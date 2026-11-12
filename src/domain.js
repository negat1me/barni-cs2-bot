export const signed = n => n == null ? '?' : `${n > 0 ? '+' : ''}${n}`;
export const escapeHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function dayKey(time = Date.now(), zone = 'Europe/Kyiv') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour:'2-digit', hourCycle:'h23' }).formatToParts(time);
  const value = type => parts.find(p => p.type === type).value;
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  // Compare the actual local clock; subtracting seven UTC hours breaks on DST days.
  return Number(value('hour')) < 7 ? previousDay(date) : date;
}
export function previousDay(key) {
  return new Date(Date.parse(`${key}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}
export function normalizeMatch(m, playerId) {
  const side = Object.entries(m.teams ?? {}).find(([, team]) => (team.players ?? team.roster ?? []).some(p => p.player_id === playerId))?.[0];
  const opponent = Object.keys(m.teams ?? {}).find(key => key !== side);
  const scores = m.results?.score ?? {};
  return { id: m.match_id, started: Number(m.started_at) * 1000,
    team: side ? m.teams[side]?.nickname ?? m.teams[side]?.name : null,
    opponent: opponent ? m.teams[opponent]?.nickname ?? m.teams[opponent]?.name : null,
    ownScore: side ? scores[side] : null, opponentScore: opponent ? scores[opponent] : null,
    competition: m.competition_name, region: m.region, finished: Number(m.finished_at) * 1000,
    win: side && m.results?.winner ? side === m.results.winner : null,
    score: Object.values(m.results?.score ?? {}).join(' : '),
    url: `https://www.faceit.com/en/cs2/room/${encodeURIComponent(m.match_id)}` };
}
export function matchesForDay(p, day, zone) {
  return Object.values(p.matches ?? {}).filter(m => m.finished && dayKey(m.finished, zone) === day).sort((a, b) => b.finished - a.finished);
}
// A fresh FACEIT response replaces the temporary data; no local history is built.
export function observe(p, profile, matches, now) {
  const game = profile.games?.cs2;
  if (!game || !Number.isFinite(game.faceit_elo)) throw new Error('Профіль не має рейтингу CS2.');
  p.matches = Object.fromEntries(matches.filter(m => m.id && m.finished).map(m => [m.id, m]));
  p.nickname = profile.nickname;
  p.level = game.skill_level;
  p.elo = game.faceit_elo;
  p.avatar = profile.avatar;
  p.country = profile.country;
  p.region = game.region;
  p.observedAt = now;
  delete p.days;
  delete p.peak;
  return p;
}
export function tag(p) {
  const peak=Math.max(p.elo,...[p.eloTracking?.peak,p.analyser?.highestElo].filter(Number.isFinite));
  const full=`${p.elo} ELO | ↑${peak}`;
  return [full,full.replaceAll(' ',''),`${p.elo}|↑${peak}`,`${p.elo} ELO`].find(value=>value.length<=16)??String(p.elo).slice(0,16);
}
export function summary(matches) {
  const wins = matches.filter(m => m.win === true).length;
  const losses = matches.filter(m => m.win === false).length;
  let streak = 0;
  for (const m of matches) { if (m.win !== true) break; streak++; }
  const detailed = matches.filter(m => m.stats);
  const nums = key => detailed.map(m => m.stats[key]).filter(v => v != null && String(v).trim() !== '').map(Number).filter(Number.isFinite);
  const sum = a => a.reduce((a, b) => a + b, 0);
  const kills = nums('Kills');
  const paired = detailed.filter(m => ['Kills', 'Deaths'].every(k => m.stats[k] != null && String(m.stats[k]).trim() !== '' && Number.isFinite(Number(m.stats[k]))));
  const pairedKills = paired.reduce((s,m) => s + Number(m.stats.Kills), 0);
  const pairedDeaths = paired.reduce((s,m) => s + Number(m.stats.Deaths), 0);
  return { wins, losses, streak, form: matches.slice(0, 5).map(m => m.win === true ? '🟩' : m.win === false ? '🟥' : '⬜').join(' '),
    kd: paired.length ? (pairedDeaths ? (pairedKills / pairedDeaths).toFixed(2) : pairedKills ? '∞' : '—') : '—',
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
