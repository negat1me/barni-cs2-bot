import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {leaderboardPages,leaderboardSvg,compareModel,compareSvg,better,lastModel,lastSvg,formModel,formSvg,renderCommandImage} from '../src/command-images.js';
const a={id:'a',nickname:'<Alpha>&',elo:2438,level:10,region:'EU'};
const b={id:'b',nickname:'Bravo',elo:2200,level:10,region:'EU'};
const sample=(win,k=20,d=10)=>({win,stats:{Kills:String(k),Deaths:String(d),Assists:'5',ADR:'90','Headshots %':'50','K/R Ratio':'0.9'}});
const aMatches=Array.from({length:20},(_,i)=>sample(i<14));
const bMatches=Array.from({length:20},(_,i)=>sample(i<10,15,15));
const match={...sample(true),id:'m',map:'de_mirage',ownScore:13,opponentScore:8,team:'<Home>',opponent:'Away',started:Date.parse('2026-11-11T12:00Z'),finished:Date.parse('2026-11-11T12:35Z'),region:'EU'};
test('leaderboard pagination preserves all rows and positions, including empty chat',()=>{
 const rows=Array.from({length:23},(_,i)=>({p:{...a,nickname:'Player'+i},matches:aMatches}));
 const pages=leaderboardPages(rows);assert.deepEqual(pages.map(p=>p.rows.length),[10,10,3]);
 assert.deepEqual(pages.flatMap(p=>p.rows),rows);assert.deepEqual(pages.map(p=>p.offset),[0,10,20]);
 assert.match(leaderboardSvg({...pages[1],page:2,pages:3}),/>11<\/text>/);
 assert.equal(leaderboardPages([]).length,1);assert.throws(()=>leaderboardPages(rows,0));
 const svg=leaderboardSvg({rows:[{p:a,matches:[sample(true),{win:null}]}],kind:'summary',day:'2026-11-11'});
 assert.match(svg,/100%/);assert.match(svg,/невідомі результати/);assert.ok(!svg.includes('<Alpha>'));
});
test('compare highlights correct direction, missing values and displayed ties',()=>{
 assert.equal(better(2,1),-1);assert.equal(better(2,1,0,true),1);
 assert.equal(better(null,1),0);assert.equal(better(1.271,1.274,2),0);
 assert.equal(better(Infinity,2,2),-1);assert.equal(better(Infinity,Infinity,2),0);
 const m=compareModel({a,b,aMatches,bMatches});
 assert.deepEqual(m.metrics[2].left,[20,10,5]);assert.equal(m.metrics[3].left,2);
 const svg=compareSvg(m);assert.match(svg,/&lt;Alpha&gt;&amp;/);assert.ok(!svg.includes('<Alpha>'));
 assert.match(svg,/fill="#64d9a0">20/);assert.match(svg,/fill="#64d9a0">10/);
});
test('last-match model uses own score, real result, integer KDA and available multikills',()=>{
 const m=lastModel({player:a,match:{...match,stats:{...match.stats,'Penta Kills':'1','Double Kills':'0'}}});
 assert.equal(m.score,'13 : 8');assert.equal(m.result,'WIN');assert.equal(m.kda,'20/10/5');assert.equal(m.multi,'ACE 1');
 assert.match(m.context,/35 хв/);assert.match(lastSvg(m),/&lt;Home&gt;/);
 const unknown=lastModel({player:a,match:{stats:{},win:null}});assert.equal(unknown.result,'Результат —');assert.equal(unknown.kda,'—/—/—');assert.equal(unknown.adr,'—');assert.equal(unknown.hs,'—');
});
test('form uses disjoint groups and percentage-point deltas without inventing missing values',()=>{
 const m=formModel({player:a,matches:[...Array.from({length:10},()=>sample(true,20)),...Array.from({length:10},()=>sample(false,10))]});
 assert.equal(m.metrics.find(m=>m.label==='AVG K').delta,10);assert.equal(m.metrics.find(m=>m.label==='WIN RATE').delta,100);
 assert.match(formSvg(m),/100 п.п./);assert.equal(m.incomplete,false);
 const partial=formModel({player:a,matches:[sample(true)]});assert.equal(partial.previous.length,0);assert.equal(partial.metrics[0].old,null);assert.equal(partial.metrics[0].delta,null);assert.equal(partial.incomplete,true);
});
test('all five commands and empty selections render square PNGs within Telegram photo dimensions',async()=>{
 const cases=[['top',{rows:Array.from({length:10},()=>({p:a}))}],['summary',{rows:[{p:a,matches:aMatches}],day:'2026-11-11'}],['compare',{a,b,aMatches,bMatches}],['last',{player:a,match}],['form',{player:a,matches:aMatches}],['top',{rows:[]}],['summary',{rows:[]}],['compare',{a,b,aMatches:[],bMatches:[]}],['last',{player:a,match:{stats:{},win:null}}],['form',{player:a,matches:[]}]];
 for(const [kind,data] of cases) {
  const png=await renderCommandImage(kind,data);assert.equal(png.subarray(1,4).toString(),'PNG',kind);
  const {data:raw,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,1120);assert.ok(info.width+info.height<10000);
  assert.equal(raw[3],255,kind);assert.equal(raw.at(-1),255,kind);
 }
 await assert.rejects(renderCommandImage('unknown',{}));
});
