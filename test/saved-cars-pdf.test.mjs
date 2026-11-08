import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSavedCarsPdf,
  savedCars,
  downloadSavedCarsPdf,
  loadCarPhoto,
  collectSavedCarPhotos,
} from "../public/saved-cars-pdf.js";
const car = {
  id: "kia:123",
  kind: "cars",
  favourite: true,
  title: "Kia León (edición) \\ Madrid",
  price: 21900,
  km: 8500,
  seats: 5,
  year: 2024,
  url: "https://www.kia.com/es/catalogo?ref=123",
  catalogueLink: true,
  stockReference: "123",
};
const contents = (items) => new TextDecoder().decode(buildSavedCarsPdf(items));
const pdfHex = (value) =>
  "<" + Buffer.from(value, "latin1").toString("hex") + ">";
test("exports only saved cars and keeps catalogue references and clickable URLs", () => {
  const items = [
    car,
    { ...car, id: "other", kind: "houses" },
    { ...car, id: "unsaved", favourite: false },
    {
      ...car,
      id: "toyota:1",
      title: "Toyota Corolla",
      url: "https://www.toyota.es/ocasion/coche/1",
      catalogueLink: false,
    },
  ];
  assert.equal(savedCars(items).length, 2);
  const pdf = contents(items);
  assert.match(pdf, /^%PDF-1.4/);
  assert.match(pdf, /\/Count 2\b/);
  assert(pdf.includes(pdfHex(car.title)));
  assert(pdf.includes(pdfHex("Referencia: 123")));
  assert(pdf.includes(`/URI ${pdfHex(car.url)}`));
  assert(pdf.includes(pdfHex("Abrir anuncio original")));
  assert(!pdf.includes(pdfHex("unsaved")));
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n /gm)].map((match) =>
    Number(match[1]),
  );
  offsets.forEach((offset, index) =>
    assert(pdf.slice(offset).startsWith(`${index + 1} 0 obj\n`)),
  );
});
test("empty selection fails clearly and unsafe links are never PDF actions", () => {
  assert.throws(() => buildSavedCarsPdf([]), /No hay coches guardados/);
  assert.throws(
    () => buildSavedCarsPdf([{ ...car, favourite: false }]),
    /No hay coches guardados/,
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/car",
    "invalid",
    null,
  ]) {
    const pdf = contents([{ ...car, url }]);
    assert(!pdf.includes("/S /URI"));
    assert(pdf.includes(pdfHex("Enlace no disponible.")));
  }
});
test("long fields flow onto continuation pages and preserve escaped data", () => {
  const pdf = contents([
    {
      ...car,
      title: "Coche ".repeat(300),
      dealer: "Concesionario ".repeat(400),
      url: "https://example.com/" + "a".repeat(900),
    },
  ]);
  assert(Number(pdf.match(/\/Count (\d+)/)[1]) > 1);
  assert(!pdf.includes("NaN"));
  assert(!pdf.includes("undefined"));
  assert(
    pdf.includes(`/URI ${pdfHex("https://example.com/" + "a".repeat(900))}`),
  );
  for (const match of pdf.matchAll(/1 0 0 1 44 (\d+) Tm/g))
    assert(Number(match[1]) >= 34);
});
test("download creates a PDF attachment and releases the object URL", async () => {
  const original = {
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  const events = [],
    anchor = {
      click() {
        events.push("click");
      },
      remove() {
        events.push("remove");
      },
    };
  let blob;
  try {
    globalThis.document = {
      createElement: () => anchor,
      body: { append: () => events.push("append") },
    };
    URL.createObjectURL = (value) => ((blob = value), "blob:test");
    URL.revokeObjectURL = (url) => events.push(url);
    globalThis.setTimeout = (callback) => callback();
    const result = await downloadSavedCarsPdf([car]);
    assert.equal(result.missingPhotos, 1);
    assert.equal(blob.type, "application/pdf");
    assert.equal(anchor.download, "coches-guardados.pdf");
    assert.equal(anchor.href, "blob:test");
    assert.deepEqual(events, ["append", "click", "remove", "blob:test"]);
  } finally {
    globalThis.document = original.document;
    globalThis.setTimeout = original.setTimeout;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

test("embedded JPEGs preserve portrait and landscape proportions and keep text and links", () => {
  for (const [width, height] of [
    [800, 400],
    [300, 900],
  ]) {
    const pdf = new TextDecoder().decode(
      buildSavedCarsPdf(
        [car],
        new Map([
          [
            car.id,
            { width, height, bytes: new Uint8Array([255, 216, 255, 217]) },
          ],
        ]),
      ),
    );
    assert(pdf.includes(`/Subtype /Image /Width ${width} /Height ${height}`));
    assert(pdf.includes("/Filter [/ASCIIHexDecode /DCTDecode]"));
    assert(pdf.includes("ffd8ffd9>"));
    const match = pdf.match(
      /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/CarPhoto Do Q/,
    );
    assert(match);
    assert(
      Math.abs(Number(match[1]) / Number(match[2]) - width / height) < 0.001,
    );
    assert(Number(match[4]) >= 88);
    assert(pdf.includes(`/URI ${pdfHex(car.url)}`));
    assert(pdf.includes(pdfHex("Referencia: 123")));
    assert(!pdf.includes(pdfHex("Foto no disponible.")));
  }
});

test("photo collection is bounded, keyed by car identity and tolerates unavailable photos", async () => {
  const items = Array.from({ length: 9 }, (_, i) => ({
    ...car,
    id: String(i),
  }));
  let active = 0,
    maxActive = 0;
  const photos = await collectSavedCarPhotos(
    [...items, { ...car, id: "unsaved", favourite: false }],
    async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      if (item.id === "1") throw Error("unavailable");
      if (item.id === "2") return null;
      return {
        width: 2,
        height: 1,
        bytes: new Uint8Array([255, 216, 255, 217]),
      };
    },
  );
  assert.equal(maxActive, 4);
  assert.equal(photos.size, 7);
  assert(!photos.has("unsaved"));
  assert(photos.has("8"));
  assert(!photos.has("1"));
  assert(!photos.has("2"));
});

test("photo conversion loads only the local proxy, scales to bounds and flattens transparency", async () => {
  const original = { Image: globalThis.Image, document: globalThis.document };
  let image, requested, background, drawn, quality;
  try {
    globalThis.Image = class {
      naturalWidth = 2400;
      naturalHeight = 1200;
      constructor() {
        image = this;
      }
      set src(value) {
        if (value) {
          requested = value;
          queueMicrotask(() => this.onload?.());
        }
      }
    };
    const canvas = {
      getContext: () => ({
        set fillStyle(value) {
          background = value;
        },
        fillRect() {},
        drawImage(...args) {
          drawn = args.slice(1);
        },
      }),
      toDataURL: (type, q) => (
        assert.equal(type, "image/jpeg"),
        (quality = q),
        "data:image/jpeg;base64,/9j/2Q=="
      ),
    };
    globalThis.document = { createElement: () => canvas };
    const photo = await loadCarPhoto({
      ...car,
      id: "kia:1 /?",
      photoUrl: "https://third-party.example/car.jpg",
    });
    assert.equal(requested, "/api/photo?id=kia%3A1%20%2F%3F");
    assert.equal(photo.width, 1280);
    assert.equal(photo.height, 640);
    assert.deepEqual(drawn, [0, 0, 1280, 640]);
    assert.equal(background, "#ffffff");
    assert.equal(quality, 0.85);
    assert.equal(image.onload, null);
    assert.equal(canvas.width, 0);
    assert.deepEqual([...photo.bytes], [255, 216, 255, 217]);
  } finally {
    globalThis.Image = original.Image;
    globalThis.document = original.document;
  }
});

test("missing, failed and timed-out photos resolve without blocking PDF download", async () => {
  assert.equal(await loadCarPhoto(car), null);
  const original = {
    Image: globalThis.Image,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  try {
    let image, timer;
    globalThis.Image = class {
      constructor() {
        image = this;
      }
      set src(value) {
        if (value) queueMicrotask(() => this.onerror?.());
      }
    };
    assert.equal(await loadCarPhoto({ ...car, photoUrl: "present" }), null);
    assert.equal(image.onerror, null);
    globalThis.Image = class {
      constructor() {
        image = this;
      }
      set src(value) {}
    };
    globalThis.setTimeout = (callback) => ((timer = callback), 1);
    globalThis.clearTimeout = () => {};
    const pending = loadCarPhoto({ ...car, photoUrl: "present" });
    timer();
    assert.equal(await pending, null);
    assert.equal(image.onload, null);
  } finally {
    globalThis.Image = original.Image;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
  }
});
