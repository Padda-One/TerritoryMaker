#!/usr/bin/env node
// Contrôle CSP pour la stratégie nonce (chantier flotte-csp-nonce) : le
// middleware functions/_middleware.js pose le nonce sur chaque <script> et
// l'ajoute à script-src. Échoue si un mécanisme incompatible persiste :
//   - attribut d'événement on*= ou URL javascript: dans le HTML construit
//   - 'unsafe-inline' ou 'sha256-' dans la directive script-src de _headers
//   - functions/_middleware.js absent
// Usage : node scripts/check-csp-nonce.mjs   (après pnpm build)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const failures = [];

// 1. HTML construit : attributs d'événement et URL javascript:
const htmlFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : [],
  );

for (const file of htmlFiles("dist")) {
  const html = readFileSync(file, "utf8");
  const events = [...html.matchAll(/\s(on[a-z]+)\s*=\s*["']/gi)].map((m) => m[1]);
  if (events.length) failures.push(`${file}: attribut(s) ${[...new Set(events)].join(", ")}`);
  if (/javascript\s*:/i.test(html)) failures.push(`${file}: URL javascript:`);
}

// 2. script-src de public/_headers sans 'unsafe-inline' ni empreintes
const headers = readFileSync("public/_headers", "utf8");
const scriptSrc = headers.match(/(?:^|;)\s*script-src\s+([^;\n]*)/i)?.[1] ?? "";
if (/'unsafe-inline'|sha256-/i.test(scriptSrc))
  failures.push(`public/_headers: script-src contient ${scriptSrc.match(/'unsafe-inline'|sha256-\S*/gi).join(", ")}`);
if (!scriptSrc) failures.push("public/_headers: directive script-src introuvable");

// 3. middleware présent
if (!existsSync("functions/_middleware.js"))
  failures.push("functions/_middleware.js absent");

if (failures.length) {
  console.error("✘ Contrôle CSP nonce :");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ CSP nonce : aucun handler inline ni sha256/'unsafe-inline', middleware présent.");
