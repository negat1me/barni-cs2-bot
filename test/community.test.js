import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Bot} from '../src/bot.js';
import {Store} from '../src/store.js';
const chat = {id: -1, type: 'supergroup'};
const user = id => ({id, first_name: `Player ${id}`});
function fixture(store) {
  const calls = [], state = store?.state ?? {users: {}, players: {}, chats: {}};
  let messageId = 10;
  const api = {tg: async (method, body) => {
    calls.push([method, body]);
    if (method === 'getChatMember') return {status: 'member', tag: 'Original'};
    return {message_id: ++messageId};
  }};
  const bot = new Bot(api, store ?? {state, save() {}}, {zone:'Europe/Kyiv', interval:60000});
  const command = (id, text, replyId) => bot.handle({message: {chat, from: user(id), text,
    ...(replyId ? {reply_to_message: {from: user(replyId)}} : {})}});
  const click = (id, action, party = state.chats[-1].party) => bot.handle({callback_query: {
    id: `cb-${id}-${action}`, from: user(id), data: `party:${party.id}:${action}`,
    message: {chat, message_id: party.messageId}
  }});
  return {bot, state, calls, api, command, click};
}
test('party holds five unique players; everyone can join and leave but only creator/admin closes', async () => {
  const {state, calls, command, click} = fixture();
  await command(1, '/party');
  const party = state.chats[-1].party;
  await click(2, 'join'); await click(2, 'join');
  assert.equal(party.participants.length, 2);
  for (const id of [3,4,5,6]) await click(id, 'join');
  assert.equal(party.participants.length, 5);
  assert.match(calls.at(-1)[1].text, /повна/);
  await click(2, 'close'); assert.equal(state.chats[-1].party, party);
  await click(2, 'leave'); await click(6, 'join');
  assert.deepEqual(party.participants.map(p => p.id), ['1','3','4','5','6']);
  await click(1, 'close'); assert.equal(state.chats[-1].party, undefined);
  await command(1, '/party');
  await click(2, 'join', party);
  assert.equal(state.chats[-1].party.participants.length, 1);
  assert.match(calls.at(-1)[1].text, /неактивний/);
});
test('non-members cannot join party', async () => {
  const f = fixture(); await f.command(1, '/party');
  const original = f.api.tg;
  f.api.tg = (method, body) => method === 'getChatMember' ? Promise.resolve({status:'left'}) : original(method, body);
  await f.click(2, 'join');
  assert.equal(f.state.chats[-1].party.participants.length, 1);
});
test('any unlinked player can tag another player; auto stats cannot replace temporary tag', async () => {
  const f = fixture();
  await f.command(1, '/tag 5 AWP king', 2);
  const g = f.state.chats[-1];
  assert.equal(g.customTags[2].text, 'AWP king');
  assert.equal(g.customTags[2].by, '1');
  assert.ok(g.customTags[2].expiresAt > Date.now() + 299000);
  f.state.users[2] = {playerId:'p'};
  f.state.players.p = {id:'p', elo:2200, observedAt:Date.now(), matches:{}};
  g.members = ['2'];
  const before = f.calls.filter(([m]) => m === 'setChatMemberTag').length;
  await f.bot.updateTags(-1, g);
  assert.equal(f.calls.filter(([m]) => m === 'setChatMemberTag').length, before);
});
test('replacing temporary tag preserves original; expiry restores original for unlinked players', async () => {
  const f = fixture();
  await f.command(1, '/tag 5 first', 2);
  f.state.chats[-1].customTags[2].expiresAt = Date.now() + 1000;
  await f.command(3, '/tag 2 second', 2);
  const t = f.state.chats[-1].customTags[2];
  assert.equal(t.restoreText, 'Original'); assert.equal(t.text, 'second');
  await f.bot.community.expireTags(t.expiresAt + 1);
  assert.equal(f.state.chats[-1].customTags[2], undefined);
  assert.equal(f.calls.filter(([m]) => m === 'setChatMemberTag').at(-1)[1].tag, 'Original');
});
test('expiry restores fresh FACEIT tag for linked players', async () => {
  const f = fixture(); await f.command(1, '/tag 1 temp', 2);
  f.state.users[2] = {playerId:'p'}; f.state.players.p = {id:'p'};
  f.bot.refresh = async () => ({elo:2345, matches:{}});
  const t = f.state.chats[-1].customTags[2];
  await f.bot.community.expireTags(t.expiresAt + 1);
  assert.equal(f.calls.filter(([m]) => m === 'setChatMemberTag').at(-1)[1].tag, '2345 ELO');
});
test('failed restoration retains expiry for retry and blocks FACEIT overwrite', async () => {
  const f = fixture(); await f.command(1, '/tag 1 temp', 2);
  const t = f.state.chats[-1].customTags[2], original = f.api.tg;
  f.api.tg = async (method, body) => {
    if (method === 'setChatMemberTag') throw new Error('no rights');
    return original(method, body);
  };
  await f.bot.community.expireTags(t.expiresAt + 1);
  assert.ok(f.state.chats[-1].customTags[2].retryAt > t.expiresAt);
  f.api.tg = original;
  await f.bot.community.expireTags(t.retryAt + 1);
  assert.equal(f.state.chats[-1].customTags[2], undefined);
});
test('invalid duration, emoji, long text and tags-off do not modify Telegram', async () => {
  const f = fixture();
  for (const text of ['/tag 0 abc', '/tag 61 abc', '/tag 1 😁', '/tag 1 12345678901234567', '/tag 1 hidden\u200b']) await f.command(1, text, 2);
  f.state.chats[-1].tags = false;
  await f.command(1, '/tag 5 abc', 2);
  assert.equal(f.calls.some(([m]) => m === 'setChatMemberTag'), false);
});
test('Telegram write failure rolls back override without promoting anyone', async () => {
  const f = fixture(), original = f.api.tg;
  f.api.tg = (method, body) => method === 'getChatMember' ? Promise.resolve({status:'creator'}) : original(method, body);
  await f.command(1, '/tag 5 abc', 2);
  assert.equal(f.state.chats[-1].customTags[2], undefined);
  assert.equal(f.calls.some(([m]) => m === 'promoteChatMember'), false);
});
test('party and tag expiry survive restart; FACEIT histories stay out of disk state', async () => {
  const dir = mkdtempSync(join(tmpdir(),'barni-community-'));
  try {
    const path = join(dir,'state.json'), store = new Store(path), f = fixture(store);
    await f.command(1,'/party'); await f.command(1,'/tag 1 temp',2);
    store.state.players.any = {matches:{secret:{}}}; store.save();
    const reloaded = new Store(path), second = fixture(reloaded);
    assert.equal(reloaded.state.chats[-1].party.participants[0].id, '1');
    assert.deepEqual(reloaded.state.players, {});
    await second.bot.community.expireTags(reloaded.state.chats[-1].customTags[2].expiresAt+1);
    assert.equal(new Store(path).state.chats[-1].customTags[2], undefined);
  } finally {rmSync(dir,{recursive:true});}
});
test('compare loads live samples for two accounts without writing target profile to state', async () => {
  const f = fixture();
  f.state.users[1] = {playerId:'a'}; f.state.players.a = {id:'a'};
  f.api.faceit = async (path) => {
    if (path === '/players/a' || path === '/players') {
      const id = path === '/players' ? 'b' : 'a';
      return {player_id:id,nickname:id,games:{cs2:{faceit_elo:2000,skill_level:10}}};
    }
    if (path.endsWith('/history')) return {items:[]};
    throw new Error('Unexpected route');
  };
  await f.command(1, '/compare rival');
  assert.match(f.calls.at(-1)[1].text,/Compare/);
  assert.match(f.calls.at(-1)[1].text,/WR  <b>—<\/b>/);
  assert.equal(f.state.players.b,undefined);
  assert.equal(f.state.players.a.matches,undefined);
});
test('party shows average for available FACEIT profiles only', async () => {
  const f = fixture();
  for (const id of [1,2]) { f.state.users[id] = {playerId:`p${id}`}; f.state.players[`p${id}`] = {id:`p${id}`}; }
  f.api.faceit = async path => ({player_id:path.split('/').at(-1),nickname:'n',games:{cs2:{faceit_elo:path.endsWith('p1') ? 2100 : 2300,skill_level:10}}});
  await f.command(1,'/party'); await f.click(2,'join'); await f.click(3,'join');
  const card = f.calls.filter(([m]) => m === 'editMessageText').at(-1)[1].text;
  assert.match(card,/AVG ELO <b>2200<\/b> · дані 2\/3/);
});

test('party text is escaped, updated by owner and preserved after restart', async () => {
  const dir=mkdtempSync(join(tmpdir(),'barni-party-text-'));
  try {
    const path=join(dir,'state.json'), f=fixture(new Store(path));
    await f.command(1,'/party Збираю стак на 19:00 <go>');
    assert.match(f.calls.find(([m])=>m==='sendMessage')[1].text,/Збираю стак на 19:00 &lt;go&gt;/);
    await f.command(2,'/party overwritten');
    assert.equal(f.state.chats[-1].party.text,'Збираю стак на 19:00 <go>');
    await f.command(1,'/party Збираю стак на 20:00');
    assert.equal(new Store(path).state.chats[-1].party.text,'Збираю стак на 20:00');
  } finally {rmSync(dir,{recursive:true});}
});

test('reserve button promotes first reserve and removes leaving player from both lists',async()=>{
  const f=fixture();await f.command(1,'/party');
  for(const id of [2,3,4,5])await f.click(id,'join');
  await f.click(6,'reserve');await f.click(7,'reserve');
  await f.click(2,'leave');
  const p=f.state.chats[-1].party;
  assert.equal(p.participants.at(-1).id,'6');
  assert.deepEqual(p.reserves.map(x=>x.id),['7']);
  await f.click(7,'leave');assert.equal(p.reserves.length,0);
});
test('reminder schedule and reserves survive restart, sends once and cancels on close',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'barni-reminders-'));
  try {
    const path=join(dir,'state.json'),f=fixture(new Store(path));
    await f.command(1,'/party Збираю стак на 19:00');await f.click(2,'reserve');
    const p=f.state.chats[-1].party;
    assert.ok(p.startsAt);assert.ok(p.remindAt);
    const second=fixture(new Store(path));
    await second.bot.community.remindParties(p.remindAt);
    const reminder=second.calls.filter(([m,b])=>m==='sendMessage'&&b.text.includes('PARTY'));
    assert.equal(reminder.length,1);assert.match(reminder[0][1].text,/tg:\/\/user\?id=2/);
    const third=fixture(new Store(path));
    await third.bot.community.remindParties(p.remindAt+1000);
    assert.equal(third.calls.length,0);
    await third.click(1,'close');third.calls.length=0;
    await third.bot.community.remindParties(p.startsAt);
    assert.equal(third.calls.length,0);
  } finally{rmSync(dir,{recursive:true});}
});
test('changing description keeps reminder; changing time resets it; no-time removes schedule',async()=>{
  const f=fixture();await f.command(1,'/party На 19:00');
  const p=f.state.chats[-1].party;
  p.remindedAt=Date.now();const start=p.startsAt;
  await f.command(1,'/party На 19:00 граємо EU');assert.equal(p.startsAt,start);assert.ok(p.remindedAt);
  await f.command(1,'/party На 20:00');assert.notEqual(p.startsAt,start);assert.equal(p.remindedAt,undefined);
  await f.command(1,'/party Без часу');assert.equal(p.startsAt,null);
});
test('taglist shows escaped text, creator and remaining minutes without requiring FACEIT link',async()=>{
  const f=fixture();await f.command(1,'/tag 5 <AWP>',2);await f.command(3,'/taglist');
  const text=f.calls.at(-1)[1].text;
  assert.match(text,/&lt;AWP&gt;/);assert.match(text,/tg:\/\/user\?id=2/);assert.match(text,/tg:\/\/user\?id=1/);assert.match(text,/5 хв/);
});
test('form command uses player stat endpoint and does not persist matches',async()=>{
  const f=fixture();f.state.users[1]={playerId:'p'};f.state.players.p={id:'p'};
  f.api.faceit=async path=>path.endsWith('/games/cs2/stats')?{items:[]}:{player_id:'p',nickname:'barni',games:{cs2:{faceit_elo:2000}}};
  await f.command(1,'/form');
  assert.match(f.calls.at(-1)[1].text,/Форма/);assert.equal(f.state.players.p.matches,undefined);
});
