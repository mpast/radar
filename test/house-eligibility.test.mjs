import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  houseExclusionReasons,
  isEligibleListing,
  matches,
  defaults,
  offer,
  createNotificationFlusher,
  parseResult,
} from "../src/domain/core.mjs";
import { parseFotocasaHouse } from "../src/sources/house-sources.mjs";
const house = {
  id: "h",
  kind: "houses",
  title: "Chalet en Rivas",
  price: 300000,
  area: 180,
  beds: 3,
  locality: "rivas",
  distance: 0,
};
test("special housing conditions are mandatory exclusions even when unknown fields are enabled", () => {
  for (const snippet of [
    "Vivienda okupada",
    "Inmueble ocupado",
    "Sin posesión",
    "Se vende alquilada con inquilinos",
    "Nuda propiedad",
    "Usufructo vitalicio",
    "Venta en subasta",
    "Cesión de remate",
    "Cesión de derechos",
    "No hipotecable",
    "No financiable",
    "Venta solo al contado",
    "Suelo rústico",
    "Finca rústica",
    "Suelo no urbanizable",
    "Vivienda construida sin licencia",
    "No se puede visitar",
  ]) {
    const x = { ...house, snippet };
    assert(houseExclusionReasons(x).length, snippet);
    assert(!matches(x, { ...defaults, includeUnknown: true }), snippet);
    assert(!isEligibleListing(x), snippet);
  }
});
test("normal financing, vacancy and rustic decoration remain eligible", () => {
  for (const snippet of [
    "Se financia, hipoteca disponible",
    "Libre de ocupantes y sin inquilinos",
    "Vivienda no está ocupada",
    "No se encuentra alquilada",
    "Decoración de estilo rústico",
    "Casa con muebles rústicos",
    "No se puede visitar sin cita previa",
  ])
    assert(isEligibleListing({ ...house, snippet }), snippet);
  assert(
    isEligibleListing({
      ...house,
      kind: "cars",
      sellerType: "dealer",
      caution: true,
      snippet: "Financiado",
    }),
  );
});
test("legacy explicit warnings and current structured flags exclude immediately without changing stored history", () => {
  for (const x of [
    { ...house, warnings: ["Ocupado"] },
    { ...house, warnings: ["Condiciones especiales en la descripción"] },
    { ...house, isBareOwnership: true },
  ])
    assert(!isEligibleListing(x));
});
test("direct and indexed parsers classify the entire available description before preview truncation", () => {
  const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/fotocasa-props.json", import.meta.url)),
    ),
    x = fixture.initialSearch.result.realEstates[0],
    description = "Información de vivienda. ".repeat(200) + " No hipotecable.";
  const parsed = parseFotocasaHouse({ ...x, description });
  assert(parsed.snippet.length < description.length);
  assert(!isEligibleListing(parsed));
  const indexed = parseResult(
    {
      title: "Chalet venta Rivas 300.000 € 180 m² 3 hab.",
      snippet: description,
      link: "https://www.idealista.com/inmueble/123456789/",
    },
    "houses",
  );
  assert(!isEligibleListing(indexed));
});
test("special homes cannot be offer subjects or comparable peers", () => {
  const peers = [1, 2, 3].map((i) => ({
    ...house,
    id: String(i),
    price: 330000,
  }));
  assert(offer(house, peers));
  assert.equal(offer({ ...house, snippet: "No financiable" }, peers), null);
  assert.equal(
    offer(
      house,
      peers.map((x) => ({ ...x, snippet: "Finca rústica" })),
    ),
    null,
  );
});
test("retry delivery discards a previously queued home now identified as occupied", async () => {
  let sent = 0,
    done = 0;
  const flush = createNotificationFlusher({
    readSettings: () => ({
      ...defaults,
      includeUnknown: true,
      telegramEnabled: true,
    }),
    readSecrets: () => ({ token: "unused", chat: "unused" }),
    pending: () => [
      {
        id: "n",
        text: "unused",
        event: JSON.stringify({ listingId: house.id, price: house.price }),
      },
    ],
    findItem: () => ({ ...house, snippet: "Okupada" }),
    markDone: () => done++,
    send: async () => sent++,
  });
  await flush();
  assert.equal(sent, 0);
  assert.equal(done, 1);
});

test("new direct parser does not retain obsolete generic warnings for negated conditions", () => {
  const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/fotocasa-props.json", import.meta.url)),
    ),
    raw = fixture.initialSearch.result.realEstates[0];
  for (const description of [
    "Vivienda no está ocupada",
    "No se encuentra alquilada",
    "Libre de ocupantes y sin inquilinos",
  ]) {
    const house = parseFotocasaHouse({ ...raw, description });
    assert.deepEqual(house.warnings, []);
    assert.deepEqual(house.specialExclusionReasons, []);
    assert(isEligibleListing(house));
  }
});
