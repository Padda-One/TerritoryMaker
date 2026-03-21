# Territory Maker

**Territory Maker** is an open-source, fully client-side web app that lets you draw geographic territories on Google Maps by mixing road-following segments (via the Directions API) and straight-line segments (as-the-crow-flies), then export the result as KML Polygon files ready for use in Google Earth, QGIS, or any GIS tool.

---

## Features

- **Mixed segments** — alternate between 🛣 *Trajet* (road-following) and ✈ *Vol d'oiseau* (straight line) segments for each point you place
- **Polygon closure** — click on the origin point (A) to close the polygon with a semi-transparent fill overlay
- **Multi-polygon layers** — draw multiple territories; each appears in a layer panel (like Illustrator layers); click to select and highlight
- **Snap / magnet tool** — 🧲 snap new points onto existing polygon paths to create shared boundaries between adjacent territories
- **Waypoint editing** — double-click any existing point to drag it to a new position; adjacent segments are recalculated automatically
- **App themes** — switch between Dark, Light, and System (follows OS preference) — persisted in `localStorage`
- **Map themes** — independently choose between Dark, Light, Satellite, and Terrain map styles
- **Settings panel** — API key management and appearance settings accessible via the ⚙ button; shows only the key status (not the key itself) once a key is stored
- **Step-by-step API key guide** — built-in tutorial page at `/api-key` for obtaining and configuring a Google Maps API key
- **KML export** — export all polygons at once ("Exporter la carte") or each polygon individually from the layer panel; supports copy to clipboard and `.kml` download
- **Encrypted local key storage** — your Google Maps API key is encrypted with AES-GCM 256-bit and stored in `localStorage` using a device-derived key (no password required)
- **No backend** — everything runs in your browser; no data is sent to any server other than Google Maps APIs
- **Responsive** — works on desktop and tablet

---

## Using Territory Maker

### 1 — Place waypoints

The map cursor is a **crosshair** `✛` — this indicates the map is ready to receive clicks.

Click anywhere on the map to place your first waypoint (labelled **A**). Each subsequent click adds the next waypoint and traces a segment from the previous one.

> The hint bar at the bottom of the map tells you what to do next at every step.

**Choosing the segment type** before each click:

| Toggle | Segment | Result |
|---|---|---|
| 🛣 Trajet | Road-following | The path follows the road network via the Directions API |
| ✈ Vol d'oiseau | Straight line | A direct line between the two points |

You can switch modes between any two waypoints — mixing road and straight segments freely.

### 2 — Close the polygon

Once you have placed **3 or more waypoints**, hover over the first marker (**A**) — the cursor changes to a **pointer** `↖` to signal it is clickable.

Click **A** to close the polygon. The closing segment is drawn using the current mode (road or straight), and the territory is filled with a semi-transparent overlay.

> To re-open the polygon and continue editing, click **↩ Rouvrir le polygone**.

### 3 — Edit an existing point

**Double-click** any waypoint marker. The marker grows slightly and gains a **yellow ring**, and the cursor on that marker becomes a **grab hand** `✋` — indicating it can be dragged.

Drag the marker to its new position and release. The adjacent segments are automatically recalculated.

> **Note for point A:** a single click on A closes the polygon; a double-click enters edit mode. There is a 250 ms debounce to distinguish the two gestures.

### 4 — Draw multiple polygons

Once a polygon is closed, the **+ Nouveau** button in the *Polygones* panel becomes active. Click it to start a new polygon — each territory gets its own color from the palette.

The layer panel shows all polygons with:
- A colored dot matching the map
- The polygon name
- A status badge (**Fermé** / **En cours**)
- A **⬇** download button (closed polygons only) to export that polygon individually as KML
- A **🗑** delete button

Click any row to switch the active polygon. The selected polygon is highlighted; others are dimmed.

### 5 — Snap tool (shared boundaries)

Click the 🧲 button in the top-right corner of the map to activate the snap tool. The button gains a **yellow glow** when active.

While the snap tool is on:
- The cursor remains a **crosshair** `✛` on the map
- As you move the mouse near an existing polygon's path, a **yellow circle marker** appears, snapping to the nearest point on that path (within a ~20 px radius, auto-scaled to the current zoom level)
- When the snap circle is visible, clicking will place the new waypoint **exactly** on the snapped position — giving you a perfectly shared boundary

This lets you build adjacent territories that share an edge without any gap or overlap.

### 6 — Export

| Button | What it exports |
|---|---|
| **⬇** (layer row) | That single polygon as a `.kml` file |
| **🗺 Exporter la carte** | All closed polygons in a single `.kml` file |

The export panel also offers **📋 Copier** to copy the KML to the clipboard.

Each polygon is exported as a separate `<Placemark>` inside a single KML `<Document>`, with its own style and color.

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

> **What is safe-npm?** It is a security wrapper around `npm install` that only installs package versions that have been publicly available for at least 90 days. This prevents your project from being hit by freshly published malicious packages — a common supply-chain attack vector.

### Install & run

```bash
git clone https://github.com/your-org/territory-maker.git
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

See the built-in guide at `/api-key` for a full step-by-step walkthrough, or follow the summary below.

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
    api-key.astro         Step-by-step guide to obtain a Google Maps API key
  components/
    ApiKeyManager.ts      AES-GCM encryption / localStorage
    MapController.ts      Google Maps init, markers, polylines, multi-polygon, snap, drag-edit
    SegmentRouter.ts      Directions API or straight-line routing
    KmlExporter.ts        KML Polygon XML construction + multi-polygon export + download
    RouteUI.ts            Application orchestrator (UI, state, layer panel, themes)
  styles/
    global.css            Tailwind v4 + CSS variables (dark & light themes)
public/
  favicon.svg
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Astro](https://astro.build/) 5 (SSG) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v4 via `@tailwindcss/vite` |
| Language | TypeScript (strict) |
| Maps | Google Maps JavaScript API v3 |
| Routing | Google Directions API |
| Geometry | Google Maps Geometry library (`spherical.computeDistanceBetween`) |
| Crypto | Web Crypto API (built-in browser API) |
| Bundler | Vite (via Astro) |
| Package install | [`safe-npm`](https://github.com/kevinslin/safe-npm) (`@dendronhq/safe-npm`) |
| Deployment | Cloudflare Pages (static) |

---

## License

MIT — see [LICENSE](./LICENSE) for details.
