// functions/api/polar-webhook.ts
// Cloudflare Pages Function — receives Polar webhooks and flips is_premium=true in Supabase
import { Webhook } from 'standardwebhooks';

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

  console.log('🔵 Webhook handler invoked');

  // 1. Read the raw body
  const rawBody = await request.text();
  console.log('📦 Raw body length:', rawBody.length);

  // 2. Build the headers object the library expects
  const headers: Record<string, string> = {
    'webhook-id': request.headers.get('webhook-id') || '',
    'webhook-timestamp': request.headers.get('webhook-timestamp') || '',
    'webhook-signature': request.headers.get('webhook-signature') || '',
  };

  console.log('📋 Headers:', JSON.stringify(headers));

  if (!headers['webhook-id'] || !headers['webhook-timestamp'] || !headers['webhook-signature']) {
    console.error('❌ Missing webhook headers');
    return new Response('Missing webhook headers', { status: 400 });
  }

  // 3. Check secret format
  const secretRaw = env.POLAR_WEBHOOK_SECRET;
  console.log('🔑 Secret length:', secretRaw?.length, '| Starts with:', secretRaw?.substring(0, 12));

  // Try multiple secret formats to figure out which Polar expects
  const secretStripped = secretRaw.replace('polar_whs_', '').replace('whsec_', '');
  console.log('🔑 Stripped secret length:', secretStripped.length);

  // 4. Verify with the Standard Webhooks library
  let event: PolarWebhookEvent;

  // Try with stripped secret first
  try {
    console.log('🔍 Attempt 1: Verifying with STRIPPED secret...');
    const wh = new Webhook(secretStripped);
    event = wh.verify(rawBody, headers) as PolarWebhookEvent;
    console.log('✅ Signature verified with stripped secret!');
  } catch (err1) {
    console.log('⚠️ Stripped secret failed:', (err1 as Error).message);

    // Try with raw secret as fallback
    try {
      console.log('🔍 Attempt 2: Verifying with RAW secret (including prefix)...');
      const wh = new Webhook(secretRaw);
      event = wh.verify(rawBody, headers) as PolarWebhookEvent;
      console.log('✅ Signature verified with raw secret!');
    } catch (err2) {
      console.error('❌ Both verification attempts failed');
      console.error('Error 1:', (err1 as Error).message);
      console.error('Error 2:', (err2 as Error).message);
      return new Response('Invalid signature', { status: 401 });
    }
  }

  console.log('✅ Polar webhook received:', event.type);

  // 5. Only act on order.paid events
  if (event.type !== 'order.paid') {
    console.log('ℹ️ Event ignored (not order.paid):', event.type);
    return new Response('Event ignored', { status: 200 });
  }

  // 6. Extract user_id from metadata
  const order = event.data;
  const userId = order?.metadata?.user_id;

  if (!userId) {
    console.error('❌ No user_id in order metadata. Order:', JSON.stringify(order));
    return new Response('Missing user_id metadata', { status: 400 });
  }

  // 7. Update Supabase
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
