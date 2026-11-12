import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FaceitAnalyser,normalizeAnalyserStats,creditSvg,usesAnalyser} from '../src/analyser.js';
import {peakElo,trackElo,eloNote} from '../src/elo-tracking.js';
import {tag} from '../src/domain.js';
import {Store} from '../src/store.js';
import {Bot} from '../src/bot.js';
const id='ff102809-e97b-40da-9e62-dcc78e61455e';
const payload=(player=id)=>({playerId:player,segment_value:player,highest_elo:3043,lowest_elo:1989,first_occurrence:'2023-09-27',last_occurrence:'2026-11-11',m:2884});
function fixture(handler=()=>new Response(JSON.stringify(payload()))) {
  let clock=10000;const calls=[];
  const analyser=new FaceitAnalyser({key:'private-key',now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async(url,options)=>{calls.push({url,options,time:clock});return handler(url,options);}});
  return {analyser,calls,advance:ms=>{clock+=ms;}};
}
test('documented response binds to correct player and rejects missing or misleading max',()=>{
 const record=normalizeAnalyserStats(payload(),id,10000);assert.equal(record.highestElo,3043);assert.equal(record.firstOccurrence,'2023-09-27');
 assert.throws(()=>normalizeAnalyserStats(payload('other'),id,10000));
 for(const value of [null,'',-1,'bad'])assert.throws(()=>normalizeAnalyserStats({...payload(),highest_elo:value},id,10000));
 assert.throws(()=>normalizeAnalyserStats({...payload(),lowest_elo:5000},id,10000));
});
test('requests are serialized, deduplicated and cached for 24 hours without credentials in headers',async()=>{
 const f=fixture(url=>new Response(JSON.stringify(payload(decodeURIComponent(new URL(url).pathname.split('/')[3])))));
 const [a,b]=await Promise.all([f.analyser.stats(id),f.analyser.stats(id)]);
 assert.equal(f.calls.length,1);assert.equal(a,b);
 await f.analyser.stats('other');assert.ok(f.calls[1].time-f.calls[0].time>=1100);
 await f.analyser.stats(id,a);assert.equal(f.calls.length,2);
 assert.equal(new URL(f.calls[0].url).searchParams.get('key'),'private-key');assert.equal(f.calls[0].options.headers.Authorization,undefined);assert.equal(f.calls[0].options.redirect,'error');
 f.advance(86400001);await f.analyser.stats(id,a);assert.equal(f.calls.length,3);
});
test('rate limits and bad credentials block new requests globally and retain previous peak',async()=>{
 for(const status of [401,403,429]) {
  const f=fixture(()=>new Response('{}',{status,headers:{'retry-after':'60'}}));
  const cached=normalizeAnalyserStats(payload(),id,1);f.advance(86400001);
  const result=await f.analyser.stats(id,cached);assert.equal(result.highestElo,3043);
  await f.analyser.stats('other');assert.equal(f.calls.length,1);assert.ok(!f.analyser.status.includes('private-key'));
 }
});
test('network or schema errors use safe backoff instead of blocking the bot or leaking keys',async()=>{
 const f=fixture(()=>{throw new Error('https://example.com/?key=private-key');});
 const record=await f.analyser.stats(id);assert.ok(record.retryAt>record.attemptedAt);assert.ok(!JSON.stringify(record).includes('private-key'));assert.ok(!f.analyser.status.includes('private-key'));
 await f.analyser.stats(id,record);assert.equal(f.calls.length,1);
 const mismatch=fixture(()=>new Response(JSON.stringify(payload('wrong'))));assert.equal((await mismatch.analyser.stats(id)).highestElo,undefined);
});
test('provider peak merges with local observations in MAX and requested tag',()=>{
 const p={elo:2438,analyser:normalizeAnalyserStats(payload(),id,10000)};trackElo(p,Date.parse('2026-11-12T12:00Z'));
 assert.equal(peakElo(p),3043);assert.equal(tag(p),'2438 ELO | ↑3043');assert.match(eloNote(p),/Faceit Analyser/);
 p.elo=3100;trackElo(p,Date.parse('2026-11-12T13:00Z'));assert.equal(peakElo(p),3100);
});
test('cache survives restart but secrets and raw match data never persist',()=>{
 const dir=mkdtempSync(join(tmpdir(),'barni-analyser-'));
 try{
  const path=join(dir,'state.json'),store=new Store(path);store.state.users[1]={playerId:id};
  store.state.players[id]={id,analyser:{...normalizeAnalyserStats(payload(),id,10000),key:'private-key',matches:[{secret:'raw-game'}]}};
  store.save();const fresh=new Store(path).state.players[id];assert.equal(fresh.analyser.highestElo,3043);
  const raw=readFileSync(path,'utf8');assert.ok(!raw.includes('private-key'));assert.ok(!raw.includes('raw-game'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('source credit is visible in captions, text fallback and exported image',async()=>{
 const p={elo:2438,analyser:normalizeAnalyserStats(payload(),id,10000)};
 assert.ok(usesAnalyser({a:[p],b:[]}));assert.ok(!usesAnalyser({player:{elo:2000}}));
 assert.match(creditSvg('<svg height="748"></svg>',{player:p}),/Powered by Faceit Analyser/);
 const calls=[],bot=new Bot({tg:async(method,body)=>calls.push([method,body]),tgUpload:async(method,body)=>calls.push([method,body])},{state:{players:{},users:{},chats:{}},save(){}},{zone:'Europe/Kyiv'});
 bot.renderImage=async()=>Buffer.from('png');await bot.sendImage(1,'form',{player:p},{caption:'Form',fallback:'Text'});
 assert.match(calls.at(-1)[1].caption,/href="https:\/\/faceitanalyser.com"/);
 bot.renderImage=async()=>{throw Error();};await bot.sendImage(1,'form',{player:p},{caption:'Form',fallback:'Text'});
 assert.match(calls.at(-1)[1].text,/Powered by Faceit Analyser/);
});
test('provider cache is saved once on linked profile and reused without repeated state writes',async()=>{
 const record=normalizeAnalyserStats(payload(),id,10000),state={players:{[id]:{id,elo:2438}},users:{1:{playerId:id}},chats:{}};
 let saves=0;
 const bot=new Bot({analyser:{enabled:true,stats:async()=>record}},{state,save(){saves++;}},{zone:'Europe/Kyiv'});
 await bot.enrichPeak(state.players[id]);assert.equal(state.players[id].analyser,record);assert.equal(saves,1);
 await bot.enrichPeak(state.players[id]);assert.equal(saves,1);
});
test('missing optional key makes no provider requests',async()=>{
 let calls=0;const analyser=new FaceitAnalyser({fetcher:async()=>{calls++;throw Error();}});
 assert.equal(await analyser.stats(id),null);assert.equal(calls,0);
});
