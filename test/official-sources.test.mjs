import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseKiaCar,
  searchOfficialCars,
} from "../src/sources/official-sources.mjs";
import { defaults, matches } from "../src/domain/core.mjs";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/kia-stock.json", import.meta.url)),
);
test("actual public Kia schema uses cash price and named dealership, never financed price for budget", () => {
  const car = parseKiaCar(fixture.vehiculos[2]);
  assert.equal(car.price, 14026);
  assert.equal(car.financePrice, 12846);
  assert.equal(car.km, 19755);
  assert.equal(car.sellerType, "dealer");
  assert.equal(car.dealer, "AKI Madrid Automoción SL");
  assert(matches(car, { ...defaults, budgetCar: 16000, maxKm: 50000 }));
  assert(!matches(car, { ...defaults, budgetCar: 13000 }));
  assert.equal(
    parseKiaCar({ ...fixture.vehiculos[0], concesionario: null }),
    null,
  );
  assert.equal(
    parseKiaCar({ ...fixture.vehiculos[0], precio_alcontado: null }).price,
    null,
  );
});
test("official adapter caps pagination, deduplicates, and preserves Kia results when Hyundai blocks", async () => {
  let kiaCalls = 0;
  const report = await searchOfficialCars(
    { ...defaults, budgetCar: 16000, maxKm: 50000 },
    async (url, options) => {
      if (!String(url).includes("kiaokasion.net"))
        return { status: 403, ok: false };
      kiaCalls++;
      assert.equal(options.body.get("accion"), "actualizarCoches");
      return {
        ok: true,
        json: async () => ({ ...fixture, top_paginacion: 20 }),
      };
    },
  );
  assert.equal(kiaCalls, 3);
  assert.equal(report.items.length, 3);
  assert.equal(report.diagnostics.partial, true);
  assert(report.diagnostics.sources.some((s) => s.name === "Hyundai" && !s.ok));
  assert.equal(report.diagnostics.matching, 1);
});
test("official adapter reports source failure instead of fabricating empty inventory", async () => {
  await assert.rejects(
    searchOfficialCars(defaults, async () => ({ ok: false, status: 403 })),
    (e) => e.code === "official_unavailable",
  );
});
