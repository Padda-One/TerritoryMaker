import { describe, it, expect, vi, beforeEach } from "vitest";
import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

// Les handlers sont typés pour le runtime Workers (functions/tsconfig.json) ;
// le tsconfig racine, qui couvre tests/, n'a pas ces types. L'import par chemin
// non littéral empêche tsc racine de suivre le module, sans rien changer au code.
const CONFIG_PATH: string = "../functions/api/config.ts";
const WEBHOOK_PATH: string = "../functions/api/webhook.ts";
const configModule = (await import(CONFIG_PATH)) as { onRequestGet: unknown };
const webhookModule = (await import(WEBHOOK_PATH)) as { onRequestPost: unknown };

const ALLOWED = "https://territory.paddaone.com";

// ─── Doubles ──────────────────────────────────────────────────────────────────

/** KV en mémoire : seules get/put sont utilisées par les handlers. */
function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  };
}

type Handler = (ctx: unknown) => Promise<Response>;
const call = (h: unknown, request: Request, env: unknown) =>
  (h as Handler)({ request, env, params: {}, data: {}, waitUntil() {}, next() {} });

beforeEach(() => {
  // Aucun appel sortant : tout fetch fait échouer le test.
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("fetch interdit dans les tests");
  }));
  // crypto.subtle.timingSafeEqual est propre à Cloudflare Workers ; Node ne l'a pas.
  const subtle = Object.create(globalThis.crypto.subtle);
  subtle.timingSafeEqual = (a: Uint8Array, b: Uint8Array) => nodeTimingSafeEqual(a, b);
  vi.stubGlobal("crypto", { ...globalThis.crypto, subtle, getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
});

// ─── /api/config ──────────────────────────────────────────────────────────────

describe("GET /api/config", () => {
  const env = (over: Record<string, unknown> = {}) => ({
    TERRITORY_CONFIG: fakeKv(),
    GOOGLE_MAPS_JS_KEY: "AIza-fausse-cle",
    ORS_KEY: "ors-fausse-cle",
    ...over,
  });
  const req = (headers: Record<string, string> = {}) =>
    new Request("https://territory.paddaone.com/api/config", { headers });

  it("n'exporte que GET : les autres méthodes sont refusées (405) par Pages", () => {
    expect(Object.keys(configModule)).toEqual(["onRequestGet"]);
  });

  it("mode partagé sans en-tête Origin (même origine / serveur)", async () => {
    const res = await call(configModule.onRequestGet, req(), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "shared",
      mapsJsKey: "AIza-fausse-cle",
      orsKey: "ors-fausse-cle",
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("accepte l'origine autorisée", async () => {
    const res = await call(configModule.onRequestGet, req({ Origin: ALLOWED }), env());
    expect(res.status).toBe(200);
  });

  it.each([
    "https://evil.example",
    "https://territory.paddaone.com.evil.example",
    "http://territory.paddaone.com",
    "null",
  ])("refuse l'origine %s (403) sans lire le KV ni divulguer de clé", async origin => {
    const e = env();
    const res = await call(configModule.onRequestGet, req({ Origin: origin }), e);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("AIza");
    expect(e.TERRITORY_CONFIG.get).not.toHaveBeenCalled();
  });

  it("mode fallback quand le drapeau KV vaut \"true\" — la clé Maps n'est pas exposée", async () => {
    const e = env({ TERRITORY_CONFIG: fakeKv({ fallback_mode: "true" }) });
    const res = await call(configModule.onRequestGet, req(), e);
    const body = await res.json();
    expect(body).toEqual({ mode: "fallback", orsKey: "ors-fausse-cle" });
  });

  it.each(["false", "TRUE", "1", ""])("drapeau KV %j ≠ \"true\" : reste en mode partagé", async v => {
    const e = env({ TERRITORY_CONFIG: fakeKv({ fallback_mode: v }) });
    const body = (await (await call(configModule.onRequestGet, req(), e)).json()) as { mode: string };
    expect(body.mode).toBe("shared");
  });

  it("mode fallback quand la clé Maps n'est pas configurée", async () => {
    const res = await call(configModule.onRequestGet, req(), env({ GOOGLE_MAPS_JS_KEY: "" }));
    expect(((await res.json()) as { mode: string }).mode).toBe("fallback");
  });

  it("orsKey absente de la réponse si non configurée", async () => {
    const res = await call(configModule.onRequestGet, req(), env({ ORS_KEY: undefined }));
    expect(await res.json()).not.toHaveProperty("orsKey");
  });
});

// ─── /api/webhook ─────────────────────────────────────────────────────────────

describe("POST /api/webhook", () => {
  const SECRET = "secret-de-test";
  const env = (kv = fakeKv(), secret: string | undefined = SECRET) => ({
    TERRITORY_CONFIG: kv,
    WEBHOOK_SECRET: secret,
  });
  const post = (body: string, auth: string | null = `Bearer ${SECRET}`) =>
    new Request("https://territory.paddaone.com/api/webhook", {
      method: "POST",
      headers: auth === null ? {} : { Authorization: auth },
      body,
    });

  it("n'exporte que POST : les autres méthodes sont refusées (405) par Pages", () => {
    expect(Object.keys(webhookModule)).toEqual(["onRequestPost"]);
  });

  describe("authentification", () => {
    it.each([
      ["sans en-tête Authorization", null],
      ["schéma différent", `Basic ${SECRET}`],
      ["secret faux de même longueur", "Bearer secret-de-tesT"],
      ["secret tronqué", "Bearer secret-de-tes"],
      ["secret allongé", `Bearer ${SECRET}x`],
    ])("401 — %s", async (_label, auth) => {
      const kv = fakeKv();
      const res = await call(webhookModule.onRequestPost, post("{}", auth), env(kv));
      expect(res.status).toBe(401);
      expect(kv.put).not.toHaveBeenCalled();
    });

    it("401 si WEBHOOK_SECRET n'est pas configuré, même avec « Bearer  »", async () => {
      const res = await call(webhookModule.onRequestPost, post("{}", "Bearer "), env(fakeKv(), ""));
      expect(res.status).toBe(401);
    });
  });

  it("400 sur JSON invalide", async () => {
    const kv = fakeKv();
    const res = await call(webhookModule.onRequestPost, post("{pas du json"), env(kv));
    expect(res.status).toBe(400);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("corps JSON `null` : réponse maîtrisée, pas d'exception", async () => {
    const res = await call(webhookModule.onRequestPost, post("null"), env());
    expect([200, 400]).toContain(res.status);
  });

  it("reset manuel : remet fallback_mode à \"false\"", async () => {
    const kv = fakeKv({ fallback_mode: "true" });
    const res = await call(webhookModule.onRequestPost, post('{"reset":true}'), env(kv));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Reset OK");
    expect(kv.store.get("fallback_mode")).toBe("false");
  });

  it("reset non booléen (\"true\" chaîne) n'est pas un reset", async () => {
    const kv = fakeKv({ fallback_mode: "true" });
    await call(webhookModule.onRequestPost, post('{"reset":"true"}'), env(kv));
    expect(kv.store.get("fallback_mode")).toBe("true");
  });

  it.each([
    ["exactement 80 %", { costIntervalStart: { units: 160 }, budgetAmount: { units: 200 } }, true],
    ["au-delà, unités en chaîne", { costIntervalStart: { units: "190" }, budgetAmount: { units: "200" } }, true],
    ["juste sous 80 %", { costIntervalStart: { units: 159 }, budgetAmount: { units: 200 } }, false],
    ["costAmount en repli de costIntervalStart", { costAmount: { units: 80 }, budgetAmount: { units: 100 } }, true],
    ["budget par défaut 200", { costAmount: { units: 160 } }, true],
    ["budget par défaut 200, sous le seuil", { costAmount: { units: 150 } }, false],
    ["budget nul", { costAmount: { units: 10 }, budgetAmount: { units: 0 } }, false],
    ["coût non numérique", { costAmount: { units: "abc" }, budgetAmount: { units: 100 } }, false],
    ["corps vide", {}, false],
  ])("seuil de bascule — %s", async (_label, payload, expectFallback) => {
    const kv = fakeKv();
    const res = await call(webhookModule.onRequestPost, post(JSON.stringify(payload)), env(kv));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(kv.store.get("fallback_mode")).toBe(expectFallback ? "true" : undefined);
  });

  it("n'effectue aucun appel réseau sortant", async () => {
    await call(webhookModule.onRequestPost, post('{"costAmount":{"units":999}}'), env());
    expect(fetch).not.toHaveBeenCalled();
  });
});
