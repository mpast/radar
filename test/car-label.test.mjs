import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { defaults, matches, validateSettings } from "../src/domain/core.mjs";
import {
  normalizeEnvironmentalLabel,
  environmentalLabelText,
} from "../public/car-label.js";
import { matchesLocality } from "../public/locality.js";
import { parseKiaCar } from "../src/sources/official-sources.mjs";
import { parseToyotaCar } from "../src/sources/toyota-sources.mjs";
const kia = JSON.parse(
  readFileSync(new URL("./fixtures/kia-stock.json", import.meta.url)),
).vehiculos[0];
const toyota = JSON.parse(
  readFileSync(new URL("./fixtures/toyota-stock.json", import.meta.url)),
);
const car = {
  kind: "cars",
  sellerType: "dealer",
  title: "Example",
  price: 15000,
  distance: 5,
  km: 10000,
};

test("environmental label selection persists, clears and validates exact options", () => {
  assert.equal(defaults.environmentalLabel, "");
  for (const environmentalLabel of ["B", "C", "ECO", "0"]) {
    const saved = JSON.parse(
      JSON.stringify(validateSettings({ environmentalLabel })),
    );
    assert.equal(
      validateSettings({ radius: 25 }, saved).environmentalLabel,
      environmentalLabel,
    );
    assert.equal(
      validateSettings({ environmentalLabel: "" }, saved).environmentalLabel,
      "",
    );
  }
  for (const environmentalLabel of [null, true, 0, [], {}, "A", "CERO", "eco"])
    assert.throws(
      () => validateSettings({ environmentalLabel }),
      /Etiqueta ambiental/,
    );
  const legacy = { ...defaults };
  delete legacy.environmentalLabel;
  assert.equal(validateSettings({}, legacy).environmentalLabel, "");
});

test("browser and server filter exact labels including favourites without guessing unknown labels", () => {
  const source = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  const allowed = source.match(/function allowed\(x\)\{[^\n]+/)[0];
  const context = vm.createContext({
    normalizeEnvironmentalLabel,
    matchesLocality,
    state: { settings: defaults },
  });
  vm.runInContext(allowed, context);
  for (const selected of ["", "B", "C", "ECO", "0"])
    for (const includeUnknown of [true, false]) {
      context.state.settings = {
        ...defaults,
        environmentalLabel: selected,
        includeUnknown,
      };
      for (const environmentalLabel of [
        "B",
        "C",
        "ECO",
        "0",
        "CERO",
        null,
        undefined,
        "unknown",
      ]) {
        const item = { ...car, environmentalLabel, favourite: true },
          expected =
            !selected ||
            normalizeEnvironmentalLabel(environmentalLabel) === selected;
        assert.equal(matches(item, context.state.settings), expected);
        assert.equal(context.allowed(item), expected);
      }
      const house = {
        kind: "houses",
        price: 100000,
        distance: 5,
        area: 100,
        beds: 3,
      };
      assert(matches(house, context.state.settings));
      assert(context.allowed(house));
    }
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<select name="environmentalLabel"/);
});

test("official adapters preserve published labels and leave missing values unknown", () => {
  // Kia renders /img/distintivo{code}.png: 1 B, 2 C, 3 ECO, 4 zero emissions.
  for (const [distintivo, label] of [
    ["1", "B"],
    ["2", "C"],
    ["3", "ECO"],
    ["4", "0"],
    ["0", null],
    ["5", null],
    [undefined, null],
    ["99", null],
    ["constructor", null],
    ["__proto__", null],
  ])
    assert.equal(parseKiaCar({ ...kia, distintivo }).environmentalLabel, label);
  for (const [description, label] of [
    ["B", "B"],
    ["C", "C"],
    ["ECO", "ECO"],
    ["CERO", "0"],
    ["invalid", null],
  ])
    assert.equal(
      parseToyotaCar({
        ...toyota,
        product: { ...toyota.product, eco: { label: { description } } },
      }).environmentalLabel,
      label,
    );
  assert.equal(parseToyotaCar(toyota).environmentalLabel, null);
  assert.equal(parseKiaCar(kia).environmentalLabel, null);
  assert.equal(environmentalLabelText(null), "Etiqueta no disponible");
  assert.equal(environmentalLabelText("CERO"), "Etiqueta 0 emisiones");
});
