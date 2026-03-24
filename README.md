<p align="center">
  <img src="public/logo-TerritoryMaker.svg" alt="Territory Maker" width="120" />
</p>

# Territory Maker

**Territory Maker** is an open-source, fully client-side web app that lets you draw geographic territories on a map by mixing road-following segments (via the Google Directions API) and straight-line segments, then export the result as KML Polygon files ready for use in Google Earth, QGIS, or any GIS tool.

<div align="center">
  <video src="https://github.com/user-attachments/assets/b585b192-0841-433e-9e08-6ddf5bb7a77c" width="300" autoplay muted loop playsinline></video>
</div>

---

## Features

- **Mixed segments** — alternate between 🛣 *Trajet* (road-following) and ✈ *Vol d'oiseau* (straight line) segments for each point you place
- **Polygon closure** — click on the origin point (A) to close the polygon with a semi-transparent fill overlay
- **Tree-view layer panel** — polygons are grouped in folders; one folder per KML import (named after the file), one for drawn polygons; collapse/expand folders; right-click for context menu
- **Folder management** — create, rename, delete folders; drag polygons between folders or reorder them within a folder; per-folder KML export
- **Resizable sidebar** — drag the right edge of the sidebar to any width between 180 px and 600 px; preference persisted across sessions
- **Multi-polygon layers** — draw multiple territories; each appears in its folder; click to select and highlight; active polygon gets a colored border to stand out
- **KML import** — import any KML 2.2 file, including large files (tested: 835 polygons, 1.3 MB); progress bar during import; all polygons from one file share a single color and folder
- **Snap / magnet tool** — 🧲 snap new points onto existing polygon paths to create shared boundaries between adjacent territories
- **Split polygon** — ✂ cut a closed polygon into two by drawing a dividing line (road-following or straight, using the current mode); the two resulting polygons are created in a "territoires enfants" folder; supports Ctrl+Z undo
- **Merge polygons** — ⊕ Ctrl+click two polygons to select them, then click Merge to fuse them into one; uses selective vertex snapping to align shared borders (tolerance 5 m); blocks non-adjacent polygons with an error; supports Ctrl+Z undo
- **Multi-select** — Ctrl+click polygon rows in the layer panel or polygon fills on the map to select multiple polygons; selected polygons are highlighted in amber
- **Waypoint editing** — double-click any existing point to drag it to a new position; adjacent segments are recalculated automatically
- **Coordinate editing** — ✏ edit individual vertices of Zone polygons: drag to move, click to delete, click an edge to insert a new point
- **Polygon simplification** — ⬡ reduce the number of vertices of a Zone using Douglas-Peucker; each click applies one pass with a progressively larger tolerance; a ↺ restore button appears to revert to the original coordinates; a global "Simplifier les zones" button simplifies all zones at once
- **Dual map backend** — choose between **Google Maps** and **OpenStreetMap** (Leaflet) as the display layer; routing always uses the Google Directions API
- **Landing page** — first-launch welcome screen with project overview and API key form; skipped automatically when a key is already stored
- **App themes** — switch between Dark, Light, and System (follows OS preference) — persisted in `localStorage`
- **Map themes** — independently choose between Dark, Light, Satellite, and Terrain map styles
- **Settings panel** — API key management and appearance settings accessible via the ⚙ button; shows only the key status (not the key itself) once a key is stored
- **Step-by-step API key guide** — built-in tutorial page at `/documentation` for obtaining and configuring a Google Maps API key
- **KML export** — export all polygons at once ("Exporter la carte") or each polygon individually from the layer panel; supports copy to clipboard and `.kml` download
- **Encrypted local key storage** — your Google Maps API key is encrypted with AES-GCM 256-bit and stored in `localStorage` using a device-derived key (no password required)
- **No backend** — everything runs in your browser; no data is sent to any server other than Google Maps APIs
- **Desktop-first** — designed for desktop use (mouse + keyboard); not optimised for mobile or touch

---

## Using Territory Maker

### 1 — Starting a territory

On first launch the map is empty. Click **+ Nouveau** in the *Polygones* panel to start drawing a new territory, or click **⬆ Importer** to import an existing KML file.

The map cursor is a **crosshair** `✛` — click anywhere to place waypoints.

> The hint bar at the bottom of the map tells you what to do next at every step.

**Choosing the segment type** before each click:

| Toggle | Segment | Result |
|---|---|---|
| 🛣 Trajet | Road-following | Path follows the road network via the Directions API |
| ✈ Vol d'oiseau | Straight line | Direct line between the two points |

You can switch modes between any two waypoints — mixing road and straight segments freely.

### 2 — Close the polygon

Once you have placed **3 or more waypoints**, click the first marker (**A**) to close the polygon. The territory is filled with a semi-transparent overlay.

> To re-open the polygon and continue editing, click **↩ Rouvrir le polygone**.

### 3 — Edit an existing waypoint

**Double-click** any waypoint marker — it gains a **yellow ring** and becomes draggable. Drag to the new position; adjacent segments recalculate automatically.

> **Note for point A:** a single click closes the polygon; double-click enters edit mode (250 ms debounce).

**Undo shortcuts:** click **↩ Supprimer dernier** or press `Ctrl+Z` / `Cmd+Z`.

### 4 — Draw multiple polygons

Once a polygon is closed, click **+ Nouveau** to start a new territory.

The layer panel shows polygons in a **tree-view** organised by folder:
- **📁 Tracés** — contains all manually drawn polygons
- **📁 filename** — one folder per KML import, named after the file

Each polygon row shows:
- A colored dot matching the map
- The polygon name (double-click to rename)
- A status badge: **Tracé** (closed drawn polygon), **En cours** (in progress), or **Zone · N pts** (imported/converted polygon)
- A **⬡** simplify button (Zone polygons only) — reduces vertex count; a **↺** restore button appears after simplification
- A **⬇** download button (closed polygons only)
- A **🗑** delete button

**Folder actions:**
- Click the **▶/▼** chevron (or anywhere on the folder row) to collapse/expand
- Click **⬇** on a folder to export all its closed polygons as one KML file
- **Right-click** anywhere in the panel for a context menu: create folder, rename folder, delete folder, move polygon to another folder
- **Drag** a polygon row to reorder it (insert indicator appears as a green line) or drop it onto a folder header to move it

Click any polygon row — or click directly on the polygon fill on the map — to switch the active polygon. The selected polygon is highlighted with a colored border and stronger fill; others are dimmed.

### 5 — Import a KML file

Click **⬆ Importer** in the *Polygones* panel header and select a KML 2.2 file. A progress bar shows import status — large files (800+ polygons) are processed in chunks to keep the UI responsive.

All polygons from the same import share a single color. Coordinate rings are automatically simplified (Douglas-Peucker) for dense geometry.

### 6 — Edit coordinates of a Zone polygon

Select a Zone polygon (badge **Zone · N pts** in the layer panel). The **✏** button appears in the right toolbar.

Click **✏** to enter coordinate edit mode:
- **Drag** a vertex marker to move it
- **Click** a vertex marker to delete it (requires at least 3 remaining vertices)
- **Click** on the white edge between two vertices to insert a new vertex at that position

Click **⊗** or switch to another polygon to exit edit mode. Modified coordinates are preserved and exported correctly.

> **Drawn polygons (Tracé):** clicking **✏** on a closed drawn polygon opens a two-step confirmation — the road routing is permanently converted to a flat coordinate ring before entering edit mode.

### 7 — Simplify a Zone polygon

Zone polygons (especially those converted from drawn routes) can contain hundreds of vertices. Territory Maker uses the **Douglas-Peucker** algorithm to reduce them:

- Click the **⬡** button in the Zone's layer panel row to apply one simplification pass
- Each subsequent click doubles the tolerance, progressively removing more vertices
- Once satisfied, leave it as-is — a **↺** button appears to restore the original coordinates at any time
- To simplify all Zone polygons at once, click **⬡ Simplifier les zones** in the sidebar (above the KML export button)

> The global "Simplifier les zones" action is permanent and cannot be undone. Per-polygon ↺ restore is always available for individually simplified zones.

### 8 — Snap tool (shared boundaries)

Click the 🧲 button in the right toolbar to activate the snap tool (button turns **amber** when active).

While the snap tool is on, moving the mouse near an existing polygon's path shows a **yellow circle marker** — clicking places the new waypoint exactly on the snapped position, giving you perfectly shared boundaries between adjacent territories.

### 9 — Split a polygon

Select a closed polygon, then click the **✂** button in the right toolbar to enter split mode. The cursor changes to a crosshair and the snap tool activates automatically.

1. Click a point **on the polygon's border** to set the start of the dividing line (a red circle marker appears)
2. Optionally click intermediate points inside the polygon to guide the cut
3. Click another point **on the border** to close the cut — the polygon is immediately replaced by two new polygons named `originalName-1` and `originalName-2`, placed in a **"territoires enfants"** folder (created automatically if needed)

The dividing line uses the **current segment mode** (road-following or straight line) selected in the toolbar.

> **Undo:** press `Ctrl+Z` or click the **↩** undo button in the right toolbar to restore the original polygon.

### 10 — Merge two polygons

1. **Ctrl+click** a second polygon (on its fill or in the layer panel row) while another polygon is already active — both are highlighted in amber and the **⊕** merge button appears in the right toolbar
2. Click **⊕** — the two polygons are fused into one, named `polygon1 - polygon2`

Territory Maker automatically snaps shared border vertices (within 5 m) before merging, so polygons drawn on opposite sides of the same road join cleanly.

> If the two polygons are not adjacent or overlapping, an error message is shown and no change is made.

> **Undo:** press `Ctrl+Z` or click the **↩** undo button.

### 11 — Map provider

Click the map icon button (Google Maps / OpenStreetMap) in the right toolbar to switch the display layer. Your drawn polygons are preserved across switches.

> Routing (road-following segments) always uses the Google Directions API regardless of the display provider.

### 12 — Export

| Button | What it exports |
|---|---|
| **⬇** (polygon row) | That single polygon as a `.kml` file |
| **⬇** (folder row) | All closed polygons in that folder as one `.kml` file |
| **🗺 Exporter la carte** | All closed polygons in a single `.kml` file |

The export panel also offers **📋 Copier** to copy the KML to the clipboard.

Each polygon is exported as a separate `<Placemark>` inside a single KML `<Document>`, with its own style and color.

### 13 — Resize the sidebar

Drag the thin handle on the **right edge of the sidebar** left or right to adjust its width (180 px – 600 px). The width is remembered across sessions.

---

## Getting Started (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A Google Maps API key with **Maps JavaScript API** and **Directions API** enabled
- [`safe-npm`](https://github.com/kevinslin/safe-npm) — recommended to protect against supply-chain attacks

### Install safe-npm (one-time, global)

```bash
npm install -g @dendronhq/safe-npm
```

> **What is safe-npm?** A security wrapper around `npm install` that only installs package versions publicly available for at least 90 days — protecting against freshly published malicious packages.

### Install & run

```bash
git clone https://github.com/Padda-One/TerritoryMaker.git
cd territory-maker
safe-npm install
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) in your browser.

### Build for production

```bash
npm run build
# Static files are output to dist/
npm run preview  # preview the production build locally
```

---

## Deploying to Cloudflare Pages

Territory Maker is a fully static site (Astro SSG) and deploys to Cloudflare Pages in minutes.

### Via the Cloudflare Dashboard

1. Push your code to a GitHub or GitLab repository.
2. Log in to [Cloudflare Pages](https://pages.cloudflare.com/) and click **Create a project**.
3. Connect your repository.
4. Set the following build settings:

   | Setting | Value |
   |---|---|
   | **Framework preset** | None (or Astro) |
   | **Build command** | `npm run build` |
   | **Install command** | `npm install -g @dendronhq/safe-npm && safe-npm install` |
   | **Build output directory** | `dist` |
   | **Node.js version** | 18 (or later) |

5. Click **Save and Deploy**.

### Via Wrangler CLI

```bash
npm install -g wrangler
wrangler pages deploy dist --project-name territory-maker
```

---

## Obtaining a Google Maps API Key

See the built-in guide at `/documentation` for a full step-by-step walkthrough, or follow the summary below.

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Navigate to **APIs & Services → Library**.
4. Search for and enable both:
   - **Maps JavaScript API**
   - **Directions API**
5. Navigate to **APIs & Services → Credentials**.
6. Click **Create Credentials → API key**.
7. Copy the generated key.

### Restricting your API key (important!)

An unrestricted API key can be used by anyone who finds it in your browser's network traffic. Always restrict your key:

1. In **Credentials**, click on your API key.
2. Under **Application restrictions**, select **HTTP referrers (websites)**.
3. Add your domain(s), e.g.:
   - `https://my-territory-maker.pages.dev/*`
   - `http://localhost:4321/*` (for local development)
4. Under **API restrictions**, select **Restrict key** and choose:
   - Maps JavaScript API
   - Directions API
5. Click **Save**.

> **Note:** The Maps JavaScript API requires the key to be present in the browser. Restricting the key to your domain is the primary defence against unauthorised use — see [SECURITY.md](./SECURITY.md) for details.

---

## Project Structure

```
src/
  pages/
    index.astro           Main page (HTML shell + script entry point)
    documentation.astro   Documentation complète : tutoriel d'utilisation + guide clé API
  components/
    ApiKeyManager.ts      AES-GCM encryption / localStorage
    MapController.ts      Map init, markers, polylines, multi-polygon, groups, snap, drag-edit, vertex edit, split, merge, undo stack
    SegmentRouter.ts      Directions API or straight-line routing
    KmlExporter.ts        KML Polygon XML construction + multi-polygon export + download
    KmlImporter.ts        KML 2.2 parsing (chunked, Douglas-Peucker simplification)
    RouteUI.ts            Application orchestrator (UI, state, tree-view layer panel, sidebar resize, context menu)
  styles/
    global.css            Tailwind v4 + CSS variables (dark & light themes)
public/
  logo-TerritoryMaker.svg  Logo et favicon
  gm.avif                  Google Maps provider icon
  images/tools/pencil.svg  Icône édition de coordonnées
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Astro](https://astro.build/) 5 (SSG) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v4 via `@tailwindcss/vite` |
| Language | TypeScript (strict) |
| Maps display | Google Maps JavaScript API v3 **or** [Leaflet](https://leafletjs.com/) + OpenStreetMap |
| Routing | Google Directions API |
| Geometry | Google Maps Geometry library (`spherical.computeDistanceBetween`) |
| Polygon geometry | [`@turf/union`](https://turfjs.org/) v7 — polygon union for the Merge operation |
| Crypto | Web Crypto API (built-in browser API) |
| Bundler | Vite (via Astro) |
| Package install | [`safe-npm`](https://github.com/kevinslin/safe-npm) (`@dendronhq/safe-npm`) |
| Deployment | Cloudflare Pages (static) |

---

## License

MIT — see [LICENSE](./LICENSE) for details.

---

Made with ❤️ by [Paddaone](https://paddaone.com/)
