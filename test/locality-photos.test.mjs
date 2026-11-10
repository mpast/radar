import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { matchesLocality, normalizeLocality } from "../public/locality.js";
import { defaults, matches, validateSettings } from "../src/domain/core.mjs";
import { createPhotoCache, photoUrl } from "../src/services/listing-photos.mjs";
import { parseKiaCar } from "../src/sources/official-sources.mjs";
import { parseToyotaCar } from "../src/sources/toyota-sources.mjs";

test("locality matches normalize accents, case and spacing, remain exact and reject unknown locations", async () => {
  const row = {
      kind: "cars",
      sellerType: "dealer",
      title: "Car",
      price: 10,
      km: 10,
      distance: 0,
      locality: " Alcalá  de Henares ",
    },
    settings = validateSettings({ locality: "alcala de henares" });
  const source = await readFile(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    context = vm.createContext({
      matchesLocality,
      state: { settings },
      effectiveSeats: () => 5,
    });
  vm.runInContext(source.match(/function allowed\(x\)\{[^\n]+/)[0], context);
  assert(matches(row, settings));
  assert(context.allowed(row));
  assert(!matches({ ...row, locality: "Alcalá" }, settings));
  assert(!matchesLocality({ locality: null }, settings.locality));
  assert(matchesLocality({ locality: null }, ""));
  assert.equal(
    validateSettings({ radius: 20 }, settings).locality,
    settings.locality,
  );
  assert.throws(() => validateSettings({ locality: {} }));
});

test("refreshing locality options preserves unsaved selection including all locations", async () => {
  const source = await readFile(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    select = { value: "", dataset: {} };
  const context = vm.createContext({
    $: () => select,
    state: {
      settings: { locality: "madrid" },
      items: [
        { kind: "cars", locality: "Madrid" },
        { kind: "cars", locality: "Alcalá" },
      ],
    },
    tab: "cars",
    demo: false,
    normalizeLocality,
    esc: (x) => x,
  });
  vm.runInContext(
    source.match(/function updateLocalities\(\)\{[^\n]+/)[0],
    context,
  );
  context.updateLocalities();
  assert.equal(select.value, "madrid");
  select.value = "";
  context.updateLocalities();
  assert.equal(select.value, "");
  assert.match(select.innerHTML, /alcala/);
});

test("only the first official photo is retained and unsafe image URLs are discarded", async () => {
  const kia = JSON.parse(
      await readFile(new URL("./fixtures/kia-stock.json", import.meta.url)),
    ).vehiculos[0],
    toyota = JSON.parse(
      await readFile(new URL("./fixtures/toyota-stock.json", import.meta.url)),
    );
  assert.equal(
    parseKiaCar({
      ...kia,
      imagen: "https://kiaokasion.net/kia/imagenes/first.jpg",
    }).photoUrl,
    "https://kiaokasion.net/kia/imagenes/first.jpg",
  );
  assert.equal(
    parseToyotaCar({
      ...toyota,
      images: [
        { url: "//used-car-publisher.toyota-europe.com/images/first.JPEG" },
        { url: "//used-car-publisher.toyota-europe.com/images/second.JPEG" },
      ],
    }).photoUrl,
    "https://used-car-publisher.toyota-europe.com/images/first.JPEG",
  );
  for (const url of [
    "http://kiaokasion.net/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://kiaokasion.net.evil/a.jpg",
    "https://user:pass@kiaokasion.net/a.jpg",
    "https://kiaokasion.net:444/a.jpg",
    "file:///tmp/a",
  ])
    assert.equal(photoUrl(url), null);
});

test("photo downloads are deduplicated, cached on disk and reject redirects and oversized/nonimage bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "radar-photos-")),
    item = { id: "kia:1", photoUrl: "https://kiaokasion.net/a.jpg" },
    bytes = Buffer.from([255, 216, 255, 0, 1]);
  let calls = 0;
  try {
    const cache = createPhotoCache(directory, async (url, options) => {
      calls++;
      assert.equal(options.redirect, "error");
      return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
    });
    const results = await Promise.all([cache(item), cache(item)]);
    assert.equal(calls, 1);
    assert.equal(results[0].type, "image/jpeg");
    assert.deepEqual(results[1].bytes, bytes);
    assert.deepEqual(
      (
        await createPhotoCache(directory, () => {
          throw Error("Should use disk");
        })(item)
      ).bytes,
      bytes,
    );
    for (const response of [
      () => new Response("<svg>bad</svg>"),
      () =>
        new Response(bytes, {
          headers: { "content-length": String(6 * 1024 * 1024) },
        }),
      () => {
        throw Error("Redirect rejected");
      },
      () => new Response(new Uint8Array(5 * 1024 * 1024 + 1)),
    ]) {
      const cache = createPhotoCache(directory, async () => response());
      assert.equal(
        await cache({ ...item, id: Math.random().toString() }),
        null,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser app starts with its declared module imports and renders the locality filter", async () => {
  const source = await readFile(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    elements = new Map();
  const element = (selector) => {
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
    settings: { ...defaults, locality: "madrid" },
    items: [],
    status: {},
    configured: {},
    csrf: "test",
  };
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [] },
    location: { hash: "#/coches" },
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
  const executable = source.replace(
    /import\s+\{([^}]+)\}\s+from\s+'([^']+)';/g,
    (_, names, path) => `const {${names}}=await importModule('${path}');`,
  );
  await vm.runInContext(`(async()=>{${executable}\n})()`, context);
  assert.equal(element("#locality").value, "madrid");
  assert.match(element("#results").innerHTML, /class="empty"/);
  assert.equal(element("#toast").textContent, "");
});
