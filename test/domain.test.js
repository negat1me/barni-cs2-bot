import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, previousDay, normalizeMatch, matchesForDay, observe, tag, summary, nicknameFrom } from '../src/domain.js';
const zone = 'Europe/Kyiv';
const profile = elo => ({ nickname: 'barni', games: { cs2: { faceit_elo: elo, skill_level: 10 } } });
test('Kyiv dates and DST use local finish date, not match start date', () => {
  assert.equal(dayKey(Date.parse('2026-11-10T22:01:00Z'), zone), '2026-11-11');
  assert.equal(dayKey(Date.parse('2026-07-10T21:01:00Z'), zone), '2026-07-11');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  const m = normalizeMatch({ match_id: 'one', started_at: 1794340000, finished_at: Date.parse('2026-11-10T22:01:00Z') / 1000,
    teams: { faction1: { players: [{ player_id: 'p' }] } }, results: { winner: 'faction1' } }, 'p');
  assert.equal(m.win, true);
  assert.equal(matchesForDay({ matches: { one: m } }, '2026-11-11', zone).length, 1);
  assert.equal(matchesForDay({ matches: { one: m } }, '2026-11-10', zone).length, 0);
});
test('fresh FACEIT response replaces games and removes historical rating fields', () => {
  const p = {days: {old: {start: 2000}}, peak: 3000}, now = Date.parse('2026-11-11T12:00:00Z');
  const m = {id: 'one', finished: now, win: true};
  observe(p, profile(2100), [m, m], now, zone);
  assert.equal(tag(p, '2026-11-11', zone), '2100 ELO | G: 1');
  observe(p, profile(2127), [], now + 60000, zone);
  assert.deepEqual(p.matches, {});
  assert.equal(p.days, undefined);
  assert.equal(p.peak, undefined);
  assert.equal(tag(p, '2026-11-11', zone), '2127 ELO');
});
test('summary uses ratio of totals, handles unknown winner and zero deaths', () => {
  const s = summary([{win: true, stats: { Kills: '30', Deaths: '10' }}, {win: false, stats: {Kills: '10', Deaths: '20'}}, {win: null}]);
  assert.equal(s.kd, '1.33'); assert.equal(s.avg, '20.0'); assert.equal(s.streak, 1); assert.equal(s.losses, 1);
});
test('profile URL parsing and tag length', () => {
  assert.equal(nicknameFrom('https://www.faceit.com/en/players/barni'), 'barni');
  assert.throws(() => nicknameFrom('https://evil.example/players/barni'));
  assert.throws(() => nicknameFrom('https://faceit.com/en/cs2/room/123'));
  assert.ok(tag({ elo: 123456789, days: {'x': {start: 1, end: 999999, partial: false}} }, 'x', zone).length <= 16);
});
