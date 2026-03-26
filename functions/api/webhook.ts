interface Env {
  TERRITORY_CONFIG: KVNamespace;
  WEBHOOK_SECRET: string;
}

interface BudgetAlertPayload {
  costIntervalStart?: { units?: string | number };
  budgetAmount?: { units?: string | number };
  costAmount?: { units?: string | number };
}

/**
 * POST /api/webhook
 *
 * Called by a Google Cloud Function when a budget alert fires.
 * Sets `fallback_mode = "true"` in KV when cost reaches 80% of budget.
 *
 * Authenticate with: Authorization: Bearer <WEBHOOK_SECRET>
 *
 * Google Budget Alerts send Pub/Sub messages, not HTTP webhooks directly.
 * A minimal Cloud Function (Node.js) should forward the decoded message here:
 *
 *   const payload = JSON.parse(Buffer.from(pubsubMessage.data, "base64").toString());
 *   await fetch("https://territory.paddaone.com/api/webhook", {
 *     method: "POST",
 *     headers: { "Authorization": `Bearer ${process.env.WEBHOOK_SECRET}`,
 *                "Content-Type": "application/json" },
 *     body: JSON.stringify(payload),
 *   });
 *
 * To manually trigger fallback mode for testing:
 *   curl -X POST https://territory.paddaone.com/api/webhook \
 *     -H "Authorization: Bearer <secret>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"costIntervalStart":{"units":160},"budgetAmount":{"units":200}}'
 *
 * To reset fallback mode (re-enable shared key):
 *   curl -X POST https://territory.paddaone.com/api/webhook \
 *     -H "Authorization: Bearer <secret>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"reset":true}'
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = request.headers.get("Authorization");
  if (!env.WEBHOOK_SECRET || !auth) {
    return new Response("Unauthorized", { status: 401 });
  }
  const enc = new TextEncoder();
  const provided = enc.encode(auth);
  const expected = enc.encode(`Bearer ${env.WEBHOOK_SECRET}`);
  if (provided.length !== expected.length) {
    return new Response("Unauthorized", { status: 401 });
  }
  const match = crypto.subtle.timingSafeEqual(provided, expected);
  if (!match) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: BudgetAlertPayload & { reset?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Manual reset
  if (body.reset === true) {
    await env.TERRITORY_CONFIG.put("fallback_mode", "false");
    return new Response("Reset OK", { status: 200 });
  }

  const cost = Number(body.costIntervalStart?.units ?? body.costAmount?.units ?? 0);
  const budget = Number(body.budgetAmount?.units ?? 200);

  if (budget > 0 && cost / budget >= 0.8) {
    await env.TERRITORY_CONFIG.put("fallback_mode", "true");
  }

  return new Response("OK", { status: 200 });
};
