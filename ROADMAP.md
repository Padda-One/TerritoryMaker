# Roadmap

This document lists planned improvements and ideas for Territory Maker. It is not a commitment or a release schedule — just a transparent view of what might come next.

Contributions are welcome! If you want to work on any of these, open an issue first so we can coordinate.

---

## Planned

### Internationalization (i18n)

The UI is currently English/French mixed. The goal is to make Territory Maker fully translatable:

- Extract all user-facing strings into locale files
- Support at least **English** and **French** at launch
- Locale auto-detected from the browser, overridable in Settings
- Community contributions welcome for additional languages

### CSV Import / Export

Allow importing and exporting territory data in CSV format:

- **Export CSV** — one row per polygon, columns: name, vertex count, area (km²), coordinates (WKT or lat/lng list)
- **Import CSV** — parse a CSV with at least a `coordinates` column (WKT Polygon or semicolon-separated `lat,lng` pairs); infer polygon name from a `name` column if present
- Useful for spreadsheet-based workflows and lightweight data exchange when KML is not needed

---

## Ideas (not yet planned)

These are directions worth exploring but not yet prioritized:

- **Multi-level undo/redo** — full history stack, not just last-waypoint undo
- **Session save/restore** — persist the full workspace (all polygons, groups, settings) to localStorage or a downloadable JSON file
- **Mobile layout** — collapsible sidebar, touch-friendly controls for small screens
- **Migrate `Marker` → `AdvancedMarkerElement`** — adopt the current Google Maps JS API standard for waypoint markers
- **Vertex density control** — after converting a drawn route to a Zone (flat polygon), optionally simplify the extracted vertices (Douglas-Peucker) to reduce marker count

---

## Changelog

See [commits](https://github.com/Padda-One/TerritoryMaker/commits/main) for the full history.
