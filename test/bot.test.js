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
  api.tgUpload = async (method,body,files) => { calls.push([method,body,files]); return {}; };
  const bot = new Bot(api, { state, save() {} }, { zone: 'Europe/Kyiv', interval: 60000 });
  bot.username = 'BarniBot';
  return { bot, calls, state, api };
}
test('regular member tags require no promotion; unchanged tag skips API write', async () => {
  const { bot, state, calls } = fixture();
  state.users['1'] = { playerId: 'p' }; state.players.p = { id: 'p', elo: 2000, matches: {}, observedAt: Date.now() };
  const group = { members: ['1'], tags: true, tagState: {} };
  await bot.updateTags(-1, group); await bot.updateTags(-1, group);
  assert.equal(calls.filter(([m]) => m === 'setChatMemberTag').length, 1);
  assert.equal(calls.some(([m]) => m === 'promoteChatMember'), false);
});
test('owner title failure is recorded with backoff and does not stop other tags', async () => {
  const { bot, state, calls } = fixture(async (_, body) => ({status: body.user_id === 1 ? 'creator' : 'member'}));
  state.users = {1: {playerId: 'p'}, 2: {playerId: 'p'}}; state.players.p = {id: 'p', elo: 2000, matches: {}, observedAt: Date.now()};
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
  assert.equal(calls.some(([m]) => m === 'editMessageMedia'), false);
  assert.match(calls.at(-1)[1].text,/tg:\/\/user\?id=2/);
});
test('history pagination, deduplication, cancelled match exclusion', async () => {
  const api = new Api({token: 'fake', faceitKey: 'fake'});
  const m = i => ({match_id: String(i), finished_at: 1, status: 'finished'});
  const offsets = [];
  api.faceit = async (_, params) => { offsets.push(params.offset); return {items: params.offset === 0 ? Array.from({length: 100}, (_, i) => m(i)) : [m(99), m(100), {...m(101), status: 'cancelled'}]}; };
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
  const match = {match_id: 'm1', status: 'finished', finished_at: finished, teams: {faction1: {players: [{player_id: 'p'}]}}, results: {winner: 'faction1', score: {faction1: 13, faction2: 8}}};
  api.faceit = async path => {
    if (path === '/players' || path === '/players/p') return {player_id: 'p', nickname: 'barni', games: {cs2: {faceit_elo: 2200, skill_level: 10}}};
    if (path.endsWith('/history')) return {items: [match]};
    if (path === '/matches/m1/stats') return {rounds: [{round_stats: {Map: 'de_mirage'}, teams: [{players: [{player_id: 'p', player_stats: {Kills: '20', Deaths: '10', Assists: '4'}}]}]}]};
    throw new Error('Unexpected API route');
  };
  api.history = async () => [match];
  const command = text => bot.handle({message: {chat: {id: -1, type: 'supergroup'}, from: {id: 1}, text}});
  await command('/link barni'); assert.equal(state.users[1].playerId, 'p');
  await command('/stats'); assert.equal(calls.at(-1)[0], 'sendPhoto'); assert.ok(calls.at(-1)[2].card.length > 1000); assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard[0].length, 3);
  await bot.handle({callback_query:{id:'cb',from:{id:1},data:'stats:1:recent',message:{chat:{id:-1,type:'supergroup'},message_id:3,photo:[{}]}}});
  assert.equal(calls.at(-1)[0],'editMessageMedia'); assert.equal(calls.at(-1)[1].media.media,'attach://card'); assert.match(calls.at(-1)[1].media.caption,/Останні 20/);
  await command('/last'); assert.equal(calls.at(-1)[0],'sendPhoto');assert.match(calls.at(-1)[1].caption, /mirage/);
  assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard[0][0].url,'https://www.faceit.com/en/cs2/room/m1');
  await command('/summary'); assert.equal(calls.at(-1)[0],'sendPhoto');assert.match(calls.at(-1)[1].caption, /Підсумок/);
  await bot.refresh('p');
  await bot.updateTags('-1', state.chats[-1]);
  await command('/unlink'); assert.equal(state.users[1], undefined); assert.equal(state.players.p, undefined);
  assert.ok(calls.some(([method, body]) => method === 'setChatMemberTag' && body.tag === ''));
});

test('storage migrates old FACEIT history and never persists transient stats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'barni-migrate-'));
  try {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({ version: 1, offset: 7, users: {1: {playerId: 'p'}},
      players: {p: {id: 'p', matches: {old: {}}, days: {old: {}}, peak: 3000}},
      chats: {'-1': {members: ['1'], tags: true, tagState: {'1': {value: '2200|2g'}}}} }));
    const store = new Store(path);
    assert.deepEqual(store.state.players.p, {id: 'p'});
    store.state.players.p.matches = {secretMatch: {stats: {Kills: '20'}}};
    store.state.players.p.days = {today: {start: 2200}};
    store.save();
    const reloaded = new Store(path);
    assert.deepEqual(reloaded.state.players.p, {id: 'p'});
    assert.equal(reloaded.state.chats['-1'].tagState['1'].value, '2200|2g');
    assert.equal(reloaded.state.offset, 7);
  } finally { rmSync(dir, {recursive: true}); }
});

test('daily summary omits unavailable Elo delta and API error text',async()=>{
 const {bot,state,calls}=fixture();state.chats[-1]={members:['1'],tags:true,tagState:{}};state.users[1]={playerId:'p'};state.players.p={id:'p',nickname:'barni',elo:2200,roundStats:[{id:'m',round:1,eloDelta:27}],matches:{m:{id:'m',finished:Date.parse('2026-11-11T12:00Z'),win:true}}};
 bot.refresh=async()=>state.players.p;
 bot.renderImage=async()=>{throw new Error('force text fallback');};
 await bot.leaderboard({id:-1,type:'supergroup'},'day','2026-11-11',true);
 assert.match(calls.at(-1)[1].text,/1g 1W\/0L/);
 assert.ok(!calls.at(-1)[1].text.includes('+27 ELO'));
 assert.ok(!calls.at(-1)[1].text.includes('недоступна у FACEIT Data API'));
 delete state.players.p.roundStats;
 await bot.leaderboard({id:-1,type:'supergroup'},'day','2026-11-11',true);
 assert.ok(!calls.at(-1)[1].text.includes('ELO —'));
});

test('leaderboard sends every page in sorted order with global positions',async()=>{
 const {bot,state,calls}=fixture();
 const rows=Array.from({length:23},(_,i)=>({uid:String(i+1),p:{id:'p'+i,nickname:'Player'+i,elo:2000+i}}));
 for(const r of rows)state.players[r.p.id]=r.p;
 bot.members=async()=>rows;bot.refresh=async id=>state.players[id];
 const pages=[];bot.renderImage=async(kind,data)=>{pages.push([kind,data]);return Buffer.from('PNG');};
 await bot.leaderboard({id:-1,type:'supergroup'});
 assert.equal(calls.length,3);assert.deepEqual(pages.map(([,p])=>p.offset),[0,10,20]);
 assert.equal(pages[0][1].rows[0].p.elo,2022);assert.equal(pages[2][1].rows.at(-1).p.elo,2000);
 assert.match(calls[2][1].caption,/3\/3/);
});

test('render failure returns full HTML text and keeps last-match button',async()=>{
 const {bot,calls}=fixture();bot.renderImage=async()=>{throw new Error('renderer unavailable');};
 const reply_markup={inline_keyboard:[[{text:'Match',url:'https://www.faceit.com/en/cs2/room/m'}]]};
 await bot.sendImage(-1,'last',{}, {caption:'Last',fallback:'<b>Stats</b>',reply_markup});
 assert.equal(calls.at(-1)[0],'sendMessage');assert.equal(calls.at(-1)[1].text,'<b>Stats</b>');
 assert.deepEqual(calls.at(-1)[1].reply_markup,reply_markup);
});

test('rankings use official region and country positions and tolerate missing ranks',async()=>{
 const {bot,api}=fixture(); const paths=[];
 api.faceit=async(path,params)=>{paths.push([path,params]);if(params.country)return {position:179};return {position:4501};};
 assert.deepEqual(await bot.rankings({id:'p',region:'EU',country:'ua'}),{country:179,region:4501});
 assert.equal(paths[1][1].country,'ua');assert.ok(paths[0][0].startsWith('/rankings/games/cs2/regions/EU/players/'));
 api.faceit=async()=>{throw new Error('Unavailable');};
 assert.deepEqual(await bot.rankings({id:'p',region:'EU',country:'ua'}),{country:null,region:null});
});

test('fresh profile Elo is tracked and tags update even when match history fails',async()=>{
 const {bot,api,state,calls}=fixture();state.users[1]={playerId:'p'};state.players.p={id:'p'};
 api.faceit=async()=>({nickname:'Player',games:{cs2:{faceit_elo:2200,skill_level:10}}});
 api.history=async()=>{throw new Error('History unavailable');};
 await assert.rejects(bot.refresh('p'));
 assert.equal(state.players.p.eloTracking.peak,2200);
 await bot.updateTags(-1,{members:['1'],tags:true,tagState:{}});
 assert.equal(calls.find(([method])=>method==='setChatMemberTag')[1].tag,'2200 ELO | ↑2200');
});

test('daily gain leaderboard sorts actual tracked changes rather than current Elo',async()=>{
 const {bot,state,calls}=fixture();const day='2026-11-11';
 const rows=[{uid:'1',p:{id:'a',nickname:'Higher',elo:3000,eloTracking:{peak:3000,days:{[day]:{start:3025,end:3000,partial:false}}}}},{uid:'2',p:{id:'b',nickname:'Gain',elo:2100,eloTracking:{peak:2100,days:{[day]:{start:2050,end:2100,partial:true}}}}}];
 bot.members=async()=>rows;bot.refresh=async()=>{};
 let rendered;bot.renderImage=async(kind,data)=>{rendered=data;return Buffer.from('png');};
 await bot.leaderboard({id:-1,type:'supergroup'},'day',day);
 assert.equal(rendered.rows[0].p.id,'b');assert.deepEqual(rendered.rows[0].change,{value:50,partial:true});assert.equal(calls.at(-1)[0],'sendPhoto');
});

test('Telegram multipart uploads preserve binary PNG, JSON media and keyboard',async()=>{
 let payload;
 const api=new Api({token:'fake',faceitKey:'fake',fetcher:async(_,options)=>{payload=options;return new Response(JSON.stringify({ok:true,result:{message_id:5}}));}});
 const png=Buffer.from([137,80,78,71]);
 await api.tgUpload('editMessageMedia',{chat_id:-1,media:{type:'photo',media:'attach://card'},reply_markup:{inline_keyboard:[]}},{card:png});
 assert.ok(payload.body instanceof FormData);assert.equal(payload.headers,undefined);
 assert.equal(JSON.parse(payload.body.get('media')).media,'attach://card');
 assert.deepEqual(Buffer.from(await payload.body.get('card').arrayBuffer()),png);
});
