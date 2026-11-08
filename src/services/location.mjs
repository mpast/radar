export const validPostalCode = (value) =>
  typeof value === "string" && /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(value);
export function geoDistance([lat, lon], [originLat, originLon]) {
  const r = Math.PI / 180,
    a = (lat - originLat) * r,
    b = (lon - originLon) * r;
  return Math.round(
    6371 *
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin(a / 2) ** 2 +
            Math.cos(lat * r) * Math.cos(originLat * r) * Math.sin(b / 2) ** 2,
        ),
      ),
  );
}
const resolverCaches = new WeakMap();
const coordinate = (value) =>
  typeof value === "number" ||
  (typeof value === "string" && value.trim() !== "")
    ? Number(value)
    : NaN;
const validCoordinates = ([lat, lon]) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180;

async function lookupPostalCode(postalCode, fetcher) {
  let primaryMissing = false;
  try {
    const response = await fetcher(
      "https://api.zippopotam.us/es/" + postalCode,
      { signal: AbortSignal.timeout(7000) },
    );
    primaryMissing = response.status === 404;
    if (response.ok) {
      const data = await response.json(),
        place = data.places?.[0],
        coordinates = [
          coordinate(place?.latitude),
          coordinate(place?.longitude),
        ];
      if (
        !place?.["place name"] ||
        !validCoordinates(coordinates) ||
        (data["country abbreviation"] &&
          data["country abbreviation"] !== "ES") ||
        (data["post code"] && data["post code"] !== postalCode)
      )
        throw Error("Invalid postal response");
      return {
        postalCode,
        name: place["place name"],
        region: place.state || "",
        coordinates,
      };
    }
  } catch {}
  // The primary dataset omits valid Spanish codes (including 28523). Photon
  // supplies OSM postcode centroids; fuzzy hits and POI addresses are rejected.
  let fallbackMissing = false;
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", postalCode + " España");
    url.searchParams.set("limit", "5");
    const response = await fetcher(url.href, {
      headers: { "user-agent": "RadarLocal/1.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw Error("Geocoder unavailable");
    const data = await response.json();
    if (!Array.isArray(data.features)) throw Error("Invalid geocoder response");
    for (const feature of data.features) {
      const p = feature?.properties,
        coords = feature?.geometry?.coordinates;
      if (
        p?.countrycode?.toUpperCase() !== "ES" ||
        p.osm_key !== "place" ||
        p.osm_value !== "postcode" ||
        p.name !== postalCode ||
        feature.geometry?.type !== "Point" ||
        !Array.isArray(coords) ||
        coords.length !== 2
      )
        continue;
      const coordinates = [coordinate(coords[1]), coordinate(coords[0])],
        name = p.city || p.town || p.village || p.municipality;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        !validCoordinates(coordinates)
      )
        continue;
      return {
        postalCode,
        name,
        region: p.state || "",
        coordinates,
        source: "OpenStreetMap / Photon",
      };
    }
    fallbackMissing = true;
  } catch {}
  const missing = primaryMissing && fallbackMissing;
  throw Object.assign(
    Error(
      missing
        ? "Configuración: los servicios de ubicación no tienen coordenadas para este código postal. No se ha cambiado tu ubicación."
        : "Configuración: no se pudo localizar el código postal porque los servicios de ubicación no están disponibles. Tu configuración anterior se conserva. Inténtalo de nuevo.",
    ),
    { code: missing ? "postal_not_found" : "location_unavailable" },
  );
}

export async function resolvePostalCode(postalCode, fetcher = fetch) {
  if (!validPostalCode(postalCode))
    throw Error(
      "Configuración: introduce un código postal español de cinco cifras.",
    );
  let cache = resolverCaches.get(fetcher);
  if (!cache) {
    cache = new Map();
    resolverCaches.set(fetcher, cache);
  }
  const saved = cache.get(postalCode);
  if (saved && saved.expires > Date.now())
    return structuredClone(await saved.result);
  const result = lookupPostalCode(postalCode, fetcher);
  const entry = { result, expires: Date.now() + 7 * 86400000 };
  cache.set(postalCode, entry);
  if (cache.size > 512) cache.delete(cache.keys().next().value);
  try {
    return structuredClone(await result);
  } catch (error) {
    if (cache.get(postalCode) === entry) cache.delete(postalCode);
    throw error;
  }
}
export const locationSlug = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
