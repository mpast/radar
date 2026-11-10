import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFotocasaHouse } from "../src/sources/house-sources.mjs";
import { photoUrl } from "../src/services/listing-photos.mjs";
import { parseResult, defaults } from "../src/domain/core.mjs";
import {
  buildSavedHousesPdf,
  savedHouses,
  collectSavedHousePhotos,
  downloadSavedHousesPdf,
} from "../public/saved-cars-pdf.js";
const row = JSON.parse(
  readFileSync(new URL("./fixtures/fotocasa-props.json", import.meta.url)),
).initialSearch.result.realEstates[0];
const image =
  "https://static.fotocasa.es/images/ads/144bdc67-35da-4a28-bd08-c46e84916b66?rule=original";
const house = {
  ...parseFotocasaHouse({
    ...row,
    multimedia: [
      { type: "video", src: "https://evil.example/video" },
      { type: "image", src: image },
    ],
  }),
  favourite: true,
};
const hex = (value) => "<" + Buffer.from(value, "latin1").toString("hex") + ">";
test("housing uses the first published image with strict hosts and safe missing-image fallback", () => {
  assert.equal(house.photoUrl, image);
  assert.equal(parseFotocasaHouse(row).photoUrl, null);
  for (const src of [
    "https://static.fotocasa.es.evil.example/a.jpg",
    "http://static.fotocasa.es/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://user:pass@static.fotocasa.es/a.jpg",
  ]) {
    assert.equal(photoUrl(src), null);
    assert.equal(
      parseFotocasaHouse({
        ...row,
        multimedia: [
          { type: "image", src },
          { type: "image", src: image },
        ],
      }).photoUrl,
      null,
    );
  }
  assert.equal(
    parseResult(
      {
        title: "Piso venta Madrid",
        link: "https://www.idealista.com/inmueble/123456789/",
        thumbnail: "https://st3.idealista.com/photo.jpg",
      },
      "houses",
    ).photoUrl,
    "https://st3.idealista.com/photo.jpg",
  );
});
test("saved housing PDF contains property fields and original link while excluding cars and unsaved houses", () => {
  const items = [
    house,
    { ...house, id: "unsaved", favourite: false },
    { ...house, id: "car", kind: "cars" },
  ];
  assert.equal(savedHouses(items).length, 1);
  const pdf = new TextDecoder().decode(buildSavedHousesPdf(items));
  assert.match(pdf, /^%PDF-1.4/);
  assert.match(pdf, /\/Count 1\b/);
  assert(pdf.includes(hex("RADAR / VIVIENDAS GUARDADAS")));
  assert(pdf.includes(hex("Superficie: 430 m²")));
  assert(pdf.includes(hex("Habitaciones: 5")));
  assert(!pdf.includes(hex("Kilómetros:")));
  assert(pdf.includes(`/URI ${hex(house.url)}`));
  assert(pdf.includes(hex("Foto no disponible.")));
  assert.throws(() => buildSavedHousesPdf([]), /No hay viviendas guardadas/);
});
test("housing photo collection shares bounded loading and continues when a photo fails", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    ...house,
    id: String(index),
  }));
  let active = 0,
    max = 0;
  const photos = await collectSavedHousePhotos(rows, async (item) => {
    active++;
    max = Math.max(max, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    if (item.id === "0") throw Error("missing");
    return { width: 2, height: 1, bytes: new Uint8Array([255, 216, 255, 217]) };
  });
  assert.equal(max, 4);
  assert.equal(photos.size, 6);
  const pdf = new TextDecoder().decode(buildSavedHousesPdf([rows[1]], photos));
  assert(pdf.includes("/Subtype /Image"));
  assert(pdf.includes(hex("Superficie: 430 m²")));
});
test("housing download creates the property PDF filename and releases its object URL", async () => {
  const original = {
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  let revoked = false;
  const anchor = { click() {}, remove() {} };
  try {
    globalThis.document = {
      createElement: () => anchor,
      body: { append() {} },
    };
    globalThis.setTimeout = (callback) => callback();
    URL.createObjectURL = (blob) => (
      assert.equal(blob.type, "application/pdf"),
      "blob:houses"
    );
    URL.revokeObjectURL = () => {
      revoked = true;
    };
    const result = await downloadSavedHousesPdf([{ ...house, photoUrl: null }]);
    assert.equal(anchor.download, "viviendas-guardadas.pdf");
    assert.equal(result.missingPhotos, 1);
    assert(revoked);
  } finally {
    globalThis.document = original.document;
    globalThis.setTimeout = original.setTimeout;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

test("normal housing cards render the real proxied image and retain the fallback for missing photos", async () => {
  const { default: vm } = await import("node:vm"),
    elements = new Map(),
    element = (selector) => {
      if (!elements.has(selector))
        elements.set(selector, {
          value: selector === "#sort" ? "price" : "",
          dataset: {},
          innerHTML: "",
          textContent: "",
          classList: { toggle() {}, add() {}, remove() {} },
          close() {},
        });
      return elements.get(selector);
    };
  const state = {
    settings: { ...defaults, budgetHouse: 2000000 },
    items: [house, { ...house, id: "no-photo", photoUrl: null }],
    status: {},
    configured: {},
    csrf: "test",
  };
  const source = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  )
    .replace(
      /import\s+\{([^}]+)\}\s+from\s+'([^']+)';/g,
      (_, names, path) => `const {${names}}=await importModule('${path}');`,
    );
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [] },
    location: { hash: "#/viviendas" },
    window: { addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => state }),
    setInterval() {},
    setTimeout() {},
    URL,
    Intl,
    FormData,
    importModule: (path) =>
      import(new URL("../public" + path, import.meta.url).href),
  });
  await vm.runInContext("(async()=>{" + source + "})()", context);
  const html = element("#results").innerHTML;
  assert.equal((html.match(/class="card"/g) || []).length, 2);
  assert.equal((html.match(/class="listing-photo"/g) || []).length, 1);
  assert(html.includes("/api/photo?id=" + encodeURIComponent(house.id)));
  assert(!html.includes('src="' + image + '"'));
  assert.equal(element("#toast").textContent, "");
});
