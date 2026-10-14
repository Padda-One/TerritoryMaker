import { describe, it, expect, vi, beforeEach } from "vitest";

// Le handler est typé pour le runtime Workers (functions/tsconfig.json) ; le
// tsconfig racine, qui couvre tests/, n'a pas ces types. L'import par chemin
// non littéral empêche tsc racine de suivre le module, sans rien changer au
// code. Même motif que tests/api.test.ts.
const PROXY_PATH: string = "../functions/s8b6hda/[[path]].ts";
const proxyModule = (await import(PROXY_PATH)) as { onRequest: unknown };

const ORIGIN = "https://territory.paddaone.com";
const PREFIX = `${ORIGIN}/s8b6hda`;
const SCRIPT_ID = "pa-p7huMaOQrDMbyp4tYZAoG.js";
const UPSTREAM_SCRIPT = `https://analytics.paddaone.com/js/${SCRIPT_ID}`;
const UPSTREAM_EVENT = "https://analytics.paddaone.com/api/event";
const CACHE_DIRECTIVE_24H = "public, max-age=86400, must-revalidate";

// ─── Doubles ──────────────────────────────────────────────────────────────────

/** caches.default en mémoire : seuls match/put sont utilisés par le proxy. */
function fakeCache() {
  const store = new Map<string, Response>();
  return {
    store,
    match: vi.fn(async (key: Request) => store.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, res: Response) => {
      store.set(key.url, res.clone());
    }),
  };
}

let cache: ReturnType<typeof fakeCache>;

beforeEach(() => {
  cache = fakeCache();
  vi.stubGlobal("caches", { default: cache });
  // Aucun appel sortant réel : chaque test pose son propre comportement.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("fetch non mocké dans ce test");
    }),
  );
});

type Handler = (ctx: unknown) => Promise<Response>;

/** Appelle le handler et capture les promesses passées à waitUntil. */
function call(request: Request) {
  const pending: Promise<unknown>[] = [];
  const response = (proxyModule.onRequest as Handler)({
    request,
    params: {},
    env: {},
    waitUntil: (p: Promise<unknown>) => pending.push(Promise.resolve(p)),
  });
  return { response, flush: () => Promise.all(pending) };
}

// ─── GET …/js/script.js ───────────────────────────────────────────────────────

describe("GET …/js/script.js", () => {
  const upstreamOk = (headers: Record<string, string> = {}) =>
    vi.mocked(fetch).mockResolvedValue(
      new Response("contenu-du-script", { status: 200, headers }),
    );

  it("relaye vers l'URL amont du script et impose un cache-control de 24 h", async () => {
    upstreamOk();
    const { response, flush } = call(new Request(`${PREFIX}/js/script.js`));
    const res = await response;
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(UPSTREAM_SCRIPT);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE_DIRECTIVE_24H);
    expect(await res.text()).toBe("contenu-du-script");
  });

  it("recopie le content-type amont", async () => {
    upstreamOk({ "content-type": "text/javascript; charset=utf-8" });
    const { response } = call(new Request(`${PREFIX}/js/script.js`));
    expect((await response).headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
  });

  it("replie sur application/javascript si l'amont n'en fournit pas", async () => {
    // undici pose text/plain sur tout corps chaîne : il faut le retirer pour
    // simuler un amont réellement dépourvu de content-type.
    const upstream = new Response("contenu-du-script", { status: 200 });
    upstream.headers.delete("content-type");
    vi.mocked(fetch).mockResolvedValue(upstream);
    const { response } = call(new Request(`${PREFIX}/js/script.js`));
    expect((await response).headers.get("content-type")).toBe(
      "application/javascript",
    );
  });

  it("met en cache via waitUntil sous une clé portant v=<identifiant du script>", async () => {
    upstreamOk();
    const { response, flush } = call(new Request(`${PREFIX}/js/script.js?x=1`));
    await response;
    await flush();

    expect(cache.put).toHaveBeenCalledTimes(1);
    const key = vi.mocked(cache.put).mock.calls[0][0];
    const keyUrl = new URL(key.url);
    expect(keyUrl.origin + keyUrl.pathname).toBe(`${PREFIX}/js/script.js`);
    expect(keyUrl.searchParams.get("v")).toBe(SCRIPT_ID);
    expect(key.method).toBe("GET");
  });

  it("second appel servi par le cache, sans nouvel appel amont", async () => {
    upstreamOk({ "content-type": "text/javascript" });
    const first = call(new Request(`${PREFIX}/js/script.js`));
    await first.response;
    await first.flush();

    const second = call(new Request(`${PREFIX}/js/script.js`));
    const res = await second.response;
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE_DIRECTIVE_24H);
    expect(await res.text()).toBe("contenu-du-script");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
  });

  it.fails(
    "défaut connu : une erreur amont ne doit ni être cachée ni porter max-age=86400",
    async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response("upstream indisponible", { status: 503 }),
      );
      const { response, flush } = call(new Request(`${PREFIX}/js/script.js`));
      const res = await response;
      await flush();

      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).not.toBe(CACHE_DIRECTIVE_24H);
      expect(cache.put).not.toHaveBeenCalled();
    },
  );
});

// ─── POST …/api/event ─────────────────────────────────────────────────────────

describe("POST …/api/event", () => {
  it("relaye vers /api/event de l'hôte Plausible : cookie retiré, autres en-têtes et corps conservés", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    const body = '{"name":"pageview","url":"https://territory.paddaone.com/"}';
    const { response } = call(
      new Request(`${PREFIX}/api/event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=secrete",
          "x-forwarded-for": "203.0.113.7",
        },
        body,
      }),
    );
    const res = await response;

    expect(res.status).toBe(202);
    expect(fetch).toHaveBeenCalledTimes(1);
    const forwarded = vi.mocked(fetch).mock.calls[0][0] as Request;
    expect(forwarded.method).toBe("POST");
    expect(forwarded.url).toBe(UPSTREAM_EVENT);
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(forwarded.headers.get("content-type")).toBe("application/json");
    expect(forwarded.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(await forwarded.text()).toBe(body);
  });
});

// ─── Tout le reste → 404 ──────────────────────────────────────────────────────

describe("404", () => {
  it.each([
    ["GET", `${PREFIX}/api/event`],
    ["POST", `${PREFIX}/js/script.js`],
    ["GET", `${PREFIX}/chemin/inconnu`],
    ["GET", `${PREFIX}/js/script.js/suffixe`],
  ])("%s %s → 404, sans appel amont", async (method, url) => {
    const { response } = call(new Request(url, { method }));
    expect((await response).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(cache.match).not.toHaveBeenCalled();
  });
});
