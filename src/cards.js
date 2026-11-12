import { escapeHtml as h, summary } from './domain.js';
import {peakElo,latestEloDay,eloLabel,eloNote} from './elo-tracking.js';

const number = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const fmt = value => Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const metric = (value, suffix = '') => number(value) == null ? '—' : `${h(value)}${suffix}`;
const header = p => `<b>🎮 ${h(p.nickname)}</b>\nLVL <b>${h(p.level)}</b>  ·  <b>${fmt(p.elo)} ELO</b>\nMAX <b>${peakElo(p)??'—'}</b> · Δ день <b>${eloLabel(latestEloDay(p))}</b>`;
const footer = (p, zone) => `\n<i>${h(eloNote(p,zone))}</i>\n\n<a href="https://www.faceit.com/en/players/${encodeURIComponent(p.nickname)}">FACEIT ↗</a>  ·  <i>${new Date(p.observedAt).toLocaleTimeString('uk-UA', {timeZone: zone, hour: '2-digit', minute: '2-digit'})}</i>`;
const statNumber = (m, key) => number(m.stats?.[key]);
function average(matches, key, digits=1) {
  const values = matches.map(m => statNumber(m, key)).filter(v => v != null);
  return values.length ? (values.reduce((a,b) => a+b, 0) / values.length).toFixed(digits) : null;
}
const integer = value => number(value) == null ? '—' : String(Math.round(Number(value)));
const kda = (k, d, a) => `K/D/A  <code>${integer(k)}/${integer(d)}/${integer(a)}</code>`;
const statLine = entries => entries.filter(([,value]) => number(value) != null)
  .map(([label,value,suffix = '']) => `${label} <b>${metric(label==='K/R'?Number(value).toFixed(2):label==='ADR'?Number(value).toFixed(1):value, suffix)}</b>`).join('  ·  ');
const mapName = value => value ? h(value.replace(/^de_/, '')) : '—';
export function recentCard(p, matches, label, zone) {
  const top = `${header(p)}\n\n<b>${h(label)}</b>`;
  if (!matches.length) return `${top}\nМатчів ще немає. Обери інший період.${footer(p, zone)}`;
  const s = summary(matches), known = s.wins + s.losses;
  const rate = known ? `${Math.round(s.wins / known * 100)}%` : '—';
  const lines = [top,
    `<b>${matches.length}</b> матчів  ·  <b>${s.wins}W / ${s.losses}L</b>  ·  WR <b>${rate}</b>`,
    '', '<b>🎯 AVG / матч</b>',
    kda(s.avg, average(matches, 'Deaths'), average(matches, 'Assists')),
    `K/D <b>${s.kd}</b>`,
    statLine([['ADR', average(matches, 'ADR')], ['HS', average(matches, 'Headshots %'), '%']])];
  if (known < matches.length) lines.push(`<i>Результат відомий: ${known}/${matches.length}</i>`);
  if (matches.some(m => !m.stats || ['Kills', 'Deaths', 'Assists'].some(k => statNumber(m,k) == null))) lines.push('<i>Неповні дані · AVG за доступними матчами</i>');
  lines.push('', `${s.form}  <i>← новіші</i>`);
  if (s.streak > 1) lines.push(`🔥 Win streak <b>${s.streak}</b>`);
  const last = matches[0];
  lines.push('', `🗺 ${mapName(last.map)}  ·  <b>${h(last.score || '—')}</b>  ·  <a href="${h(last.url)}">Матч ↗</a>`);
  return lines.filter(line => line !== null).join('\n') + footer(p, zone);
}
export function lifetimeCard(p, stats, zone) {
  const count = number(stats.Matches), wins = number(stats.Wins);
  const lines = [header(p), '', '<b>🌍 За весь час</b>',
    `<b>${count == null ? '—' : fmt(count)}</b> матчів  ·  <b>${wins == null ? '—' : fmt(wins)}W</b>  ·  WR <b>${metric(stats['Win Rate %'], '%')}</b>`,
    '', '<b>🎯 AVG / матч</b>',
    `K/D <b>${metric(stats['Average K/D Ratio'])}</b>  ·  HS <b>${metric(stats['Average Headshots %'], '%')}</b>`];
  const kr = statLine([['K/R', stats['Average K/R Ratio']]]);
  if (kr) lines.push(kr);
  const streak = statLine([['Win streak', stats['Current Win Streak']], ['Best', stats['Longest Win Streak']]]);
  if (streak) lines.push('', `🔥 ${streak}`);
  return lines.join('\n') + footer(p, zone);
}
export function lastMatchCard(p, m, zone) {
  const s = m.stats ?? {};
  const own = number(m.ownScore), other = number(m.opponentScore);
  const score = own != null && other != null ? `${own} : ${other}` : m.score || '—';
  const result = m.win === true ? '🟢 WIN' : m.win === false ? '🔴 LOSS' : '⚪ Результат —';
  const lines = [header(p), '', `<b>${result}  ·  ${h(score)}</b>`, `🗺 <b>${mapName(m.map)}</b>`];
  if (m.team && m.opponent) lines.push(`${h(m.team)} — ${h(m.opponent)}`);
  const date = Number.isFinite(m.finished) && m.finished > 0
    ? new Date(m.finished).toLocaleString('uk-UA', {timeZone: zone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '';
  const duration = m.started > 0 && m.finished > m.started ? `${Math.round((m.finished - m.started) / 60000)} хв` : '';
  const context = [date, duration, m.region].filter(Boolean).map(h).join('  ·  ');
  if (context) lines.push(context);
  lines.push('', '<b>🎯 Performance</b>', kda(s.Kills, s.Deaths, s.Assists), `K/D <b>${summary([m]).kd}</b>`);
  const aim = statLine([['ADR', s.ADR], ['HS', s['Headshots %'], '%'], ['K/R', s['K/R Ratio']]]);
  if (aim) lines.push(aim);
  const multi = statLine([['2K', s['Double Kills']], ['3K', s['Triple Kills']], ['4K', s['Quadro Kills']], ['ACE', s['Penta Kills']]].filter(([,value]) => number(value) > 0));
  if (multi) lines.push('', `💥 ${multi}`);
  if (!m.stats || ['Kills', 'Deaths', 'Assists'].some(key => number(s[key]) == null)) lines.push('<i>Частина даних ще недоступна</i>');
  lines.push('', '<i>LVL / ELO — поточні</i>',`<i>${h(eloNote(p,zone))}</i>`);
  return lines.join('\n');
}

export function compareCard(a, b, aMatches, bMatches) {
  const first = summary(aMatches), second = summary(bMatches);
  const wr = s => s.wins + s.losses ? `${Math.round(s.wins / (s.wins + s.losses) * 100)}%` : '—';
  const line = (label, left, right) => `${label}  <b>${left}</b> / <b>${right}</b>`;
  return [
    '<b>⚔️ FACEIT · Compare</b>', `${h(a.nickname)} 🆚 ${h(b.nickname)}`, '',
    line('ELO', a.elo, b.elo), line('MAX',peakElo(a)??'—',peakElo(b)??'—'), line('Δ день',eloLabel(latestEloDay(a)),eloLabel(latestEloDay(b))), line('LVL', a.level, b.level), '',
    '<b>Останні 20 матчів · лівий / правий</b>',
    line('Матчі', aMatches.length, bMatches.length),
    line('W–L', `${first.wins}–${first.losses}`, `${second.wins}–${second.losses}`),
    line('WR', wr(first), wr(second)), line('K/D', first.kd, second.kd),
    line('AVG K', integer(first.avg), integer(second.avg)),
    line('ADR', metric(average(aMatches, 'ADR')), metric(average(bMatches, 'ADR'))),
    line('HS', metric(average(aMatches, 'Headshots %'), '%'), metric(average(bMatches, 'Headshots %'), '%')),
    '', `${h(a.nickname)}  ${first.form || '—'}`, `${h(b.nickname)}  ${second.form || '—'}`,
    ...(aMatches.concat(bMatches).some(m => !m.stats || ['Kills','Deaths','ADR','Headshots %'].some(key => statNumber(m, key) == null))
      ? ['<i>Частина показників недоступна · AVG за наявними даними</i>'] : [])
  ].join('\n');
}
