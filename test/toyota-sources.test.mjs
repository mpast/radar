import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseToyotaCar,
  searchToyotaCars,
  toyotaDealers,
} from "../src/sources/toyota-sources.mjs";
import { searchOfficialCars } from "../src/sources/official-sources.mjs";
import { defaults, matches, toyotaVerification } from "../src/domain/core.mjs";
const car = JSON.parse(
  readFileSync(new URL("./fixtures/toyota-stock.json", import.meta.url)),
);
const catalogue = (dealers) =>
  '<div id="tor-example-data" style="display:none">' +
  JSON.stringify({ carFilters: { usedCarLocation: { dealerCache: dealers } } })
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;") +
  "</div>";
test("Toyota official stock retains dealer, VAT-inclusive cash price, mileage and individual URL", () => {
  const parsed = parseToyotaCar(car);
  assert.equal(parsed.price, 16290);
  assert.equal(parsed.financePrice, null);
  assert.equal(parsed.km, 12462);
  assert.equal(parsed.year, 2025);
  assert.equal(parsed.registrationDate, "2025-04-08");
  assert.equal(parsed.sellerType, "dealer");
  assert.equal(parsed.dealer, car.dealer.name);
  assert(parsed.distance <= defaults.radius);
  assert(matches(parsed, defaults));
  assert(!matches(parsed, { ...defaults, budgetCar: 16000 }));
  assert(!matches(parsed, { ...defaults, maxKm: 10000 }));
  assert.equal(
    parsed.url,
    "https://www.toyota.es/coches-segunda-mano/ficha.toyota-aygo-x-2025-5-puertas-manual-gasolina-" +
      car.id,
  );
  for (const patch of [
    { dealer: null },
    { currencyCode: "GBP" },
    { vehicleStatus: { code: "2" } },
    {
      product: { ...car.product, brand: { code: "22", description: "Lexus" } },
    },
  ])
    assert.equal(parseToyotaCar({ ...car, ...patch }), null);
  assert.equal(
    parseToyotaCar({ ...car, price: { sellingPriceExclVAT: 15000 } }).price,
    null,
  );
  assert.equal(
    parseToyotaCar({ ...car, mileage: { value: 5, unit: { code: "miles" } } })
      .km,
    null,
  );
  assert.equal(
    parseToyotaCar({ ...car, dealer: { ...car.dealer, geoLocation: null } })
      .distance,
    null,
  );
});
test("Toyota dealer state rejects changed or empty schemas", () => {
  assert.throws(() => toyotaDealers("<html>Blocked</html>"));
  assert.throws(() => toyotaDealers(catalogue([])));
  assert.equal(toyotaDealers(catalogue([car.dealer]))[0].id, car.dealer.id);
});
test("Toyota selects nearby dealers, reads all pages, deduplicates and sends configured limits", async () => {
  let calls = 0;
  const far = {
      ...car.dealer,
      id: "far",
      geoLocation: { lat: 41.38, lon: 2.14 },
    },
    report = await searchToyotaCars(defaults, async (url, options) => {
      if (!options?.method)
        return { ok: true, text: async () => catalogue([car.dealer, far]) };
      const body = JSON.parse(options.body);
      assert.deepEqual(
        body.filters.find((x) => x.filterId === "usedCarLocation").valueIds,
        [car.dealer.id],
      );
      assert.equal(
        body.filters.find((x) => x.filterId === "cash").max,
        defaults.budgetCar,
      );
      assert.equal(
        body.filters.find((x) => x.filterId === "usedCarMileage").max,
        defaults.maxKm,
      );
      assert.equal(body.offset, calls++ * 12);
      return {
        ok: true,
        json: async () => ({
          results: Array.from(
            { length: Math.min(12, 100 - body.offset) },
            (_, i) => ({
              ...car,
              id:
                (i === 0 ? 0 : body.offset + i).toString(16).padStart(8, "0") +
                "-0000-0000-0000-000000000000",
            }),
          ),
          totalResultCount: 100,
          errorLogs: [],
        }),
      };
    });
  assert.equal(calls, 9);
  assert.equal(report.items.length, 92);
  assert.equal(report.raw, 100);
  assert.equal(report.source.pages, 9);
  assert.equal(report.source.totalPages, 9);
  assert.equal(report.source.partial, false);
});
test("Toyota remains usable when Kia and Hyundai fail", async () => {
  const report = await searchOfficialCars(defaults, async (url) => {
    if (String(url).includes("www.toyota.es"))
      return { ok: true, text: async () => catalogue([car.dealer]) };
    if (String(url).includes("usc-webcomponents"))
      return {
        ok: true,
        json: async () => ({
          results: [car],
          totalResultCount: 1,
          errorLogs: [],
        }),
      };
    return { ok: false, status: 403 };
  });
  assert.equal(report.items[0].provider, "toyota-official");
  assert.equal(report.diagnostics.matching, 1);
  assert(report.diagnostics.sources.some((x) => x.name === "Kia" && !x.ok));
  assert.equal(report.diagnostics.partial, false);
});
test("Toyota changed inventory responses fail visibly rather than reporting empty success", async () => {
  await assert.rejects(
    searchToyotaCars(defaults, async (url, options) =>
      !options?.method
        ? { ok: true, text: async () => catalogue([car.dealer]) }
        : { ok: true, json: async () => ({ errorLogs: [], results: [] }) },
    ),
    /Formato/,
  );
});
test("Toyota preserves complete earlier pages on later timeout, HTTP error or malformed inventory", async () => {
  for (const failure of ["timeout", "http", "schema"]) {
    let calls = 0;
    const report = await searchToyotaCars(defaults, async (url, options) => {
      if (!options?.method)
        return { ok: true, text: async () => catalogue([car.dealer]) };
      if (calls++ === 0)
        return {
          ok: true,
          json: async () => ({
            results: [car],
            totalResultCount: 25,
            errorLogs: [],
          }),
        };
      if (failure === "timeout")
        throw Object.assign(Error("Timeout"), { name: "TimeoutError" });
      if (failure === "http") return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({ results: [car], totalResultCount: null }),
      };
    });
    assert.equal(report.items.length, 1);
    assert.equal(report.raw, 1);
    assert.equal(report.source.ok, true);
    assert.equal(report.source.pages, 1);
    assert.equal(report.source.totalPages, 3);
    assert.equal(report.source.partial, true);
    assert.match(report.source.error, /Consulta Toyota incompleta/);
  }
});

test("Toyota empty stock is complete, but empty intermediate pages and changing totals stay partial", async () => {
  for (const mode of ["empty", "gap", "changing"]) {
    let calls = 0;
    const report = await searchToyotaCars(defaults, async (url, options) => {
      if (!options?.method)
        return { ok: true, text: async () => catalogue([car.dealer]) };
      const page = calls++;
      return {
        ok: true,
        json: async () => ({
          results:
            mode === "empty" || (mode === "gap" && page === 1)
              ? []
              : Array.from({ length: 12 }, (_, i) => ({
                  ...car,
                  id:
                    (page * 12 + i).toString(16).padStart(8, "0") +
                    "-0000-0000-0000-000000000000",
                })),
          totalResultCount:
            mode === "empty" ? 0 : mode === "changing" && page > 0 ? 48 : 36,
          errorLogs: [],
        }),
      };
    });
    assert.equal(calls, mode === "empty" ? 1 : mode === "gap" ? 2 : 3);
    assert.equal(report.source.partial, mode !== "empty");
    if (mode !== "empty") assert(report.source.error);
  }
});
test("Toyota retains unique results first seen on later pages", async () => {
  let calls = 0;
  const report = await searchToyotaCars(defaults, async (url, options) => {
    if (!options?.method)
      return { ok: true, text: async () => catalogue([car.dealer]) };
    const page = calls++;
    return {
      ok: true,
      json: async () => ({
        results: Array.from({ length: page === 4 ? 1 : 12 }, (_, i) => ({
          ...car,
          id:
            (page * 12 + i).toString(16).padStart(8, "0") +
            "-0000-0000-0000-000000000000",
        })),
        totalResultCount: 49,
        errorLogs: [],
      }),
    };
  });
  assert.equal(calls, 5);
  assert.equal(report.items.length, 49);
  assert.equal(report.source.partial, false);
});
test("Toyota history verification uses the latest source check without deleting saved records", () => {
  const latest = "2026-11-06T22:00:00.000Z",
    sources = [{ name: "Toyota", checkedAt: latest, partial: true }];
  assert.equal(
    toyotaVerification(
      { provider: "toyota-official", lastSeen: latest },
      sources,
    ),
    true,
  );
  const saved = {
    provider: "toyota-official",
    lastSeen: "2026-11-02T22:00:00.000Z",
    favourite: true,
  };
  assert.equal(toyotaVerification(saved, sources), false);
  assert.equal(saved.favourite, true);
  assert.equal(toyotaVerification(saved, []), null);
  assert.equal(toyotaVerification({ provider: "kia-official" }, sources), null);
});

test("Toyota stops repeated inventory pages rather than claiming complete coverage", async () => {
  let calls = 0;
  const report = await searchToyotaCars(defaults, async (url, options) => {
    if (!options?.method)
      return { ok: true, text: async () => catalogue([car.dealer]) };
    calls++;
    return {
      ok: true,
      json: async () => ({
        results: [car],
        totalResultCount: 12000,
        errorLogs: [],
      }),
    };
  });
  assert.equal(calls, 2);
  assert.equal(report.source.pages, 1);
  assert.equal(report.items.length, 1);
  assert.equal(report.source.partial, true);
  assert.match(report.source.error, /repitió/);
});

test("failed Toyota checks leave every retained record explicitly unverified", () => {
  const latest = "2026-11-06T22:00:00.000Z",
    saved = { provider: "toyota-official", lastSeen: latest, favourite: true };
  for (const source of [
    { name: "Toyota", ok: false, error: "HTTP 503" },
    { name: "Toyota", ok: false, error: "HTTP 503", checkedAt: latest },
  ])
    assert.equal(toyotaVerification(saved, [source]), false);
  assert.equal(toyotaVerification(saved, [{ name: "Toyota", ok: true }]), null);
  assert.equal(
    toyotaVerification(saved, [
      { name: "Toyota", ok: true, checkedAt: latest },
    ]),
    true,
  );
  assert.equal(saved.favourite, true);
});

test("Toyota root empty dealer cache uses initialized directory and still filters by user origin", async () => {
  const local = {
      ...car.dealer,
      id: "barcelona",
      geoLocation: { lat: 41.3818, lon: 2.1685 },
    },
    settings = {
      ...defaults,
      postalCode: "08001",
      origin: { name: "Barcelona", coordinates: [41.3818, 2.1685] },
      radius: 5,
    },
    calls = [];
  const report = await searchToyotaCars(settings, async (url, options) => {
    calls.push(String(url));
    if (!options?.method)
      return {
        ok: true,
        text: async () =>
          catalogue(String(url).endsWith("/madrid") ? [car.dealer, local] : []),
      };
    const body = JSON.parse(options.body);
    assert.deepEqual(
      body.filters.find((x) => x.filterId === "usedCarLocation").valueIds,
      ["barcelona"],
    );
    return {
      ok: true,
      json: async () => ({ results: [], totalResultCount: 0 }),
    };
  });
  assert(calls[1].endsWith("/madrid"));
  assert.equal(report.source.partial, false);
});
test("unavailable initialized dealer directory reports HTTP failure instead of a format failure", async () => {
  await assert.rejects(
    searchToyotaCars(defaults, async (url) =>
      String(url).endsWith("/madrid")
        ? { ok: false, status: 503 }
        : { ok: true, text: async () => catalogue([]) },
    ),
    /Directorio.*HTTP 503/,
  );
});
