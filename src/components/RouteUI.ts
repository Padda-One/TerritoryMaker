/**
 * RouteUI — orchestrates the full application lifecycle:
 *   - Settings panel (API key + appearance)
 *   - Map initialization
 *   - Segment mode toggle
 *   - Transport mode selection
 *   - Waypoint list rendering
 *   - Layer panel (multi-polygon management)
 *   - Snap / magnet tool
 *   - KML export panel
 *   - Error / loading feedback
 *   - App theme & map theme management
 */

import * as ApiKeyManager from "./ApiKeyManager.ts";
import { MapController } from "./MapController.ts";
import type { MapSnapshot } from "./MapController.ts";
import { buildKmlMulti, downloadKml, copyKml, getStats } from "./KmlExporter.ts";
import { parseKmlFile } from "./KmlImporter.ts";
import { parseNwsCsv, nwsDisplayName } from "./NwsCsvImporter.ts";
import {
  buildNwsCsv, buildSuppressionsCsv, buildSuppressionsXlsx,
  buildSuppressionAFaire, buildSuppressionAControler,
  downloadText, downloadBlob,
  type SuppressionAFaire, type SuppressionAControler,
} from "./NwsCsvExporter.ts";
import type { Waypoint, ResolvedSegment, SegmentMode, TravelMode } from "./SegmentRouter.ts";
import type { GroupInfo, MapProvider, NWSData, RoutingProvider } from "./MapController.ts";

type MapTheme = "dark" | "light" | "satellite" | "terrain";
type AppTheme = "dark" | "light" | "system";

export class RouteUI {
  private mapController: MapController | null = null;
  private currentMode: SegmentMode = "route";
  private currentSegments: ResolvedSegment[] = [];
  private currentWaypoints: Waypoint[] = [];
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private isMapLoaded = false;
  private snapActive = false;

  private sortByPoints = false;
  private sharedMode = false;
  private sharedApiKey: string | null = null;
  private orsApiKey = "";
  private routingProvider: RoutingProvider = "ors";

  // NWS session state
  private isNwsSession = false;
  private nwsAccessMode: "yes" | "no" | null = null;
  private suppressionAFaire: SuppressionAFaire[] = [];
  private suppressionAControler: SuppressionAControler[] = [];
  /** Pending merge IDs — set before showing the NWS access modal, consumed after user choice. */
  private pendingMergeIds: [string, string] | null = null;
  /** Resolve function for the merge modal promise. */
  private pendingMergeResolve: ((proceed: boolean) => void) | null = null;

  // ─── Element accessors ───────────────────────────────────────────────────────

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return el as T;
  }

  private elQ<T extends HTMLElement = HTMLElement>(
    selector: string,
    parent: HTMLElement | Document = document,
  ): T | null {
    return parent.querySelector<T>(selector);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.initThemes();
    this.bindSettings();
    this.bindTransportButtons();
    this.bindActionButtons();
    this.bindToggle();
    this.bindKmlButtons();
    this.bindKmlImport();
    this.bindCsvExport();
    this.bindLayerListResize();
    this.bindSnapToggle();
    this.bindProviderToggle();
    this.bindRoutingProviderToggle();
    this.bindSidebarResize();
    this.bindContextMenu();
    this.bindLayerPanel();
    this.bindMobileUI();
    this.bindSidebarTabs();
    this.bindMapToolbar();

    // Always fetch config first (ORS key + shared Google Maps key)
    const config = await this.fetchConfig();
    this.orsApiKey = config.orsKey ?? "";
    // Cache shared key unconditionally — needed if user later toggles to Google Maps
    // while starting in OSM mode (the sharedMode branch below is never reached then).
    if (config.mapsJsKey) this.sharedApiKey = config.mapsJsKey;

    const mapProvider = (localStorage.getItem("tm_map_provider") ?? "osm") as MapProvider;
    this.routingProvider = (localStorage.getItem("tm_routing_provider") ?? "ors") as RoutingProvider;
    const needsGoogleKey = mapProvider === "google" || this.routingProvider === "google";

    // ── OSM map + ORS routing — no Google key needed, load immediately ─────────
    if (!needsGoogleKey) {
      this.updateKeySection(true);
      await this.exitLanding(null);
      return;
    }

    // ── Google key needed — existing shared/fallback flow ───────────────────────
    if (config.mode === "shared" && config.mapsJsKey) {
      this.sharedMode = true;
      this.sharedApiKey = config.mapsJsKey;
      this.updateKeySection(true);
      try {
        await this.exitLanding(config.mapsJsKey);
      } catch {
        // Shared key rejected — fall back to user key flow
        this.sharedMode = false;
        this.showFallbackNotice();
        this.updateKeySection(false);
        const savedKey = await ApiKeyManager.loadKey().catch(() => null);
        if (savedKey) {
          await this.exitLanding(savedKey).catch(() => {
            ApiKeyManager.forgetKey();
            this.bindLandingForm();
          });
        } else {
          this.bindLandingForm();
        }
      }
      return;
    }

    // Fallback mode — show notice then try stored user key
    this.showFallbackNotice();
    const savedKey = await ApiKeyManager.loadKey().catch(() => null);
    if (savedKey) {
      this.updateKeySection(true);
      try {
        await this.exitLanding(savedKey);
      } catch (err) {
        // Saved key is invalid — clear it, rebind form first (clones DOM), then show error
        ApiKeyManager.forgetKey();
        this.updateKeySection(false);
        this.bindLandingForm();
        const errorEl = document.getElementById("landing-error");
        if (errorEl) {
          errorEl.textContent = err instanceof Error ? err.message : "Clé API invalide.";
          errorEl.hidden = false;
        }
      }
      return;
    }

    // No key — show landing form
    this.bindLandingForm();
    this.updateKeySection(false);
  }

  // ─── Server config ────────────────────────────────────────────────────────────

  private async fetchConfig(): Promise<{ mode: "shared" | "fallback"; mapsJsKey?: string; orsKey?: string }> {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return { mode: "fallback" };
      return (await res.json()) as { mode: "shared" | "fallback"; mapsJsKey?: string; orsKey?: string };
    } catch {
      return { mode: "fallback" };
    }
  }

  /** Hides the loading spinner and reveals the fallback key-entry form. */
  private showFallbackNotice(): void {
    const loading = document.getElementById("landing-loading");
    if (loading) loading.style.display = "none";
    const container = document.getElementById("fallback-form-container");
    if (container) container.style.display = "";
  }

  // ─── Settings panel ──────────────────────────────────────────────────────────

  private bindSettings(): void {
    // Key form submit
    const form = this.el("key-form");
    const input = this.el<HTMLInputElement>("key-input");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      await this.handleKeySubmit(key);
    });

    // Forget key
    this.el("btn-forget-key").addEventListener("click", () => {
      ApiKeyManager.forgetKey();
      this.mapController?.destroy();
      this.mapController = null;
      this.isMapLoaded = false;
      this.currentWaypoints = [];
      this.currentSegments = [];
      this.el<HTMLInputElement>("key-input").value = "";
      this.updateKeySection(false);
      this.showLandingAfterForget();
    });

  }

  private updateKeySection(hasKey: boolean): void {
    const mapProvider = (localStorage.getItem("tm_map_provider") ?? "osm") as MapProvider;
    const routingProvider = (localStorage.getItem("tm_routing_provider") ?? "ors") as RoutingProvider;
    const needsGoogleKey = mapProvider === "google" || routingProvider === "google";

    const googleKeySection = document.getElementById("google-key-section");
    if (googleKeySection) googleKeySection.style.display = needsGoogleKey ? "" : "none";

    if (!needsGoogleKey) return;

    const formSection = document.getElementById("key-form-section");
    const storedSection = document.getElementById("key-stored-section");
    const sharedSection = document.getElementById("shared-key-section");
    if (this.sharedMode) {
      if (formSection) formSection.style.display = "none";
      if (storedSection) storedSection.style.display = "none";
      if (sharedSection) sharedSection.style.display = "flex";
      return;
    }
    if (sharedSection) sharedSection.style.display = "none";
    if (formSection) formSection.style.display = hasKey ? "none" : "flex";
    if (storedSection) storedSection.style.display = hasKey ? "flex" : "none";
  }

  private showSettingsPanel(): void {
    this.el("settings-panel").style.display = "flex";
    this.el("map-panel").style.display = "none";
    document.getElementById("tab-settings")?.classList.add("active");
    document.getElementById("tab-tools")?.classList.remove("active");
  }

  private showMapPanel(): void {
    this.el("settings-panel").style.display = "none";
    this.el("map-panel").style.display = "flex";
    document.getElementById("tab-tools")?.classList.add("active");
    document.getElementById("tab-settings")?.classList.remove("active");
  }

  // ─── Landing page ─────────────────────────────────────────────────────────────

  /** Animates the landing out, then initialises the map. */
  private async exitLanding(key: string | null): Promise<void> {
    // rethrow=true: errors surface to the caller (form handler or init startup)
    await this.initMap(key, undefined, true);
    const landing = document.getElementById("landing-page");
    if (landing) {
      landing.classList.add("landing--exit");
      await new Promise<void>((r) => setTimeout(r, 400));
      landing.style.display = "none";
    }
    document.body.classList.add("app--fadein");
  }

  /** Resets and shows the landing after the user forgets their key. */
  private showLandingAfterForget(): void {
    const landing = document.getElementById("landing-page");
    if (!landing) return;
    landing.classList.remove("landing--exit");
    landing.style.display = "";
    landing.style.opacity = "";
    landing.style.transform = "";
    document.body.classList.remove("app--fadein");
    const input = document.getElementById("landing-key-input") as HTMLInputElement | null;
    if (input) input.value = "";
    const errorEl = document.getElementById("landing-error") as HTMLElement | null;
    if (errorEl) errorEl.hidden = true;
    const btn = landing.querySelector<HTMLButtonElement>("button[type=submit]");
    if (btn) btn.disabled = false;
    this.showFallbackNotice();
    this.bindLandingForm();
  }

  /** Binds the landing page key form submit handler. */
  private bindLandingForm(): void {
    const form = document.getElementById("landing-key-form");
    if (!form) return;
    // Remove any previous listener by cloning the form node
    const fresh = form.cloneNode(true) as HTMLFormElement;
    form.replaceWith(fresh);

    fresh.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("landing-key-input") as HTMLInputElement;
      const errorEl = document.getElementById("landing-error") as HTMLElement;
      const btn = fresh.querySelector<HTMLButtonElement>("button[type=submit]")!;
      const key = input.value.trim();
      if (!key) return;

      btn.disabled = true;
      btn.textContent = "Chargement…";
      errorEl.hidden = true;

      try {
        await ApiKeyManager.saveKey(key);
        this.updateKeySection(true);
        await this.exitLanding(key);
      } catch (err) {
        errorEl.textContent = err instanceof Error
          ? err.message
          : "Erreur lors du chargement de la carte.";
        errorEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Initialiser la session";
      }
    });
  }

  // ─── Themes ──────────────────────────────────────────────────────────────────

  private initThemes(): void {
    const savedAppTheme = (localStorage.getItem("tm_app_theme") ?? "dark") as AppTheme;
    const savedMapTheme = (localStorage.getItem("tm_map_theme") ?? "dark") as MapTheme;
    this.applyAppTheme(savedAppTheme);
    this.setActiveThemeBtn("app-theme-picker", savedAppTheme);
    this.setActiveThemeBtn("map-theme-picker", savedMapTheme);

    // App theme picker
    document.getElementById("app-theme-picker")
      ?.querySelectorAll<HTMLButtonElement>(".theme-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const theme = (btn.dataset.value ?? "dark") as AppTheme;
          this.applyAppTheme(theme);
          localStorage.setItem("tm_app_theme", theme);
          this.setActiveThemeBtn("app-theme-picker", theme);
        });
      });

    // Map theme picker
    document.getElementById("map-theme-picker")
      ?.querySelectorAll<HTMLButtonElement>(".theme-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const theme = (btn.dataset.value ?? "dark") as MapTheme;
          localStorage.setItem("tm_map_theme", theme);
          this.setActiveThemeBtn("map-theme-picker", theme);
          this.mapController?.setMapTheme(theme);
        });
      });
  }

  private applyAppTheme(theme: AppTheme): void {
    const html = document.documentElement;
    if (theme === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      html.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
      html.setAttribute("data-theme", theme);
    }
  }

  private setActiveThemeBtn(pickerId: string, value: string): void {
    document.getElementById(pickerId)
      ?.querySelectorAll<HTMLButtonElement>(".theme-btn")
      .forEach((btn) => btn.classList.toggle("active", btn.dataset.value === value));
  }

  // ─── Key submit ──────────────────────────────────────────────────────────────

  private async handleKeySubmit(key: string): Promise<void> {
    const submitBtn = this.elQ<HTMLButtonElement>("#key-form button[type=submit]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Chargement…";
    }

    try {
      await ApiKeyManager.saveKey(key);
      this.updateKeySection(true);
      await this.initMap(key);
    } catch (err) {
      this.updateKeySection(false);
      this.showError(
        err instanceof Error ? err.message : "Erreur lors du chargement de la carte.",
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Charger la carte";
      }
    }
  }

  // ─── Map init ────────────────────────────────────────────────────────────────

  private async initMap(
    apiKey: string | null,
    initialView?: { center: { lat: number; lng: number }; zoom: number },
    rethrow = false,
    routingProvider?: RoutingProvider,
  ): Promise<void> {
    const mapEl = this.el("map");
    this.showMapPanel();
    this.showMapLoading(true);

    try {
      this.mapController = new MapController();
      this.mapController.currentMode = this.currentMode;

      this.mapController.onWaypointsChanged = (waypoints, segments) => {
        this.currentWaypoints = waypoints;
        this.currentSegments = segments;
        this.renderWaypointList(waypoints);
        this.updateActionButtons();
        this.updateKmlPanel();
      };

      this.mapController.onPolygonsChanged = (groups) => {
        this.renderLayerPanel(groups);
        this.updateSplitMergeButtons(groups);
      };

      this.mapController.onError = (msg) => this.showError(msg);
      this.mapController.onLoadingChange = (loading) => this.showMapLoading(loading);
      this.mapController.onClosedChanged = (closed) => this.handleClosedChanged(closed);
      this.mapController.onGoogleQuota = () => this.handleGoogleQuotaExceeded();
      this.mapController.onOrsUnavailable = () => {
        this.routingProvider = "google";
        localStorage.setItem("tm_routing_provider", "google");
        this.updateRoutingBtn("google");
        this.showError("ORS indisponible — calcul d'itinéraires basculé automatiquement vers Google Maps.");
      };

      const provider = (localStorage.getItem("tm_map_provider") ?? "osm") as MapProvider;
      const rp = routingProvider ?? this.routingProvider;
      await this.mapController.init(apiKey, mapEl, provider, rp, initialView);
      this.mapController.setOrsApiKey(this.orsApiKey);

      // Apply saved map theme
      const savedMapTheme = (localStorage.getItem("tm_map_theme") ?? "dark") as MapTheme;
      if (savedMapTheme !== "dark") {
        this.mapController.setMapTheme(savedMapTheme);
      }

      this.isMapLoaded = true;
      const initialGroups = this.mapController?.getGroups() ?? [];
      this.renderLayerPanel(initialGroups);
      this.updateSplitMergeButtons(initialGroups);
      this.updateActionButtons();
    } catch (err) {
      this.isMapLoaded = false;
      this.mapController = null;
      this.showMapLoading(false);
      if (rethrow) throw err;
      this.updateKeySection(false);
      this.showSettingsPanel();
      this.showError(err instanceof Error ? err.message : "Impossible de charger Google Maps.");
      return;
    }
    this.showMapLoading(false);
  }

  private async switchProvider(): Promise<void> {
    const viewState = this.mapController?.getViewState() ?? undefined;
    this.mapController?.destroy();
    this.mapController = null;
    this.isMapLoaded = false;
    this.currentWaypoints = [];
    this.currentSegments = [];

    const mapProvider = (localStorage.getItem("tm_map_provider") ?? "osm") as MapProvider;
    const needsGoogleKey = mapProvider === "google" || this.routingProvider === "google";

    if (!needsGoogleKey) {
      await this.initMap(null, viewState);
      return;
    }

    // Google key needed — prefer shared key, fall back to personal key
    const apiKey = this.sharedApiKey
      ?? await ApiKeyManager.loadKey().catch(() => null);

    if (apiKey) {
      await this.initMap(apiKey, viewState);
    } else {
      // No key available — prompt user in settings panel
      this.updateKeySection(false);
      this.showSettingsPanel();
      this.showFallbackNotice();
      this.bindLandingForm();
    }
  }

  // ─── Segment mode toggle ─────────────────────────────────────────────────────

  private bindToggle(): void {
    this.el("btn-mode-route").addEventListener("click", () => this.setMode("route"));
    this.el("btn-mode-straight").addEventListener("click", () => this.setMode("straight"));
    this.renderToggle();
  }

  private setMode(mode: SegmentMode): void {
    this.currentMode = mode;
    if (this.mapController) this.mapController.currentMode = mode;
    this.renderToggle();
  }

  private renderToggle(): void {
    const btnRoute = this.el("btn-mode-route");
    const btnStraight = this.el("btn-mode-straight");
    if (this.currentMode === "route") {
      btnRoute.className = "toggle-pill-btn active-route";
      btnStraight.className = "toggle-pill-btn inactive";
    } else {
      btnRoute.className = "toggle-pill-btn inactive";
      btnStraight.className = "toggle-pill-btn active-straight";
    }
  }

  // ─── Transport buttons ───────────────────────────────────────────────────────

  private bindTransportButtons(): void {
    const buttons: Array<{ id: string; mode: string }> = [
      { id: "btn-transport-driving", mode: "DRIVING" },
      { id: "btn-transport-walking", mode: "WALKING" },
      { id: "btn-transport-bicycling", mode: "BICYCLING" },
    ];

    for (const { id, mode } of buttons) {
      document.getElementById(id)?.addEventListener("click", () => {
        if (!this.mapController) return;
        this.mapController.setTravelMode(mode as TravelMode);
        this.renderTransportButtons(mode);
      });
    }
  }

  private renderTransportButtons(activeMode: string): void {
    const ids: Record<string, string> = {
      DRIVING: "btn-transport-driving",
      WALKING: "btn-transport-walking",
      BICYCLING: "btn-transport-bicycling",
    };
    for (const [mode, id] of Object.entries(ids)) {
      document.getElementById(id)?.classList.toggle("active", mode === activeMode);
    }
  }

  // ─── Action buttons ──────────────────────────────────────────────────────────

  private bindActionButtons(): void {
    this.el("btn-undo").addEventListener("click", () => {
      this.mapController?.removeLastWaypoint();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        // Try merge/split undo first; fall back to waypoint undo
        const undone = this.mapController?.undoLastMergeSplit();
        if (!undone) this.mapController?.removeLastWaypoint();
      }
    });
    this.el("btn-clear").addEventListener("click", () => {
      this.mapController?.clearAll();
    });

    {
      let pendingId: string | null = null;
      let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

      const resetPending = () => {
        pendingId = null;
        if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
        document.removeEventListener("click", cancelOnOutside);
        document.getElementById("btn-vertex-edit")?.classList.remove("vertex-edit-pending");
        this.updateVertexEditButton(this.mapController?.getGroups() ?? []);
      };
      const cancelOnOutside = (e: MouseEvent) => {
        const btn = document.getElementById("btn-vertex-edit");
        if (btn && !btn.contains(e.target as Node)) resetPending();
      };

      document.getElementById("btn-vertex-edit")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const active = this.mapController?.getPolygons().find((p) => p.isActive);
        if (!active) return;

        if (!active.isImported && active.isClosed) {
          // Drawn closed polygon: two-step confirmation before irreversible conversion
          const btn = e.currentTarget as HTMLButtonElement;
          if (pendingId !== active.id) {
            pendingId = active.id;
            btn.classList.add("vertex-edit-pending");
            btn.textContent = "⚠";
            btn.title = "Cliquer à nouveau pour confirmer — le tracé routier sera perdu";
            pendingTimeout = setTimeout(resetPending, 4000);
            document.addEventListener("click", cancelOnOutside);
          } else {
            resetPending();
            this.mapController?.toggleVertexEdit(active.id);
          }
        } else {
          // Imported / zone polygon: direct toggle
          this.mapController?.toggleVertexEdit(active.id);
        }
      });
    }

    document.getElementById("btn-split")?.addEventListener("click", () => {
      if (this.mapController?.splitModeActive) {
        this.mapController.exitSplitMode();
      } else {
        this.mapController?.enterSplitMode();
      }
    });

    document.getElementById("btn-merge")?.addEventListener("click", () => {
      const ids = this.mapController?.getSelectedPolygonIds() ?? [];
      if (ids.length === 2) {
        void this.handleMergeClick(ids[0]!, ids[1]!);
      }
    });

    document.getElementById("btn-undo-split-merge")?.addEventListener("click", () => {
      this.mapController?.undoLastMergeSplit();
    });

    document.getElementById("btn-simplify-all")?.addEventListener("click", () => {
      const drawnIds = this.mapController?.getClosedDrawnPolygonIds() ?? [];
      if (drawnIds.length === 0) {
        this.mapController?.simplifyAllPolygons();
        return;
      }
      const countEl = document.getElementById("simplify-drawn-count");
      if (countEl) countEl.textContent = String(drawnIds.length);
      const modal = document.getElementById("simplify-confirm-modal") as HTMLElement | null;
      if (modal) modal.style.display = "flex";
    });

    document.getElementById("btn-simplify-confirm")?.addEventListener("click", () => {
      (document.getElementById("simplify-confirm-modal") as HTMLElement).style.display = "none";
      this.mapController?.convertAllDrawnToFlat();
      this.mapController?.simplifyAllPolygons();
    });

    document.getElementById("btn-simplify-cancel")?.addEventListener("click", () => {
      (document.getElementById("simplify-confirm-modal") as HTMLElement).style.display = "none";
    });
  }

  // ─── NWS merge flow ──────────────────────────────────────────────────────────

  /**
   * Intercept merge to inject NWS workflow when a NWS session is active.
   * Shows access modal on first merge, then keeps / control choice on every merge.
   */
  private async handleMergeClick(id1: string, id2: string): Promise<void> {
    if (!this.isNwsSession) {
      await this.mapController?.mergePolygons(id1, id2);
      return;
    }

    if (this.nwsAccessMode === null) {
      const mode = await this.askNwsAccess();
      if (mode === null) return;
      this.nwsAccessMode = mode;
    }

    const nws1 = this.mapController?.getPolygonNwsData(id1);
    const nws2 = this.mapController?.getPolygonNwsData(id2);

    if (this.nwsAccessMode === "yes") {
      const keepId = await this.askNwsKeep(id1, id2);
      if (keepId === null) return;

      const otherId = keepId === id1 ? id2 : id1;
      const nwsKept = this.mapController?.getPolygonNwsData(keepId);
      const nwsDeleted = this.mapController?.getPolygonNwsData(otherId);

      await this.mapController?.mergePolygons(id1, id2, nwsKept);

      if (nwsDeleted && nwsKept) {
        this.suppressionAFaire.push(buildSuppressionAFaire(nwsDeleted, nwsKept.TerritoryID));
      }
    } else {
      await this.mapController?.mergePolygons(id1, id2, nws1);
      if (nws1 && nws2) {
        this.suppressionAControler.push(buildSuppressionAControler(nws1, nws2));
      }
    }
  }

  /** Show modal-nws-access and return "yes" | "no" | null (if closed without choosing). */
  private askNwsAccess(): Promise<"yes" | "no" | null> {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-nws-access") as HTMLElement;
      modal.style.display = "flex";

      const cleanup = () => { modal.style.display = "none"; };
      const btnYes = document.getElementById("btn-nws-access-yes")!;
      const btnNo  = document.getElementById("btn-nws-access-no")!;

      const onYes = () => {
        cleanup();
        btnYes.removeEventListener("click", onYes);
        btnNo.removeEventListener("click", onNo);
        resolve("yes");
      };
      const onNo = () => {
        cleanup();
        btnYes.removeEventListener("click", onYes);
        btnNo.removeEventListener("click", onNo);
        resolve("no");
      };
      btnYes.addEventListener("click", onYes);
      btnNo.addEventListener("click", onNo);
    });
  }

  /** Show modal-nws-keep with the two territory names. Returns the chosen id, or null if closed. */
  private askNwsKeep(id1: string, id2: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-nws-keep") as HTMLElement;
      const optionsDiv = document.getElementById("nws-keep-options")!;
      optionsDiv.replaceChildren();

      const makeCard = (id: string, nws: NWSData | undefined) => {
        const card = document.createElement("div");
        card.style.cssText = "background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:8px;padding:12px 14px;cursor:pointer;transition:border-color .15s;";

        const strong = document.createElement("strong");
        strong.style.fontSize = "1rem";
        strong.textContent = nws ? `N\u00b0\u00a0${nwsDisplayName(nws.Number, nws.Suffix)}` : id;
        card.appendChild(strong);

        if (nws) {
          card.appendChild(document.createElement("br"));
          const span = document.createElement("span");
          span.style.cssText = "font-size:0.78rem;color:var(--color-text-muted);";
          span.textContent = `TerritoryID\u00a0: ${nws.TerritoryID} \u2014 Cat\u00e9gorie\u00a0: ${nws.Category}`;
          card.appendChild(span);
        }

        card.addEventListener("click", () => {
          modal.style.display = "none";
          optionsDiv.replaceChildren();
          resolve(id);
        });
        card.addEventListener("mouseenter", () => { card.style.borderColor = "var(--color-accent-green)"; });
        card.addEventListener("mouseleave", () => { card.style.borderColor = "var(--color-border)"; });
        return card;
      };

      optionsDiv.appendChild(makeCard(id1, this.mapController?.getPolygonNwsData(id1)));
      optionsDiv.appendChild(makeCard(id2, this.mapController?.getPolygonNwsData(id2)));
      modal.style.display = "flex";
    });
  }

  // ─── NWS CSV export ──────────────────────────────────────────────────────────

  private bindCsvExport(): void {
    document.getElementById("btn-export-csv")?.addEventListener("click", () => {
      void this.handleCsvExport();
    });

    document.getElementById("btn-suppressions-csv")?.addEventListener("click", () => {
      const csv = buildSuppressionsCsv(this.suppressionAFaire, this.suppressionAControler);
      downloadText(csv, "Suppressions_NWS.csv");
    });

    document.getElementById("btn-suppressions-xlsx")?.addEventListener("click", async () => {
      const blob = await buildSuppressionsXlsx(this.suppressionAFaire, this.suppressionAControler);
      downloadBlob(blob, "Suppressions_NWS.xlsx");
    });

    document.getElementById("btn-suppressions-continue")?.addEventListener("click", () => {
      (document.getElementById("modal-nws-suppressions") as HTMLElement).style.display = "none";
      this.doExportCsv();
    });
  }

  private async handleCsvExport(): Promise<void> {
    const hasSuppresions = this.suppressionAFaire.length > 0 || this.suppressionAControler.length > 0;
    if (hasSuppresions) {
      this.renderSuppressionModal();
    } else {
      this.doExportCsv();
    }
  }

  private doExportCsv(): void {
    const polygons = this.mapController?.getAllPolygonsForExport() ?? [];
    const csv = buildNwsCsv(polygons);
    downloadText(csv, "Territoires_NWS.csv");
  }

  private renderSuppressionModal(): void {
    const modal = document.getElementById("modal-nws-suppressions") as HTMLElement;
    const content = document.getElementById("nws-suppressions-content")!;
    content.replaceChildren();

    const makeTable = (headers: string[], rows: string[][]): HTMLElement => {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "overflow-x:auto;";
      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:0.78rem;";
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const h of headers) {
        const th = document.createElement("th");
        th.textContent = h;
        th.style.cssText = "padding:6px 10px;border-bottom:1px solid var(--color-border);text-align:left;white-space:nowrap;color:var(--color-text-muted);font-weight:600;";
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell;
          td.style.cssText = "padding:6px 10px;border-bottom:1px solid var(--color-surface-2);";
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrapper.appendChild(table);
      return wrapper;
    };

    if (this.suppressionAFaire.length > 0) {
      const section = document.createElement("div");

      const title = document.createElement("p");
      title.style.cssText = "font-weight:700;color:var(--color-accent-green);margin:0 0 8px;";
      title.textContent = "Suppressions \u00e0 faire";
      section.appendChild(title);

      const note = document.createElement("p");
      note.style.cssText = "font-size:0.78rem;color:var(--color-text-muted);margin:0 0 10px;";
      note.textContent = "Ces territoires ont \u00e9t\u00e9 fusionn\u00e9s. Vous devez les supprimer dans NWS et mettre \u00e0 jour MyMaps.";
      section.appendChild(note);

      const rows = this.suppressionAFaire.map(r => [
        r.TerritoryID, nwsDisplayName(r.Number, r.Suffix), r.Category, r.MergedInto_TerritoryID, r.Instructions_MyMaps,
      ]);
      section.appendChild(makeTable(["TerritoryID", "N\u00b0", "Cat\u00e9gorie", "Fusionn\u00e9 dans", "Instructions MyMaps"], rows));
      content.appendChild(section);
    }

    if (this.suppressionAControler.length > 0) {
      const section = document.createElement("div");

      const title = document.createElement("p");
      title.style.cssText = "font-weight:700;color:var(--color-accent-blue);margin:0 0 8px;";
      title.textContent = "\u00c0 contr\u00f4ler dans NWS";
      section.appendChild(title);

      const note = document.createElement("p");
      note.style.cssText = "font-size:0.78rem;color:var(--color-text-muted);margin:0 0 10px;";
      note.textContent = "Ces fusions ont \u00e9t\u00e9 faites sans acc\u00e8s \u00e0 NWS. V\u00e9rifiez les dates d\u2019attribution avant de supprimer.";
      section.appendChild(note);

      const rows = this.suppressionAControler.map(r => [
        r.TerritoryID_new, nwsDisplayName(r.Number_new, r.Suffix_new),
        r.TerritoryID_old, nwsDisplayName(r.Number_old, r.Suffix_old),
        r.Instructions,
      ]);
      section.appendChild(makeTable(["TerritoryID (nouveau)", "N\u00b0 (nouveau)", "TerritoryID (ancien)", "N\u00b0 (ancien)", "Instructions"], rows));
      content.appendChild(section);
    }

    modal.style.display = "flex";
  }

  private updateCsvExportButton(): void {
    const btn = document.getElementById("btn-export-csv") as HTMLButtonElement | null;
    if (!btn) return;
    btn.style.display = this.isNwsSession ? "" : "none";
  }

  private updateSplitMergeButtons(groups: GroupInfo[]): void {
    const allPolygons = groups.flatMap(g => g.polygons);
    const active = allPolygons.find(p => p.isActive);
    const selectedCount = this.mapController?.getSelectedPolygonIds().length ?? 0;
    const splitModeActive = this.mapController?.splitModeActive ?? false;
    const undoStackSize = this.mapController?.getUndoStackSize() ?? 0;

    const btnSplit = document.getElementById("btn-split") as HTMLButtonElement | null;
    const btnMerge = document.getElementById("btn-merge") as HTMLButtonElement | null;
    const btnUndoSM = document.getElementById("btn-undo-split-merge") as HTMLButtonElement | null;

    if (btnSplit) {
      const canSplit = active?.isClosed && !splitModeActive && selectedCount <= 1;
      const inSplitMode = splitModeActive;
      btnSplit.style.display = (canSplit || inSplitMode) ? "" : "none";
      btnSplit.textContent = inSplitMode
        ? (this.mapController?.splitStartSet ? "✂ En cours…" : "⊗")
        : "✂";
      btnSplit.title = inSplitMode ? "Annuler la découpe" : "Découper le polygone";
      btnSplit.classList.toggle("active-snap", inSplitMode);
    }

    if (btnMerge) {
      btnMerge.style.display = selectedCount === 2 ? "" : "none";
    }

    if (btnUndoSM) {
      btnUndoSM.style.display = undoStackSize > 0 ? "" : "none";
    }
  }

  private updateVertexEditButton(groups: GroupInfo[]): void {
    const allPolygons = groups.flatMap((g) => g.polygons);
    const active = allPolygons.find((p) => p.isActive);
    const btn = document.getElementById("btn-vertex-edit") as HTMLButtonElement | null;
    if (!btn) return;
    btn.style.display = active?.isClosed ? "" : "none";
    if (active?.vertexEditActive) {
      btn.textContent = "⊗";
      btn.title = "Quitter l'édition des coordonnées";
    } else if (!btn.classList.contains("vertex-edit-pending")) {
      const img = document.createElement("img");
      img.src = "/images/tools/pencil.svg";
      img.width = 20;
      img.height = 20;
      img.setAttribute("aria-hidden", "true");
      btn.replaceChildren(img);
      btn.title = active?.isImported
        ? "Éditer les coordonnées"
        : "Convertir en zone éditable (le tracé routier sera perdu)";
    }
    btn.classList.toggle("active-snap", active?.vertexEditActive ?? false);
  }

  private updateSimplifyAllButton(): void {
    const btn = document.getElementById("btn-simplify-all") as HTMLButtonElement | null;
    if (!btn) return;
    const polygons = (this.mapController?.getGroups() ?? []).flatMap(g => g.polygons);
    const hasZones = polygons.some(p => p.isClosed);
    btn.disabled = !hasZones;
  }

  private updateActionButtons(): void {
    const count = this.currentWaypoints.length;
    const closed = this.mapController?.closed ?? false;
    const undoBtn = this.el<HTMLButtonElement>("btn-undo");
    undoBtn.disabled = count === 0;
    undoBtn.textContent = closed ? "↩ Rouvrir le polygone" : "↩ Supprimer dernier";
    this.el<HTMLButtonElement>("btn-clear").disabled = count === 0;
    this.el<HTMLButtonElement>("btn-export-kml").disabled =
      (this.mapController?.getAllPolygonsForExport().length ?? 0) === 0;
    this.updateVertexEditButton(this.mapController?.getGroups() ?? []);
    this.updateSimplifyAllButton();
    this.updateCsvExportButton();

    // Enable "New polygon" button when there are no polygons, or when the active polygon is closed
    const polygonsCount = this.mapController?.getGroups().flatMap((g) => g.polygons).length ?? 0;
    const addBtn = document.getElementById("btn-add-polygon") as HTMLButtonElement | null;
    if (addBtn) addBtn.disabled = polygonsCount > 0 && !closed;

    const hint = document.getElementById("map-hint-text");
    if (hint && !closed) {
      hint.textContent = count >= 3
        ? `${this.tap("Clique")} sur le point A pour fermer le polygone`
        : `${this.tap("Clique")} sur la carte pour placer un point de passage`;
    }
  }

  private handleClosedChanged(closed: boolean): void {
    const hintWrapper = document.getElementById("map-hint");
    const hint = document.getElementById("map-hint-text");
    if (closed) {
      if (hintWrapper) hintWrapper.style.display = "none";
    } else {
      if (hint) hint.textContent = this.currentWaypoints.length >= 3
        ? `${this.tap("Clique")} sur le point A pour fermer le polygone`
        : `${this.tap("Clique")} sur la carte pour placer un point de passage`;
    }
    this.updateActionButtons();
  }

  // ─── Layer panel ─────────────────────────────────────────────────────────────

  private bindLayerPanel(): void {
    document.getElementById("btn-add-polygon")?.addEventListener("click", () => {
      this.mapController?.addPolygon();
      const hint = document.getElementById("map-hint");
      if (hint) hint.style.display = "";
    });

    document.getElementById("layer-filter")?.addEventListener("input", () => {
      requestAnimationFrame(() => {
        const groups = this.mapController?.getGroups() ?? [];
        this.renderLayerPanel(groups);
      });
    });

    const sortBtn = document.getElementById("btn-sort-by-points");
    if (sortBtn) {
      sortBtn.addEventListener("click", () => {
        this.sortByPoints = !this.sortByPoints;
        sortBtn.style.color = this.sortByPoints ? "var(--color-accent-green)" : "var(--color-text-muted)";
        sortBtn.style.borderColor = this.sortByPoints ? "var(--color-accent-green)" : "var(--color-border)";
        const groups = this.mapController?.getGroups() ?? [];
        this.renderLayerPanel(groups);
      });
    }
  }

  /** Use touch-friendly verbs when the device has a touchscreen */
  private readonly isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  private tap(verb: string): string {
    if (!this.isTouch) return verb;
    const map: Record<string, string> = { "Clique": "Touche", "Cliquez": "Touchez" };
    return map[verb] ?? verb;
  }

  // ─── Mobile drawer toggle ────────────────────────────────────────────────────

  private bindMobileUI(): void {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("btn-sidebar-toggle");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (!sidebar || !toggle || !backdrop) return;

    const open = () => {
      sidebar.classList.add("open");
      backdrop.classList.add("visible");
    };
    const close = () => {
      sidebar.classList.remove("open");
      backdrop.classList.remove("visible");
    };

    toggle.addEventListener("click", () => {
      sidebar.classList.contains("open") ? close() : open();
    });
    backdrop.addEventListener("click", close);
    document.getElementById("btn-sidebar-close")?.addEventListener("click", close);
  }

  // ─── Sidebar tabs (desktop) ──────────────────────────────────────────────────

  private bindSidebarTabs(): void {
    const tabTools = document.getElementById("tab-tools");
    const tabSettings = document.getElementById("tab-settings");
    if (!tabTools || !tabSettings) return;

    tabTools.addEventListener("click", () => {
      if (this.isMapLoaded) this.showMapPanel();
    });
    tabSettings.addEventListener("click", () => {
      this.showSettingsPanel();
    });
  }

  // ─── Floating map toolbar (mobile/tablet) ────────────────────────────────────

  private bindMapToolbar(): void {
    // Proxy buttons → trigger their sidebar counterparts
    document.querySelectorAll<HTMLButtonElement>("#map-toolbar [data-target]").forEach(tbBtn => {
      const target = document.getElementById(tbBtn.dataset.target!) as HTMLButtonElement | null;
      if (!target) return;
      tbBtn.addEventListener("click", () => target.click());
      // Sync initial disabled state
      tbBtn.disabled = target.disabled;
      // Sync disabled state on changes
      new MutationObserver(() => {
        tbBtn.disabled = target.disabled;
      }).observe(target, { attributes: true, attributeFilter: ["disabled"] });
    });

    // Transport picker
    const picker = document.getElementById("tb-transport");
    const currentBtn = document.getElementById("tb-transport-current");
    const currentIcon = document.getElementById("tb-transport-icon");
    const currentLabel = document.getElementById("tb-transport-label");

    const MODES = [
      { mode: "driving",   icon: "🚗", label: "Voiture" },
      { mode: "walking",   icon: "🚶", label: "Pied"    },
      { mode: "bicycling", icon: "🚴", label: "Vélo"    },
    ] as const;

    const syncPickerIcon = () => {
      for (const { mode, icon, label } of MODES) {
        if (document.getElementById(`btn-transport-${mode}`)?.classList.contains("active")) {
          if (currentIcon) currentIcon.textContent = icon;
          if (currentLabel) currentLabel.textContent = label;
        }
      }
    };

    const closePicker = () => {
      picker?.classList.remove("expanded");
      currentBtn?.setAttribute("aria-expanded", "false");
      document.getElementById("tb-transport-options")?.setAttribute("aria-hidden", "true");
    };

    currentBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = picker?.classList.contains("expanded");
      if (isExpanded) {
        closePicker();
      } else {
        picker?.classList.add("expanded");
        currentBtn.setAttribute("aria-expanded", "true");
        document.getElementById("tb-transport-options")?.setAttribute("aria-hidden", "false");
      }
    });

    document.querySelectorAll<HTMLButtonElement>(".tb-transport-opt").forEach(opt => {
      const target = document.getElementById(opt.dataset.target!) as HTMLButtonElement | null;
      if (!target) return;
      // Initial active state
      opt.classList.toggle("active", target.classList.contains("active"));
      // Click → trigger real button, sync icon, collapse
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        target.click();
        syncPickerIcon();
        closePicker();
      });
      // Sync active class when real button changes
      new MutationObserver(() => {
        opt.classList.toggle("active", target.classList.contains("active"));
        syncPickerIcon();
      }).observe(target, { attributes: true, attributeFilter: ["class"] });
    });

    // Close picker on outside click
    document.addEventListener("click", (e) => {
      if (!picker?.contains(e.target as Node)) closePicker();
    });

    syncPickerIcon();

    // Export button → direct download (kml-panel is hidden on mobile)
    const tbExport = document.getElementById("tb-export") as HTMLButtonElement | null;
    const realExportBtn = document.getElementById("btn-export-kml") as HTMLButtonElement | null;
    const downloadBtn = document.getElementById("btn-kml-download") as HTMLButtonElement | null;
    if (tbExport && realExportBtn && downloadBtn) {
      tbExport.disabled = realExportBtn.disabled;
      tbExport.addEventListener("click", () => downloadBtn.click());
      new MutationObserver(() => {
        tbExport.disabled = realExportBtn.disabled;
      }).observe(realExportBtn, { attributes: true, attributeFilter: ["disabled"] });
    }

    // Zones button → open bottom sheet
    document.getElementById("tb-zones")?.addEventListener("click", () => {
      this.openZonesSheet();
    });
  }

  // ─── Zones bottom sheet ──────────────────────────────────────────────────────

  private openZonesSheet(): void {
    const sheet = document.getElementById("zones-sheet");
    const backdrop = document.getElementById("zones-sheet-backdrop");
    const sheetList = document.getElementById("zones-sheet-list");
    const sourceList = document.getElementById("polygon-layer-list");
    if (!sheet || !backdrop || !sheetList || !sourceList) return;

    // Clone current layer list content
    sheetList.replaceChildren(sourceList.cloneNode(true));

    // Wire up polygon row clicks: select real item and close sheet
    sheetList.querySelectorAll<HTMLElement>(".polygon-layer-row[data-id]").forEach(clonedRow => {
      const polyId = clonedRow.dataset.id;
      clonedRow.addEventListener("click", () => {
        const realRow = sourceList.querySelector<HTMLElement>(`.polygon-layer-row[data-id="${polyId}"]`);
        realRow?.click();
        this.closeZonesSheet();
      });
    });

    // Wire up group row clicks: collapse/expand via real row
    sheetList.querySelectorAll<HTMLElement>(".group-row[data-group-id]").forEach(clonedRow => {
      const groupId = clonedRow.dataset.groupId;
      clonedRow.addEventListener("click", () => {
        const realRow = sourceList.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`);
        realRow?.click();
      });
    });

    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    backdrop.classList.add("visible");
    document.getElementById("btn-zones-sheet-close")?.addEventListener("click", () => this.closeZonesSheet(), { once: true });
    backdrop.addEventListener("click", () => this.closeZonesSheet(), { once: true });
  }

  private closeZonesSheet(): void {
    const sheet = document.getElementById("zones-sheet");
    const backdrop = document.getElementById("zones-sheet-backdrop");
    sheet?.classList.remove("open");
    sheet?.setAttribute("aria-hidden", "true");
    backdrop?.classList.remove("visible");
  }

  // ─── Sidebar resize ──────────────────────────────────────────────────────────

  private bindLayerListResize(): void {
    const handle = document.getElementById("layer-list-resize");
    const list = document.getElementById("polygon-layer-list");
    if (!handle || !list) return;

    const MIN_H = 80;
    const MAX_H = 600;

    // Restore saved height
    const saved = localStorage.getItem("tm_layer_list_height");
    if (saved) list.style.maxHeight = `${Math.max(MIN_H, Math.min(MAX_H, Number(saved)))}px`;

    const startDrag = (startY: number) => {
      handle.classList.add("dragging");
      document.body.classList.add("layer-list-resizing");
      const startH = list.offsetHeight;

      const move = (y: number) => {
        const h = Math.max(MIN_H, Math.min(MAX_H, startH + y - startY));
        list.style.maxHeight = `${h}px`;
      };
      const end = () => {
        handle.classList.remove("dragging");
        document.body.classList.remove("layer-list-resizing");
        localStorage.setItem("tm_layer_list_height", String(list.offsetHeight));
        document.removeEventListener("mousemove", onMouse);
        document.removeEventListener("mouseup", onMouseUp);
        document.removeEventListener("touchmove", onTouch);
        document.removeEventListener("touchend", onTouchEnd);
      };
      const onMouse = (mv: MouseEvent) => move(mv.clientY);
      const onMouseUp = end;
      const onTouch = (mv: TouchEvent) => move(mv.touches[0].clientY);
      const onTouchEnd = end;
      document.addEventListener("mousemove", onMouse);
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchmove", onTouch, { passive: true });
      document.addEventListener("touchend", onTouchEnd);
    };

    handle.addEventListener("mousedown", (e) => { e.preventDefault(); startDrag(e.clientY); });
    handle.addEventListener("touchstart", (e) => { e.preventDefault(); startDrag(e.touches[0].clientY); });
  }

  private bindSidebarResize(): void {
    const sidebar = document.getElementById("sidebar");
    const handle = document.getElementById("sidebar-resize");
    if (!sidebar || !handle) return;

    // Restore saved width
    const saved = localStorage.getItem("tm_sidebar_width");
    if (saved) sidebar.style.width = `${Math.max(180, Math.min(600, Number(saved)))}px`;

    const startDrag = (startX: number) => {
      handle.classList.add("dragging");
      document.body.classList.add("sidebar-resizing");
      const startW = sidebar.offsetWidth;

      const move = (x: number) => {
        const w = Math.max(180, Math.min(600, startW + x - startX));
        sidebar.style.width = `${w}px`;
      };
      const end = () => {
        handle.classList.remove("dragging");
        document.body.classList.remove("sidebar-resizing");
        localStorage.setItem("tm_sidebar_width", String(sidebar.offsetWidth));
        document.removeEventListener("mousemove", onMouse);
        document.removeEventListener("mouseup", onMouseUp);
        document.removeEventListener("touchmove", onTouch);
        document.removeEventListener("touchend", onTouchEnd);
      };
      const onMouse = (mv: MouseEvent) => move(mv.clientX);
      const onMouseUp = end;
      const onTouch = (mv: TouchEvent) => move(mv.touches[0].clientX);
      const onTouchEnd = end;
      document.addEventListener("mousemove", onMouse);
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchmove", onTouch, { passive: true });
      document.addEventListener("touchend", onTouchEnd);
    };

    handle.addEventListener("mousedown", (e) => { e.preventDefault(); startDrag(e.clientX); });
    handle.addEventListener("touchstart", (e) => { e.preventDefault(); startDrag(e.touches[0].clientX); });
  }

  // ─── Context menu ─────────────────────────────────────────────────────────────

  private bindContextMenu(): void {
    const list = document.getElementById("polygon-layer-list");
    const menu = document.getElementById("layer-ctx-menu");
    if (!list || !menu) return;
    menu.setAttribute("role", "menu");

    const hideMenu = () => { menu.hidden = true; menu.replaceChildren(); };

    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target as Node)) hideMenu();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideMenu(); });

    list.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      hideMenu();

      const target = e.target as HTMLElement;
      const groupRow = target.closest<HTMLElement>(".group-row");
      const polyRow = target.closest<HTMLElement>(".polygon-layer-row");
      const groupChildrenEl = polyRow?.closest<HTMLElement>(".group-children");
      const groupId = groupRow?.dataset.groupId ?? groupChildrenEl?.dataset.parentGroup;
      const polyId = polyRow?.dataset.id;

      const mkItem = (icon: string, label: string, danger = false): HTMLDivElement => {
        const el = document.createElement("div");
        el.className = "ctx-item" + (danger ? " danger" : "");
        el.setAttribute("role", "menuitem");
        const iconSpan = document.createElement("span");
        iconSpan.setAttribute("aria-hidden", "true");
        iconSpan.textContent = icon;
        el.appendChild(iconSpan);
        el.appendChild(document.createTextNode(" " + label));
        return el;
      };

      const mkSep = (): HTMLDivElement => {
        const el = document.createElement("div");
        el.className = "ctx-separator";
        return el;
      };

      const mkNewFolder = (): HTMLDivElement => {
        const it = mkItem("📁", "Nouveau dossier");
        it.addEventListener("click", () => {
          hideMenu();
          const name = prompt("Nom du nouveau dossier :", "Nouveau dossier");
          if (name?.trim()) this.mapController?.addGroup(name.trim());
        });
        return it;
      };

      if (polyRow && polyId) {
        const groups = this.mapController?.getGroups() ?? [];
        const otherGroups = groups.filter((g) => g.id !== groupId);
        if (otherGroups.length > 0) {
          const header = document.createElement("div");
          header.style.cssText = "font-size:0.7rem;color:var(--color-text-muted);padding:5px 12px 3px;";
          header.textContent = "Déplacer vers…";
          menu.appendChild(header);
          for (const g of otherGroups) {
            const it = mkItem("📁", g.name);
            it.addEventListener("click", () => { this.mapController?.movePolygonToGroup(polyId, g.id); hideMenu(); });
            menu.appendChild(it);
          }
          menu.appendChild(mkSep());
        }
        const del = mkItem("🗑", "Supprimer le polygone", true);
        del.addEventListener("click", () => { this.mapController?.deletePolygon(polyId); hideMenu(); });
        menu.appendChild(del);

      } else if (groupRow && groupId) {
        const ren = mkItem("✏", "Renommer le dossier");
        ren.addEventListener("click", () => {
          hideMenu();
          const nameEl = groupRow.querySelector<HTMLElement>(".group-name");
          nameEl?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        });
        menu.appendChild(ren);

        const del = mkItem("🗑", "Supprimer le dossier", true);
        del.addEventListener("click", () => { this.mapController?.deleteGroup(groupId); hideMenu(); });
        menu.appendChild(del);

        menu.appendChild(mkSep());
        menu.appendChild(mkNewFolder());

      } else {
        menu.appendChild(mkNewFolder());
      }

      // Position — keep on screen
      menu.hidden = false;
      const rect = menu.getBoundingClientRect();
      const mx = Math.min(e.clientX, window.innerWidth - rect.width - 8);
      const my = Math.min(e.clientY, window.innerHeight - rect.height - 8);
      menu.style.left = `${mx}px`;
      menu.style.top = `${my}px`;
    });
  }

  renderLayerPanel(groups: GroupInfo[]): void {
    this.updateVertexEditButton(groups);

    const list = document.getElementById("polygon-layer-list");
    if (!list) return;

    const filterInput = document.getElementById("layer-filter") as HTMLInputElement | null;
    const filterText = filterInput?.value.toLowerCase().trim() ?? "";

    list.replaceChildren();

    const totalPolygons = groups.reduce((s, g) => s + g.polygons.length, 0);

    if (totalPolygons === 0) {
      const hint = document.createElement("p");
      hint.style.cssText = "font-size:0.75rem;color:var(--color-text-muted);font-style:italic;text-align:center;padding:8px 0;margin:0;";
      hint.textContent = `${this.tap("Cliquez")} sur + Nouveau ou ⬆ Importer pour commencer`;
      list.appendChild(hint);
      return;
    }

    let draggedPolygonId: string | null = null;

    for (const group of groups) {
      // Filter polygons within the group
      let visiblePolys = filterText
        ? group.polygons.filter((p) => p.name.toLowerCase().includes(filterText))
        : [...group.polygons];

      // Sort by point count descending when active
      if (this.sortByPoints) {
        visiblePolys.sort((a, b) => (b.vertexCount ?? b.waypointCount) - (a.vertexCount ?? a.waypointCount));
      }

      // Skip empty groups when filtering
      if (filterText && visiblePolys.length === 0) continue;

      // ── Group header row ─────────────────────────────────────────────────────
      const groupRow = document.createElement("div");
      groupRow.className = "group-row";
      groupRow.dataset.groupId = group.id;

      const chevron = document.createElement("span");
      chevron.className = "group-chevron";
      chevron.textContent = group.collapsed ? "▶" : "▼";

      const icon = document.createElement("span");
      icon.textContent = "📁";
      icon.style.fontSize = "0.8rem";

      // Color dot — click to recolor all polygons in this group
      const groupColorInput = document.createElement("input");
      groupColorInput.type = "color";
      groupColorInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
      const groupColorDot = document.createElement("span");
      groupColorDot.className = "polygon-color-dot";
      const groupColor = group.polygons[0]?.fillColor ?? "#000000";
      groupColorDot.style.background = groupColor;
      groupColorInput.value = groupColor;
      groupColorDot.title = "Changer la couleur du dossier";
      groupColorDot.appendChild(groupColorInput);
      groupColorDot.addEventListener("click", (e) => {
        e.stopPropagation();
        groupColorInput.click();
      });
      groupColorInput.addEventListener("change", (e) => {
        e.stopPropagation();
        const newColor = groupColorInput.value;
        groupColorDot.style.background = newColor;
        this.mapController?.recolorGroup(group.id, newColor);
      });

      // Group name (double-click to rename)
      const groupName = document.createElement("span");
      groupName.className = "group-name";
      groupName.textContent = group.name;
      groupName.title = "Double-clic pour renommer";
      groupName.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.value = group.name;
        input.style.cssText = "flex:1;font-size:0.78rem;font-weight:600;background:var(--color-surface-2);color:var(--color-text);border:1px solid var(--color-accent-green);border-radius:4px;padding:1px 4px;width:100%;outline:none;";
        groupName.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim() || group.name;
          this.mapController?.renameGroup(group.id, newName);
        };
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); commit(); }
          if (ev.key === "Escape") { ev.preventDefault(); this.mapController?.renameGroup(group.id, group.name); }
        });
        input.addEventListener("blur", commit);
      });

      // Count badge
      const countBadge = document.createElement("span");
      countBadge.style.cssText = "font-size:0.65rem;color:var(--color-text-muted);flex-shrink:0;";
      countBadge.textContent = `${visiblePolys.length}`;

      // Group KML export button
      const groupKmlBtn = document.createElement("button");
      groupKmlBtn.className = "btn-icon";
      groupKmlBtn.title = "Exporter ce dossier en KML";
      groupKmlBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
      groupKmlBtn.textContent = "⬇";
      groupKmlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const data = this.mapController?.getGroupPolygonsForExport(group.id) ?? [];
        if (data.length > 0) downloadKml(buildKmlMulti(data), group.name);
      });

      // Group delete button
      const groupDelBtn = document.createElement("button");
      groupDelBtn.className = "btn-icon";
      groupDelBtn.title = "Supprimer ce dossier et ses polygones";
      groupDelBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
      groupDelBtn.textContent = "🗑";
      groupDelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.mapController?.deleteGroup(group.id);
      });

      groupRow.appendChild(chevron);
      groupRow.appendChild(icon);
      groupRow.appendChild(groupColorDot);
      groupRow.appendChild(groupName);
      groupRow.appendChild(countBadge);
      groupRow.appendChild(groupKmlBtn);
      groupRow.appendChild(groupDelBtn);

      // Accessibility
      groupRow.setAttribute("role", "button");
      groupRow.setAttribute("tabindex", "0");
      groupRow.setAttribute("aria-expanded", String(!group.collapsed));

      // Toggle collapse on row click or Enter/Space
      groupRow.addEventListener("click", () => {
        this.mapController?.toggleGroupCollapse(group.id);
      });
      groupRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.mapController?.toggleGroupCollapse(group.id);
        }
      });

      // Drop directly on the folder header → append to group
      groupRow.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        groupRow.classList.add("drag-over-folder");
      });
      groupRow.addEventListener("dragleave", () => {
        groupRow.classList.remove("drag-over-folder");
      });
      groupRow.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        groupRow.classList.remove("drag-over-folder");
        if (draggedPolygonId) {
          this.mapController?.reorderPolygon(draggedPolygonId, null, group.id);
          draggedPolygonId = null;
        }
      });

      list.appendChild(groupRow);

      // ── Children container ───────────────────────────────────────────────────
      const children = document.createElement("div");
      children.className = "group-children" + (group.collapsed ? " collapsed" : "");
      children.dataset.parentGroup = group.id;

      // Group-level drop zone (fallback when not hovering a polygon row)
      children.addEventListener("dragover", (e) => {
        // Only show group-level indicator if not over a polygon row
        if (!(e.target as HTMLElement).closest(".polygon-layer-row")) {
          e.preventDefault();
          children.classList.add("drag-over");
        }
      });
      children.addEventListener("dragleave", (e) => {
        if (!children.contains(e.relatedTarget as Node)) {
          children.classList.remove("drag-over");
        }
      });
      children.addEventListener("drop", (e) => {
        if ((e.target as HTMLElement).closest(".polygon-layer-row")) return;
        e.preventDefault();
        children.classList.remove("drag-over");
        if (draggedPolygonId) {
          this.mapController?.reorderPolygon(draggedPolygonId, null, group.id);
          draggedPolygonId = null;
        }
      });

      for (const poly of visiblePolys) {
        const row = document.createElement("div");
        row.className = "polygon-layer-row" + (poly.isActive ? " active-layer" : poly.isSelected ? " selected-layer" : "");
        row.dataset.id = poly.id;
        row.draggable = true;

        row.addEventListener("dragstart", (e) => {
          draggedPolygonId = poly.id;
          e.dataTransfer?.setData("text/plain", poly.id);
          setTimeout(() => row.style.opacity = "0.4", 0);
        });
        row.addEventListener("dragend", () => {
          draggedPolygonId = null;
          row.style.opacity = "";
        });

        // Reorder indicator on dragover
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.stopPropagation();
          children.classList.remove("drag-over");
          const rect = row.getBoundingClientRect();
          const isUpperHalf = e.clientY < rect.top + rect.height / 2;
          row.classList.toggle("drag-insert-before", isUpperHalf);
          row.classList.toggle("drag-insert-after", !isUpperHalf);
        });
        row.addEventListener("dragleave", () => {
          row.classList.remove("drag-insert-before", "drag-insert-after");
        });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isBefore = row.classList.contains("drag-insert-before");
          row.classList.remove("drag-insert-before", "drag-insert-after");
          children.classList.remove("drag-over");
          if (draggedPolygonId && draggedPolygonId !== poly.id) {
            if (isBefore) {
              this.mapController?.reorderPolygon(draggedPolygonId, poly.id, group.id);
            } else {
              // Insert after: find the next polygon in this group
              const groupPolys = group.polygons;
              const idx = groupPolys.findIndex((p) => p.id === poly.id);
              const nextPoly = groupPolys[idx + 1];
              this.mapController?.reorderPolygon(draggedPolygonId, nextPoly?.id ?? null, group.id);
            }
          }
          draggedPolygonId = null;
        });

        // Color dot
        const dot = document.createElement("span");
        dot.className = "polygon-color-dot";
        dot.style.background = poly.fillColor;

        // Name (double-click to rename)
        const name = document.createElement("span");
        name.style.cssText = "flex:1;font-size:0.8rem;font-weight:500;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;";
        name.title = "Double-clic pour renommer";
        // For imported zones the name is already shown in the badge — hide the redundant span
        if (poly.isImported) name.style.display = "none";
        name.textContent = poly.name;
        name.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          const input = document.createElement("input");
          input.value = poly.name;
          input.style.cssText = "flex:1;font-size:0.8rem;font-weight:500;background:var(--color-surface-2);color:var(--color-text);border:1px solid var(--color-accent-green);border-radius:4px;padding:1px 4px;width:100%;outline:none;";
          name.replaceWith(input);
          input.focus();
          input.select();
          const commit = () => {
            const newName = input.value.trim() || poly.name;
            this.mapController?.renamePolygon(poly.id, newName);
          };
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); commit(); }
            if (ev.key === "Escape") { ev.preventDefault(); this.mapController?.renamePolygon(poly.id, poly.name); }
          });
          input.addEventListener("blur", commit);
        });

        // Status badge
        const badge = document.createElement("span");
        if (poly.isImported) {
          badge.style.cssText = "font-size:0.68rem;padding:2px 5px;border-radius:3px;background:rgba(251,191,36,0.15);color:#fbbf24;flex-shrink:0;";
          badge.textContent = poly.vertexCount ? `${poly.name} · ${poly.vertexCount} pts` : poly.name;
        } else {
          badge.style.cssText = `font-size:0.68rem;padding:2px 5px;border-radius:3px;background:${poly.isClosed ? "rgba(0,229,160,0.15)" : "rgba(129,140,248,0.15)"};color:${poly.isClosed ? "#00e5a0" : "#818cf8"};flex-shrink:0;`;
          badge.textContent = poly.isClosed ? "Tracé" : "En cours";
        }

        row.appendChild(dot);
        row.appendChild(name);
        row.appendChild(badge);

        // Per-polygon simplify + restore (only for imported zones)
        if (poly.isImported && poly.isClosed) {
          const simplBtn = document.createElement("button");
          simplBtn.className = "btn-icon";
          simplBtn.title = "Simplifier le tracé (réduire le nombre de points)";
          simplBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
          simplBtn.textContent = "⬡";
          simplBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.mapController?.simplifyPolygon(poly.id);
          });
          row.appendChild(simplBtn);

          if (poly.canRestoreSimplify) {
            const restoreBtn = document.createElement("button");
            restoreBtn.className = "btn-icon";
            restoreBtn.title = "Restaurer le tracé original (annuler la simplification)";
            restoreBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
            restoreBtn.textContent = "↺";
            restoreBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.mapController?.restorePolygon(poly.id);
            });
            row.appendChild(restoreBtn);
          }
        }

        // Per-polygon KML download (only when closed)
        if (poly.isClosed) {
          const kmlBtn = document.createElement("button");
          kmlBtn.className = "btn-icon";
          kmlBtn.title = "Télécharger KML";
          kmlBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
          kmlBtn.textContent = "⬇";
          kmlBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const data = this.mapController?.getPolygonForExport(poly.id);
            if (data) downloadKml(buildKmlMulti([data]), poly.name);
          });
          row.appendChild(kmlBtn);
        }

        // Delete button
        const delBtn = document.createElement("button");
        delBtn.className = "btn-icon";
        delBtn.title = "Supprimer ce polygone";
        delBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.mapController?.deletePolygon(poly.id);
        });
        row.appendChild(delBtn);

        // Click row to select polygon (Ctrl+click adds to selection without fitting)
        row.addEventListener("click", (e) => {
          const multi = e.ctrlKey || e.metaKey;
          this.mapController?.selectPolygon(poly.id, multi);
          if (!multi) this.mapController?.fitToPolygon(poly.id);
        });

        // Double-click on a Zone row: enter vertex edit mode directly
        if (poly.isImported && poly.isClosed) {
          row.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            this.mapController?.selectPolygon(poly.id, false);
            this.mapController?.toggleVertexEdit(poly.id);
          });
        }

        children.appendChild(row);
      }

      list.appendChild(children);
    }
  }

  // ─── KML import ──────────────────────────────────────────────────────────────

  private bindKmlImport(): void {
    const btn = document.getElementById("btn-import-kml");
    const input = document.getElementById("input-kml-file") as HTMLInputElement | null;
    const progressEl = document.getElementById("import-progress");
    const progressText = document.getElementById("import-progress-text");
    const progressBar = document.getElementById("import-progress-bar") as HTMLElement | null;

    if (!btn || !input) return;

    btn.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      input.value = ""; // allow re-selecting the same file

      const lname = file.name.toLowerCase();
      if (!lname.endsWith(".kml") && !lname.endsWith(".csv")) {
        this.showError("Fichier invalide — seuls les fichiers .kml et .csv (NWS) sont supportés.");
        return;
      }

      if (progressEl) progressEl.style.display = "block";
      btn.setAttribute("disabled", "");

      try {
        if (lname.endsWith(".csv")) {
          // NWS CSV import
          const text = await file.text();
          if (progressText) progressText.textContent = "Analyse du CSV NWS…";
          const rows = parseNwsCsv(text);
          if (progressBar) progressBar.style.width = "100%";
          this.mapController?.importNwsCsv(rows);
          this.isNwsSession = true;
          this.suppressionAFaire = [];
          this.suppressionAControler = [];
          this.nwsAccessMode = null;
          this.updateActionButtons();
          this.updateCsvExportButton();
          if (progressText) progressText.textContent = `${rows.length} territoires importés`;
        } else {
          // KML import (existing flow)
          const polygons = await parseKmlFile(file, (p) => {
            const pct = Math.round((p.parsed / p.total) * 100);
            if (progressText) progressText.textContent = `${p.parsed} / ${p.total} — ${p.currentName}`;
            if (progressBar) progressBar.style.width = `${pct}%`;
          });

          if (polygons.length === 0) {
            throw new Error("Aucun polygone trouvé dans ce fichier KML.");
          }

          const groupName = file.name.replace(/\.[^.]+$/, "").slice(0, 30) || "Import";
          this.mapController?.importPolygons(polygons, groupName);
          this.updateActionButtons();
          if (progressText) progressText.textContent = `${polygons.length} polygones importés`;
        }

        setTimeout(() => {
          if (progressEl) progressEl.style.display = "none";
          if (progressBar) progressBar.style.width = "0%";
        }, 2000);
      } catch (err) {
        this.showError(err instanceof Error ? err.message : "Erreur lors de l'import.");
        if (progressEl) progressEl.style.display = "none";
      } finally {
        btn.removeAttribute("disabled");
      }
    });
  }

  // ─── Snap / magnet tool ──────────────────────────────────────────────────────

  private bindSnapToggle(): void {
    const btn = document.getElementById("btn-snap-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      this.snapActive = !this.snapActive;
      btn.classList.toggle("active-snap", this.snapActive);
      this.mapController?.setSnapMode(this.snapActive);
    });
  }

  // ─── Provider toggle ─────────────────────────────────────────────────────────

  private bindProviderToggle(): void {
    const btn = document.getElementById("btn-provider-toggle");
    if (!btn) return;
    const saved = (localStorage.getItem("tm_map_provider") ?? "osm") as MapProvider;
    this.updateProviderBtn(btn, saved);
    btn.addEventListener("click", async () => {
      const current = (localStorage.getItem("tm_map_provider") ?? "osm") as MapProvider;
      const next: MapProvider = current === "google" ? "osm" : "google";
      localStorage.setItem("tm_map_provider", next);
      this.updateProviderBtn(btn, next);
      this.updateKeySection(this.isMapLoaded);
      // Always switch if map is loaded, OR if switching to a no-key provider
      // while waiting for a key (isMapLoaded=false but no key needed anymore).
      const needsKey = next === "google" || this.routingProvider === "google";
      if (this.isMapLoaded || !needsKey) await this.switchProvider();
    });
  }

  private updateProviderBtn(btn: HTMLElement, provider: MapProvider): void {
    const img = document.getElementById("btn-provider-icon") as HTMLImageElement | null;
    if (img) {
      img.src = provider === "google" ? "/gm.avif" : "/osm.avif";
      img.alt = provider === "google" ? "Google Maps" : "OpenStreetMap";
    }
    btn.classList.toggle("active-provider-osm", provider === "osm");
  }

  // ─── Routing provider toggle ─────────────────────────────────────────────────

  private bindRoutingProviderToggle(): void {
    const picker = document.getElementById("routing-provider-picker");
    if (!picker) return;
    const saved = (localStorage.getItem("tm_routing_provider") ?? "ors") as RoutingProvider;
    this.routingProvider = saved;
    this.updateRoutingBtn(saved);
    picker.querySelectorAll<HTMLButtonElement>(".theme-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.value as RoutingProvider;
        if (next === this.routingProvider) return;
        localStorage.setItem("tm_routing_provider", next);
        this.routingProvider = next;
        this.updateRoutingBtn(next);
        this.updateKeySection(this.isMapLoaded);
        const needsKey = (localStorage.getItem("tm_map_provider") ?? "osm") === "google" || next === "google";
        if (this.isMapLoaded || !needsKey) await this.switchRoutingProvider();
      });
    });
  }

  private updateRoutingBtn(provider: RoutingProvider): void {
    const picker = document.getElementById("routing-provider-picker");
    if (!picker) return;
    picker.querySelectorAll<HTMLButtonElement>(".theme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === provider);
    });
  }

  private async switchRoutingProvider(): Promise<void> {
    const routingProvider = (localStorage.getItem("tm_routing_provider") ?? "ors") as RoutingProvider;
    const mapProvider = (localStorage.getItem("tm_map_provider") ?? "osm") as MapProvider;
    const needsGoogleKey = mapProvider === "google" || routingProvider === "google";

    if (!needsGoogleKey) {
      // Switch to ORS: just update routing provider on controller, no Google needed
      this.mapController?.setRoutingProvider("ors");
      this.updateKeySection(true);
      return;
    }

    // Switching to Google routing: need Google SDK + key
    // We must recreate the map controller with new routing provider
    const viewState = this.mapController?.getViewState() ?? undefined;
    this.mapController?.destroy();
    this.mapController = null;
    this.isMapLoaded = false;
    this.currentWaypoints = [];
    this.currentSegments = [];

    const apiKey = this.sharedApiKey
      ?? await ApiKeyManager.loadKey().catch(() => null);
    if (apiKey) {
      await this.initMap(apiKey, viewState, false, routingProvider);
    } else {
      this.updateKeySection(false);
      this.showSettingsPanel();
      this.showFallbackNotice();
      this.bindLandingForm();
    }
  }

  // ─── Waypoint list ───────────────────────────────────────────────────────────

  private renderWaypointList(waypoints: Waypoint[]): void {
    const list = this.el("waypoint-list");
    list.replaceChildren();

    if (waypoints.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText = "font-size:0.75rem;color:var(--color-text-muted);font-style:italic;text-align:center;padding:8px 0;margin:0;";
      empty.textContent = "Clique sur la carte pour ajouter des points";
      list.appendChild(empty);
      return;
    }

    for (const wp of waypoints) {
      const item = document.createElement("div");
      item.className = "waypoint-item";

      const labelEl = document.createElement("span");
      labelEl.className = "waypoint-label";
      labelEl.style.color = wp.segmentMode === "route" ? "#00e5a0" : "#818cf8";
      labelEl.textContent = wp.label;

      const coordEl = document.createElement("span");
      coordEl.style.cssText = "font-size:0.75rem;color:var(--color-text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      coordEl.textContent = `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`;

      item.appendChild(labelEl);
      item.appendChild(coordEl);

      if (wp.label !== "A") {
        const badge = document.createElement("span");
        badge.className =
          wp.segmentMode === "route"
            ? "segment-badge segment-badge-route"
            : "segment-badge segment-badge-straight";
        badge.textContent = wp.segmentMode === "route" ? "🛣" : "✈";
        item.appendChild(badge);
      }

      list.appendChild(item);
    }
  }

  // ─── KML export panel ────────────────────────────────────────────────────────

  private bindKmlButtons(): void {
    const exportBtn = this.el("btn-export-kml");
    const panel = this.el("kml-panel");

    exportBtn.addEventListener("click", () => {
      const isVisible = panel.style.display !== "none";
      panel.style.display = isVisible ? "none" : "flex";
      if (!isVisible) this.updateKmlPanel();
    });

    this.el("btn-kml-copy").addEventListener("click", async () => {
      const kml = this.getCurrentKml();
      if (!kml) return;
      try {
        await copyKml(kml);
        this.flashButton("btn-kml-copy", "✓ Copié !");
      } catch {
        this.showError("Impossible de copier dans le presse-papiers.");
      }
    });

    this.el("btn-kml-download").addEventListener("click", () => {
      const kml = this.getCurrentKml();
      if (kml) downloadKml(kml);
    });

    this.el("btn-kml-close").addEventListener("click", () => {
      panel.style.display = "none";
    });
  }

  private getCurrentKml(): string | null {
    const polygons = this.mapController?.getAllPolygonsForExport() ?? [];
    if (polygons.length === 0) return null;
    return buildKmlMulti(polygons);
  }

  private updateKmlPanel(): void {
    const panel = this.el("kml-panel");
    if (panel.style.display === "none") return;

    const kml = this.getCurrentKml();
    if (!kml) {
      panel.style.display = "none";
      return;
    }

    this.el<HTMLTextAreaElement>("kml-output").value = kml;

    const stats = getStats(this.currentSegments);
    const statsEl = this.el("kml-stats");
    statsEl.replaceChildren();

    const addStat = (label: string, value: string, color?: string) => {
      const span = document.createElement("span");
      span.style.color = "var(--color-text-muted)";
      span.textContent = label;
      statsEl.appendChild(span);
      const val = document.createElement("strong");
      if (color) val.style.color = color;
      val.textContent = value;
      statsEl.appendChild(val);
    };

    addStat("Points : ", String(stats.totalPoints));
    statsEl.appendChild(document.createTextNode(" · "));
    addStat("Route : ", String(stats.routeCount), "#00e5a0");
    statsEl.appendChild(document.createTextNode(" · "));
    addStat("Ligne droite : ", String(stats.straightCount), "#818cf8");
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private showMapLoading(visible: boolean): void {
    const overlay = document.getElementById("map-loading");
    if (!overlay) return;
    overlay.style.display = visible ? "flex" : "none";
  }

  // ─── Google quota fallback ───────────────────────────────────────────────────

  private handleGoogleQuotaExceeded(): void {
    const snapshot: MapSnapshot = this.mapController!.captureState();

    // Build modal overlay via DOM (no innerHTML — all content is static)
    const overlay = document.createElement("div");
    overlay.id = "quota-modal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;";

    const box = document.createElement("div");
    box.style.cssText = "background:var(--color-surface,#1e1e2e);border:1px solid var(--color-accent-yellow,#eed49f);border-radius:12px;padding:24px;max-width:480px;width:90%;box-sizing:border-box;";

    const title = document.createElement("h2");
    title.style.cssText = "font-size:1rem;margin:0 0 8px;color:var(--color-text);";
    title.textContent = "⚠ Quota Google Directions atteint";

    const desc = document.createElement("p");
    desc.style.cssText = "font-size:0.84rem;color:var(--color-text-muted);margin:0 0 10px;line-height:1.5;";
    desc.textContent = "La clé API partagée a épuisé son quota. Entrez votre propre clé Google Maps API pour continuer.";

    const notice = document.createElement("p");
    notice.style.cssText = "font-size:0.82rem;color:var(--color-accent-green,#a6e3a1);margin:0 0 16px;";
    notice.textContent = "Vos données sont conservées et seront restaurées automatiquement.";

    const kmlBtn = document.createElement("button");
    kmlBtn.type = "button";
    kmlBtn.style.cssText = "display:block;width:100%;margin-bottom:12px;padding:8px;background:transparent;border:1px solid var(--color-text-muted,#6c7086);border-radius:6px;color:var(--color-text);cursor:pointer;font-size:0.82rem;box-sizing:border-box;";
    kmlBtn.textContent = "⬇ Télécharger KML (sauvegarde)";

    const form = document.createElement("form");
    form.noValidate = true;

    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.placeholder = "AIza…";
    keyInput.autocomplete = "off";
    keyInput.spellcheck = false;
    keyInput.style.cssText = "display:block;width:100%;padding:8px 10px;background:var(--color-bg,#0f1117);border:1px solid var(--color-text-muted,#6c7086);border-radius:6px;color:var(--color-text);font-size:0.9rem;box-sizing:border-box;margin-bottom:10px;";

    const errorEl = document.createElement("div");
    errorEl.style.cssText = "display:none;font-size:0.8rem;color:var(--color-accent-red,#f38ba8);margin-bottom:8px;";

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.style.cssText = "display:block;width:100%;padding:9px;background:var(--color-accent-blue,#89b4fa);border:none;border-radius:6px;color:#1e1e2e;font-weight:600;cursor:pointer;font-size:0.9rem;box-sizing:border-box;";
    submitBtn.textContent = "Utiliser ma clé API";

    const guide = document.createElement("a");
    guide.href = "/documentation";
    guide.style.cssText = "display:block;text-align:center;margin-top:12px;font-size:0.78rem;color:var(--color-accent-blue,#89b4fa);";
    guide.textContent = "Comment obtenir une clé Google Maps API →";

    form.append(keyInput, errorEl, submitBtn);
    box.append(title, desc, notice, kmlBtn, form, guide);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    kmlBtn.addEventListener("click", () => {
      const kml = this.getCurrentKml();
      if (kml) downloadKml(kml);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = keyInput.value.trim();
      if (!key) return;

      submitBtn.disabled = true;
      errorEl.style.display = "none";

      try {
        await ApiKeyManager.saveKey(key);
        overlay.remove();
        this.sharedMode = false;
        this.mapController?.destroy();
        this.mapController = null;
        this.isMapLoaded = false;
        this.currentWaypoints = [];
        this.currentSegments = [];
        await this.initMap(key, snapshot.view ?? undefined, false, this.routingProvider);
        (this.mapController as MapController | null)?.restoreState(snapshot);
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : "Clé invalide.";
        errorEl.style.display = "block";
        submitBtn.disabled = false;
      }
    });
  }

  private showError(message: string): void {
    const existing = document.getElementById("error-toast");
    if (existing) existing.remove();
    if (this.errorTimer) clearTimeout(this.errorTimer);

    const toast = document.createElement("div");
    toast.id = "error-toast";
    toast.className = "error-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    this.errorTimer = setTimeout(() => {
      toast.remove();
      this.errorTimer = null;
    }, 6000);
  }

  private flashButton(id: string, text: string): void {
    const btn = document.getElementById(id);
    if (!btn) return;
    const original = btn.textContent ?? "";
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1800);
  }
}
