import { matchesLocality } from "../public/locality.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  defaults,
  matches,
  parseSeats,
  validateSettings,
} from "../src/domain/core.mjs";
import {
  parseToyotaCar,
  searchToyotaCars,
} from "../src/sources/toyota-sources.mjs";
import { parseKiaCar } from "../src/sources/official-sources.mjs";
import { effectiveSeats, seatLabel } from "../public/car-seats.js";
import { buildCarDetail } from "../public/car-detail.js";
const toyota = JSON.parse(
  readFileSync(new URL("./fixtures/toyota-stock.json", import.meta.url)),
);
const kia = JSON.parse(
  readFileSync(new URL("./fixtures/kia-stock.json", import.meta.url)),
).vehiculos[0];
const car = {
  id: "car",
  kind: "cars",
  title: "Example",
  sellerType: "dealer",
  price: 15000,
  distance: 5,
  km: 10000,
  seats: 5,
};
test("minimum seat filter assumes five for unknown seats independently of other unknown data", () => {
  for (const includeUnknown of [true, false]) {
    const settings = { ...defaults, seats: 5, includeUnknown };
    assert(matches(car, settings));
    assert(!matches({ ...car, seats: 4 }, settings));
    assert(matches({ ...car, seats: null }, settings));
    const legacy = { ...car };
    delete legacy.seats;
    assert(matches(legacy, settings));
  }
  assert(matches({ ...car, seats: null }, { ...defaults, seats: 0 }));
  const old = { ...defaults };
  delete old.seats;
  assert(matches({ ...car, seats: null }, old));
  assert(
    matches(
      { kind: "houses", price: 100000, distance: 1, area: 100, beds: 3 },
      { ...defaults, seats: 7 },
    ),
  );
});
test("seat settings validate integers and keep the selection across unrelated changes and JSON storage", () => {
  const selected = validateSettings({ seats: "7" });
  assert.equal(selected.seats, 7);
  const saved = JSON.parse(JSON.stringify(selected));
  assert.equal(validateSettings({ radius: 25 }, saved).seats, 7);
  assert.equal(validateSettings({ seats: "0" }, saved).seats, 0);
  const legacy = { ...defaults };
  delete legacy.seats;
  assert.equal(validateSettings({ model: "Yaris" }, legacy).seats, 0);
  for (const seats of [
    true,
    false,
    null,
    [],
    {},
    "",
    1.5,
    "5.5",
    -1,
    10,
    "7 seats",
    NaN,
  ])
    assert.throws(() => validateSettings({ seats }), /Configuración/);
});
test("seat parsing preserves only explicit valid counts and never infers from models", () => {
  for (const value of [null, undefined, 0, 10, 4.5, true, "", "5 seats"])
    assert.equal(parseSeats(value), null);
  assert.equal(parseSeats("5"), 5);
  assert.equal(parseSeats(7), 7);
  assert.equal(parseToyotaCar(toyota).seats, toyota.product.seats);
  assert.equal(
    parseToyotaCar({
      ...toyota,
      product: { ...toyota.product, seats: undefined },
    }).seats,
    null,
  );
  assert.equal(parseKiaCar(kia).seats, null);
});
test("browser and server agree about seat count for normal cards and favourites", () => {
  const source = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  const allowed = source.match(/function allowed\(x\)\{[^\n]+/)[0];
  const context = vm.createContext({
    effectiveSeats,
    matchesLocality,
    state: { settings: { ...defaults, seats: 5, includeUnknown: true } },
  });
  vm.runInContext(allowed, context);
  for (const seats of [undefined, null, 0, "invalid", 4, 5, 7]) {
    const row = { ...car, seats, favourite: true };
    assert.equal(context.allowed(row), matches(row, context.state.settings));
  }
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<select name="seats">/);
  assert.match(html, /<option value="0">Todas<\/option>/);
});
test("Toyota requests confirmed non-five seat counts before its pagination limit", async () => {
  let query;
  const data = JSON.stringify({
    carFilters: { usedCarLocation: { dealerCache: [toyota.dealer] } },
  }).replace(/"/g, "&quot;");
  await searchToyotaCars({ ...defaults, seats: 7 }, async (url, options) => {
    if (!options?.method)
      return {
        ok: true,
        text: async () => '<div id="tor-test-data">' + data + "</div>",
      };
    query = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ results: [], totalResultCount: 0, errorLogs: [] }),
    };
  });
  assert.deepEqual(
    query.filters.find((x) => x.filterId === "usedCarSeats"),
    { filterId: "usedCarSeats", min: 7, max: 9 },
  );
});
test("missing or invalid seats count as assumed five without replacing confirmed counts", () => {
  for (const seats of [
    undefined,
    null,
    0,
    -1,
    10,
    NaN,
    Infinity,
    4.5,
    true,
    false,
    "",
    "invalid",
    {},
    [],
  ]) {
    assert.equal(effectiveSeats(seats), 5);
    assert.equal(seatLabel(seats), "5 plazas (estimadas)");
    assert(matches({ ...car, seats }, { ...defaults, seats: 5 }));
    assert(matches({ ...car, seats }, { ...defaults, seats: 4 }));
    assert(!matches({ ...car, seats }, { ...defaults, seats: 7 }));
  }
  for (const seats of [1, 4, 5, 7, "4", "7"]) {
    assert.equal(effectiveSeats(seats), Number(seats));
    assert(!seatLabel(seats).includes("estimadas"));
    assert(matches({ ...car, seats }, { ...defaults, seats: Number(seats) }));
  }
  const detail = buildCarDetail({ ...parseKiaCar(kia), seats: null });
  assert(detail.includes("5 plazas (estimadas)"));
  assert(
    buildCarDetail({ ...parseKiaCar(kia), seats: 4 }).includes(
      "<dd>4 plazas</dd>",
    ),
  );
});
test("five-seat Toyota lookup includes records without confirmed seats for local fallback", async () => {
  let query;
  const data = JSON.stringify({
    carFilters: { usedCarLocation: { dealerCache: [toyota.dealer] } },
  }).replace(/"/g, "&quot;");
  const result = await searchToyotaCars(
    { ...defaults, seats: 5 },
    async (url, options) => {
      if (!options?.method)
        return {
          ok: true,
          text: async () => '<div id="tor-test-data">' + data + "</div>",
        };
      query = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          results: [
            { ...toyota, product: { ...toyota.product, seats: undefined } },
          ],
          totalResultCount: 1,
          errorLogs: [],
        }),
      };
    },
  );
  assert(!query.filters.some((x) => x.filterId === "usedCarSeats"));
  assert.equal(result.items[0].seats, null);
  assert(matches(result.items[0], { ...defaults, seats: 5 }));
});

test("minimum four seats excludes three and includes four, five and larger counts in browser and server", () => {
  const settings = { ...defaults, seats: 4 },
    source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"),
    allowed = source.match(/function allowed\(x\)\{[^\n]+/)[0],
    context = vm.createContext({
      effectiveSeats,
      matchesLocality,
      state: { settings },
    });
  vm.runInContext(allowed, context);
  for (const seats of [3, 4, 5, 7, 9]) {
    const row = { ...car, seats, favourite: true };
    assert.equal(matches(row, settings), seats >= 4, "server " + seats);
    assert.equal(context.allowed(row), seats >= 4, "browser " + seats);
  }
});

test("minimum four-seat Toyota lookup preserves higher counts and unpublished five-seat estimates", async () => {
  let query;
  const data = JSON.stringify({
    carFilters: { usedCarLocation: { dealerCache: [toyota.dealer] } },
  }).replace(/"/g, "&quot;");
  const report = await searchToyotaCars(
    { ...defaults, seats: 4 },
    async (url, options) => {
      if (!options?.method)
        return {
          ok: true,
          text: async () => '<div id="tor-test-data">' + data + "</div>",
        };
      query = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          results: [
            { ...toyota, product: { ...toyota.product, seats: 7 } },
            {
              ...toyota,
              id: "12345678-1234-1234-1234-123456789012",
              product: { ...toyota.product, seats: undefined },
            },
          ],
          totalResultCount: 2,
          errorLogs: [],
        }),
      };
    },
  );
  assert(!query.filters.some((x) => x.filterId === "usedCarSeats"));
  assert.equal(report.items.length, 2);
  assert(
    report.items.every((item) => matches(item, { ...defaults, seats: 4 })),
  );
});
