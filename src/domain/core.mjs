import { normalizeTransmission } from "../../public/car-transmission.js";
import { photoUrl } from "../services/listing-photos.mjs";
import { validPostalCode, geoDistance } from "../services/location.mjs";
import { normalizeLocality, matchesLocality } from "../../public/locality.js";
import { registrationYear } from "../../public/car-registration.js";
import { effectiveSeats } from "../../public/car-seats.js";
import { normalizeEnvironmentalLabel } from "../../public/car-label.js";
export { parseSeats } from "../../public/car-seats.js";
export const towns = {
  rivas: [40.33, -3.53],
  "rivas-vaciamadrid": [40.33, -3.53],
  arganda: [40.3, -3.44],
  "arganda del rey": [40.3, -3.44],
  velilla: [40.37, -3.49],
  "velilla de san antonio": [40.37, -3.49],
  mejorada: [40.4, -3.48],
  "mejorada del campo": [40.4, -3.48],
  loeches: [40.38, -3.41],
  "campo real": [40.34, -3.38],
  "morata de tajuña": [40.23, -3.43],
  madrid: [40.42, -3.7],
  "san fernando de henares": [40.42, -3.53],
  coslada: [40.42, -3.56],
  "torrejon de ardoz": [40.46, -3.48],
  "torrejón de ardoz": [40.46, -3.48],
  "san martin de la vega": [40.21, -3.57],
  "san martín de la vega": [40.21, -3.57],
};
export const defaults = {
  postalCode: "",
  origin: null,
  onlyChalets: false,
  radius: 30,
  budgetCar: 40000,
  budgetHouse: 500000,
  maxKm: 20000,
  minYear: 0,
  seats: 0,
  environmentalLabel: "",
  transmission: "",
  model: "",
  locality: "",
  beds: 0,
  minArea: 0,
  includeUnknown: false,
  interval: 1440,
  houseSearchMode: "direct",
  telegramEnabled: false,
};
export function distance(coordinates, origin = [40.33, -3.53]) {
  return geoDistance(coordinates, origin);
}
const number = (s) => Number(s.replace(/\./g, "").replace(",", "."));
export function houseExclusionReasons(x) {
  if (x.kind !== "houses") return [];
  const reasons = new Set(x.specialExclusionReasons || []),
    warnings = x.warnings || [];
  if (warnings.includes("Condiciones especiales en la descripción"))
    reasons.add("Condición especial señalada en la descripción original");
  for (const [flag, label, legacy] of [
    ["isOccupied", "Ocupación", "Ocupado"],
    ["isBareOwnership", "Nuda propiedad", "Nuda propiedad"],
    ["isRentedWithTenants", "Con inquilinos", "Con inquilinos"],
    ["isAuctioned", "Subasta", "Subasta"],
  ])
    if (x[flag] || warnings.includes(legacy)) reasons.add(label);
  const text = [x.title, x.description, x.snippet]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\blibre de (?:ocupantes|inquilinos|ocupacion)\b|\bsin (?:inquilinos|ocupantes|ocupacion)\b|\bno (?:esta |se encuentra )?(?:o[kc]upad[oa]s?|alquilad[oa]s?)\b|\bno se puede visitar sin cita previa\b/g,
      "",
    );
  for (const [pattern, label] of [
    [/\bo[kc]upad[oa]s?\b|\bsin posesion\b/, "Ocupación o sin posesión"],
    [/\b(?:con inquilinos|alquilad[oa]s?)\b/, "Con inquilinos"],
    [/\bnuda propiedad\b|\busufructo\b/, "Nuda propiedad o usufructo"],
    [
      /\bsubasta\b|\bcesion (?:de )?(?:remate|derechos)\b/,
      "Subasta o cesión de derechos",
    ],
    [
      /\bno (?:es |resulta )?(?:hipotecable|financiable)\b|\bsin (?:posibilidad de )?financiacion\b|\b(?:solo|solamente|unicamente|exclusivamente) (?:al )?contado\b/,
      "No hipotecable o solo contado",
    ],
    [
      /\b(?:suelo|finca|terreno|parcela) rustic[oa]\b|\b(?:suelo|terreno) no urbanizable\b/,
      "Suelo rústico o no urbanizable",
    ],
    [
      /\b(?:vivienda|construccion|obra|edificacion)[^.!?]{0,60}\b(?:ilegal|sin licencia)\b/,
      "Irregularidad urbanística",
    ],
    [
      /\bno (?:se )?(?:puede|es posible) visitar\b|\bsin (?:posibilidad de )?visita(?:s)?\b/,
      "No se puede visitar",
    ],
  ])
    if (pattern.test(text)) reasons.add(label);
  return [...reasons];
}
export function isEligibleListing(x) {
  return x.kind === "cars"
    ? x.sellerType === "dealer" &&
        !x.manualSnapshot &&
        x.provider !== "hyundai-manual"
    : x.kind === "houses"
      ? houseExclusionReasons(x).length === 0
      : true;
}
export function classifySeller(result) {
  const text = String(result.title || "") + " " + String(result.snippet || "");
  const privateEvidence = text.match(
    /\bparticular(?:es)?\b|\b(?:no|nunca|non)\b[^.!?;\n]{0,90}\bconcesionario\b|\bsin concesionario\b/i,
  );
  if (privateEvidence)
    return { sellerType: "private", sellerEvidence: privateEvidence[0] };
  const sellerText = text.replace(
    /\b(?:procedente de|revisad[oa] en|mantenid[oa] en|garant[ií]a (?:de|en)|historial (?:de|en)|mantenimiento (?:de|en))\s+(?:un |el |nuestro )?concesionario(?:\s+oficial)?/gi,
    "",
  );
  const evidence =
    sellerText.match(
      /\b(?:vendido|venta|ofrecido|anunciado)\s+por\s+(?:el |un )?concesionario(?:\s+oficial)?\b|\bvendedor\s*:\s*concesionario(?:\s+oficial)?\b|\bsomos\s+(?:un |el )?concesionario(?:\s+oficial)?\b/iu,
    ) ||
    String(result.title || "").match(/^concesionario\s+[\p{L}][\p{L}\d-]+/iu);
  if (evidence) return { sellerType: "dealer", sellerEvidence: evidence[0] };
  if (result.seller?.type === "dealer")
    return {
      sellerType: "dealer",
      sellerEvidence:
        "Tipo de vendedor dealer en datos estructurados del resultado",
    };
  return { sellerType: "unknown", sellerEvidence: null };
}
export function parseResult(result, kind) {
  let url;
  try {
    url = new URL(result.link);
  } catch {
    return null;
  }
  const hosts =
    kind === "cars"
      ? ["coches.net", "autoscout24.es", "autocasion.com"]
      : ["idealista.com", "fotocasa.es"];
  if (
    url.protocol !== "https:" ||
    !hosts.some((h) => url.hostname === h || url.hostname.endsWith("." + h))
  )
    return null;
  const detail =
    kind === "cars"
      ? /\d{5,}.*\.(?:htm|aspx)|\/(?:ofertas|anuncios)\/.+-[a-f0-9]{8}-|\/(?:vo|coches-segunda-mano)\/.+\d{5,}/i.test(
          url.pathname,
        )
      : /\/inmueble\/\d+|\/comprar\/vivienda\/.+\/\d+/i.test(url.pathname);
  if (!detail) return null;
  const title = String(result.title || "").slice(0, 250),
    snippet = String(result.snippet || "").slice(0, 2000),
    text = title + " " + snippet;
  if (
    kind === "houses" &&
    /\balquiler\b|\bse alquila\b|\balquilar\b/i.test(text) &&
    !/\bventa\b|\bcomprar\b/i.test(text)
  )
    return null;
  const p = text.match(/(\d{1,3}(?:\.\d{3})+|\d{4,7})(?:,\d{2})?\s*€/),
    km = text.match(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:km|kilómetros)\b/i),
    area = text.match(/(\d{1,3}(?:\.\d{3})+|\d{2,5})(?:,\d+)?\s*m[²2]/i),
    beds = text.match(/(\d{1,2})\s*(?:hab\.?|dormitorios)/i),
    year = text.match(/\b(20[012]\d)\b/);
  const locality = Object.keys(towns)
    .sort((a, b) => b.length - a.length)
    .find((t) => text.toLowerCase().includes(t));
  return {
    id: url.href.split("#")[0],
    url: url.href,
    title,
    snippet,
    kind,
    ...(kind === "cars"
      ? classifySeller(result)
      : {
          photoUrl: photoUrl(
            result.thumbnail || result.pagemap?.cse_image?.[0]?.src,
          ),
          houseType: /chalet|adosad|paread|unifamiliar/i.test(text)
            ? "chalet"
            : "home",
          specialExclusionReasons: houseExclusionReasons({
            kind: "houses",
            title,
            description: String(result.snippet || ""),
          }),
        }),
    price: p ? number(p[1]) : null,
    km: km ? number(km[1]) : null,
    area: area ? number(area[1]) : null,
    beds: beds ? +beds[1] : null,
    year: year ? +year[1] : null,
    locality: locality || null,
    distance: locality ? distance(towns[locality]) : null,
    source: url.hostname.replace("www.", ""),
    caution:
      /financia|financiado|cuota|ocupad|nuda propiedad|alquilad|sin posesión|sin posesion/i.test(
        text,
      ),
  };
}
export function createNotificationFlusher({
  readSettings,
  readSecrets,
  pending,
  findItem,
  markDone,
  send,
}) {
  let running;
  return function flush() {
    if (running) return running;
    running = (async () => {
      for (const row of pending()) {
        const settings = readSettings(),
          secrets = readSecrets();
        if (!settings.telegramEnabled || !secrets.token || !secrets.chat)
          return;
        let event;
        try {
          event = JSON.parse(row.event);
        } catch {
          markDone(row.id);
          continue;
        }
        if (!event || typeof event.listingId !== "string") {
          markDone(row.id);
          continue;
        }
        const current = findItem(event.listingId);
        if (
          !current ||
          current.price !== event.price ||
          !matches(current, settings)
        ) {
          markDone(row.id);
          continue;
        }
        await send(secrets.token, secrets.chat, row.text);
        markDone(row.id);
      }
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
}
export function matches(x, s) {
  if (
    x.availability === "sold" ||
    !isEligibleListing(x) ||
    !matchesLocality(x, s.locality) ||
    (x.kind === "houses" && s.onlyChalets && x.houseType !== "chalet")
  )
    return false;
  const unknown = (v, test) => (v == null ? s.includeUnknown : test(v));
  return (
    unknown(
      x.price,
      (v) => v <= (x.kind === "cars" ? s.budgetCar : s.budgetHouse),
    ) &&
    ((x.distanceBasis === "provider-radius" && x.searchRadius <= s.radius) ||
      unknown(x.distance, (v) => v <= s.radius)) &&
    (x.kind === "cars"
      ? unknown(x.km, (v) => v <= s.maxKm) &&
        (!s.minYear || unknown(registrationYear(x), (v) => v >= s.minYear)) &&
        (!s.seats || effectiveSeats(x.seats) >= s.seats) &&
        (!s.transmission || normalizeTransmission(x.transmission) === s.transmission) &&
        (!s.environmentalLabel ||
          normalizeEnvironmentalLabel(x.environmentalLabel) ===
            s.environmentalLabel) &&
        (!s.model || x.title.toLowerCase().includes(s.model.toLowerCase()))
      : unknown(x.area, (v) => v >= s.minArea) &&
        unknown(x.beds, (v) => v >= s.beds))
  );
}
export function validateSettings(input, previous = defaults) {
  const s = { ...defaults, ...previous };
  if ("postalCode" in input) {
    if (!validPostalCode(input.postalCode))
      throw Error("Configuración: código postal español no válido");
    s.postalCode = input.postalCode;
  }
  if ("minYear" in input) {
    const value = input.minYear;
    if (
      (typeof value !== "number" &&
        !(typeof value === "string" && /^\d*$/.test(value.trim()))) ||
      !Number.isInteger(Number(value)) ||
      (Number(value) !== 0 && (Number(value) < 1900 || Number(value) > 9999))
    )
      throw Error("Año mínimo de matriculación no válido");
    s.minYear = Number(value);
  }
  if ("seats" in input) {
    const value = input.seats;
    if (
      (typeof value !== "number" &&
        !(typeof value === "string" && /^\d+$/.test(value.trim()))) ||
      !Number.isInteger(Number(value)) ||
      Number(value) < 0 ||
      Number(value) > 9
    )
      throw Error("Configuración no válida");
    s.seats = Number(value);
  }
  if ("environmentalLabel" in input) {
    if (
      typeof input.environmentalLabel !== "string" ||
      !["", "B", "C", "ECO", "0"].includes(input.environmentalLabel)
    )
      throw Error("Etiqueta ambiental no válida");
    s.environmentalLabel = input.environmentalLabel;
  }
  if ("transmission" in input) {
    if (typeof input.transmission !== "string" || !["", "manual", "automatic"].includes(input.transmission))
      throw Error("Tipo de cambio no válido");
    s.transmission = input.transmission;
  }
  if ("houseSearchMode" in input) {
    if (!["direct", "indexed"].includes(input.houseSearchMode))
      throw Error("Configuración no válida");
    s.houseSearchMode = input.houseSearchMode;
  }
  for (const [k, min, max] of [
    ["radius", 1, 200],
    ["budgetCar", 1, 1000000],
    ["budgetHouse", 1, 10000000],
    ["maxKm", 0, 100000],
    ["beds", 0, 20],
    ["minArea", 0, 2000],
    ["interval", 15, 1440],
  ]) {
    if (k in input) {
      const n = Number(input[k]);
      if (!Number.isFinite(n) || n < min || n > max)
        throw Error("Valores de búsqueda fuera de rango");
      s[k] = n;
    }
  }
  for (const k of ["includeUnknown", "telegramEnabled", "onlyChalets"])
    if (k in input) {
      if (typeof input[k] !== "boolean") throw Error("Configuración no válida");
      s[k] = input[k];
    }
  if ("locality" in input) {
    if (typeof input.locality !== "string" || input.locality.length > 150)
      throw Error("Configuración no válida");
    s.locality = input.locality.trim();
  }
  if ("model" in input) s.model = String(input.model).slice(0, 80);
  return s;
}
export function offer(x, all) {
  if (x.availability === "sold" || x.caution || !isEligibleListing(x))
    return null;
  const peers = all.filter(
    (y) =>
      y.availability !== "sold" &&
      !y.caution &&
      isEligibleListing(y) &&
      y.id !== x.id &&
      y.price &&
      y.kind === x.kind &&
      (x.kind === "cars"
        ? x.year &&
          y.year &&
          Math.abs(x.year - y.year) <= 1 &&
          x.km != null &&
          y.km != null &&
          Math.abs(x.km - y.km) <= 10000 &&
          x.title.toLowerCase().split(" ").slice(0, 2).join(" ") ===
            y.title.toLowerCase().split(" ").slice(0, 2).join(" ")
        : x.locality &&
          x.locality === y.locality &&
          x.area &&
          y.area &&
          Math.abs(x.area - y.area) / x.area < 0.2),
  );
  if (peers.length < 3 || !x.price) return null;
  const prices = peers.map((y) => y.price).sort((a, b) => a - b),
    median = prices[Math.floor(prices.length / 2)];
  return {
    percent: Math.round((1 - x.price / median) * 100),
    samples: peers.length,
  };
}
export function changes(previous, next, baseline) {
  if (!baseline) return [];
  return next.flatMap((x) => {
    const old = previous.find((y) => y.id === x.id);
    return !old
      ? [{ type: "new", item: x }]
      : old.price && x.price && x.price < old.price
        ? [{ type: "drop", item: x, oldPrice: old.price }]
        : [];
  });
}
export function queryFor(kind, s) {
  const place = s.origin?.name || s.postalCode;
  return kind === "cars"
    ? `(site:coches.net OR site:autoscout24.es OR site:autocasion.com) ${s.model} concesionario seminuevo ${place}`
    : `(site:idealista.com/inmueble/ OR site:fotocasa.es) ${s.onlyChalets ? "chalet" : "vivienda"} venta ${place} ${s.postalCode}`;
}
function indexedLocation(item, settings) {
  if (!settings.origin) return item;
  if (item.locality && towns[item.locality])
    return {
      ...item,
      distance: distance(towns[item.locality], settings.origin.coordinates),
    };
  const municipality = normalizeLocality(settings.origin.name),
    title = normalizeLocality(item.title);
  // Require a title's location phrase, rather than a province or a passing mention.
  const phrase =
    title.match(
      /\b(?:en venta|venta|comprar|en)\s+(?:en\s+)?([^\d·,|:;]+?)(?=\s*(?:[·,|:;]|\d|$))/g,
    ) || [];
  const identified = phrase.some(
    (value) =>
      value
        .replace(/^(?:en venta|venta|comprar|en)\s+(?:en\s+)?/, "")
        .trim() === municipality,
  );
  return identified
    ? {
        ...item,
        locality: municipality,
        distance: 0,
        distanceBasis: "municipality-estimate",
      }
    : { ...item, distance: null };
}
export function searchReport(body, kind, s) {
  const raw = body.organic_results || [],
    items = raw
      .map((x) => parseResult(x, kind))
      .filter(Boolean)
      .map((x) => indexedLocation(x, s)),
    eligible = items.filter(
      (x) => kind !== "cars" || x.sellerType === "dealer",
    );
  return {
    items,
    diagnostics: {
      raw: raw.length,
      accepted: items.length,
      unsupported: raw.length - items.length,
      sellerExcluded: items.length - eligible.length,
      filterExcluded: eligible.filter((x) => !matches(x, s)).length,
      matching: eligible.filter((x) => matches(x, s)).length,
      searchId: body.search_metadata?.id || null,
      providerSeconds: body.search_metadata?.total_time_taken ?? null,
    },
  };
}
export function providerFailure(code) {
  const messages = {
    timeout:
      "La búsqueda agotó el tiempo de espera. El proveedor puede haberla completado: revisa su historial antes de repetir.",
    auth: "El proveedor rechazó la clave de acceso.",
    forbidden:
      "El proveedor denegó el acceso (HTTP 403). Revisa la clave o las restricciones de acceso.",
    quota: "Cuota o límite del proveedor agotado.",
    network: "No se pudo conectar con el proveedor.",
    response: "El proveedor devolvió una respuesta no válida.",
    provider: "El proveedor no pudo completar la búsqueda.",
  };
  const e = Error(messages[code] || messages.provider);
  e.code = code;
  return e;
}
export async function searchProviderReport(kind, s, key, fetcher = fetch) {
  const u = new URL("https://serpapi.com/search");
  for (const [k, v] of Object.entries({
    engine: "google",
    q: queryFor(kind, s),
    api_key: key,
    gl: "es",
    hl: "es",
  }))
    u.searchParams.set(k, v);
  const started = Date.now();
  let res;
  try {
    res = await fetcher(u, { signal: AbortSignal.timeout(90000) });
  } catch (e) {
    throw providerFailure(
      e.name === "TimeoutError" || e.name === "AbortError"
        ? "timeout"
        : "network",
    );
  }
  if (!res.ok)
    throw providerFailure(
      res.status === 401
        ? "auth"
        : res.status === 403
          ? "forbidden"
          : res.status === 429
            ? "quota"
            : "provider",
    );
  let body;
  try {
    body = await res.json();
  } catch {
    throw providerFailure("response");
  }
  if (body.error)
    throw providerFailure(
      /quota|limit|credits|searches.*run out/i.test(String(body.error))
        ? "quota"
        : /key|unauthorized/i.test(String(body.error))
          ? "auth"
          : "provider",
    );
  const report = searchReport(body, kind, s);
  report.diagnostics.elapsedMs = Date.now() - started;
  return report;
}
export async function searchProvider(kind, s, key, fetcher = fetch) {
  return (await searchProviderReport(kind, s, key, fetcher)).items;
}
export async function collectSearches(
  s,
  key,
  provider = searchProviderReport,
  scope = "both",
) {
  const outcomes = {};
  for (const kind of ["cars", "houses"]) {
    if (
      (scope === "cars" && kind === "houses") ||
      (scope === "houses" && kind === "cars")
    ) {
      outcomes[kind] = { skipped: true };
      continue;
    }
    try {
      outcomes[kind] = { ok: true, ...(await provider(kind, s, key)) };
    } catch (e) {
      outcomes[kind] = {
        ok: false,
        error: e.message,
        code: e.code || "provider",
        sources: e.sources,
      };
    }
  }
  return outcomes;
}
export function refreshDue(status, interval, now = Date.now()) {
  const last = status.attemptedAt || status.last;
  return !last || now - Date.parse(last) >= interval * 60000;
}
export async function telegram(token, chat, text, fetcher = fetch) {
  try {
    const res = await fetcher(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chat,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const b = await res.json();
    if (!res.ok || !b.ok) throw Error();
  } catch {
    throw Error(
      "Telegram no pudo entregar el mensaje. Revisa el bot y el chat.",
    );
  }
}

export function toyotaVerification(item, sources = []) {
  if (item.provider !== "toyota-official") return null;
  const source = sources.find((source) => source.name === "Toyota");
  if (source?.ok === false) return false;
  const checkedAt = source?.checkedAt;
  if (!checkedAt) return null;
  return item.lastSeen === checkedAt;
}
