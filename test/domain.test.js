import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, previousDay, normalizeMatch, matchesForDay, observe, tag, summary, nicknameFrom } from '../src/domain.js';
const zone = 'Europe/Kyiv';
const profile = elo => ({ nickname: 'barni', games: { cs2: { faceit_elo: elo, skill_level: 10 } } });
test('gaming day changes at 07:00 local time in winter and summer', () => {
  const cases = [
    ['2026-11-10T22:01:00Z','2026-11-10'],
    ['2026-11-11T04:59:59Z','2026-11-10'],
    ['2026-11-11T05:00:00Z','2026-11-11'],
    ['2026-07-10T21:01:00Z','2026-07-10'],
    ['2026-07-11T03:59:59Z','2026-07-10'],
    ['2026-07-11T04:00:00Z','2026-07-11'],
    ['2027-01-01T04:59:59Z','2026-12-31'],
    ['2026-03-01T04:59:59Z','2026-02-28']
  ];
  for (const [instant, expected] of cases) assert.equal(dayKey(Date.parse(instant), zone), expected, instant);
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
});
test('07:00 cutoff follows the local clock across both DST transitions', () => {
  for (const [instant, expected] of [
    ['2026-03-29T03:59:59Z','2026-03-28'],
    ['2026-03-29T04:00:00Z','2026-03-29'],
    ['2026-10-25T04:59:59Z','2026-10-24'],
    ['2026-10-25T05:00:00Z','2026-10-25']
  ]) assert.equal(dayKey(Date.parse(instant),zone),expected,instant);
});
test('stats assign matches by finish time at the 07:00 boundary; tags show current and tracked maximum Elo', () => {
  const m = normalizeMatch({ match_id: 'one', started_at: Date.parse('2026-11-11T04:50:00Z') / 1000, finished_at: Date.parse('2026-11-11T05:05:00Z') / 1000,
    teams: { faction1: { players: [{ player_id: 'p' }] } }, results: { winner: 'faction1' } }, 'p');
  assert.equal(m.win, true);
  const before = {id:'two', finished:Date.parse('2026-11-11T04:59:59Z'), win:false};
  const p = {elo:2100,matches:{one:m,two:before}};
  assert.deepEqual(matchesForDay(p, '2026-11-11', zone).map(m=>m.id), ['one']);
  assert.deepEqual(matchesForDay(p, '2026-11-10', zone).map(m=>m.id), ['two']);
  assert.equal(tag(p, '2026-11-11', zone), '2100 ELO | ↑2100');
  assert.equal(dayKey(Date.parse('2026-11-12T00:20:00Z'),zone), '2026-11-11');
  assert.equal(previousDay(dayKey(Date.parse('2026-11-12T00:20:00Z'),zone)), '2026-11-10');
});
test('fresh FACEIT response replaces games and removes historical rating fields', () => {
  const p = {days: {old: {start: 2000}}, peak: 3000}, now = Date.parse('2026-11-11T12:00:00Z');
  const m = {id: 'one', finished: now, win: true};
  observe(p, profile(2100), [m, m], now, zone);
  assert.equal(tag(p, '2026-11-11', zone), '2100 ELO | ↑2100');
  observe(p, profile(2127), [], now + 60000, zone);
  assert.deepEqual(p.matches, {});
  assert.equal(p.days, undefined);
  assert.equal(p.peak, undefined);
  assert.equal(tag(p, '2026-11-11', zone), '2127 ELO | ↑2127');
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
