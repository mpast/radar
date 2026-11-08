import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("page serves its complete browser module graph with JavaScript MIME types", async (t) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const dir = await mkdtemp(join(tmpdir(), "radar-assets-"));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    {
      env: { ...process.env, PORT: String(port), RADAR_DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await rm(dir, { recursive: true, force: true });
  });
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => {
      throw Error("Server exited: " + code);
    }),
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(Error("Server startup timed out")),
        5000,
      );
      timer.unref();
    }),
  ]);
  const base = `http://127.0.0.1:${port}`,
    page = await fetch(base + "/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(!html.includes("environmentalLabelHelp"));
  assert(html.includes('name="environmentalLabel"'));
  const pending = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    seen = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200, path);
    assert.match(
      response.headers.get("content-type"),
      /^text\/javascript/,
      path,
    );
    const source = await response.text();
    for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      const dependency = new URL(match[1], new URL(path, base));
      assert.equal(dependency.origin, base);
      pending.push(dependency.pathname);
    }
  }
  assert(seen.has("/car-label.js"));
  const state = await fetch(base + "/api/state");
  assert.equal(state.status, 200);
  assert(Array.isArray((await state.json()).items));
});
