import test from "node:test";
import assert from "node:assert/strict";
import {
  parseResult,
  matches,
  defaults,
  changes,
  offer,
  searchProvider,
  telegram,
  validateSettings,
  createNotificationFlusher,
  searchReport,
  searchProviderReport,
  collectSearches,
  refreshDue,
} from "../src/domain/core.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const raw = {
  title: "SEAT León 2024 Rivas 19.900 €",
  snippet: "Vendido por concesionario oficial. 8.500 km precio financiado",
  link: "https://www.coches.net/seat-leon-2024-12345678-covo.aspx",
};
test("parses grounded values and financing caution; rejects unsafe or directory links", () => {
  const x = parseResult(raw, "cars");
  assert.equal(x.price, 19900);
  assert.equal(x.km, 8500);
  assert.equal(x.distance, 0);
  assert.equal(x.caution, true);
  assert.equal(
    parseResult({ ...raw, link: "javascript:alert(1)" }, "cars"),
    null,
  );
  assert.equal(
    parseResult(
      { ...raw, link: "https://www.coches.net/segunda-mano/" },
      "cars",
    ),
    null,
  );
  assert.equal(
    parseResult(
      { ...raw, link: "https://coches.net.evil.test/12345678.htm" },
      "cars",
    ),
    null,
  );
});
test("unknown facts excluded by default and radius, budget, mileage enforced", () => {
  const x = parseResult(raw, "cars");
  assert(matches(x, defaults));
  assert(!matches({ ...x, km: 30000 }, defaults));
  assert(!matches({ ...x, distance: 40 }, defaults));
  assert(!matches({ ...x, price: null }, defaults));
  assert(matches({ ...x, price: null }, { ...defaults, includeUnknown: true }));
  assert.throws(() => validateSettings({ radius: -1 }));
});
test("first scan is silent; future new results and decreases only", () => {
  const a = { id: "a", price: 10 };
  assert.deepEqual(changes([], [a], false), []);
  assert.equal(changes([], [a], true)[0].type, "new");
  assert.equal(changes([a], [{ ...a, price: 9 }], true)[0].type, "drop");
  assert.deepEqual(changes([a], [{ ...a, price: 11 }], true), []);
});
test("comparison requires three adequate peers and avoids financing conditions", () => {
  const x = {
    id: "a",
    kind: "cars",
    sellerType: "dealer",
    title: "SEAT León TSI",
    price: 10,
    year: 2024,
    km: 8000,
  };
  const peers = [1, 2, 3].map((i) => ({ ...x, id: String(i), price: 20 }));
  assert.equal(offer(x, peers).percent, 50);
  assert.equal(offer(x, peers.slice(1)), null);
  assert.equal(offer({ ...x, caution: true }, peers), null);
});
test("mocked provider does not leak key on failure", async () => {
  const results = await searchProvider(
    "cars",
    defaults,
    "secret",
    async (u) => {
      assert.equal(u.searchParams.get("api_key"), "secret");
      return { ok: true, json: async () => ({ organic_results: [raw] }) };
    },
  );
  assert.equal(results.length, 1);
  await assert.rejects(
    searchProvider("cars", defaults, "secret", async () => {
      throw Error("secret");
    }),
    (e) => !e.message.includes("secret"),
  );
});
test("mocked Telegram sends exact chat and hides transport credentials", async () => {
  await telegram("secret", "123", "hello", async (u, o) => {
    assert.equal(JSON.parse(o.body).chat_id, "123");
    return { ok: true, json: async () => ({ ok: true }) };
  });
  await assert.rejects(
    telegram("secret", "123", "hello", async () => {
      throw Error("secret");
    }),
    (e) => !e.message.includes("secret"),
  );
});
test("purchase parser rejects rental-only chalets but preserves tenanted sale warnings and grouped areas", () => {
  const house = {
    title: "Chalet en alquiler Rivas 2.000 € 180 m² 4 hab.",
    link: "https://www.idealista.com/inmueble/123456789/",
  };
  assert.equal(parseResult(house, "houses"), null);
  const sale = parseResult(
    {
      ...house,
      title: "Chalet en venta alquilado Rivas 450.000 € 1.000 m² 4 hab.",
    },
    "houses",
  );
  assert.equal(sale.area, 1000);
  assert.equal(sale.caution, true);
  assert.equal(sale.price, 450000);
  assert.equal(
    parseResult(
      { ...house, title: "Chalet venta Rivas 450.000 € 180 m² 4 hab." },
      "houses",
    ).area,
    180,
  );
});
test("polling updates results without overwriting unsaved form controls; saved refresh repopulates", async () => {
  const source = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    load = source.match(/async function load\([^\n]+/)[0];
  let fills = 0,
    renders = 0;
  const context = vm.createContext({
    state: undefined,
    api: async () => ({ settings: defaults }),
    fill: () => fills++,
    render: () => renders++,
    toast: () => {},
  });
  vm.runInContext(load, context);
  await context.load();
  assert.equal(fills, 1);
  await context.load();
  assert.equal(fills, 1);
  await context.load(true);
  assert.equal(fills, 2);
  assert.equal(renders, 3);
  assert(!source.match(/function render\(\)\{fill/));
});
test("delivery is single-flight and retries failures once on the next flush", async () => {
  let resolve,
    attempts = 0,
    done = false;
  const item = { ...parseResult(raw, "cars"), id: "a" },
    row = {
      id: "n",
      event: JSON.stringify({ listingId: "a", price: item.price }),
      text: "alert",
    },
    flush = createNotificationFlusher({
      readSettings: () => ({ ...defaults, telegramEnabled: true }),
      readSecrets: () => ({ token: "x", chat: "y" }),
      pending: () => (done ? [] : [row]),
      findItem: () => item,
      markDone: () => {
        done = true;
      },
      send: async () => {
        attempts++;
        await new Promise((r) => (resolve = r));
        if (attempts === 1) throw Error("offline");
      },
    });
  const first = flush(),
    second = flush();
  assert.equal(first, second);
  assert.equal(attempts, 1);
  resolve();
  await assert.rejects(first);
  assert.equal(done, false);
  const retry = flush();
  assert.equal(attempts, 2);
  resolve();
  await retry;
  assert.equal(done, true);
});
test("queued delivery rechecks current filters and identity; drops obsolete pending events", async () => {
  const item = { ...parseResult(raw, "cars"), id: "a" },
    rows = [
      { id: "legacy", event: null },
      {
        id: "excluded",
        event: JSON.stringify({ listingId: "a", price: item.price }),
      },
      { id: "changed", event: JSON.stringify({ listingId: "b", price: 100 }) },
    ];
  const dropped = [];
  let sent = 0;
  const flush = createNotificationFlusher({
    readSettings: () => ({
      ...defaults,
      budgetCar: 500,
      telegramEnabled: true,
    }),
    readSecrets: () => ({ token: "x", chat: "y" }),
    pending: () => rows,
    findItem: (id) => (id === "a" ? item : { ...item, id: "b", price: 200 }),
    markDone: (id) => dropped.push(id),
    send: async () => sent++,
  });
  await flush();
  assert.deepEqual(dropped, ["legacy", "excluded", "changed"]);
  assert.equal(sent, 0);
});
test("dealer-only cars exclude private, brand-only, professional-only and unclassified legacy cars even with unknown data enabled", () => {
  const dealer = parseResult(raw, "cars"),
    s = { ...defaults, includeUnknown: true };
  assert.equal(dealer.sellerType, "dealer");
  assert(matches(dealer, s));
  for (const snippet of [
    "Venta de particular, 8.500 km",
    "Hyundai Kia coches 8.500 km",
    "Vendedor profesional 8.500 km",
    "No es un concesionario. 8.500 km",
  ]) {
    const car = parseResult({ ...raw, snippet }, "cars");
    assert.notEqual(car.sellerType, "dealer");
    assert(!matches(car, s));
  }
  const { sellerType, sellerEvidence, ...legacy } = dealer;
  assert(!matches(legacy, s));
  assert(
    matches(
      parseResult(
        { ...raw, snippet: "Vendido por concesionario Kia, 8.500 km" },
        "cars",
      ),
      s,
    ),
  );
  assert(
    matches(
      parseResult(
        { ...raw, snippet: "8.500 km", seller: { type: "dealer" } },
        "cars",
      ),
      s,
    ),
  );
});
test("comparisons cannot use unknown or private cars as peers or subjects", () => {
  const car = { ...parseResult(raw, "cars"), caution: false },
    peers = [1, 2, 3].map((i) => ({ ...car, id: String(i), price: 22000 }));
  assert(offer(car, peers));
  assert.equal(
    offer(
      car,
      peers.map((x) => ({ ...x, sellerType: "private" })),
    ),
    null,
  );
  assert.equal(offer({ ...car, sellerType: undefined }, peers), null);
});
test("pending alerts are discarded when seller has no dealership evidence", async () => {
  let sends = 0,
    done = 0;
  const car = { ...parseResult(raw, "cars"), sellerType: undefined },
    flush = createNotificationFlusher({
      readSettings: () => ({
        ...defaults,
        includeUnknown: true,
        telegramEnabled: true,
      }),
      readSecrets: () => ({ token: "x", chat: "y" }),
      pending: () => [
        {
          id: "n",
          event: JSON.stringify({ listingId: car.id, price: car.price }),
        },
      ],
      findItem: () => car,
      markDone: () => done++,
      send: async () => sends++,
    });
  await flush();
  assert.equal(sends, 0);
  assert.equal(done, 1);
});

test("dealership provenance and maintenance do not establish seller identity", () => {
  for (const snippet of [
    "Vendedor profesional. Vehículo procedente de concesionario, 8.500 km",
    "Revisado en concesionario oficial Kia, 8.500 km",
    "Mantenido en concesionario Hyundai, 8.500 km",
    "Garantía de concesionario oficial Kia, 8.500 km",
    "Mantenimiento en concesionario oficial Kia, 8.500 km",
    "Concesionario. 8.500 km",
  ]) {
    const car = parseResult({ ...raw, snippet }, "cars");
    assert.equal(car.sellerType, "unknown");
    assert(!matches(car, { ...defaults, includeUnknown: true }));
  }
  for (const snippet of [
    "Vendedor: concesionario Hyundai, 8.500 km",
    "Somos un concesionario Kia, 8.500 km",
  ])
    assert.equal(parseResult({ ...raw, snippet }, "cars").sellerType, "dealer");
  assert.equal(
    parseResult(
      {
        ...raw,
        title: "Concesionario Motor Rivas SEAT León 19.900 €",
        snippet: "8.500 km",
      },
      "cars",
    ).sellerType,
    "dealer",
  );
});
test("negated dealership identity never becomes affirmative seller evidence", () => {
  for (const snippet of [
    "No somos un concesionario. Vendedor profesional.",
    "Nunca somos un concesionario.",
    "Non somos un concesionario.",
    "No vendido por concesionario.",
    "No es un concesionario.",
    "No somos concesionario oficial Kia.",
  ]) {
    const car = parseResult({ ...raw, snippet }, "cars");
    assert.notEqual(car.sellerType, "dealer");
    assert(!matches(car, { ...defaults, includeUnknown: true }));
  }
});

test("archive diagnostics explain unsupported detail results and unknown dealer exclusions", () => {
  const report = searchReport(
    {
      organic_results: [
        { ...raw, link: "https://www.coches.net/concesionarios/madrid/" },
        { ...raw, snippet: "8.500 km Rivas" },
      ],
    },
    "cars",
    defaults,
  );
  assert.equal(report.diagnostics.raw, 2);
  assert.equal(report.diagnostics.unsupported, 1);
  assert.equal(report.diagnostics.sellerExcluded, 1);
  assert.equal(report.diagnostics.matching, 0);
});
test("provider distinguishes timeout, quota, authorization and non-JSON without leaking key", async () => {
  for (const [fetcher, code] of [
    [
      async () => {
        throw new DOMException("secret", "TimeoutError");
      },
      "timeout",
    ],
    [async () => ({ ok: false, status: 429 }), "quota"],
    [async () => ({ ok: false, status: 401 }), "auth"],
    [
      async () => ({
        ok: true,
        json: async () => {
          throw Error("secret");
        },
      }),
      "response",
    ],
  ])
    await assert.rejects(
      searchProviderReport("cars", defaults, "secret", fetcher),
      (e) => e.code === code && !e.message.includes("secret"),
    );
});
test("successful cars survive house provider failure and failed attempts honor configured interval", async () => {
  const outcomes = await collectSearches(defaults, "secret", async (kind) => {
    if (kind === "houses")
      throw Object.assign(Error("Timeout seguro"), { code: "timeout" });
    return { items: [parseResult(raw, "cars")], diagnostics: { raw: 1 } };
  });
  assert.equal(outcomes.cars.items.length, 1);
  assert.equal(outcomes.houses.code, "timeout");
  const now = Date.now();
  assert(
    !refreshDue(
      { last: null, attemptedAt: new Date(now - 60000).toISOString() },
      1440,
      now,
    ),
  );
  assert(
    refreshDue(
      { attemptedAt: new Date(now - 1441 * 60000).toISOString() },
      1440,
      now,
    ),
  );
});
test("AutoScout anuncios detail URL is supported but directory is rejected", () => {
  assert(
    parseResult(
      {
        ...raw,
        link: "https://www.autoscout24.es/anuncios/kia-ceed-gasolina-12345678-abcd-1234-abcd-123456789012",
      },
      "cars",
    ),
  );
  assert.equal(
    parseResult(
      { ...raw, link: "https://www.autoscout24.es/anuncios/" },
      "cars",
    ),
    null,
  );
});

test("cars-only source failure is a category result and skips paid house search while honoring retry interval", async () => {
  const calls = [],
    sources = [{ name: "Kia", ok: false }],
    outcomes = await collectSearches(
      defaults,
      "unused",
      async (kind) => {
        calls.push(kind);
        throw Object.assign(Error("Inventario oficial no disponible"), {
          code: "official_unavailable",
          sources,
        });
      },
      "cars",
    );
  assert.deepEqual(calls, ["cars"]);
  assert.equal(outcomes.cars.ok, false);
  assert.equal(outcomes.cars.code, "official_unavailable");
  assert.deepEqual(outcomes.cars.sources, sources);
  assert.equal(outcomes.houses.skipped, true);
  const prior = { houses: { ok: true, raw: 7 } },
    merged = {
      ...prior,
      ...Object.fromEntries(
        Object.entries(outcomes).filter(([, o]) => !o.skipped),
      ),
    };
  assert.equal(merged.houses, prior.houses);
  assert(!refreshDue({ attemptedAt: new Date().toISOString() }, 1440));
});

test("house direct mode is default and indexed fallback must be explicitly selected", () => {
  assert.equal(defaults.houseSearchMode, "direct");
  assert.equal(
    validateSettings({ houseSearchMode: "indexed" }).houseSearchMode,
    "indexed",
  );
  assert.throws(() => validateSettings({ houseSearchMode: "other" }));
});
test("house-only refresh skips car adapter and captures house source failure", async () => {
  const calls = [],
    outcomes = await collectSearches(
      defaults,
      "unused",
      async (kind) => {
        calls.push(kind);
        throw Object.assign(Error("Direct source blocked"), {
          code: "houses_unavailable",
        });
      },
      "houses",
    );
  assert.deepEqual(calls, ["houses"]);
  assert(outcomes.cars.skipped);
  assert.equal(outcomes.houses.code, "houses_unavailable");
});
