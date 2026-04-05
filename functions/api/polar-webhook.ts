// functions/api/polar-webhook.ts
// Cloudflare Pages Function — receives Polar webhooks and flips is_premium=true in Supabase
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';

interface Env {
  POLAR_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface EventContext<E> {
  request: Request;
  env: E;
}

export async function onRequestPost(context: EventContext<Env>): Promise<Response> {
  const { request, env } = context;

  console.log('🔵 Webhook handler invoked');

  // 1. Read the raw body
  const rawBody = await request.text();

  // 2. Convert Cloudflare Headers to a plain object for the SDK
  const headersObj: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  // 3. Let Polar's SDK handle signature verification
  let event;
  try {
    event = validateEvent(rawBody, headersObj, env.POLAR_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.error('❌ Signature verification failed:', err.message);
      return new Response('Invalid signature', { status: 401 });
    }
    console.error('❌ Unexpected verification error:', err);
    return new Response('Verification error', { status: 500 });
  }

  console.log('✅ Polar webhook received:', event.type);

  // 4. Only act on order.paid events
  if (event.type !== 'order.paid') {
    console.log('ℹ️ Event ignored (not order.paid):', event.type);
    return new Response('Event ignored', { status: 200 });
  }

  // 5. Extract user_id from metadata (typed by Polar's SDK)
  const order = event.data;
  const metadata = (order.metadata as Record<string, string>) || {};
  const userId = metadata.user_id;

  if (!userId) {
    console.error('❌ No user_id in order metadata. Metadata was:', JSON.stringify(metadata));
    return new Response('Missing user_id metadata', { status: 400 });
  }

  // 6. Update Supabase — flip is_premium to true
  const supabaseResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ is_premium: true }),
  });

  if (!supabaseResponse.ok) {
    const errorText = await supabaseResponse.text();
    console.error('❌ Supabase update failed:', supabaseResponse.status, errorText);
    return new Response('Database update failed', { status: 500 });
  }

  console.log(`✅ Premium unlocked for user ${userId}`);
  return new Response('OK', { status: 200 });
}

export async function onRequestGet(): Promise<Response> {
  return new Response('Polar webhook endpoint is live. POST only.', { status: 405 });
}
