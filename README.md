# Territory Maker

**Territory Maker** is an open-source, fully client-side web app that lets you draw a geographic territory on Google Maps by mixing road-following segments (via the Directions API) and straight-line segments (as-the-crow-flies), then export the result as a KML Polygon file ready for use in Google Earth, QGIS, or any GIS tool.

---

## Features

- **Mixed segments** — alternate between 🛣 *Trajet* (road-following) and ✈ *Vol d'oiseau* (straight line) segments for each point you place
- **Polygon closure** — click on the origin point (A) to close the polygon with a semi-transparent fill overlay
- **App themes** — switch between Dark, Light, and System (follows OS preference) — persisted in `localStorage`
- **Map themes** — independently choose between Dark, Light, Satellite, and Terrain map styles
- **Settings panel** — API key management and appearance settings accessible via the ⚙ button; shows only the key status (not the key itself) once a key is stored
- **Step-by-step API key guide** — built-in tutorial page at `/api-key` for obtaining and configuring a Google Maps API key
- **KML Polygon export** — the traced territory is exported as a closed polygon; supports copy to clipboard and `.kml` download
- **Encrypted local key storage** — your Google Maps API key is encrypted with AES-GCM 256-bit and stored in `localStorage` using a device-derived key (no password required)
- **No backend** — everything runs in your browser; no data is sent to any server other than Google Maps APIs
- **Responsive** — works on desktop and tablet

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
    MapController.ts      Google Maps init, markers, polylines, polygon closure, map themes
    SegmentRouter.ts      Directions API or straight-line routing
    KmlExporter.ts        KML Polygon XML construction + download
    RouteUI.ts            Application orchestrator (UI, state, settings, themes)
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
| Crypto | Web Crypto API (built-in browser API) |
| Bundler | Vite (via Astro) |
| Package install | [`safe-npm`](https://github.com/kevinslin/safe-npm) (`@dendronhq/safe-npm`) |
| Deployment | Cloudflare Pages (static) |

---

## License

MIT — see [LICENSE](./LICENSE) for details.
