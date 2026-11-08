import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  readFotocasa,
  parseFotocasaHouse,
  searchDirectHouses,
} from "../src/sources/house-sources.mjs";
import { defaults, matches, offer } from "../src/domain/core.mjs";
const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/fotocasa-props.json", import.meta.url)),
  ),
  rows = fixture.initialSearch.result.realEstates,
  html =
    '<script id="__initial_props__" type="application/json">' +
    JSON.stringify(fixture) +
    "</script>";
test("actual Fotocasa page JSON gives purchase-only chalet details and published asking price", () => {
  assert.equal(readFotocasa(html).rows.length, rows.length);
  const x = parseFotocasaHouse(rows[0]);
  assert.equal(x.price, 1480000);
  assert.equal(x.area, 430);
  assert.equal(x.beds, 5);
  assert.equal(x.locality, "rivas-vaciamadrid");
  assert(x.url.startsWith("https://www.fotocasa.es/es/comprar/vivienda/"));
  assert.equal(parseFotocasaHouse({ ...rows[0], transactionTypeId: 2 }), null);
  assert.equal(
    parseFotocasaHouse({ ...rows[0], buildingSubtype: "Flat" }).houseType,
    "home",
  );
  assert.equal(
    parseFotocasaHouse({
      ...rows[0],
      detail: { "es-ES": "https://evil.example/123/d" },
    }),
    null,
  );
  assert(!matches(x, { ...defaults, budgetHouse: 550000 }));
  assert.equal(parseFotocasaHouse(rows[1]), null);
  assert(matches(x, { ...defaults, budgetHouse: 1500000 }));
});
test("occupied, bare ownership, tenancy and auctions retain warnings and never become comparison offers", () => {
  for (const flag of [
    "isOccupied",
    "isBareOwnership",
    "isRentedWithTenants",
    "isAuctioned",
  ]) {
    const x = parseFotocasaHouse({ ...rows[0], [flag]: true });
    assert(x.caution);
    assert(x.warnings.length);
    assert.equal(offer(x, []), null);
  }
});
test("direct houses preserve accessible Fotocasa results while reporting Idealista denial, with no paid API calls", async () => {
  const calls = [];
  const report = await searchDirectHouses(
    { ...defaults, budgetHouse: 550000 },
    async (url) => {
      calls.push(String(url));
      return String(url).includes("idealista")
        ? { status: 403, ok: false }
        : { ok: true, text: async () => html };
    },
  );
  assert.equal(calls.length, 2);
  assert(calls.every((u) => !u.includes("serpapi")));
  assert.equal(report.items.length, 2);
  assert(report.diagnostics.partial);
  assert.deepEqual(report.diagnostics.coverage, ["Rivas-Vaciamadrid"]);
  assert(
    report.diagnostics.sources.some((x) => x.name === "Idealista" && !x.ok),
  );
});
test("blocked Fotocasa is a source error, never a normal zero-results success", async () => {
  await assert.rejects(
    searchDirectHouses(defaults, async () => ({ status: 403, ok: false })),
    (e) => e.code === "houses_unavailable" && e.sources.every((x) => !x.ok),
  );
});
const responseHtml = (rows, nearby = []) =>
  '<script id="__initial_props__">' +
  JSON.stringify({
    initialSearch: { result: { realEstates: rows } },
    closeZones: nearby,
  }) +
  "</script>";
test("null and empty-object inventory entries fail atomically instead of establishing an empty successful baseline", async () => {
  for (const invalid of [null, {}]) {
    await assert.rejects(
      searchDirectHouses(defaults, async (url) =>
        String(url).includes("idealista")
          ? { status: 403, ok: false }
          : { ok: true, text: async () => responseHtml([rows[0], invalid]) },
      ),
      (e) => e.code === "houses_unavailable" && e.sources.every((s) => !s.ok),
    );
  }
});
test("genuine empty inventory and excluded rental rows are successful sources", async () => {
  for (const inventory of [[], [{ ...rows[0], transactionTypeId: 2 }]]) {
    const report = await searchDirectHouses(defaults, async (url) =>
      String(url).includes("idealista")
        ? { status: 403, ok: false }
        : { ok: true, text: async () => responseHtml(inventory) },
    );
    assert.deepEqual(report.items, []);
    assert.deepEqual(report.diagnostics.coverage, ["Rivas-Vaciamadrid"]);
    assert.equal(report.diagnostics.raw, inventory.length);
  }
});
test("a malformed nearby-town response preserves an earlier valid town without partial additions", async () => {
  const nearby = [
    {
      name: "Arganda del Rey",
      url: "/es/comprar/chalets/arganda-del-rey/todas-las-zonas/l",
    },
  ];
  const report = await searchDirectHouses(defaults, async (url) =>
    String(url).includes("idealista")
      ? { status: 403, ok: false }
      : {
          ok: true,
          text: async () =>
            String(url).includes("arganda")
              ? responseHtml([{ ...rows[0], id: 123456789 }, {}])
              : responseHtml([rows[0]], nearby),
        },
  );
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].id, "fotocasa:" + rows[0].id);
  assert.equal(report.diagnostics.raw, 1);
  assert.deepEqual(report.diagnostics.coverage, ["Rivas-Vaciamadrid"]);
  assert(
    report.diagnostics.sources.some((s) => s.name.includes("Arganda") && !s.ok),
  );
});
