# Changelog

All notable changes to Territory Maker are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.3.0] — 2026-03-26

### Added

- **Favicon** — multi-size `.ico` (16 × 32 × 48 px), `favicon-48x48.png`, and `apple-touch-icon.png` added to satisfy Google Search favicon requirements. Declared in `<head>` of all pages alongside the existing SVG.
- **HTTP security headers** — `public/_headers` (Cloudflare Pages) now sets `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` on all responses.
- **CORS origin restriction on `/api/config`** — requests carrying an `Origin` header other than `https://territory.paddaone.com` are rejected with HTTP 403. Responses include `Access-Control-Allow-Origin` and `Vary: Origin`.

### Changed

- **Excel export migrated from SheetJS to `write-excel-file`** — removes two unpatched vulnerabilities (Prototype Pollution, ReDoS) present in SheetJS 0.18.x; bundle size reduced by ~770 KB. API is identical from the user's perspective.
- **Google Maps SDK loaded with `loading=async`** — suppresses the suboptimal-performance warning in the browser console.

### Fixed

- **OSM provider toggle broken in shared API key mode** — switching the map provider triggered a full map re-initialisation that called `ApiKeyManager.loadKey()`, which returns `null` in shared mode (key comes from `/api/config`, not local storage). The shared key is now stored in `RouteUI.sharedApiKey` and used as fallback in `switchProvider()`.
- **Webhook Bearer token comparison** — replaced `===` string comparison with `crypto.subtle.timingSafeEqual()` to prevent timing-based secret inference. A length pre-check avoids the exception thrown when buffers differ in size.
- **TypeScript: `timingSafeEqual` not found on `SubtleCrypto`** — added `"lib": ["ES2022"]` to `functions/tsconfig.json` to exclude conflicting DOM type definitions and let `@cloudflare/workers-types` be the sole source for Web API types.

---

## [0.2.0] — 2026-03-25

### Added

- **NWS CSV import/export** — import a CSV file exported from NWS to load territory boundaries together with all NWS metadata (`TerritoryID`, `CategoryCode`, `Category`, `Number`, `Suffix`, `Area`, `Type`, `Link1`, `Link2`, `CustomNotes1`, `CustomNotes2`). Metadata is preserved through split, merge, and vertex edit operations. A dedicated **📋 Exporter CSV (NWS)** button (visible only after a NWS import) rebuilds the CSV with updated boundaries.
- **Suppression report** — when territories are merged during a NWS session, a report listing territories to delete or cross-check in NWS is generated automatically. Downloadable as CSV or Excel (`.xlsx`), or printable as PDF.
- **NWS merge workflow** — two modes depending on NWS availability: choose which territory ID to keep (with NWS open) or record both for later cross-check (without NWS access). Choice is memorised for the entire session.
- **NWS split workflow** — split fragments automatically inherit NWS metadata with an incremented suffix (e.g. suffix `A` → `A1` / `A2`).
- **Group recolor** — click the color dot on any folder header to change the color of all polygons in that folder at once (fill overlay, border, markers, and polylines).
- **Auto-fit on import** — the map automatically fits to the full extent of the imported file after a KML or NWS CSV import.
- **Auto-fit on layer selection** — clicking a polygon row in the layer panel fits the map to that polygon's bounds.
- **Sort by point count** — a **⇅ pts** toggle button next to the layer filter sorts polygons within each folder by vertex count (descending), making it easy to identify polygons that need simplification.
- **Double-click to edit** — double-clicking directly on a Zone polygon on the map enters vertex edit mode instantly, without going through the toolbar.
- **Merge tolerance increased** — shared-border vertex snapping tolerance raised from 5 m to 10 m for cleaner merges across two-lane roads.

### Changed

- Non-selected polygon borders are now always visible (weight 1) instead of invisible (weight 0), making it easier to see territory boundaries at a glance.
- The map hint bar now appears only while drawing a new polygon and disappears once the polygon is closed, reducing UI noise when working with imported territories.
- The map provider button (Google Maps / OSM) keeps a consistent opaque background regardless of the active provider.

---

## [0.1.0] — 2026-03-23

Initial public release.

- Draw territories by mixing road-following segments (Google Directions API) and straight-line segments
- Close polygons with a semi-transparent fill overlay
- Tree-view layer panel with folders, drag-and-drop reordering, context menu
- KML 2.2 import (chunked processing, Douglas-Peucker simplification) and export
- Vertex edit mode for Zone polygons (drag, delete, insert)
- Split and merge operations with Ctrl+Z undo
- Snap / magnet tool for shared boundaries
- Polygon simplification (Douglas-Peucker, per-polygon or global)
- Dual map backend: Google Maps or OpenStreetMap (Leaflet)
- App and map themes (Dark / Light / System)
- AES-GCM 256-bit encrypted API key storage
- Fully client-side — no backend, no data sent to any server
- Deployed on Cloudflare Pages
