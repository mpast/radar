import { normalizeTransmission } from "../../public/car-transmission.js";
import { normalizeEnvironmentalLabel } from "../../public/car-label.js";
import { photoUrl } from "../services/listing-photos.mjs";
import { distance, parseSeats } from "../domain/core.mjs";
export const toyotaCatalogue = "https://www.toyota.es/coches-segunda-mano";
// This location-initialized page embeds the full public Spanish dealer directory.
export const toyotaDealerDirectory = toyotaCatalogue + "/madrid";
const endpoint =
  "https://usc-webcomponents.toyota-europe.com/v1/api/usedcars/results/es/es?brand=toyota";
const amount = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const dealerDistance = (dealer, origin) => {
  const { lat, lon } = dealer?.geoLocation || {};
  return typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
    ? distance([lat, lon], origin)
    : null;
};
export function parseToyotaCar(car, settings) {
  const product = car?.product,
    dealer = car?.dealer;
  if (
    !/^[a-f\d-]{36}$/i.test(car?.id || "") ||
    product?.brand?.code !== "38" ||
    !product.model?.description ||
    !dealer?.id ||
    !dealer.name ||
    car.currencyCode !== "EUR" ||
    car.vehicleStatus?.code !== "1"
  )
    return null;
  const registrationDate = /^\d{4}-\d{2}-\d{2}$/.test(
    car.history?.registrationDate || "",
  )
    ? car.history.registrationDate
    : null;
  const year = registrationDate ? Number(registrationDate.slice(0, 4)) : null;
  // Match the public Toyota frontend's individual vehicle URL format.
  const slug = [
    product.model.description
      .toLowerCase()
      .includes(product.brand.description?.toLowerCase())
      ? ""
      : product.brand.description,
    product.model.description,
    year,
    product.bodyType,
    product.transmission?.transmissionType?.description,
    product.engine?.marketingFuelType?.description,
    car.id,
  ]
    .filter(Boolean)
    .map((value) =>
      String(value)
        .normalize("NFD")
        .replace(/N\/A/g, "")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[()]/g, "")
        .replace(/[\s,/]+/g, "-")
        .replace(/[+]/g, "plus")
        .replace(/[.]/g, ""),
    )
    .join("-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return {
    id: "toyota:" + car.id,
    stockReference: car.id,
    kind: "cars",
    title: [
      product.brand.description,
      product.model.description,
      product.versionName,
    ]
      .filter(Boolean)
      .join(" "),
    url: "https://www.toyota.es/coches-segunda-mano/ficha." + encodeURI(slug),
    source: "Toyota Ocasión",
    provider: "toyota-official",
    sellerType: "dealer",
    sellerEvidence: "Inventario oficial Toyota España · " + dealer.name,
    dealer: dealer.name,
    locality: dealer.address?.city?.toLowerCase() || null,
    distance: dealerDistance(dealer, settings?.origin?.coordinates),
    price:
      amount(car.price?.sellingPriceInclVAT) > 0
        ? car.price.sellingPriceInclVAT
        : null,
    priceBasis: "cash",
    financePrice: null,
    photoUrl: photoUrl(car.images?.[0]?.url),
    seats: parseSeats(product.seats),
    transmission: normalizeTransmission(product.transmission?.transmissionType?.description),
    environmentalLabel: normalizeEnvironmentalLabel(
      product.eco?.label?.description,
    ),
    km: car.mileage?.unit?.code === "5" ? amount(car.mileage.value) : null,
    year,
    registrationDate,
    caution: false,
  };
}
export function toyotaDealers(html, { allowEmpty = false } = {}) {
  for (const match of String(html).matchAll(
    /<div\b[^>]*\bid="[^"]+-data"[^>]*>([\s\S]*?)<\/div>/g,
  )) {
    try {
      const state = JSON.parse(
          match[1]
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&"),
        ),
        dealers = state.carFilters?.usedCarLocation?.dealerCache;
      if (Array.isArray(dealers) && (dealers.length || allowEmpty))
        return dealers;
    } catch {}
  }
  throw Error("Formato del catálogo Toyota no reconocido.");
}
export async function searchToyotaCars(settings, fetcher = fetch) {
  const catalogue = await fetcher(toyotaCatalogue, {
    signal: AbortSignal.timeout(15000),
  });
  if (!catalogue.ok)
    throw Error(
      "Catálogo Toyota no disponible (HTTP " + catalogue.status + ").",
    );
  let dealers = toyotaDealers(await catalogue.text(), { allowEmpty: true });
  if (!dealers.length) {
    const directory = await fetcher(toyotaDealerDirectory, {
      signal: AbortSignal.timeout(15000),
    });
    if (!directory.ok)
      throw Error(
        "Directorio de concesionarios Toyota no disponible (HTTP " +
          directory.status +
          ").",
      );
    dealers = toyotaDealers(await directory.text());
  }
  const nearby = dealers
    .filter(
      (dealer) =>
        dealer.id &&
        dealerDistance(dealer, settings.origin?.coordinates) != null &&
        dealerDistance(dealer, settings.origin?.coordinates) <= settings.radius,
    )
    .map((dealer) => dealer.id);
  if (!nearby.length)
    throw Error(
      "El catálogo Toyota no identifica concesionarios dentro del radio; consulta el catálogo directamente.",
    );
  const items = [],
    ids = new Set(),
    pageKeys = new Set();
  let pages = 0,
    totalPages = 1,
    totalResults,
    raw = 0,
    error;
  for (let page = 0; page < totalPages; page++) {
    try {
      const body = {
        uscEnv: "production",
        filterContext: "used",
        offset: page * 12,
        resultCount: 12,
        sortOrder: "cashAsc",
        distributorCode: "94244",
        filters: [
          { filterId: "usedCarBrand", valueIds: ["38"] },
          { filterId: "usedCarLocation", valueIds: nearby },
          { filterId: "cash", min: 0, max: settings.budgetCar },
          { filterId: "usedCarMileage", min: 0, max: settings.maxKm },
        ],
      };
      // Up to five seats, retain records without a published count for the local five-seat fallback.
      if (settings.seats > 5)
        body.filters.push({
          filterId: "usedCarSeats",
          min: settings.seats,
          max: 9,
        });
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw Error(
          "Inventario Toyota no disponible (HTTP " + response.status + ").",
        );
      const result = await response.json();
      if (
        !Array.isArray(result.results) ||
        !Number.isSafeInteger(result.totalResultCount) ||
        result.totalResultCount < 0 ||
        result.errorLogs?.length
      )
        throw Error("Formato de inventario Toyota no reconocido.");
      const parsed = result.results.map((car) => parseToyotaCar(car, settings)),
        pageKey = JSON.stringify(result.results.map((car) => car?.id));
      if (result.results.length && pageKeys.has(pageKey)) {
        error = "Consulta Toyota incompleta: el servidor repitió una página.";
        break;
      }
      pageKeys.add(pageKey);
      if (totalResults == null) {
        totalResults = result.totalResultCount;
        totalPages = Math.max(1, Math.ceil(totalResults / 12));
      } else if (result.totalResultCount !== totalResults)
        error =
          "El inventario Toyota cambió durante la consulta; vuelve a actualizar para verificarlo.";
      pages++;
      raw += result.results.length;
      for (const car of parsed) {
        if (car && !ids.has(car.id)) {
          ids.add(car.id);
          items.push(car);
        }
      }
      if (!result.results.length && page + 1 < totalPages) {
        error =
          "Consulta Toyota incompleta: una página llegó vacía antes del final.";
        break;
      }
    } catch (failure) {
      if (!pages) throw failure;
      error =
        "Consulta Toyota incompleta: se conservan " +
        pages +
        " páginas. " +
        (failure.name === "TimeoutError" || failure.name === "AbortError"
          ? "Tiempo de espera agotado."
          : failure.message);
      break;
    }
  }
  if (!error && raw !== totalResults)
    error =
      "Consulta Toyota incompleta: el número de registros recibidos no coincide con el inventario anunciado.";
  return {
    items,
    raw,
    source: {
      name: "Toyota",
      ok: true,
      pages,
      totalPages,
      totalResults,
      partial: !!error || totalPages > pages,
      ...(error ? { error } : {}),
    },
  };
}
