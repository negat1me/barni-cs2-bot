import test from 'node:test';
import assert from 'node:assert/strict';
import {recentCard, lifetimeCard} from '../src/cards.js';
import {summary} from '../src/domain.js';
const p = {nickname: '<barni>', level: 10, elo: 2150, observedAt: Date.now()};
test('partial stats never turn missing values into zeros or mismatched K/D totals', () => {
  const matches = [
    {win: true, stats: {Kills:'20', Deaths:'10', Assists:'4', 'Headshots %':'50'}, url:'https://www.faceit.com/', score:'13 : 8'},
    {win: false, stats: {Kills:null, Deaths:'20', Assists:'', 'Headshots %':null}, url:'https://www.faceit.com/'}
  ];
  assert.equal(summary(matches).kd, '2.00');
  const card = recentCard(p, matches, 'Останні 20 матчів', 'Europe/Kyiv');
  assert.match(card, /HS <b>50.0%/);
  assert.match(card, /20\/15\/4/);
  assert.match(card, /Неповні дані/);
  assert.ok(!card.includes('Разом K / D / A'));
  assert.match(card, /&lt;barni&gt;/);
  assert.ok(card.length < 4096);
});
test('empty day has a clear message without empty numeric blocks', () => {
  const card = recentCard(p, [], 'Сьогодні', 'Europe/Kyiv');
  assert.match(card, /Матчів ще немає/);
  assert.ok(!card.includes('K/D:'));
});
test('lifetime shows zero streak, omits unavailable records and percentages', () => {
  const card = lifetimeCard(p, {'Current Win Streak': '0'}, 'Europe/Kyiv');
  assert.match(card, /Win streak <b>0/);
  assert.ok(!card.includes('Best'));
  assert.ok(!card.includes('—%'));
});

test('last match score is from player perspective and missing metrics are omitted', async () => {
  const {normalizeMatch} = await import('../src/domain.js');
  const {lastMatchCard} = await import('../src/cards.js');
  const m = normalizeMatch({match_id: 'match', started_at: 1000, finished_at: 2800,
    teams: {faction1: {nickname: 'Enemy', players: []}, faction2: {nickname: '<Team>', players: [{player_id: 'p'}]}},
    results: {winner: 'faction2', score: {faction1: 8, faction2: 13}}}, 'p');
  m.map = 'de_mirage'; m.stats = {Kills: '20', Deaths: '0', Assists: '4', ADR: '99.5', 'Penta Kills': '0'};
  const card = lastMatchCard(p, m, 'Europe/Kyiv');
  assert.match(card, /WIN  ·  13 : 8/);
  assert.match(card, /&lt;Team&gt; — Enemy/);
  assert.match(card, /30 хв/);
  assert.match(card, /K\/D <b>∞/);
  assert.ok(!card.includes('ACE'));
  assert.ok(!card.includes('Хедшоти:'));
  assert.ok(card.length < 4096);
});
