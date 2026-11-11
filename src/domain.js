export const signed = n => n == null ? '?' : `${n > 0 ? '+' : ''}${n}`;
export const escapeHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function dayKey(time = Date.now(), zone = 'Europe/Kyiv') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function previousDay(key) {
  return new Date(Date.parse(`${key}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}
export function normalizeMatch(m, playerId) {
  const side = Object.entries(m.teams ?? {}).find(([, team]) => (team.players ?? team.roster ?? []).some(p => p.player_id === playerId))?.[0];
  return { id: m.match_id, finished: Number(m.finished_at) * 1000,
    win: side && m.results?.winner ? side === m.results.winner : null,
    score: Object.values(m.results?.score ?? {}).join(' : '),
    url: `https://www.faceit.com/en/cs2/room/${encodeURIComponent(m.match_id)}` };
}
export function matchesForDay(p, day, zone) {
  return Object.values(p.matches ?? {}).filter(m => m.finished && dayKey(m.finished, zone) === day).sort((a, b) => b.finished - a.finished);
}
// Profile snapshots represent net rating changes, never invented per-match Elo.
export function observe(p, profile, matches, now, zone) {
  const game = profile.games?.cs2;
  if (!game || !Number.isFinite(game.faceit_elo)) throw new Error('Профіль не має рейтингу CS2.');
  p.matches ??= {};
  for (const m of matches) if (m.id && m.finished) p.matches[m.id] = { ...p.matches[m.id], ...m };
  p.days ??= {};
  const today = dayKey(now, zone);
  const prev = p.observedAt;
  if (!p.days[today]) {
    // A recent observation on the other side of midnight gives an approximate boundary.
    const nearBoundary = prev && dayKey(prev, zone) === previousDay(today) && now - prev < 180000;
    p.days[today] = { start: nearBoundary ? p.elo : game.faceit_elo, end: game.faceit_elo, partial: !nearBoundary, approximate: !!nearBoundary, since: nearBoundary ? prev : now };
  }
  p.days[today].end = game.faceit_elo;
  p.nickname = profile.nickname;
  p.level = game.skill_level;
  p.elo = game.faceit_elo;
  p.peak = Math.max(p.peak ?? game.faceit_elo, game.faceit_elo);
  p.observedAt = now;
  return p;
}
export function delta(p, day) {
  const d = p.days?.[day];
  return d ? d.end - d.start : null;
}
export function deltaLabel(p, day) {
  const d = p.days?.[day];
  if (!d) return 'немає спостережень';
  return `${signed(delta(p, day))}${d.partial ? ' (від підключення/першої перевірки дня)' : ' (≈ за день)'}`;
}
export function tag(p, day, zone) {
  const count = matchesForDay(p, day, zone).length;
  const d = p.days?.[day];
  const change = d?.partial ? '?' : `~${signed(delta(p, day))}`;
  const text = `${p.elo}|${count}g ${change}`;
  return text.length <= 16 ? text : `${p.elo}|${count}g`.slice(0, 16);
}
export function summary(matches) {
  const wins = matches.filter(m => m.win === true).length;
  const losses = matches.filter(m => m.win === false).length;
  let streak = 0;
  for (const m of matches) { if (m.win !== true) break; streak++; }
  const detailed = matches.filter(m => m.stats);
  const nums = key => detailed.map(m => Number(m.stats[key])).filter(Number.isFinite);
  const sum = a => a.reduce((a, b) => a + b, 0);
  const kills = nums('Kills'), deaths = nums('Deaths');
  return { wins, losses, streak, form: matches.slice(0, 5).map(m => m.win === true ? '🟩' : m.win === false ? '🟥' : '⬜').join(' '),
    kd: kills.length && deaths.length === kills.length ? (sum(kills) / Math.max(1, sum(deaths))).toFixed(2) : '—',
    avg: kills.length ? (sum(kills) / kills.length).toFixed(1) : '—', detailed: detailed.length };
}
export function nicknameFrom(input) {
  if (!input) throw new Error('Вкажи нік: /link nickname або посилання на FACEIT-профіль.');
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (!['faceit.com', 'www.faceit.com'].includes(url.hostname)) throw new Error('Потрібне посилання faceit.com.');
    const parts = url.pathname.split('/');
    input = decodeURIComponent(parts[parts.indexOf('players') + 1] ?? '');
    if (!parts.includes('players')) throw new Error('Потрібне посилання на профіль гравця.');
  }
  if (!/^[\w-]{1,50}$/.test(input)) throw new Error('Некоректний FACEIT-нік.');
  return input;
}
