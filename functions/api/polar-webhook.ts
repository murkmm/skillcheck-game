// functions/api/polar-webhook.ts
// Cloudflare Pages Function — receives Polar webhooks and flips is_premium=true in Supabase
// Matches users by email (Polar Checkout Links don't support custom metadata)
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

interface PolarCustomer {
  email?: string;
  [key: string]: unknown;
}

interface PolarOrder {
  customer?: PolarCustomer;
  customer_email?: string;
  [key: string]: unknown;
}

interface SupabaseAuthUser {
  id: string;
  email: string;
}

interface SupabaseAuthUsersResponse {
  users: SupabaseAuthUser[];
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

  // 5. Extract customer email from the order
  const order = event.data as PolarOrder;
  const email = order.customer?.email || order.customer_email;

  if (!email) {
    console.error('❌ No customer email in order. Order keys:', Object.keys(order).join(', '));
    return new Response('Missing customer email', { status: 400 });
  }

  console.log('📧 Order email:', email);

  // 6. Look up the user_id from Supabase Auth Admin API by email.
  // The ?email= filter is unreliable across gotrue versions, so we paginate
  // through all users and match case-insensitively. This is fine for current scale.
  const targetEmail = email.toLowerCase().trim();
  let matchedUser: SupabaseAuthUser | null = null;
  let page = 1;
  const perPage = 1000; // Supabase max
  const maxPages = 20; // Safety cap: 20,000 users

  while (page <= maxPages && !matchedUser) {
    const listUrl = `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const listResponse = await fetch(listUrl, {
      method: 'GET',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error('❌ Supabase Auth list failed:', listResponse.status, errorText);
      return new Response('User lookup failed', { status: 500 });
    }

    const listData = (await listResponse.json()) as SupabaseAuthUsersResponse;
    const users = listData.users ?? [];

    if (users.length === 0) {
      // No more users to iterate
      break;
    }

    matchedUser = users.find((u) => u.email?.toLowerCase().trim() === targetEmail) ?? null;

    // Stop early if this page wasn't full (we've reached the end)
    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  if (!matchedUser) {
    console.error('❌ No Supabase user found with email:', email);
    return new Response('User not found', { status: 404 });
  }

  const userId = matchedUser.id;
  console.log('👤 Matched user_id:', userId);

  // 7. Update Supabase profiles — flip is_premium to true
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

  console.log(`✅ Premium unlocked for user ${userId} (${email})`);
  return new Response('OK', { status: 200 });
}

export async function onRequestGet(): Promise<Response> {
  return new Response('Polar webhook endpoint is live. POST only.', { status: 405 });
}
