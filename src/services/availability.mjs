// Search inventories can be filtered or paginated. Only a definitive detail-page
// response establishes a sale; blocked requests and transport failures do not.
export async function checkCarAvailability(item, fetcher = fetch, signal) {
  if (item.kind !== "cars" || item.catalogueLink || item.manualSnapshot)
    return null;
  let url;
  try {
    url = new URL(item.url);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !["www.toyota.es", "www.hyundai.es"].includes(url.hostname)
  )
    return null;
  try {
    const timeout = AbortSignal.timeout(10000);
    const response = await fetcher(url, {
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 404 || response.status === 410) return "sold";
    if (!response.ok) return null;
    const html = await response.text(),
      heading =
        html
          .match(/<(?:h1|title)\b[^>]*>([\s\S]*?)<\/(?:h1|title)>/gi)
          ?.join(" ") || "";
    if (
      /https?:\/\/schema.org\/SoldOut/i.test(html) ||
      /(?:vehículo|vehiculo|coche)\s+(?:ya\s+)?(?:vendido|no disponible)|(?:anuncio|vehículo|vehiculo)\s+(?:ya\s+)?no (?:está|esta|se encuentra) disponible/i.test(
        heading,
      )
    )
      return "sold";
    return null;
  } catch {
    return null;
  }
}

export async function checkMissingCars(
  previous,
  next,
  postalCode,
  offset = 0,
  fetcher = fetch,
) {
  const present = new Set(next.map((item) => item.id));
  const candidates = previous.filter(
    (item) =>
      item.kind === "cars" &&
      item.searchPostalCode === postalCode &&
      item.availability !== "sold" &&
      !item.catalogueLink &&
      !item.manualSnapshot &&
      !present.has(item.id),
  );
  if (!candidates.length) return { items: [], offset: 0 };
  const start = (offset || 0) % candidates.length,
    batch = Array.from(
      { length: Math.min(8, candidates.length) },
      (_, index) => candidates[(start + index) % candidates.length],
    ),
    items = [],
    signal = AbortSignal.timeout(20000);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, batch.length) }, async () => {
      while (index < batch.length && !signal.aborted) {
        const item = batch[index++];
        if ((await checkCarAvailability(item, fetcher, signal)) === "sold")
          items.push(item);
      }
    }),
  );
  return { items, offset: (start + batch.length) % candidates.length };
}
