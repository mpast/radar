import { photoUrl } from "../services/listing-photos.mjs";
import { searchToyotaCars } from "./toyota-sources.mjs";
import { towns, distance, matches } from "../domain/core.mjs";
export const kiaCatalogue =
  "https://www.kia.com/es/soluciones-de-movilidad/kia-seminuevos-certificados-/";
export const hyundaiCatalogue =
  "https://www.hyundai.es/seminuevos/index.php?route=product%2Fvehiculo&group_id=10";
const endpoint = "https://kiaokasion.net/kia/async/metodos.aspx";
const numeric = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export function parseKiaCar(x, settings) {
  if (!/^\d+$/.test(String(x.id)) || !x.concesionario || !x.modelo) return null;
  const locality = String(x.poblacion || "")
      .toLowerCase()
      .trim(),
    coords = towns[locality],
    cash = numeric(x.precio_alcontado);
  return {
    id: "kia:" + x.id,
    stockReference: String(x.id),
    kind: "cars",
    title: [x.marca, x.modelo, x.version].filter(Boolean).join(" "),
    url: kiaCatalogue,
    catalogueLink: true,
    source: "Kia Seminuevos Certificados",
    provider: "kia-official",
    sellerType: "dealer",
    sellerEvidence:
      "Inventario enlazado por Kia España · " + String(x.concesionario),
    dealer: String(x.concesionario),
    locality: locality || null,
    distance: coords ? distance(coords, settings?.origin?.coordinates) : null,
    distanceBasis: coords
      ? "coordinates"
      : settings?.origin
        ? "provider-radius"
        : null,
    searchRadius: settings?.radius,
    price: cash,
    priceBasis: "cash",
    financePrice: numeric(x.precio),
    photoUrl: photoUrl(x.imagen),
    seats: null,
    environmentalLabel:
      new Map([
        ["1", "B"],
        ["2", "C"],
        ["3", "ECO"],
        ["4", "0"],
      ]).get(String(x.distintivo)) ?? null,
    km: numeric(x.kilometros),
    year: numeric(x.any),
    caution: false,
  };
}
export async function searchOfficialCars(settings, fetcher = fetch) {
  const items = [],
    sources = [],
    ids = new Set();
  let raw = 0,
    pages = 0,
    totalPages = 0;
  try {
    for (let page = 1; page <= Math.min(totalPages || 1, 3); page++) {
      const body = new URLSearchParams({
        accion: "actualizarCoches",
        modelos: "",
        carrocerias: "",
        motores: "",
        cambios: "",
        combustibles: "",
        colores: "",
        kilometros: String(settings.maxKm),
        preciominimo: "0",
        preciomaximo: String(settings.budgetCar),
        cp: settings.postalCode || "",
        km: String(settings.radius),
        orden: "1",
        pagina: String(page),
        anyminimo: "2000",
        anymaximo: String(new Date().getFullYear() + 1),
        longitud: String(settings.origin?.coordinates[1] ?? ""),
        latitud: String(settings.origin?.coordinates[0] ?? ""),
        kmsdistancia: String(settings.radius),
        idconcesionario: "",
      });
      const r = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error("HTTP " + r.status);
      const b = await r.json();
      if (!Array.isArray(b.vehiculos))
        throw Error("Formato de inventario no reconocido");
      totalPages = Math.max(1, Number(b.top_paginacion) || 1);
      pages++;
      raw += b.vehiculos.length;
      for (const x of b.vehiculos) {
        const car = parseKiaCar(x, settings);
        if (car && !ids.has(car.id)) {
          ids.add(car.id);
          items.push(car);
        }
      }
    }
    sources.push({
      name: "Kia",
      ok: true,
      pages,
      totalPages,
      partial: totalPages > pages,
    });
  } catch {
    sources.push({
      name: "Kia",
      ok: false,
      error: "Inventario no disponible o formato cambiado.",
      pages,
    });
  }
  try {
    const r = await fetcher(hyundaiCatalogue, {
      signal: AbortSignal.timeout(15000),
    });
    sources.push({
      name: "Hyundai",
      ok: false,
      error:
        r.status === 403
          ? "Acceso bloqueado por Hyundai (HTTP 403). Abre su catálogo directamente."
          : "No hay un adaptador de inventario disponible para la respuesta actual.",
    });
  } catch {
    sources.push({
      name: "Hyundai",
      ok: false,
      error: "No se pudo conectar con el catálogo.",
    });
  }
  try {
    const toyota = await searchToyotaCars(settings, fetcher);
    raw += toyota.raw;
    items.push(...toyota.items);
    sources.push(toyota.source);
  } catch (error) {
    sources.push({ name: "Toyota", ok: false, error: error.message });
  }
  if (!sources.some((source) => source.ok))
    throw Object.assign(
      Error(
        "No se pudieron consultar los inventarios oficiales. Revisa el estado de cada fuente o abre sus catálogos.",
      ),
      { code: "official_unavailable", sources },
    );
  return {
    items,
    diagnostics: {
      raw,
      accepted: items.length,
      unsupported: raw - items.length,
      sellerExcluded: 0,
      filterExcluded: items.filter((x) => !matches(x, settings)).length,
      matching: items.filter((x) => matches(x, settings)).length,
      sources,
      official: true,
      partial: sources.some((source) => source.partial),
    },
  };
}
