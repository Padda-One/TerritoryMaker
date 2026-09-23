#!/usr/bin/env node
// Vérifie que chaque script intégré exécutable de dist/ a son empreinte dans la
// directive script-src de public/_headers. Une montée d'Astro qui change ces
// scripts sans mettre la CSP à jour les fait bloquer par le navigateur, en silence
// (incident du 2026-09-23 : contenu de l'accueil resté invisible).
// Usage : node scripts/check-csp-hashes.mjs   (après pnpm build)
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const headers = readFileSync("public/_headers", "utf8");
const scriptSrc = headers.match(/script-src [^;\n]*/)?.[0] ?? "";
const allowed = new Set(scriptSrc.match(/sha256-[A-Za-z0-9+/=]+/g) ?? []);

const htmlFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : [],
  );

const missing = new Map();
for (const file of htmlFiles("dist")) {
  const html = readFileSync(file, "utf8");
  for (const [, attrs, body] of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    const type = attrs.match(/type="([^"]+)"/)?.[1];
    if (type && type !== "module" && type !== "text/javascript") continue; // JSON-LD : non exécuté
    const hash = "sha256-" + createHash("sha256").update(body).digest("base64");
    if (!allowed.has(hash)) missing.set(hash, [...(missing.get(hash) ?? []), file]);
  }
}

if (missing.size) {
  console.error(`✘ ${missing.size} script(s) intégré(s) absent(s) de script-src (public/_headers) :`);
  for (const [hash, files] of missing) console.error(`  '${hash}'  ← ${files.join(", ")}`);
  process.exit(1);
}
console.log(`✓ CSP : tous les scripts intégrés exécutables ont leur empreinte (${allowed.size} autorisées).`);
