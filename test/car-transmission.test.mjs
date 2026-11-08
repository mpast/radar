import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { defaults, matches, validateSettings } from "../src/domain/core.mjs";
import { normalizeTransmission } from "../public/car-transmission.js";
import { matchesLocality } from "../public/locality.js";
import { parseToyotaCar } from "../src/sources/toyota-sources.mjs";

const car = { kind: "cars", sellerType: "dealer", title: "Example", price: 15000, distance: 5, km: 10000 };

test("transmission selection persists, clears and rejects invalid values", () => {
  assert.equal(defaults.transmission, "");
  for (const transmission of ["manual", "automatic"]) {
    const saved = JSON.parse(JSON.stringify(validateSettings({ transmission })));
    assert.equal(validateSettings({ radius: 25 }, saved).transmission, transmission);
    assert.equal(validateSettings({ transmission: "" }, saved).transmission, "");
  }
  for (const transmission of [null, true, 1, [], {}, "Automatic", "unknown"])
    assert.throws(() => validateSettings({ transmission }), /Tipo de cambio/);
});

test("browser and server filter transmissions consistently without guessing missing data", () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const context = vm.createContext({ normalizeTransmission, matchesLocality, state: { settings: defaults } });
  vm.runInContext(source.match(/function allowed\(x\)\{[^\n]+/)[0], context);
  for (const selected of ["", "manual", "automatic"])
    for (const includeUnknown of [true, false]) {
      context.state.settings = { ...defaults, transmission: selected, includeUnknown };
      for (const transmission of ["Manual", "manual", "Automatic", "Automático", "Automática", "e-CVT", null, undefined, "unknown"]) {
        const item = { ...car, transmission, favourite: true };
        const expected = !selected || normalizeTransmission(transmission) === selected;
        assert.equal(matches(item, context.state.settings), expected);
        assert.equal(context.allowed(item), expected);
      }
      const house = { kind: "houses", price: 100000, distance: 5, area: 100, beds: 3 };
      assert(matches(house, context.state.settings));
      assert(context.allowed(house));
      assert(!matches({ ...car, transmission: selected, price: 100000 }, context.state.settings));
    }
});

test("Toyota preserves its published transmission and unknown values remain unknown", () => {
  const toyota = JSON.parse(readFileSync(new URL("./fixtures/toyota-stock.json", import.meta.url)));
  assert.equal(parseToyotaCar(toyota).transmission, "manual");
  for (const [description, expected] of [["Automático", "automatic"], ["e-CVT", "automatic"], ["unknown", null], [undefined, null]]) {
    const item = { ...toyota, product: { ...toyota.product, transmission: { transmissionType: { description } } } };
    assert.equal(parseToyotaCar(item).transmission, expected);
  }
});
