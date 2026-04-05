// functions/api/polar-webhook.ts
// Cloudflare Pages Function — receives Polar webhooks and flips is_premium=true in Supabase

interface Env {
  POLAR_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface EventContext<E> {
  request: Request;
  env: E;
}

interface PolarOrder {
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

interface PolarWebhookEvent {
  type: string;
  data: PolarOrder;
}

export async function onRequestPost(context: EventContext<Env>): Promise<Response> {
  const { request, env } = context;

  // 1. Read the raw body (must be raw for signature verification)
  const rawBody = await request.text();

  // 2. Extract Polar's three webhook headers (Standard Webhooks spec)
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.error("❌ Missing webhook headers");
    return new Response("Missing webhook headers", { status: 400 });
  }

  // 3. Verify the signature
  const isValid = await verifyPolarSignature(
    env.POLAR_WEBHOOK_SECRET,
    webhookId,
    webhookTimestamp,
    rawBody,
    webhookSignature
  );

  if (!isValid) {
    console.error("❌ Invalid webhook signature");
    return new Response("Invalid signature", { status: 401 });
  }

  // 4. Parse the event JSON
  let event: PolarWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error("❌ Invalid JSON body");
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log("✅ Polar webhook received:", event.type);

  // 5. Only act on order.paid events — ignore everything else
  if (event.type !== "order.paid") {
    console.log("ℹ️ Event ignored (not order.paid):", event.type);
    return new Response("Event ignored", { status: 200 });
  }

  // 6. Extract user_id from the order's metadata
  const order = event.data;
  const userId = order?.metadata?.user_id;

  if (!userId) {
    console.error("❌ No user_id in order metadata. Order:", JSON.stringify(order));
    return new Response("Missing user_id metadata", { status: 400 });
  }

  // 7. Update Supabase — flip is_premium to true for this user
  const supabaseResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
    {
      method: "PATCH",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ is_premium: true }),
    }
  );

  if (!supabaseResponse.ok) {
    const errorText = await supabaseResponse.text();
    console.error("❌ Supabase update failed:", supabaseResponse.status, errorText);
    return new Response("Database update failed", { status: 500 });
  }

  console.log(`✅ Premium unlocked for user ${userId}`);
  return new Response("OK", { status: 200 });
}

// --- Signature verification (Standard Webhooks / Svix-compatible HMAC-SHA256) ---
async function verifyPolarSignature(
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
  body: string,
  signatureHeader: string
): Promise<boolean> {
  // The secret comes as "whsec_<base64>". Strip prefix and base64-decode.
  const secretBytes = Uint8Array.from(
    atob(secret.replace("whsec_", "")),
    (c) => c.charCodeAt(0)
  );

  // The signed payload format: webhook-id.webhook-timestamp.body
  const signedPayload = `${webhookId}.${webhookTimestamp}.${body}`;

  // Compute HMAC-SHA256
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );

  // Base64-encode the computed signature
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(signature)));

  // Header format: "v1,XXXXX v1,YYYYY" (space-separated, may have multiple versions)
  const receivedSigs = signatureHeader.split(" ");
  for (const sig of receivedSigs) {
    const [version, value] = sig.split(",");
    if (version === "v1" && value === expectedSig) {
      return true;
    }
  }
  return false;
}

// Handle GET requests (for sanity-checking the endpoint is deployed)
export async function onRequestGet(): Promise<Response> {
  return new Response("Polar webhook endpoint is live. POST only.", { status: 405 });
}