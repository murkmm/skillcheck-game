// functions/api/dashboard-data.js
// Cloudflare Pages Function — server-side proxy, no CORS issues
// Profiles table has: user_id, is_premium, display_name, public_stats (no created_at)

export async function onRequest(context) {
  const { env } = context;

  const SUPABASE_URL = 'https://sneidksdbqzptlecezma.supabase.co';
  const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || 'sb_publishable_mdU6mAWsRF5arvFCLnu98A_OMaVHFGA';
  const SW_GAME_ID = 'RetroRecall';
  const SW_API_KEY = 'FVEdSbSGe9S6Z1sZ2xKB4rhS47RlFAN2sfR8Rpj0';
  const SW_BASE = 'https://api.silentwolf.com';

  const now = new Date();
  const todayUTC =
    now.getUTCFullYear() +
    '-' +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getUTCDate()).padStart(2, '0');

  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    Accept: 'application/json',
  };

  async function sbFetch(path) {
    const r = await fetch(SUPABASE_URL + path, { headers: sbHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('Supabase ' + r.status + ': ' + text.slice(0, 300));
    }
    return r.json();
  }

  async function swFetch(board, numScores) {
    const url =
      SW_BASE +
      '/get_scores/' +
      SW_GAME_ID +
      '/' +
      board +
      '?api_key=' +
      SW_API_KEY +
      '&num_scores=' +
      (numScores || 10);
    const r = await fetch(url);
    if (!r.ok) throw new Error('SW ' + r.status + ' ' + board);
    return r.json();
  }

  const results = await Promise.allSettled([
    sbFetch('/rest/v1/profiles?select=user_id,display_name,is_premium,public_stats&limit=1000'),
    swFetch('daily_' + todayUTC, 50),
    swFetch('all_time', 10),
  ]);

  // Supabase
  let totalAccounts = 0,
    namedPlayers = 0,
    premiumSubs = 0;
  let recentNamed = [];
  let topScores = [];
  let supabaseOk = false;

  if (results[0].status === 'fulfilled') {
    const profiles = results[0].value;
    supabaseOk = true;
    totalAccounts = profiles.length;
    namedPlayers = profiles.filter((p) => p.display_name && p.display_name.trim() !== '').length;
    premiumSubs = profiles.filter((p) => p.is_premium).length;

    recentNamed = profiles
      .filter((p) => p.display_name && p.display_name.trim() !== '')
      .slice(0, 10)
      .map((p) => ({
        display_name: p.display_name,
        is_premium: p.is_premium || false,
        best_score: p.public_stats ? p.public_stats.best_score || p.public_stats.high_score || null : null,
        streak: p.public_stats ? p.public_stats.streak || p.public_stats.daily_streak || null : null,
      }));

    topScores = profiles
      .filter((p) => p.display_name && p.public_stats && (p.public_stats.best_score || p.public_stats.high_score))
      .map((p) => ({
        name: p.display_name,
        score: p.public_stats.best_score || p.public_stats.high_score || 0,
        is_premium: p.is_premium || false,
        streak: p.public_stats.streak || p.public_stats.daily_streak || 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  // SilentWolf
  let dailyScores = [],
    alltimeScores = [];
  let swOk = false;

  if (results[1].status === 'fulfilled') {
    const d = results[1].value;
    dailyScores = d.scores || d.high_scores || [];
    swOk = true;
  }
  if (results[2].status === 'fulfilled') {
    const d = results[2].value;
    alltimeScores = d.scores || d.high_scores || [];
    swOk = true;
  }

  const errors = results
    .map((r, i) => (r.status === 'rejected' ? { index: i, reason: r.reason?.message || String(r.reason) } : null))
    .filter(Boolean);

  const payload = {
    ok: true,
    fetched_at: now.toISOString(),
    today: todayUTC,
    supabase: {
      ok: supabaseOk,
      total_accounts: totalAccounts,
      named_players: namedPlayers,
      premium_subs: premiumSubs,
      recent_named: recentNamed,
      top_scores_from_profiles: topScores,
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
      'Access-Control-Allow-Origin': 'https://skillcheckgame.com',
      'Cache-Control': 'no-store',
    },
  });
}
