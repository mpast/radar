import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validPostalCode,
  resolvePostalCode,
  geoDistance,
} from "../src/services/location.mjs";
import {
  defaults,
  validateSettings,
  matches,
  parseResult,
  searchReport,
} from "../src/domain/core.mjs";
import {
  parseFotocasaHouse,
  searchDirectHouses,
} from "../src/sources/house-sources.mjs";
import { searchOfficialCars } from "../src/sources/official-sources.mjs";
import {
  checkCarAvailability,
  checkMissingCars,
} from "../src/services/availability.mjs";

const origin = {
  postalCode: "08001",
  name: "Barcelona",
  region: "Cataluna",
  coordinates: [41.3818, 2.1685],
};
const settings = {
  ...defaults,
  postalCode: "08001",
  origin,
  budgetHouse: 2000000,
};
const row = JSON.parse(
  readFileSync(new URL("./fixtures/fotocasa-props.json", import.meta.url)),
).initialSearch.result.realEstates[0];
test("Spanish postal codes retain leading zeros and resolution failures preserve prior settings", async () => {
  for (const value of ["08001", "28001", "52001"])
    assert(validPostalCode(value));
  for (const value of ["00000", "53000", "8001", "08001x", 8001])
    assert(!validPostalCode(value));
  const resolved = await resolvePostalCode("08001", async (url) => {
    assert(url.endsWith("/es/08001"));
    return {
      ok: true,
      json: async () => ({
        places: [
          {
            "place name": "Barcelona",
            state: "Cataluna",
            latitude: "41.3818",
            longitude: "2.1685",
          },
        ],
      }),
    };
  });
  assert.deepEqual(resolved, origin);
  assert.equal(validateSettings({ postalCode: "08001" }).postalCode, "08001");
  await assert.rejects(
    resolvePostalCode("08001", async () => ({ ok: false })),
    /no se pudo localizar/,
  );
  assert.throws(() => validateSettings({ postalCode: "bad" }, settings));
  assert.equal(settings.postalCode, "08001");
  assert.equal(geoDistance(origin.coordinates, origin.coordinates), 0);
  assert(geoDistance([40.33, -3.53], origin.coordinates) > 400);
});
test("all homes are included by default and chalet-only toggles on and off", () => {
  const flat = {
    ...parseFotocasaHouse({ ...row, buildingSubtype: "Flat" }),
    distance: 0,
  };
  const chalet = { ...parseFotocasaHouse(row), distance: 0 };
  assert.equal(parseFotocasaHouse({ ...row, buildingSubtype: "Garage" }), null);
  assert(matches(flat, settings));
  assert(!matches(flat, { ...settings, onlyChalets: true }));
  assert(matches(chalet, { ...settings, onlyChalets: true }));
  const enabled = validateSettings({ onlyChalets: true }, settings),
    disabled = validateSettings({ onlyChalets: false }, enabled);
  assert(matches(flat, disabled));
  const indexed = parseResult(
    {
      title: "Piso venta Barcelona 200.000 € 90 m² 3 hab.",
      link: "https://www.idealista.com/inmueble/123456789/",
    },
    "houses",
  );
  assert(indexed);
  assert.equal(indexed.houseType, "home");
});
test("house search uses the selected town and housing type and computes distance from postcode", async () => {
  const urls = [];
  const report = await searchDirectHouses(settings, async (url) => {
    urls.push(String(url));
    return String(url).includes("idealista")
      ? { ok: false, status: 403 }
      : {
          ok: true,
          text: async () =>
            '<script id="__initial_props__">' +
            JSON.stringify({
              initialSearch: {
                result: {
                  realEstates: [
                    {
                      ...row,
                      buildingSubtype: "Flat",
                      address: {
                        ...row.address,
                        zipCode: "08001",
                        municipality: "Barcelona",
                      },
                    },
                  ],
                },
              },
            }) +
            "</script>",
        };
  });
  assert(urls[0].includes("/viviendas/barcelona/"));
  assert.equal(report.items[0].distance, 0);
  assert.equal(report.diagnostics.matching, 1);
});
test("Kia receives postcode and coordinates instead of fixed Madrid origin", async () => {
  await searchOfficialCars(settings, async (url, options) => {
    if (!String(url).includes("kiaokasion")) return { ok: false, status: 403 };
    assert.equal(options.body.get("cp"), "08001");
    assert.equal(options.body.get("latitud"), "41.3818");
    assert.equal(options.body.get("longitud"), "2.1685");
    return {
      ok: true,
      json: async () => ({ vehiculos: [], top_paginacion: 1 }),
    };
  });
});
test("only definitive missing car pages imply sold; transport and access failures retain availability", async () => {
  const car = {
    kind: "cars",
    url: "https://www.toyota.es/coches-segunda-mano/ficha.test",
  };
  for (const status of [404, 410])
    assert.equal(
      await checkCarAvailability(car, async () => ({ status, ok: false })),
      "sold",
    );
  for (const status of [403, 429, 500, 302])
    assert.equal(
      await checkCarAvailability(car, async () => ({ status, ok: false })),
      null,
    );
  assert.equal(
    await checkCarAvailability(car, async () => {
      throw Error("timeout");
    }),
    null,
  );
  assert.equal(
    await checkCarAvailability({ ...car, catalogueLink: true }, () =>
      assert.fail("catalogues are not individual cars"),
    ),
    null,
  );
  assert.equal(
    await checkCarAvailability(
      { ...car, url: "https://evil.example/car" },
      () => assert.fail("untrusted host"),
    ),
    null,
  );
  assert(
    !matches(
      { ...car, sellerType: "dealer", availability: "sold" },
      { ...settings, includeUnknown: true },
    ),
  );
  assert(
    !matches(
      { ...car, sellerType: "dealer", provider: "hyundai-manual" },
      { ...settings, includeUnknown: true },
    ),
  );
});

test("indexed housing recognizes the selected municipality beyond Madrid and labels its estimated distance", () => {
  const report = searchReport(
    {
      organic_results: [
        {
          title: "Piso en venta Barcelona 250.000 € 80 m² 3 hab.",
          link: "https://www.idealista.com/inmueble/123456789/",
        },
      ],
    },
    "houses",
    settings,
  );
  assert.equal(report.items[0].locality, "barcelona");
  assert.equal(report.items[0].distanceBasis, "municipality-estimate");
  assert.equal(report.diagnostics.matching, 1);
});
test("missing-car checks rotate bounded batches and skip sold, other postcodes, returned records and catalogues", async () => {
  const cars = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    kind: "cars",
    searchPostalCode: "08001",
    availability: "available",
    url: "https://www.toyota.es/coches-segunda-mano/ficha." + i,
  }));
  let active = 0,
    max = 0,
    calls = 0;
  const fetcher = async () => {
    active++;
    calls++;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return { status: 404, ok: false };
  };
  const first = await checkMissingCars(
    [
      ...cars,
      { ...cars[0], id: "sold", availability: "sold" },
      { ...cars[0], id: "elsewhere", searchPostalCode: "28001" },
      { ...cars[0], id: "catalogue", catalogueLink: true },
    ],
    [],
    "08001",
    0,
    fetcher,
  );
  assert.equal(calls, 8);
  assert(max <= 4);
  assert.equal(first.items.length, 8);
  assert.equal(first.offset, 8);
  const second = await checkMissingCars(
    cars,
    [cars[0]],
    "08001",
    first.offset,
    fetcher,
  );
  assert(second.items.some((x) => x.id === "11"));
  assert(!second.items.some((x) => x.id === "0"));
  assert.equal(
    await checkCarAvailability(cars[0], async () => ({
      ok: true,
      text: async () =>
        "<footer>Si un vehículo no disponible aparece, contacta con nosotros.</footer>",
    })),
    null,
  );
});

test("a province mention never overwrites a known municipality or bypasses radius", () => {
  const madrid = {
    ...settings,
    postalCode: "28001",
    origin: { name: "Madrid", coordinates: [40.42, -3.7] },
    radius: 1,
  };
  const report = searchReport(
    {
      organic_results: [
        {
          title:
            "Piso en venta Arganda del Rey, Madrid · 250.000 € 80 m² 3 hab.",
          link: "https://www.idealista.com/inmueble/123456789/",
        },
      ],
    },
    "houses",
    madrid,
  );
  assert.equal(report.items[0].locality, "arganda del rey");
  assert(report.items[0].distance > 20);
  assert.equal(report.diagnostics.matching, 0);
  const other = searchReport(
    {
      organic_results: [
        {
          title: "Piso en venta Sabadell, Barcelona · 250.000 € 80 m² 3 hab.",
          link: "https://www.idealista.com/inmueble/123456790/",
        },
      ],
    },
    "houses",
    settings,
  );
  assert.equal(other.items[0].distance, null);
  assert.equal(other.diagnostics.matching, 0);
});

test("refresh repopulates canonical filters after a postcode change before the next refresh", async () => {
  const { default: vm } = await import("node:vm");
  const source = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    ),
    handler = source.match(
      /\$\('#refresh'\)\.onclick=(async\(\)=>\{.+?\});\$\('#filters'\)/,
    )[1];
  let town = "madrid",
    canonicalTown = "madrid",
    saves = [];
  const context = vm.createContext({
    demo: false,
    tab: "cars",
    $: () => ({ reportValidity: () => true }),
    saveFilters: async () => {
      saves.push(town);
      canonicalTown = "";
    },
    api: async () => ({ ok: true }),
    toast: () => {},
    load: async (repopulate) => {
      if (repopulate) town = canonicalTown;
    },
  });
  const click = vm.runInContext("(" + handler + ")", context);
  await click();
  await click();
  assert.deepEqual(saves, ["madrid", ""]);
});
