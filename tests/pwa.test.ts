import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import manifest from "../src/app/manifest";

const require = createRequire(import.meta.url);
const sw = require("../public/sw.js") as {
  CACHE: string; SHELL: string[];
  extractAssets: (html: string) => string[];
  route: (req: { method: string; url: string }, origin: string) => "bypass" | "cache-first" | "network-first";
};
const O = "https://billshield-kappa.vercel.app";

test("manifest is installable: name, standalone, start_url, 192 + 512 PNG icons and a maskable icon that exist", () => {
  const m = manifest();
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/");
  assert.ok(m.name && m.short_name);
  const icons = m.icons ?? [];
  for (const size of ["192x192", "512x512"]) assert.ok(icons.some((i) => i.sizes === size && i.type === "image/png"), size);
  assert.ok(icons.some((i) => i.purpose === "maskable"));
  for (const i of icons) {
    const file = `public${i.src}`;
    assert.ok(existsSync(file), file);
    const png = readFileSync(file);
    assert.equal(png.readUInt32BE(16), Number(i.sizes!.split("x")[0]), `${file} width`); // PNG IHDR width
  }
});

test("service worker never intercepts cross-origin calls (Firebase AI Logic, Firestore, App Check stay network-only)", () => {
  for (const url of [
    "https://firebasevertexai.googleapis.com/v1beta/projects/x/models/gemini:generateContent",
    "https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel",
    "https://content-firebaseappcheck.googleapis.com/v1/projects/x/apps/y:exchangeRecaptchaV3Token",
    "https://www.google.com/recaptcha/api.js",
  ]) assert.equal(sw.route({ method: "GET", url }, O), "bypass", url);
  assert.equal(sw.route({ method: "POST", url: `${O}/` }, O), "bypass");
});

test("service worker caches the app shell: hashed assets cache-first, pages network-first", () => {
  assert.equal(sw.route({ method: "GET", url: `${O}/_next/static/chunks/app/page-abc123.js` }, O), "cache-first");
  assert.equal(sw.route({ method: "GET", url: `${O}/icons/icon-192.png` }, O), "cache-first");
  assert.equal(sw.route({ method: "GET", url: `${O}/` }, O), "network-first");
  assert.equal(sw.route({ method: "GET", url: `${O}/eval` }, O), "network-first");
  for (const p of ["/", "/eval", "/manifest.webmanifest"]) assert.ok(sw.SHELL.includes(p), p);
});

test("install step finds every Next build asset referenced by the HTML shell", () => {
  const html = `<link rel="stylesheet" href="/_next/static/css/a1.css" data-precedence="next"/><link rel="preload" href="/_next/static/media/geist.woff2" as="font"/>
<script src="/_next/static/chunks/webpack-1.js" async=""></script><script src="/_next/static/chunks/app/page-2.js" async=""></script>
<script src="https://www.gstatic.com/x.js"></script><link href="/_next/static/css/a1.css"/>`;
  assert.deepEqual(sw.extractAssets(html).sort(), ["/_next/static/chunks/app/page-2.js", "/_next/static/chunks/webpack-1.js", "/_next/static/css/a1.css", "/_next/static/media/geist.woff2"]);
});
