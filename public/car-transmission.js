export function normalizeTransmission(value) {
  if (typeof value !== "string") return null;
  const transmission = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["manual", "manual transmission"].includes(transmission)) return "manual";
  if (["automatic", "automatico", "automatica", "automatic transmission", "cvt", "e-cvt", "ecvt"].includes(transmission)) return "automatic";
  return null;
}
