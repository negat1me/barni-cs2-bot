import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSamples,formCard,stackMaps,partyAction,nextPartyTime} from '../src/insights.js';
test('stat sample is ordered by finish time and duplicate matches are not double counted',async()=>{
  const sample=(id,time)=>({stats:{'Match Id':id,'Match Finished At':time,Map:'de_mirage',Result:'1',ADR:'80'}});
  const api={faceit:async()=>({items:[sample('a',100),sample('b',200),sample('a',100),{stats:{}}]})};
  assert.deepEqual((await loadSamples(api,'p')).map(m=>m.id),['b','a']);
});
test('form compares two disjoint groups and uses percentage points for WR',()=>{
  const matches=Array.from({length:20},(_,i)=>({win:i<10,stats:{Kills:i<10?'20':'10',Deaths:'10',ADR:i<10?'90':'70'}}));
  const card=formCard({nickname:'barni'},matches);
  assert.match(card,/ADR  <b>90.0<\/b> \/ 70.0 · ↑ 20.0/);
  assert.match(card,/WR  <b>100%<\/b> \/ 0% · ↑ 100 п.п./);
  assert.match(formCard({nickname:'barni'},matches.slice(0,3)),/Неповна вибірка/);
  assert.match(formCard({nickname:'barni'},[]),/Немає завершених/);
});
test('map ranking favors coverage; WR is an average per player, not a joint team claim',()=>{
  const match=(map,win,adr)=>({map,win,stats:{ADR:String(adr)}});
  const text=stackMaps([[match('de_mirage',true,100),match('de_nuke',true,60)],[match('de_mirage',false,80)]],3);
  assert.match(text,/mirage · 2\/3 · WR <b>50%<\/b>/);
  assert.ok(text.indexOf('mirage')<text.indexOf('nuke'));
  assert.match(stackMaps([],5),/немає даних/);
});
test('reserve is unique, leaves both lists and promotes first reserve into a free slot',()=>{
  const p={participants:Array.from({length:5},(_,i)=>({id:String(i+1)}))};
  assert.equal(partyAction(p,{id:6},'reserve'),null);
  assert.match(partyAction(p,{id:6},'reserve'),/вже/);
  partyAction(p,{id:2},'leave');
  assert.deepEqual(p.participants.map(x=>x.id),['1','3','4','5','6']);
  assert.equal(p.reserves.length,0);
  partyAction(p,{id:6},'reserve');
  assert.equal(p.reserves[0].id,'6');assert.equal(p.participants.length,4);
  partyAction(p,{id:6},'join');assert.equal(p.reserves.length,0);
});
test('scheduled clock uses Kyiv time, rolls past times to next day and handles DST',()=>{
  assert.equal(new Date(nextPartyTime('на 19:00','Europe/Kyiv',Date.parse('2026-11-11T12:00Z'))).toISOString(),'2026-11-11T17:00:00.000Z');
  assert.equal(new Date(nextPartyTime('на 19:00','Europe/Kyiv',Date.parse('2026-11-11T18:00Z'))).toISOString(),'2026-11-12T17:00:00.000Z');
  assert.equal(nextPartyTime('без часу','Europe/Kyiv'),null);
  const spring=nextPartyTime('03:30','Europe/Kyiv',Date.parse('2026-03-28T22:00Z'));
  const local=new Date(spring).toLocaleString('en-GB',{timeZone:'Europe/Kyiv',hourCycle:'h23'});
  assert.match(local,/30\/03\/2026, 03:30/);
});
