// functions/api/dashboard-data.js
// Cloudflare Pages Function — server-side proxy

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
  };

  async function sbFetch(path) {
    const r = await fetch(SUPABASE_URL + path, { headers: sbHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('Supabase ' + r.status + ': ' + text.slice(0, 300));
    }
    return r.json();
  }

  // Fetch profiles and saves in parallel
  const [profilesResult, savesResult] = await Promise.allSettled([
    sbFetch('/rest/v1/profiles?select=user_id,display_name,is_premium,public_stats&limit=1000'),
    sbFetch('/rest/v1/player_saves?select=user_id,save_data&limit=1000'),
  ]);

  // ── Profiles map ──────────────────────────────────────────────────────────
  let totalAccounts = 0,
    namedPlayers = 0,
    premiumSubs = 0;
  let supabaseOk = false;
  const profileMap = {}; // user_id -> {display_name, is_premium, public_stats}

  if (profilesResult.status === 'fulfilled') {
    const profiles = profilesResult.value;
    supabaseOk = true;
    totalAccounts = profiles.length;
    for (const p of profiles) {
      if (p.display_name && p.display_name.trim() !== '') {
        namedPlayers++;
        profileMap[p.user_id] = p;
      }
      if (p.is_premium) premiumSubs++;
    }
  }

  // ── Build leaderboards from save data ─────────────────────────────────────
  let dailyScores = [];
  let alltimeScores = [];
  let todayTheme = '';
  let lbOk = false;
  let totalRunsToday = 0;
  let totalRunsAllTime = 0;

  if (savesResult.status === 'fulfilled') {
    const saves = savesResult.value;
    lbOk = true;

    const todayEntries = [];
    const allTimeMap = {}; // display_name -> {score, days, is_premium}

    for (const save of saves) {
      const profile = profileMap[save.user_id];
      const name = profile ? profile.display_name : null;
      if (!name) continue; // skip unnamed players

      const history = save.save_data && typeof save.save_data === 'object' ? save.save_data.history || {} : {};
      const isPrem = profile.is_premium || false;

      let bestScore = 0;
      let daysPlayed = Object.keys(history).length;
      totalRunsAllTime += daysPlayed;

      for (const [date, entry] of Object.entries(history)) {
        const s = parseFloat(entry.score || 0);
        if (s > bestScore) bestScore = s;

        // Today's entry
        if (date === todayUTC && s > 0) {
          totalRunsToday++;
          todayEntries.push({
            player_name: name,
            score: s,
            theme: entry.theme || '',
            victory: entry.victory === true || entry.victory === 'true',
            is_premium: isPrem,
          });
          if (!todayTheme && entry.theme) todayTheme = entry.theme;
        }
      }

      if (bestScore > 0) {
        // Keep only best entry per player
        if (!allTimeMap[name] || bestScore > allTimeMap[name].score) {
          allTimeMap[name] = { player_name: name, score: bestScore, days_played: daysPlayed, is_premium: isPrem };
        }
      }
    }

    dailyScores = todayEntries.sort((a, b) => b.score - a.score).slice(0, 10);
    alltimeScores = Object.values(allTimeMap)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  // ── Named players list with best scores ───────────────────────────────────
  // Build from saves data for accuracy
  const namedList = [];
  if (savesResult.status === 'fulfilled') {
    const saves = savesResult.value;
    for (const save of saves) {
      const profile = profileMap[save.user_id];
      if (!profile) continue;
      const history = save.save_data && typeof save.save_data === 'object' ? save.save_data.history || {} : {};
      let bestScore = 0;
      let bestTheme = '';
      let daysPlayed = 0;
      let victories = 0;
      for (const [, entry] of Object.entries(history)) {
        const s = parseFloat(entry.score || 0);
        daysPlayed++;
        if (s > bestScore) {
          bestScore = s;
          bestTheme = entry.theme || '';
        }
        if (entry.victory === true || entry.victory === 'true') victories++;
      }
      namedList.push({
        display_name: profile.display_name,
        is_premium: profile.is_premium || false,
        best_score: bestScore > 0 ? bestScore : null,
        best_theme: bestTheme,
        days_played: daysPlayed,
        victories: victories,
        streak: profile.public_stats
          ? profile.public_stats.streak ||
            profile.public_stats.daily_streak ||
            profile.public_stats.current_streak ||
            null
          : null,
      });
    }
    namedList.sort((a, b) => (b.best_score || 0) - (a.best_score || 0));
  }

  const errors = [profilesResult, savesResult]
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
      named_list: namedList.slice(0, 20),
    },
    leaderboards: {
      ok: lbOk,
      daily: {
        board: 'daily_' + todayUTC,
        theme: todayTheme,
        count: dailyScores.length,
        total_runs: totalRunsToday,
        scores: dailyScores,
      },
      alltime: {
        count: alltimeScores.length,
        total_runs: totalRunsAllTime,
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
