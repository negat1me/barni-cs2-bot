import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {analyticsWindow,dayStart,parseDelta,normalizeAnalyserMatch,buildAnalytics,applyExactDays,mapStats,bestMatches,partyMapSummary} from '../src/analytics.js';
import {FaceitAnalyser} from '../src/analyser.js';
import {eloDay,eloWeek,trackElo} from '../src/elo-tracking.js';
import {Bot} from '../src/bot.js';
import {renderStatsImage} from '../src/stats-image.js';
import {renderCommandImage} from '../src/command-images.js';
const id='p',now=Date.parse('2026-11-12T12:00Z'),zone='Europe/Kyiv';
const raw=(mid,finished)=>({match_id:mid,finished_at:finished/1000,started_at:finished/1000-1800,status:'FINISHED',teams:{faction1:{players:[{player_id:id}]}},results:{winner:'faction1',score:{faction1:13,faction2:8}}});
const source=(mid,delta=25,round=1)=>normalizeAnalyserMatch({playerId:id,matchId:mid,matchRound:round,status:'finished',game:'cs2',elo:2400,elod:`(${delta>=0?'+':''}${delta})`,map:'de_mirage',k:20,d:10,a:4,w:1,adr:90,c4:50,c2:1},id);
test('30-day window begins at local 07:00 and follows DST rather than fixed offsets',()=>{
 assert.equal(new Date(dayStart('2026-03-29',zone)).toISOString(),'2026-03-29T04:00:00.000Z');
 assert.equal(new Date(dayStart('2026-10-25',zone)).toISOString(),'2026-10-25T05:00:00.000Z');
 const w=analyticsWindow(Date.parse('2026-11-12T04:59Z'),zone);assert.equal(w.endDay,'2026-11-11');assert.equal(w.startDay,'2026-10-13');
});
test('provider deltas parse signed strings and preserve zero without inventing missing values',()=>{
 assert.equal(parseDelta('(+24)'),24);assert.equal(parseDelta('(-13)'),-13);assert.equal(parseDelta('(0)'),0);assert.equal(parseDelta(''),null);assert.equal(parseDelta('pending'),null);
 assert.equal(normalizeAnalyserMatch({playerId:'wrong',matchId:'m'},id),null);
 assert.equal(normalizeAnalyserMatch({playerId:id,matchId:'m',elo_enabled:false},id).eloDelta,0);
 assert.equal(normalizeAnalyserMatch({playerId:id,matchId:'m',status:'APPLIED',played:'1',elo_delta:'24'},id).eloDelta,24);
 assert.equal(normalizeAnalyserMatch({playerId:id,matchId:'m',status:'APPLIED',played:'0'},id),null);
});
test('exact daily Elo joins by match ID and official finish date; duplicates never multiply delta',()=>{
 const w=analyticsWindow(now,zone),before=Date.parse('2026-11-12T04:59Z'),after=Date.parse('2026-11-12T05:01Z');
 const matches=[source('a',24),source('a',24),source('b',-13),source('b',-13,2)];
 const data=buildAnalytics(id,{matches,available:true},[raw('a',before),raw('b',after)],w,zone);
 assert.equal(data.exactDays['2026-11-11'].value,24);assert.equal(data.exactDays['2026-11-12'].value,-13);
 const p={elo:2400};trackElo(p,now,zone);applyExactDays(p,data);
 assert.deepEqual(eloDay(p,'2026-11-12'),{value:-13,partial:false,source:'analyser'});
 assert.equal(eloWeek(p,'2026-11-12').source,'analyser');
 assert.equal(data.graph.points.length,2);
});
test('missing or conflicting per-match deltas prevent a false exact total',()=>{
 const w=analyticsWindow(now,zone),history=[raw('a',now-1000),raw('missing',now-2000)];
 const data=buildAnalytics(id,{matches:[source('a',20),source('a',25,2)],available:true},history,w,zone);
 assert.equal(data.matchDeltas.has('a'),false);assert.equal(data.exactDays['2026-11-12'],undefined);assert.equal(data.complete,false);
 const p={elo:2400};trackElo(p,now-10000,zone);applyExactDays(p,data);assert.equal(eloDay(p,'2026-11-12').partial,true);
});
test('maps, best games and party summaries disclose samples and never add ADR to party',()=>{
 const matches=[{...source('a'),finished:now},{...source('b'),finished:now-1,stats:{Kills:10,Deaths:0,Assists:1,ADR:100}},{...source('c'),win:null,stats:{}}];
 const maps=mapStats(matches);assert.equal(maps[0].count,3);assert.equal(maps[0].wr,100);assert.equal(maps[0].adr,95);assert.equal(maps[0].kd,3);
 assert.equal(bestMatches(matches).find(r=>r.key==='kd').value,Infinity);
 const text=partyMapSummary([[{...maps[0],count:6}],[{...maps[0],count:10,wr:50}]],3);
 assert.match(text,/2\/3/);assert.match(text,/75%/);assert.ok(!text.includes('ADR'));
});
test('provider dataset is paginated, shared across features and refreshed only when version changes',async()=>{
 let clock=10000;const calls=[];
 const analyser=new FaceitAnalyser({key:'hidden',now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async url=>{
  calls.push(new URL(url));return new Response(JSON.stringify({segments:[{playerId:id,matchId:'a',status:'finished',elo:2400,elo_delta:24}]}));
 }});
 await analyser.matches(id,'m1',now-30*86400000);await analyser.matches(id,'m1',now-30*86400000);assert.equal(calls.length,1);
 await analyser.matches(id,'m2',now-30*86400000);assert.equal(calls.length,2);assert.equal(calls[0].searchParams.get('page_size'),'500');assert.equal(calls[0].searchParams.has('date'),false);
});
test('analytics cache invalidates on completed match and preserves official day boundaries',async()=>{
 const state={players:{},users:{},chats:{}},p={id,elo:2400,matches:{a:{id:'a',finished:now}}};let requests=0;
 const api={analyser:{enabled:true,matches:async()=>{requests++;return {available:true,matches:[source('a'),source('b')]};},retryMatchesSoon(){}},history:async()=>[raw('a',now),raw('b',now-1000)]};
 const bot=new Bot(api,{state,save(){}},{zone,interval:60000});await bot.analytics(p);await bot.analytics(p);assert.equal(requests,1);
 p.matches.c={id:'c',finished:now+1000};await bot.analytics(p);assert.equal(requests,2);
});
test('graph, maps and best cards render PNG with partial and empty selections',async()=>{
 const window=analyticsWindow(now,zone),data=buildAnalytics(id,{available:true,matches:[source('a')]},[raw('a',now-1000)],window,zone);
 const player={nickname:'<Player>',elo:2400,level:10,region:'EU'};
 for(const kind of ['maps','best']){const png=await renderCommandImage(kind,{...data,player});assert.equal((await sharp(png).metadata()).width,1120);}
 const png=await renderStatsImage({player,matches:[],graph:data.graph,analyserUsed:true});assert.equal((await sharp(png).metadata()).height,1030);
 for(const graph of [{points:[],expected:0},{points:[],expected:10}])assert.ok((await renderStatsImage({player,matches:[],graph})).length>1000);
});
test('history pagination crosses the window without broken date filters or unnecessary old pages',async()=>{
 let clock=10000;const calls=[];const cutoff=now-30*86400000;
 const analyser=new FaceitAnalyser({key:'hidden',now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async url=>{
  const query=new URL(url).searchParams,page=Number(query.get('page'));calls.push(page);
  const segments=Array.from({length:500},(_,i)=>({playerId:id,matchId:`${page}-${i}`,status:'APPLIED',created_at:page===1?now-i:cutoff-1000-i}));
  return new Response(JSON.stringify({segments}));
 }});
 const data=await analyser.matches(id,'newest',cutoff);assert.deepEqual(calls,[1,2]);assert.equal(data.matches.length,1000);assert.equal(data.truncated,false);
});
test('lagging results back off, but a new completed match gets a fresh attempt',async()=>{
 let clock=10000,calls=0;
 const analyser=new FaceitAnalyser({key:'hidden',now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async()=>{calls++;return new Response(JSON.stringify({segments:[]}));}});
 await analyser.matches(id,'old');analyser.retryMatchesSoon(id);const retryAt=analyser.datasets.get(id).retryAt;
 clock+=1000;analyser.retryMatchesSoon(id);assert.equal(analyser.datasets.get(id).retryAt,retryAt);
 await analyser.matches(id,'old');assert.equal(calls,1);
 await analyser.matches(id,'new');assert.equal(calls,2);
 analyser.retryMatchesSoon(id);clock+=120001;await analyser.matches(id,'new');assert.equal(calls,3);
});
test('maps and best commands target the replied player and retain links through text fallback',async()=>{
 const calls=[],state={players:{},users:{},chats:{}},bot=new Bot({tg:async(method,body)=>calls.push([method,body])},{state,save(){}},{zone});
 let selected;
 bot.community.performanceData=async user=>{selected=user.id;return {player:{nickname:'<Target>'},period:'30 ігрових днів',maps:mapStats([source('a')]),best:bestMatches([source('a')]),complete:false,analyserUsed:true};};
 bot.renderImage=async()=>{throw Error('native module unavailable');};
 const message={chat:{id:1,type:'private'},from:{id:1},reply_to_message:{from:{id:2}}};
 await bot.handle({message:{...message,text:'/maps'}});assert.equal(selected,2);assert.match(calls.at(-1)[1].text,/&lt;Target&gt;/);assert.match(calls.at(-1)[1].text,/Powered by Faceit Analyser/);
 await bot.handle({message:{...message,text:'/bestmatch'}});assert.equal(selected,2);assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard.length,3);assert.match(calls.at(-1)[1].text,/faceit.com\/en\/cs2\/room\/a/);
});
test('performance commands fall back to official recent games with an explicit scope',async()=>{
 const bot=new Bot({}, {state:{players:{},users:{},chats:{}},save(){}},{zone});
 bot.community.profile=async()=>({id,nickname:'Player'});bot.analytics=async()=>null;bot.recent=async()=>[source('a')];bot.details=async()=>{};
 const data=await bot.community.performanceData({id:1});assert.equal(data.period,'Останні матчі · 1');assert.equal(data.analyserUsed,false);assert.equal(data.maps[0].count,1);
});
test('last match delta remains available for inactive players outside the 30-day chart',()=>{
 const data=buildAnalytics(id,{available:true,matches:[source('old',-19)]},[],analyticsWindow(now,zone),zone);
 assert.equal(data.matchDeltas.get('old'),-19);assert.equal(data.graph.points.length,0);assert.equal(data.maps.length,0);assert.equal(data.exactDays['2026-11-12'].value,0);
});
