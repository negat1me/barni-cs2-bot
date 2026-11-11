import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { Api } from '../src/api.js';
import { Store } from '../src/store.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function fixture(tg = async () => ({ status: 'member' })) {
  const calls = [];
  const state = { users: {}, players: {}, chats: {} };
  const api = { tg: async (method, body) => { calls.push([method, body]); return tg(method, body); } };
  const bot = new Bot(api, { state, save() {} }, { zone: 'Europe/Kyiv', interval: 60000 });
  bot.username = 'BarniBot';
  return { bot, calls, state, api };
}
test('regular member tags require no promotion; unchanged tag skips API write', async () => {
  const { bot, state, calls } = fixture();
  state.users['1'] = { playerId: 'p' }; state.players.p = { id: 'p', elo: 2000, observedAt: Date.now() };
  const group = { members: ['1'], tags: true, tagState: {} };
  await bot.updateTags(-1, group); await bot.updateTags(-1, group);
  assert.equal(calls.filter(([m]) => m === 'setChatMemberTag').length, 1);
  assert.equal(calls.some(([m]) => m === 'promoteChatMember'), false);
});
test('owner title failure is recorded with backoff and does not stop other tags', async () => {
  const { bot, state, calls } = fixture(async (_, body) => ({status: body.user_id === 1 ? 'creator' : 'member'}));
  state.users = {1: {playerId: 'p'}, 2: {playerId: 'p'}}; state.players.p = {id: 'p', elo: 2000, observedAt: Date.now()};
  const group = {members: ['1', '2'], tags: true, tagState: {}};
  await bot.updateTags(-1, group);
  assert.match(group.tagState['1'].error, /власника/);
  assert.equal(calls.filter(([m]) => m === 'setChatMemberTag').length, 1);
});
test('tags off requires administrator; no automatic summary messages', async () => {
  const { bot, calls } = fixture();
  await bot.handle({message: {chat: {id: -1, type: 'supergroup'}, from: {id: 1}, text: '/tags off'}});
  assert.match(calls.at(-1)[1].text, /адміністраторам/);
  calls.length = 0; await bot.tick(); assert.equal(calls.length, 0);
});
test('callbacks cannot change another user card; commands for other bots ignored', async () => {
  const { bot, calls } = fixture();
  const message = {chat: {id: -1, type: 'supergroup'}, message_id: 3, from: {id: 1}, text: '/help@OtherBot'};
  await bot.handle({message}); assert.equal(calls.length, 0);
  await bot.handle({callback_query: {id: 'a', from: {id: 2}, message, data: 'stats:1:today'}});
  assert.equal(calls.some(([m]) => m === 'editMessageText'), false);
});
test('history pagination, deduplication, cancelled match exclusion', async () => {
  const api = new Api({token: 'fake', faceitKey: 'fake'});
  const m = i => ({match_id: String(i), finished_at: 1, status: 'FINISHED'});
  const offsets = [];
  api.faceit = async (_, params) => { offsets.push(params.offset); return {items: params.offset === 0 ? Array.from({length: 100}, (_, i) => m(i)) : [m(99), m(100), {...m(101), status: 'CANCELLED'}]}; };
  assert.equal((await api.history('p', 0, 100)).length, 101);
  assert.deepEqual(offsets, [0, 100]);
});
test('rate limits set cooldown without exposing credentials', async () => {
  const api = new Api({ token: 'secret', faceitKey: 'secret', fetcher: async () => new Response(JSON.stringify({ok: false, error_code: 429, parameters: {retry_after: 10}}), { status: 429 }) });
  await assert.rejects(api.tg('getMe'), e => e.status === 429 && !e.message.includes('secret'));
  assert.ok(api.cooldown.Telegram > Date.now());
});
test('persistent state round trip and corrupted file fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'barni-test-'));
  try {
    const path = join(dir, 'state.json'); const store = new Store(path);
    store.state.offset = 123; store.save(); assert.equal(new Store(path).state.offset, 123);
    writeFileSync(path, '{broken'); assert.throws(() => new Store(path));
  } finally { rmSync(dir, {recursive: true}); }
});
test('link → stats → last → summary → unlink works with API fixtures', async () => {
  const {bot, state, calls, api} = fixture();
  const finished = Math.floor(Date.now()/1000);
  const match = {match_id: 'm1', status: 'FINISHED', finished_at: finished, teams: {faction1: {players: [{player_id: 'p'}]}}, results: {winner: 'faction1', score: {faction1: 13, faction2: 8}}};
  api.faceit = async path => {
    if (path === '/players' || path === '/players/p') return {player_id: 'p', nickname: 'barni', games: {cs2: {faceit_elo: 2200, skill_level: 10}}};
    if (path.endsWith('/history')) return {items: [match]};
    if (path === '/matches/m1/stats') return {rounds: [{round_stats: {Map: 'de_mirage'}, teams: [{players: [{player_id: 'p', player_stats: {Kills: '20', Deaths: '10', Assists: '4'}}]}]}]};
    throw new Error('Unexpected API route');
  };
  api.history = async () => [match];
  const command = text => bot.handle({message: {chat: {id: -1, type: 'supergroup'}, from: {id: 1}, text}});
  await command('/link barni'); assert.equal(state.users[1].playerId, 'p');
  await command('/stats'); assert.match(calls.at(-1)[1].text, /1 матчів · 1W \/ 0L/); assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard[0].length, 3);
  await command('/last'); assert.match(calls.at(-1)[1].text, /de_mirage/);
  await command('/summary'); assert.match(calls.at(-1)[1].text, /Підсумок/);
  await bot.updateTags('-1', state.chats[-1]);
  await command('/unlink'); assert.equal(state.users[1], undefined); assert.equal(state.players.p, undefined);
  assert.ok(calls.some(([method, body]) => method === 'setChatMemberTag' && body.tag === ''));
});
