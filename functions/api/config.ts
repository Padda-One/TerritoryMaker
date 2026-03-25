interface Env {
  TERRITORY_CONFIG: KVNamespace;
  GOOGLE_MAPS_JS_KEY: string;
}

/**
 * GET /api/config
 *
 * Returns the current operating mode for the client:
 * - { mode: "shared", mapsJsKey: "AIza..." } → use the shared key directly
 * - { mode: "fallback" }                     → user must supply their own key
 *
 * The `fallback_mode` flag in KV is set to "true" by the /api/webhook endpoint
 * when the Google Maps billing budget alert fires at 80% threshold.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const fallback = (await env.TERRITORY_CONFIG.get("fallback_mode")) === "true";

  if (fallback || !env.GOOGLE_MAPS_JS_KEY) {
    return Response.json({ mode: "fallback" });
  }

  return Response.json({ mode: "shared", mapsJsKey: env.GOOGLE_MAPS_JS_KEY });
};
