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
const ALLOWED_ORIGIN = "https://territory.paddaone.com";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Vary": "Origin",
  };

  // Block requests from other browser origins
  if (origin !== null && origin !== ALLOWED_ORIGIN) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const fallback = (await env.TERRITORY_CONFIG.get("fallback_mode")) === "true";

  if (fallback || !env.GOOGLE_MAPS_JS_KEY) {
    return Response.json({ mode: "fallback" }, { headers: corsHeaders });
  }

  return Response.json(
    { mode: "shared", mapsJsKey: env.GOOGLE_MAPS_JS_KEY },
    { headers: corsHeaders },
  );
};
