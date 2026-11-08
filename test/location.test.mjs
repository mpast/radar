import test from "node:test";
import assert from "node:assert/strict";
import { resolvePostalCode } from "../src/services/location.mjs";

const feature = (
  properties = {},
  coordinates = [-3.5433248386391254, 40.36763331968408],
) => ({
  type: "Feature",
  properties: {
    osm_key: "place",
    osm_value: "postcode",
    name: "28523",
    city: "Rivas-Vaciamadrid",
    state: "Comunidad de Madrid",
    countrycode: "ES",
    ...properties,
  },
  geometry: { type: "Point", coordinates },
});
const json = (body) => ({ ok: true, status: 200, json: async () => body });
test("28523 falls back after primary 404 and retains exact postcode and municipality", async () => {
  const calls = [];
  const place = await resolvePostalCode("28523", async (url, options) => {
    calls.push(url);
    assert(options.signal instanceof AbortSignal);
    return url.includes("zippopotam")
      ? { ok: false, status: 404 }
      : json({ features: [feature()] });
  });
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]).searchParams.get("q"), "28523 España");
  assert.equal(place.postalCode, "28523");
  assert.equal(place.name, "Rivas-Vaciamadrid");
  assert.deepEqual(place.coordinates, [40.36763331968408, -3.5433248386391254]);
});
test("fallback rejects fuzzy codes, foreign results, POIs and malformed coordinates", async () => {
  for (const invalid of [
    feature({ name: "28524" }),
    feature({ countrycode: "PE" }),
    feature({ osm_key: "amenity", osm_value: "restaurant", postcode: "28523" }),
    feature({}, [null, 40]),
    feature({}, [-3, 91]),
    feature({ city: "" }),
  ]) {
    await assert.rejects(
      resolvePostalCode("28523", async (url) =>
        url.includes("zippopotam")
          ? { ok: false, status: 404 }
          : json({ features: [invalid] }),
      ),
      (error) => error.code === "postal_not_found",
    );
  }
});
test("transport and malformed primary responses try the fallback without weakening TLS", async () => {
  for (const primary of [
    async () => {
      throw new TypeError("fetch failed");
    },
    async () =>
      json({
        places: [{ "place name": "Rivas", latitude: null, longitude: null }],
      }),
    async () =>
      json({
        places: [{ "place name": "Rivas", latitude: "", longitude: "" }],
      }),
  ]) {
    const place = await resolvePostalCode("28523", async (url, options) => {
      assert(!("rejectUnauthorized" in options));
      return url.includes("zippopotam")
        ? primary()
        : json({ features: [feature()] });
    });
    assert.equal(place.name, "Rivas-Vaciamadrid");
  }
});
test("not-found and outage failures are distinct and failed lookups can be retried", async () => {
  await assert.rejects(
    resolvePostalCode("28523", async (url) =>
      url.includes("zippopotam")
        ? { ok: false, status: 404 }
        : json({ features: [] }),
    ),
    (error) => error.code === "postal_not_found",
  );
  let offline = true,
    calls = 0;
  const fetcher = async (url) => {
    calls++;
    if (offline) throw Error("network");
    return url.includes("zippopotam")
      ? { ok: false, status: 404 }
      : json({ features: [feature()] });
  };
  await assert.rejects(
    resolvePostalCode("28523", fetcher),
    (error) =>
      error.code === "location_unavailable" &&
      error.message.includes("configuración anterior"),
  );
  offline = false;
  assert.equal(
    (await resolvePostalCode("28523", fetcher)).name,
    "Rivas-Vaciamadrid",
  );
  assert.equal(calls, 4);
});
test("successful lookups are cached and simultaneous requests deduplicate without shared mutable results", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 1));
    return json({
      places: [
        { "place name": "Barcelona", latitude: "41.3818", longitude: "2.1685" },
      ],
    });
  };
  const [first, second] = await Promise.all([
    resolvePostalCode("08001", fetcher),
    resolvePostalCode("08001", fetcher),
  ]);
  first.coordinates[0] = 0;
  assert.equal(second.coordinates[0], 41.3818);
  assert.equal(
    (await resolvePostalCode("08001", fetcher)).coordinates[0],
    41.3818,
  );
  assert.equal(calls, 1);
});
