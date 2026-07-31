const PLAUSIBLE_HOST = "https://analytics.paddaone.com";
const SCRIPT_PATH = "/js/pa-p7huMaOQrDMbyp4tYZAoG.js";

/**
 * Same-origin Plausible proxy (norme `Tech/Plausible-Proxy.md`).
 *
 * - GET  .../js/script.js  → sert le script v3 du site depuis l'instance Plausible,
 *   cache edge-friendly (clé dérivée de `SCRIPT_PATH`, TTL 24 h explicite).
 * - POST .../api/event     → forward vers `/api/event` en supprimant `cookie`.
 * - tout le reste          → 404.
 *
 * Le préfixe `s8b6hda` est une chaîne aléatoire sans sens (anti-adblock).
 */
export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  const pathname = new URL(request.url).pathname;

  if (request.method === "GET" && pathname.endsWith("/js/script.js")) {
    // La clé de cache DOIT intégrer l'identifiant du script : l'URL du proxy est
    // stable, sans ça changer `SCRIPT_PATH` n'invalide rien (edge + caches.default).
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.set("v", SCRIPT_PATH.split("/").pop()!);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (!response) {
      const upstream = await fetch(PLAUSIBLE_HOST + SCRIPT_PATH);
      // En-têtes explicites : recopier ceux de l'upstream laisse passer son
      // `max-age=31536000` (un an), qui prime sur le TTL voulu ici.
      response = new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type":
            upstream.headers.get("content-type") ?? "application/javascript",
          "cache-control": "public, max-age=86400, must-revalidate",
        },
      });
      context.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  }

  if (request.method === "POST" && pathname.endsWith("/api/event")) {
    const forwarded = new Request(PLAUSIBLE_HOST + "/api/event", request);
    forwarded.headers.delete("cookie");
    return fetch(forwarded);
  }

  return new Response(null, { status: 404 });
};
