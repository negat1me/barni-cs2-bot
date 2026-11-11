import { escapeHtml as h, summary } from './domain.js';

const number = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const fmt = value => Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const metric = (value, suffix = '') => number(value) == null ? '—' : `${h(value)}${suffix}`;
const header = p => `<b>🎮 ${h(p.nickname)}</b>\nРівень <b>${h(p.level)}</b>  ·  <b>${fmt(p.elo)} Elo</b>`;
const footer = (p, zone) => `\n\n<a href="https://www.faceit.com/en/players/${encodeURIComponent(p.nickname)}">Профіль FACEIT ↗</a>\n<i>Оновлено ${new Date(p.observedAt).toLocaleTimeString('uk-UA', {timeZone: zone, hour: '2-digit', minute: '2-digit'})}</i>`;
const statNumber = (m, key) => number(m.stats?.[key]);
function average(matches, key) {
  const values = matches.map(m => statNumber(m, key)).filter(v => v != null);
  return values.length ? (values.reduce((a,b) => a+b, 0) / values.length).toFixed(1) : null;
}
function total(matches, key) {
  const values = matches.map(m => statNumber(m, key));
  return values.length && values.every(v => v != null) ? values.reduce((a,b) => a+b, 0) : null;
}
export function recentCard(p, matches, label, zone) {
  const top = `${header(p)}\n\n<b>📅 ${h(label)}</b>`;
  if (!matches.length) return `${top}\nЗавершених матчів за цей період немає.\nОбери інший період кнопками нижче.${footer(p, zone)}`;
  const s = summary(matches), known = s.wins + s.losses;
  const rate = known ? `${Math.round(s.wins / known * 100)}%` : '—';
  const unknown = matches.length - known;
  const lines = [top,
    `Матчів: <b>${matches.length}</b>`,
    `🟢 Перемоги: <b>${s.wins}</b>  ·  🔴 Поразки: <b>${s.losses}</b>`,
    `Частка перемог: <b>${rate}</b>${unknown ? ` (результат відомий для ${known}/${matches.length})` : ''}`,
    '', '<b>🎯 Особиста статистика</b>',
    `K/D: <b>${s.kd}</b>  <i>· вбивства / смерті</i>`,
    `У середньому за матч:`,
    `Вбивства <b>${s.avg}</b>  ·  Смерті <b>${metric(average(matches, 'Deaths'))}</b>  ·  Асисти <b>${metric(average(matches, 'Assists'))}</b>`];
  const hs = average(matches, 'Headshots %');
  if (hs != null) lines.push(`Хедшоти: <b>${hs}%</b> <i>· середнє за матч</i>`);
  const adr = average(matches, 'ADR');
  if (adr != null) lines.push(`Шкода за раунд (ADR): <b>${adr}</b> <i>· середнє за матч</i>`);
  const kills = total(matches, 'Kills'), deaths = total(matches, 'Deaths'), assists = total(matches, 'Assists');
  if (kills != null && deaths != null && assists != null) lines.push(`Разом K / D / A: <b>${kills} / ${deaths} / ${assists}</b>`);
  if (matches.some(m => !m.stats || ['Kills', 'Deaths', 'Assists'].some(k => statNumber(m,k) == null))) lines.push('<i>Частина показників недоступна; середні — за наявними даними.</i>');
  lines.push('', '<b>📊 Останні результати</b>', s.form, '<i>Новіші ліворуч · 🟩 перемога · 🟥 поразка · ⬜ невідомо</i>');
  if (s.streak > 1) lines.push(`🔥 Перемог поспіль у вибірці: <b>${s.streak}</b>`);
  const last = matches[0];
  lines.push('', '<b>🗺 Останній матч у вибірці</b>', `${h(last.map?.replace(/^de_/, '') ?? 'Карта недоступна')}  ·  ${h(last.score || 'Рахунок недоступний')}  ·  <a href="${h(last.url)}">Матч ↗</a>`);
  return lines.join('\n') + footer(p, zone);
}
export function lifetimeCard(p, stats, zone) {
  const count = number(stats.Matches), wins = number(stats.Wins);
  const losses = count != null && wins != null && wins <= count ? count - wins : null;
  const lines = [header(p), '', '<b>🌍 За весь час · CS2</b>',
    `Матчів: <b>${count == null ? '—' : fmt(count)}</b>`,
    `🟢 Перемоги: <b>${wins == null ? '—' : fmt(wins)}</b>  ·  Решта матчів: <b>${losses == null ? '—' : fmt(losses)}</b>`,
    `Частка перемог: <b>${metric(stats['Win Rate %'], '%')}</b>`,
    '', '<b>🎯 Особиста статистика</b>',
    `Середній K/D: <b>${metric(stats['Average K/D Ratio'])}</b>`,
    `Хедшоти: <b>${metric(stats['Average Headshots %'], '%')}</b> <i>· середнє за матч</i>`];
  if (number(stats['Average K/R Ratio']) != null) lines.push(`Вбивства за раунд: <b>${metric(stats['Average K/R Ratio'])}</b>`);
  const current = number(stats['Current Win Streak']), longest = number(stats['Longest Win Streak']);
  if (current != null || longest != null) {
    lines.push('', '<b>🔥 Серії перемог</b>');
    if (current != null) lines.push(`Поточна: <b>${current}</b>`);
    if (longest != null) lines.push(`Найдовша: <b>${longest}</b>`);
  }
  lines.push('', '<i>Загальні показники з профілю FACEIT.</i>');
  return lines.join('\n') + footer(p, zone);
}

export function lastMatchCard(p, m, zone) {
  const s = m.stats ?? {};
  const own = number(m.ownScore), other = number(m.opponentScore);
  const score = own != null && other != null ? `${own} : ${other}` : m.score || '—';
  const result = m.win === true ? '🟢 ПЕРЕМОГА' : m.win === false ? '🔴 ПОРАЗКА' : '⚪ Результат недоступний';
  const lines = [header(p), '', '<b>🗺 Останній матч · CS2</b>',
    `<b>${result}  ·  ${h(score)}</b>`,
    `Карта: <b>${h(m.map ?? '—')}</b>`];
  if (own != null && other != null) lines.push('<i>Рахунок: твоя команда : суперник</i>');
  if (m.team && m.opponent) lines.push(`${h(m.team)} — ${h(m.opponent)}`);
  if (m.competition || m.region) lines.push([m.competition, m.region].filter(Boolean).map(h).join(' · '));
  if (Number.isFinite(m.finished) && m.finished > 0) lines.push(`Завершено: ${h(new Date(m.finished).toLocaleString('uk-UA', {timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}))} (${h(zone)})`);
  if (m.started > 0 && m.finished > m.started) lines.push(`Тривалість: <b>${Math.round((m.finished - m.started) / 60000)} хв</b>`);
  lines.push('', '<b>🎯 Твоя статистика</b>',
    `Вбивства <b>${metric(s.Kills)}</b>  ·  Смерті <b>${metric(s.Deaths)}</b>  ·  Асисти <b>${metric(s.Assists)}</b>`,
    `K/D: <b>${summary([m]).kd}</b> <i>· вбивства / смерті</i>`);
  const kills = number(s.Kills), deaths = number(s.Deaths);
  if (kills != null && deaths != null) { const diff = kills - deaths; lines.push(`Різниця K−D: <b>${diff > 0 ? '+' : ''}${diff}</b>`); }
  const fields = [['ADR', 'Шкода за раунд (ADR)', ''], ['K/R Ratio', 'Вбивства за раунд', ''], ['Headshots %', 'Хедшоти', '%'], ['Headshots', 'Вбивства в голову', ''], ['MVPs', 'MVP раундів', '']];
  for (const [key, label, suffix] of fields) if (number(s[key]) != null) lines.push(`${label}: <b>${metric(s[key], suffix)}</b>`);
  const multi = [['Double Kills', '2 вбивства'], ['Triple Kills', '3 вбивства'], ['Quadro Kills', '4 вбивства'], ['Penta Kills', 'Ейси']]
    .filter(([key]) => number(s[key]) != null);
  if (multi.length) {
    lines.push('', '<b>💥 Мультикіли · раунди</b>');
    lines.push(multi.map(([key, label]) => `${label}: <b>${metric(s[key])}</b>`).join('  ·  '));
  }
  if (!m.stats || ['Kills', 'Deaths', 'Assists'].some(key => number(s[key]) == null)) lines.push('', '<i>Частина статистики ще недоступна у FACEIT.</i>');
  lines.push('', '<i>Рівень і Elo у заголовку — поточні.</i>');
  return lines.join('\n');
}
