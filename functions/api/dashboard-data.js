// functions/api/dashboard-data.js
// Cloudflare Pages Function — runs server-side, no CORS issues

export async function onRequest(context) {
  const { env } = context;

  // Keys — SUPABASE_SERVICE_KEY set in Cloudflare Pages env vars
  const SUPABASE_URL = 'https://sneidksdbqzptlecezma.supabase.co';
  const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || 'sb_publishable_mdU6mAWsRF5arvFCLnu98A_OMaVHFGA';
  const SW_GAME_ID = 'RetroRecall';
  const SW_API_KEY = 'FVEdSbSGe9S6Z1sZ2xKB4rhS47RlFAN2sfR8Rpj0';
  const SW_BASE = 'https://api.silentwolf.com';

  // Today's date in UTC
  const now = new Date();
  const todayUTC =
    now.getUTCFullYear() +
    '-' +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getUTCDate()).padStart(2, '0');

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoISO = weekAgo.toISOString().split('.')[0] + 'Z';
  const todayISO = todayUTC + 'T00:00:00Z';

  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    Accept: 'application/json',
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function sbFetch(path) {
    const r = await fetch(SUPABASE_URL + path, { headers: sbHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('Supabase ' + r.status + ': ' + text.slice(0, 200));
    }
    return r.json();
  }

  async function swFetch(board, numScores) {
    const url = `${SW_BASE}/get_scores/${SW_GAME_ID}/${board}?api_key=${SW_API_KEY}&num_scores=${numScores || 10}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('SW ' + r.status + ' ' + board);
    return r.json();
  }

  // ── Fetch everything in parallel ───────────────────────────────────────────
  const results = await Promise.allSettled([
    // 0: all profiles (capped at 1000 — adjust if you ever exceed this)
    sbFetch('/rest/v1/profiles?select=user_id,display_name,is_premium,created_at&order=created_at.desc&limit=1000'),
    // 1: new today
    sbFetch('/rest/v1/profiles?select=user_id&created_at=gte.' + todayISO),
    // 2: new this week
    sbFetch('/rest/v1/profiles?select=user_id&created_at=gte.' + weekAgoISO),
    // 3: today's leaderboard
    swFetch('daily_' + todayUTC, 50),
    // 4: all-time leaderboard
    swFetch('all_time', 10),
  ]);

  // ── Process Supabase results ───────────────────────────────────────────────
  let totalAccounts = 0,
    namedPlayers = 0,
    premiumSubs = 0;
  let newToday = 0,
    newWeek = 0;
  let recentSignups = [];
  let supabaseOk = false;

  if (results[0].status === 'fulfilled') {
    const profiles = results[0].value;
    supabaseOk = true;
    totalAccounts = profiles.length;
    namedPlayers = profiles.filter((p) => p.display_name && p.display_name.trim() !== '').length;
    premiumSubs = profiles.filter((p) => p.is_premium).length;

    // Recent signups: last 10 with a display name
    recentSignups = profiles
      .filter((p) => p.display_name && p.display_name.trim() !== '')
      .slice(0, 10)
      .map((p) => ({
        display_name: p.display_name,
        created_at: p.created_at || null,
        is_premium: p.is_premium || false,
      }));
  }

  if (results[1].status === 'fulfilled') {
    newToday = Array.isArray(results[1].value) ? results[1].value.length : 0;
  }
  if (results[2].status === 'fulfilled') {
    newWeek = Array.isArray(results[2].value) ? results[2].value.length : 0;
  }

  // ── Process SilentWolf results ─────────────────────────────────────────────
  let dailyScores = [],
    alltimeScores = [];
  let swOk = false;

  if (results[3].status === 'fulfilled') {
    const d = results[3].value;
    dailyScores = d.scores || d.high_scores || [];
    swOk = true;
  }
  if (results[4].status === 'fulfilled') {
    const d = results[4].value;
    alltimeScores = d.scores || d.high_scores || [];
    swOk = true;
  }

  // ── Collect errors for debugging ──────────────────────────────────────────
  const errors = results
    .map((r, i) => (r.status === 'rejected' ? { index: i, reason: r.reason?.message || String(r.reason) } : null))
    .filter(Boolean);

  // ── Return JSON ───────────────────────────────────────────────────────────
  const payload = {
    ok: true,
    fetched_at: now.toISOString(),
    today: todayUTC,
    supabase: {
      ok: supabaseOk,
      total_accounts: totalAccounts,
      named_players: namedPlayers,
      premium_subs: premiumSubs,
      new_today: newToday,
      new_week: newWeek,
      recent_signups: recentSignups,
    },
    leaderboards: {
      ok: swOk,
      daily: {
        board: 'daily_' + todayUTC,
        count: dailyScores.length,
        scores: dailyScores.slice(0, 10),
      },
      alltime: {
        count: alltimeScores.length,
        scores: alltimeScores.slice(0, 10),
      },
    },
    errors: errors,
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      // Only allow your own domain to call this
      'Access-Control-Allow-Origin': 'https://skillcheckgame.com',
      'Cache-Control': 'no-store',
    },
  });
}
