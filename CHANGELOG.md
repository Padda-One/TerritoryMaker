# Changelog

All notable changes to Territory Maker are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [2.0.0] — 2026-03-29

### Added
- **Mobile & tablet support** — full responsive redesign for screens ≤ 768 px
  - Floating vertical toolbar on the left of the map: transport mode picker, new zone, import, undo, simplify, export, zones list
  - Transport mode picker collapses to a single button showing the active mode; tap to expand all three options, tap a choice to switch and collapse
  - Zones bottom sheet — swipes up from the bottom of the screen; tap any zone to select it and close the sheet
  - Hamburger drawer shows Settings only (API key, themes, routing provider); tools are on the map toolbar
  - ✕ close button inside the drawer fixes the hamburger-can't-be-closed bug
- **Sidebar tabs (desktop)** — *Outils* and *Paramètres* tabs replace the ⚙ toggle button; always visible and labelled

### Changed
- Desktop sidebar: ⚙ toggle replaced by *Outils | Paramètres* tab strip
- Mobile export button triggers direct KML download (bypasses the hidden sidebar panel)

---

## [1.3.0] — 2026-03-28

### Added
- **Routing provider toggle** — ORS (OpenRouteService) or Google Directions, configurable in ⚙ settings, independent of the map provider
- **Shared keys** — ORS and Google Directions both work out of the box via graciously-provided server-side keys; no personal API key required within their daily quotas

### Changed
- ORS replaces Google Directions as the default routing engine — no Google API key required by default
- Haversine formula replaces `google.maps.geometry.spherical` for distance calculations, removing one Google SDK dependency
- Documentation restructured: "Démarrage" is now key-free; new "Carte et routage" chapter explains provider choices, shared key limits, and the fallback chain

---

## [1.2.0] — 2026-03-26

### Added
- **OSM/Leaflet map provider** — full OpenStreetMap support as an alternative to Google Maps, usable without any API key
- **Shared Google API key** — server-side fallback key allows the app to load without a personal key configured
- **Favicon** — complete favicon set (ICO, PNG, SVG, Apple Touch Icon) for all platforms
- **Plausible Analytics** — self-hosted, proxied via Cloudflare Worker

### Changed
- HTTP security headers hardened: Content Security Policy with explicit SHA-256 hashes, HSTS, X-Frame-Options, Permissions-Policy
- `/api/config` restricted to the production origin (HTTP 403 on cross-origin requests)
- Excel export migrated from SheetJS to `write-excel-file`, removing two unpatched vulnerabilities and reducing bundle size by ~770 KB

---

## [1.1.0] — 2026-03-25

### Added
- **NWS CSV import/export** — full round-trip with New World Scheduler; preserves all 12 NWS columns including `TerritoryID`, `Boundary`, and custom metadata through split, merge, and vertex edit operations
- **Suppression report** — territories to delete in NWS after merges, downloadable as CSV, Excel, or PDF
- **Auto-fit** — map viewport fits imported file on load and fits selected polygon on layer click
- **Sort layers by point count** — surfaces complex polygons for simplification
- **Double-click to edit** — enters vertex-editing mode directly from the map
- **Group recolor** — click a folder color swatch to recolor all its polygons at once

---

## [1.0.0] — 2026-03-23

Initial public release.

### Added
- Draw territories by mixing road-following segments (Google Directions) and straight-line segments
- Three travel modes: driving, walking, cycling
- Snap tool — new points magnetic to existing polygon edges
- Multi-layer management with folders, per-folder coloring, and KML import/export
- Polygon simplification via Douglas-Peucker algorithm with iterative passes and per-polygon restore
- Vertex editing for closed polygons (Tracé → Zone conversion)
- Split tool — divide a closed polygon by drawing a cut line
- Merge tool — join two adjacent polygons with automatic edge alignment (±10 m tolerance)
- Undo for waypoints, Split, and Merge operations
- Dual map backend: Google Maps or OpenStreetMap (Leaflet)
- Dark/light/system interface themes; four map themes (dark, light, satellite, relief)
- AES-GCM 256-bit encryption for the API key stored in `localStorage`
- Deployed on Cloudflare Pages — fully client-side, no data sent to any server

[2.0.0]: https://github.com/Padda-One/TerritoryMaker/compare/v1.3.0...v2.0.0
[1.3.0]: https://github.com/Padda-One/TerritoryMaker/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Padda-One/TerritoryMaker/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Padda-One/TerritoryMaker/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Padda-One/TerritoryMaker/releases/tag/v1.0.0
