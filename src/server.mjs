import { resolvePostalCode } from "./services/location.mjs";
import { checkMissingCars } from "./services/availability.mjs";
import { createPhotoCache } from "./services/listing-photos.mjs";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import {
  defaults,
  houseExclusionReasons,
  isEligibleListing,
  validateSettings,
  matches,
  offer,
  changes,
  searchProvider,
  telegram,
  collectSearches,
  refreshDue,
  createNotificationFlusher,
  toyotaVerification,
} from "./domain/core.mjs";
import { searchDirectHouses } from "./sources/house-sources.mjs";
import { searchOfficialCars } from "./sources/official-sources.mjs";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  dir = process.env.RADAR_DATA_DIR || join(root, ".data");
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
const firstPhoto = createPhotoCache(join(dir, "photos"));
const db = new DatabaseSync(join(dir, "radar.sqlite"));
chmodSync(join(dir, "radar.sqlite"), 0o600);
db.exec(
  "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, data TEXT); CREATE TABLE IF NOT EXISTS history (id TEXT, price REAL, at TEXT); CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, text TEXT, sent INTEGER DEFAULT 0);",
);
if (
  !db
    .prepare("PRAGMA table_info(notifications)")
    .all()
    .some((c) => c.name === "event")
)
  db.exec("ALTER TABLE notifications ADD COLUMN event TEXT");
const get = (k, f) => {
    const r = db.prepare("SELECT value FROM kv WHERE key=?").get(k);
    return r ? JSON.parse(r.value) : f;
  },
  set = (k, v) =>
    db
      .prepare("INSERT OR REPLACE INTO kv VALUES (?,?)")
      .run(k, JSON.stringify(v));
let settings = { ...defaults, ...get("settings", defaults) },
  busy = false,
  status = get("status", { last: null, error: null }),
  csrf = randomBytes(32).toString("hex");
const all = () =>
  db
    .prepare("SELECT data FROM listings")
    .all()
    .map((r) => JSON.parse(r.data));
const flush = createNotificationFlusher({
  readSettings: () => settings,
  readSecrets: () => get("secrets", {}),
  pending: () =>
    db.prepare("SELECT * FROM notifications WHERE sent=0 LIMIT 10").all(),
  findItem: (id) => {
    const r = db.prepare("SELECT data FROM listings WHERE id=?").get(id);
    const item = r ? JSON.parse(r.data) : null;
    return item?.searchPostalCode === settings.postalCode ? item : null;
  },
  markDone: (id) =>
    db.prepare("UPDATE notifications SET sent=1 WHERE id=?").run(id),
  send: telegram,
});
async function refresh(scope = "both") {
  if (busy || !settings.origin || !settings.postalCode) return;
  const searchSettings = structuredClone(settings);
  const secrets = get("secrets", {});
  busy = true;
  const now = new Date().toISOString();
  status = { ...status, attemptedAt: now, error: null };
  set("status", status);
  try {
    const previous = all(),
      outcomes = await collectSearches(
        searchSettings,
        secrets.key,
        async (kind, s, key) => {
          if (kind === "cars") return searchOfficialCars(s);
          if (s.houseSearchMode !== "indexed") return searchDirectHouses(s);
          if (!key)
            throw Object.assign(
              Error("Configura SerpAPI para buscar viviendas."),
              { code: "not_configured" },
            );
          return (await import("./domain/core.mjs")).searchProviderReport(
            kind,
            s,
            key,
          );
        },
        scope,
      ),
      next = Object.values(outcomes)
        .filter((x) => x.ok)
        .flatMap((x) => x.items),
      unique = [...new Map(next.map((x) => [x.id, x])).values()];
    if (outcomes.cars?.ok)
      for (const source of outcomes.cars.diagnostics?.sources || [])
        if (source.name === "Toyota" && source.ok) source.checkedAt = now;
    const availability = outcomes.cars?.ok
      ? await checkMissingCars(
          previous.filter(isEligibleListing),
          unique,
          searchSettings.postalCode,
          status.availabilityOffset,
        )
      : { items: [], offset: status.availabilityOffset };
    const unavailable = availability.items.map((item) => ({
      ...item,
      availability: "sold",
      availabilityCheckedAt: now,
    }));
    status = { ...status, availabilityOffset: availability.offset };
    db.exec("BEGIN");
    try {
      for (const item of unavailable)
        db.prepare("INSERT OR REPLACE INTO listings VALUES (?,?)").run(
          item.id,
          JSON.stringify(item),
        );
      for (const x of unique) {
        const old = previous.find((y) => y.id === x.id),
          item = {
            ...x,
            searchPostalCode: searchSettings.postalCode,
            availability: "available",
            firstSeen: old?.firstSeen || now,
            lastSeen: now,
            favourite: old?.favourite || false,
          };
        db.prepare("INSERT OR REPLACE INTO listings VALUES (?,?)").run(
          x.id,
          JSON.stringify(item),
        );
        if (x.price != null && old?.price !== x.price)
          db.prepare("INSERT INTO history VALUES (?,?,?)").run(
            x.id,
            x.price,
            now,
          );
      }
      for (const kind of ["cars", "houses"])
        if (outcomes[kind]?.ok) {
          const baseline = get("baseline:" + kind, get("baseline", false));
          if (settings.telegramEnabled)
            for (const event of changes(
              previous,
              outcomes[kind].items,
              baseline,
            ).filter((e) => matches(e.item, settings))) {
              const x = event.item,
                id = event.type + ":" + x.id + ":" + x.price;
              db.prepare(
                "INSERT OR IGNORE INTO notifications (id,text,event) VALUES (?,?,?)",
              ).run(
                id,
                (event.type === "new" ? "Nuevo anuncio" : "Bajada de precio") +
                  ": " +
                  x.title +
                  "\n" +
                  (x.price
                    ? x.price.toLocaleString("es-ES") + " €"
                    : "Precio desconocido") +
                  "\n" +
                  x.url,
                JSON.stringify({
                  listingId: x.id,
                  type: event.type,
                  price: x.price,
                }),
              );
            }
          set("baseline:" + kind, true);
        }
      const categories = {
        ...status.categories,
        ...Object.fromEntries(
          Object.entries(outcomes)
            .filter(([, o]) => !o.skipped)
            .map(([kind, o]) => [
              kind,
              o.ok
                ? { ok: true, ...o.diagnostics }
                : {
                    ok: false,
                    error: o.error,
                    code: o.code,
                    sources: o.sources,
                  },
            ]),
        ),
      };
      status = {
        ...status,
        last:
          next.length || Object.values(outcomes).some((o) => o.ok)
            ? now
            : status.last,
        error:
          Object.entries(outcomes)
            .filter(([, o]) => !o.ok && !o.skipped)
            .map(
              ([k, o]) =>
                (k === "cars" ? "Coches" : "Viviendas") + ": " + o.error,
            )
            .join(" ") || null,
        found: unique.length,
        categories,
      };
      set("status", status);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    await flush();
  } catch {
    status = {
      ...status,
      error:
        "No se pudo guardar o completar la revisión. Los anuncios guardados se conservan.",
    };
    set("status", status);
  } finally {
    busy = false;
  }
}
const json = (res, code, data) => {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
};
export function trustedRequest(req, port) {
  return (
    req.headers.host === `127.0.0.1:${port}` ||
    req.headers.host === `localhost:${port}`
  );
}
const port = Number(process.env.PORT || 8081);
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (!trustedRequest(req, port))
    return json(res, 403, { error: "Host no permitido" });
  const path = new URL(req.url, "http://localhost").pathname;
  try {
    if (req.method === "GET" && path === "/api/photo") {
      const id = new URL(req.url, "http://localhost").searchParams.get("id"),
        item = all().find((x) => x.id === id && isEligibleListing(x));
      const photo = item ? await firstPhoto(item) : null;
      if (!photo) return json(res, 404, { error: "Foto no disponible" });
      res.writeHead(200, {
        "content-type": photo.type,
        "cache-control": "private, max-age=3600",
      });
      return res.end(photo.bytes);
    }
    if (req.method === "GET" && path === "/api/state") {
      const secrets = get("secrets", {}),
        items = all().filter(
          (x) => settings.origin && x.searchPostalCode === settings.postalCode,
        ),
        special = items.filter(
          (x) => x.kind === "houses" && houseExclusionReasons(x).length,
        ),
        exclusions = {
          specialExcluded: special.length,
          reasons: special.reduce((acc, x) => {
            for (const reason of houseExclusionReasons(x))
              acc[reason] = (acc[reason] || 0) + 1;
            return acc;
          }, {}),
        },
        categories = { ...status.categories };
      if (categories.houses)
        categories.houses = {
          ...categories.houses,
          specialExcluded: special.length,
          matching: items.filter(
            (x) => x.kind === "houses" && matches(x, settings),
          ).length,
        };
      return json(res, 200, {
        csrf,
        settings,
        status: { ...status, categories, busy, automatic: true },
        exclusions,
        configured: {
          provider: !!secrets.key,
          telegram: !!(secrets.token && secrets.chat),
        },
        items: items
          .filter(isEligibleListing)
          .map((x) => ({
            ...x,
            verifiedInLatestSearch: toyotaVerification(
              x,
              status.categories?.cars?.sources,
            ),
            offer: offer(x, items),
            history: db
              .prepare("SELECT price,at FROM history WHERE id=? ORDER BY at")
              .all(x.id),
          })),
      });
    }
    if (req.method === "POST" && path.startsWith("/api/")) {
      if (
        req.headers["x-csrf-token"] !== csrf ||
        !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(
          req.headers.origin,
        ) ||
        !String(req.headers["content-type"]).startsWith("application/json")
      )
        return json(res, 403, { error: "Solicitud no permitida" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16384)
          return json(res, 413, { error: "Solicitud demasiado grande" });
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "JSON no válido" });
      }
      if (path === "/api/settings") {
        if (busy)
          throw Error(
            "Configuración: espera a que termine la búsqueda antes de cambiar los filtros",
          );
        const next = validateSettings(data, settings);
        if (next.postalCode !== settings.postalCode || !next.origin)
          next.origin = await resolvePostalCode(next.postalCode);
        const locationChanged = next.postalCode !== settings.postalCode;
        if (locationChanged) next.locality = "";
        const secrets = get("secrets", {});
        for (const [input, key, max] of [
          ["providerKey", "key", 256],
          ["botToken", "token", 256],
          ["chatId", "chat", 100],
        ])
          if (data[input]) {
            if (typeof data[input] !== "string" || data[input].length > max)
              throw Error("Credenciales no válidas");
            if (key === "token" && !/^\d+:[A-Za-z0-9_-]+$/.test(data[input]))
              throw Error("Token de bot no válido");
            if (key === "chat" && !/^-?\d+$|^@[A-Za-z0-9_]+$/.test(data[input]))
              throw Error("Chat de Telegram no válido");
            secrets[key] = data[input];
          }
        if (next.telegramEnabled && (!secrets.token || !secrets.chat))
          throw Error("Configura el bot y el chat antes de activar alertas");
        if (!settings.telegramEnabled && next.telegramEnabled)
          db.prepare("UPDATE notifications SET sent=1 WHERE sent=0").run();
        if (locationChanged) {
          set("baseline:cars", false);
          set("baseline:houses", false);
          status = { last: null, error: null };
          set("status", status);
        }
        settings = next;
        set("settings", settings);
        set("secrets", secrets);
        return json(res, 200, { ok: true });
      }
      if (path === "/api/refresh") {
        void refresh(
          ["cars", "houses"].includes(data.scope) ? data.scope : "both",
        );
        return json(res, 202, { ok: true });
      }
      if (path === "/api/favourite") {
        const item = all().find((x) => x.id === data.id);
        if (!item) return json(res, 404, { error: "Anuncio no encontrado" });
        item.favourite = !item.favourite;
        db.prepare("UPDATE listings SET data=? WHERE id=?").run(
          JSON.stringify(item),
          item.id,
        );
        return json(res, 200, { ok: true });
      }
      if (path === "/api/telegram-test") {
        const s = get("secrets", {});
        if (!s.token || !s.chat) throw Error("Guarda primero el bot y el chat");
        await telegram(
          s.token,
          s.chat,
          "Radar local: conexión de Telegram verificada.",
        );
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "Ruta no encontrada" });
    }
    if (
      req.method === "GET" &&
      [
        "/",
        "/app.js",
        "/car-detail.js",
        "/saved-cars-pdf.js",
        "/car-seats.js",
        "/car-registration.js",
        "/car-label.js",
        "/car-transmission.js",
        "/locality.js",
        "/style.css",
      ].includes(path)
    ) {
      const file = path === "/" ? "index.html" : path.slice(1);
      res.writeHead(200, {
        "content-type": file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : file.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
      });
      return res.end(readFileSync(join(root, "public", file)));
    }
    json(res, 404, { error: "No encontrado" });
  } catch (e) {
    json(res, 400, {
      error:
        e.message === "Valores de búsqueda fuera de rango" ||
        /Configuración|Credenciales|Token de bot|Chat de Telegram|Configura el bot|Guarda primero|Telegram no pudo/.test(
          e.message,
        )
          ? e.message
          : "No se pudo completar la operación.",
    });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Radar local: http://127.0.0.1:${port}`),
);
setInterval(() => {
  if (!busy && refreshDue(status, settings.interval)) void refresh();
  else if (!busy) void flush().catch(() => {});
}, 60000).unref();
