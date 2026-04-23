// functions/api/dashboard-data.js
// Cloudflare Pages Function — server-side proxy
// Builds leaderboards directly from player_saves history data

export async function onRequest(context) {
  const { env } = context;

  const SUPABASE_URL = 'https://sneidksdbqzptlecezma.supabase.co';
  const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || 'sb_publishable_mdU6mAWsRF5arvFCLnu98A_OMaVHFGA';

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
    'Content-Type': 'application/json',
  };

  async function sbFetch(path) {
    const r = await fetch(SUPABASE_URL + path, { headers: sbHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('Supabase ' + r.status + ': ' + text.slice(0, 300));
    }
    return r.json();
  }

  async function sbRpc(fnName, params) {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify(params),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('RPC ' + fnName + ' ' + r.status + ': ' + text.slice(0, 300));
    }
    return r.json();
  }

  // Today's leaderboard query — join saves history with profiles for display names
  const todayQuery = `
    SELECT
      p.display_name,
      p.is_premium,
      (h.value->>'score')::numeric AS score,
      h.value->>'theme' AS theme,
      (h.value->>'victory')::boolean AS victory
    FROM player_saves ps
    JOIN profiles p ON p.user_id = ps.user_id
    , jsonb_each(ps.save_data->'history') AS h(key, value)
    WHERE h.key = '${todayUTC}'
      AND p.display_name IS NOT NULL
      AND p.display_name != ''
    ORDER BY score DESC
    LIMIT 50
  `.trim();

  // All-time best: highest score per player across all history entries
  const allTimeQuery = `
    SELECT
      p.display_name,
      p.is_premium,
      MAX((h.value->>'score')::numeric) AS score,
      COUNT(DISTINCT h.key) AS days_played
    FROM player_saves ps
    JOIN profiles p ON p.user_id = ps.user_id
    , jsonb_each(ps.save_data->'history') AS h(key, value)
    WHERE p.display_name IS NOT NULL
      AND p.display_name != ''
    GROUP BY p.display_name, p.is_premium
    ORDER BY score DESC
    LIMIT 20
  `.trim();

  const results = await Promise.allSettled([
    // 0: profiles
    sbFetch('/rest/v1/profiles?select=user_id,display_name,is_premium,public_stats&limit=1000'),
    // 1: today's leaderboard via raw query
    fetch(SUPABASE_URL + '/rest/v1/rpc/execute_sql', {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({ query: todayQuery }),
    }).then(() => null), // fallback — RPC may not exist, use direct query approach below
  ]);

  // ── Profiles ──────────────────────────────────────────────────────────────
  let totalAccounts = 0,
    namedPlayers = 0,
    premiumSubs = 0;
  let recentNamed = [];
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
  }

  // ── Today's leaderboard — query saves directly ────────────────────────────
  let dailyScores = [];
  let alltimeScores = [];
  let todayTheme = '';
  let lbOk = false;

  try {
    const dailyR = await fetch(
      SUPABASE_URL + '/rest/v1/player_saves?select=user_id,save_data,profiles(display_name,is_premium)&limit=1000',
      { headers: sbHeaders }
    );
    if (dailyR.ok) {
      const saves = await dailyR.json();

      // Extract today's entry per player
      const todayEntries = [];
      const allEntries = [];

      for (const save of saves) {
        const profile = save.profiles;
        const name = profile && profile.display_name ? profile.display_name : null;
        if (!name) continue;

        const history = save.save_data && save.save_data.history ? save.save_data.history : {};
        const isPrem = profile.is_premium || false;

        // Today's score
        if (history[todayUTC]) {
          const entry = history[todayUTC];
          const score = parseFloat(entry.score || 0);
          if (score > 0) {
            todayEntries.push({
              player_name: name,
              score: score,
              theme: entry.theme || '',
              victory: entry.victory || false,
              is_premium: isPrem,
            });
            if (!todayTheme && entry.theme) todayTheme = entry.theme;
          }
        }

        // All-time best score across all dates
        let bestScore = 0;
        let daysPlayed = 0;
        for (const [date, entry] of Object.entries(history)) {
          const s = parseFloat(entry.score || 0);
          if (s > bestScore) bestScore = s;
          daysPlayed++;
        }
        if (bestScore > 0) {
          allEntries.push({
            player_name: name,
            score: bestScore,
            days_played: daysPlayed,
            is_premium: isPrem,
          });
        }
      }

      dailyScores = todayEntries.sort((a, b) => b.score - a.score).slice(0, 10);
      alltimeScores = allEntries.sort((a, b) => b.score - a.score).slice(0, 10);
      lbOk = true;
    }
  } catch (e) {
    console.error('Leaderboard build error:', e);
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
    },
    leaderboards: {
      ok: lbOk,
      daily: {
        board: 'daily_' + todayUTC,
        theme: todayTheme,
        count: dailyScores.length,
        scores: dailyScores,
      },
      alltime: {
        count: alltimeScores.length,
        scores: alltimeScores,
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
