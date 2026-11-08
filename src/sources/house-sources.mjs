import { photoUrl } from "../services/listing-photos.mjs";
import { locationSlug, resolvePostalCode } from "../services/location.mjs";
import {
  towns,
  distance,
  matches,
  houseExclusionReasons,
} from "../domain/core.mjs";
export const idealistaCatalogue =
  "https://www.idealista.com/venta-viviendas/rivas-vaciamadrid-madrid/con-chalets/";
export const fotocasaCatalogue =
  "https://www.fotocasa.es/es/comprar/chalets/rivas-vaciamadrid/todas-las-zonas/l";
function validateFotocasaRow(x) {
  if (
    !x ||
    typeof x !== "object" ||
    !Number.isSafeInteger(x.id) ||
    x.id <= 0 ||
    !Number.isInteger(x.transactionTypeId) ||
    typeof x.buildingSubtype !== "string" ||
    !x.buildingSubtype ||
    typeof x.detail?.["es-ES"] !== "string" ||
    !x.address ||
    typeof x.address !== "object" ||
    !Array.isArray(x.features) ||
    x.features.some(
      (f) => !f || typeof f.key !== "string" || typeof f.value !== "number",
    )
  )
    throw Error("Esquema de ficha de Fotocasa no reconocido");
}
export function parseFotocasaHouse(x, settings) {
  validateFotocasaRow(x);
  const path = x.detail?.["es-ES"];
  if (
    x.isPromotion ||
    x.promotionId ||
    x.transactionTypeId !== 1 ||
    !/^(?:House_|Flat|Apartment|Duplex|Penthouse|Studio)/i.test(
      x.buildingSubtype,
    ) ||
    !/^\/es\/comprar\/vivienda\/[^?#]+\/\d+\/d$/.test(path || "")
  )
    return null;
  const locality = String(x.address?.municipality || "").toLowerCase(),
    coordinates = towns[locality],
    feature = (k) => {
      const v = x.features?.find((f) => f.key === k)?.value;
      return typeof v === "number" && v > 0 ? v : null;
    },
    price =
      typeof x.rawPrice === "number" && x.rawPrice > 0 ? x.rawPrice : null,
    description = String(x.description || "");
  if (!feature("surface")) return null;
  const specialExclusionReasons = houseExclusionReasons({
    kind: "houses",
    description,
    ...Object.fromEntries(
      [
        "isOccupied",
        "isBareOwnership",
        "isRentedWithTenants",
        "isAuctioned",
      ].map((k) => [k, x[k]]),
    ),
  });
  const warnings = [
    x.isBareOwnership && "Nuda propiedad",
    x.isOccupied && "Ocupado",
    x.isRentedWithTenants && "Con inquilinos",
    x.isAuctioned && "Subasta",
  ].filter(Boolean);
  if (specialExclusionReasons.length && !warnings.length)
    warnings.push("Condiciones especiales en la descripción");
  return {
    id: "fotocasa:" + x.id,
    kind: "houses",
    title:
      (x.buildingSubtype === "House_Chalet" ? "Chalet" : "Vivienda") +
      " en " +
      String(x.address?.municipality || "localidad desconocida") +
      (x.location ? " · " + x.location : ""),
    url: "https://www.fotocasa.es" + path,
    source: "Fotocasa directo",
    provider: "fotocasa-direct",
    photoUrl: photoUrl(
      x.multimedia?.find((media) => media?.type === "image")?.src,
    ),
    houseType: x.buildingSubtype === "House_Chalet" ? "chalet" : "home",
    postalCode: String(x.address?.zipCode || ""),
    price,
    area: feature("surface"),
    beds: feature("rooms"),
    locality: locality || null,
    distance: coordinates
      ? distance(coordinates, settings?.origin?.coordinates)
      : null,
    caution: !!specialExclusionReasons.length,
    warnings,
    specialExclusionReasons,
    eligibilityBasis: "Clasificado con la descripción completa del portal",
    snippet: description.slice(0, 1500),
  };
}
export function readFotocasa(html) {
  const m = html.match(
    /<script[^>]*id=["']__initial_props__["'][^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) throw Error("Formato público de Fotocasa no reconocido");
  const b = JSON.parse(m[1]),
    rows = b.initialSearch?.result?.realEstates;
  if (!Array.isArray(rows)) throw Error("Inventario de Fotocasa no reconocido");
  return { rows, nearby: Array.isArray(b.closeZones) ? b.closeZones : [] };
}
export async function searchDirectHouses(settings, fetcher = fetch) {
  const items = [],
    ids = new Set(),
    sources = [],
    coverage = [],
    locations = new Map();
  let raw = 0,
    succeeded = 0;
  const load = async (url, name) => {
    try {
      const r = await fetcher(url, { signal: AbortSignal.timeout(25000) });
      if (!r.ok)
        throw Error(
          r.status === 403
            ? "Acceso bloqueado (HTTP 403), sin eludir la protección."
            : "Respuesta HTTP " + r.status,
        );
      const b = readFotocasa(await r.text()),
        parsed = b.rows.map((x) => parseFotocasaHouse(x, settings));
      for (const house of parsed) {
        if (!house || !settings.origin) continue;
        house.distance = null;
        if (house.postalCode === settings.postalCode) house.distance = 0;
        else if (/^\d{5}$/.test(house.postalCode)) {
          try {
            if (!locations.has(house.postalCode))
              locations.set(
                house.postalCode,
                resolvePostalCode(house.postalCode, fetcher),
              );
            const place = await locations.get(house.postalCode);
            house.distance = distance(
              place.coordinates,
              settings.origin.coordinates,
            );
          } catch {}
        }
      }
      raw += b.rows.length;
      succeeded++;
      coverage.push(name);
      for (const house of parsed) {
        if (house && !ids.has(house.id)) {
          items.push(house);
          ids.add(house.id);
        }
      }
      sources.push({ name: "Fotocasa · " + name, ok: true });
      return b;
    } catch (e) {
      sources.push({
        name: "Fotocasa · " + name,
        ok: false,
        error: e.message.startsWith("Acceso bloqueado")
          ? e.message
          : "Consulta no disponible o formato cambiado.",
      });
      return null;
    }
  };
  const slug = settings.origin
      ? locationSlug(settings.origin.name)
      : "rivas-vaciamadrid",
    type = settings.onlyChalets ? "chalets" : "viviendas",
    catalogue =
      "https://www.fotocasa.es/es/comprar/" +
      type +
      "/" +
      slug +
      "/todas-las-zonas/l";
  const first = await load(
    catalogue,
    settings.origin?.name || "Rivas-Vaciamadrid",
  );
  for (const link of first?.nearby || []) {
    if (
      !/^\/es\/comprar\/(?:chalets|viviendas)\/[a-z0-9-]+\/todas-las-zonas\/l$/.test(
        link.url,
      ) ||
      coverage.length >= 6
    )
      continue;
    await load("https://www.fotocasa.es" + link.url, link.name);
  }

  try {
    const r = await fetcher(
      settings.origin
        ? "https://www.idealista.com/venta-viviendas/" +
            locationSlug(settings.origin.name) +
            "-" +
            locationSlug(settings.origin.region) +
            (settings.onlyChalets ? "/con-chalets/" : "/")
        : idealistaCatalogue,
      { signal: AbortSignal.timeout(15000) },
    );
    sources.push({
      name: "Idealista",
      ok: false,
      error:
        r.status === 403
          ? "Acceso bloqueado por Idealista (HTTP 403). Abre el portal directamente."
          : "Adaptador no disponible para la respuesta actual de Idealista.",
    });
  } catch {
    sources.push({
      name: "Idealista",
      ok: false,
      error: "No se pudo consultar el portal.",
    });
  }
  if (!succeeded)
    throw Object.assign(
      Error(
        "No se pudo leer Fotocasa directamente. Idealista no permite la consulta automática en este momento.",
      ),
      { code: "houses_unavailable", sources },
    );
  return {
    items,
    diagnostics: {
      raw,
      accepted: items.length,
      unsupported: raw - items.length,
      sellerExcluded: 0,
      specialExcluded: items.filter((x) => houseExclusionReasons(x).length)
        .length,
      filterExcluded: items.filter(
        (x) => !houseExclusionReasons(x).length && !matches(x, settings),
      ).length,
      matching: items.filter((x) => matches(x, settings)).length,
      directHouses: true,
      partial: true,
      coverage,
      sources,
    },
  };
}
