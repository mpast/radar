import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
const hosts = new Set([
  "kiaokasion.net",
  "used-car-publisher.toyota-europe.com",
  "www.hyundai.es",
  "static.fotocasa.es",
  "st3.idealista.com",
]);
export function photoUrl(value) {
  try {
    if (typeof value !== "string" || !value.trim()) return null;
    const url = new URL(value.startsWith("//") ? "https:" + value : value);
    return url.protocol === "https:" &&
      hosts.has(url.hostname) &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function imageType(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
export function createPhotoCache(directory, fetcher = fetch) {
  const pending = new Map(),
    failed = new Map(),
    limit = 5 * 1024 * 1024;
  return async function firstPhoto(item) {
    const url = photoUrl(item.photoUrl);
    if (!url) return null;
    const key = createHash("sha256")
        .update(item.id + "\0" + url)
        .digest("hex"),
      file = join(directory, key);
    if (pending.has(key)) return pending.get(key);
    if ((failed.get(key) || 0) > Date.now()) return null;
    const job = (async () => {
      try {
        const bytes = await readFile(file);
        const type = imageType(bytes);
        if (type) return { bytes, type };
      } catch {}
      let temporary;
      try {
        const response = await fetcher(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (
          !response.ok ||
          Number(response.headers.get("content-length")) > limit
        ) {
          await response.body?.cancel();
          throw Error("Photo unavailable");
        }
        const chunks = [];
        let size = 0;
        try {
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > limit) throw Error("Photo too large");
            chunks.push(chunk);
          }
        } catch (error) {
          await response.body?.cancel().catch(() => {});
          throw error;
        }
        const bytes = Buffer.concat(chunks),
          type = imageType(bytes);
        if (!type) throw Error("Unsupported photo");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        temporary = file + "." + randomBytes(8).toString("hex");
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, file);
        return { bytes, type };
      } catch {
        if (temporary) await unlink(temporary).catch(() => {});
        failed.set(key, Date.now() + 300000);
        return null;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  };
}
