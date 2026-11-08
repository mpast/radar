import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildCarDetail } from "../public/car-detail.js";
import { parseKiaCar } from "../src/sources/official-sources.mjs";
const cars = JSON.parse(
  readFileSync(new URL("./fixtures/kia-stock.json", import.meta.url)),
)
  .vehiculos.slice(0, 2)
  .map(parseKiaCar);
test("individual car details distinguish two actual stock references, cash, finance and mileage", () => {
  const a = buildCarDetail(cars[0]),
    b = buildCarDetail(cars[1]);
  assert(a.includes(cars[0].stockReference));
  assert(!a.includes(cars[1].stockReference));
  assert.match(a, /13\.427/);
  assert.match(a, /11\.521/);
  assert.match(a, /18\.330 km/);
  assert.match(b, /13\.900/);
  assert.match(b, /37\.460 km/);
  assert(a.includes(cars[0].dealer));
  assert(b.includes(cars[1].dealer));
  assert(a.includes("Abrir catálogo Kia"));
  assert(a.includes("FICHA DEL COCHE EN RADAR"));
  assert.notEqual(a, b);
});
test("opening the card selects the exact stored car and supports explicit close without mixing records", () => {
  const source = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    fn = source.match(/function openCarDetail\(id\)\{[^\n]+/)[0];
  let opens = 0,
    closes = 0;
  const dialog = {
      innerHTML: "",
      showModal: () => opens++,
      close: () => closes++,
    },
    closeButton = {},
    context = vm.createContext({
      state: { items: cars },
      buildCarDetail,
      $: (selector) => (selector === "#carDialog" ? dialog : closeButton),
    });
  vm.runInContext(fn, context);
  context.openCarDetail(cars[0].id);
  assert(dialog.innerHTML.includes(cars[0].stockReference));
  context.openCarDetail(cars[1].id);
  assert(dialog.innerHTML.includes(cars[1].stockReference));
  assert(!dialog.innerHTML.includes(cars[0].stockReference));
  closeButton.onclick();
  assert.equal(closes, 1);
  context.openCarDetail("kia:missing");
  assert.equal(opens, 2);
});
test("detail content escapes source strings and rejects ambiguous identity", () => {
  assert(
    buildCarDetail({
      ...cars[0],
      title: "<img src=x onerror=alert(1)>",
    }).includes("&lt;img"),
  );
  assert.throws(() => buildCarDetail({ ...cars[0], id: cars[1].id }));
});
