import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {trackElo,eloDay,eloWeek,eloLabel,peakElo} from '../src/elo-tracking.js';
import {tag} from '../src/domain.js';
import {Store} from '../src/store.js';
const time=s=>Date.parse(s),zone='Europe/Kyiv';
test('first day is partial; observed peak never falls and daily change uses actual endpoints',()=>{
  const p={id:'p',elo:2000};trackElo(p,time('2026-11-11T12:00Z'),zone);
  assert.equal(eloLabel(eloDay(p,'2026-11-11')),'~0');
  p.elo=2051;trackElo(p,time('2026-11-11T13:00Z'),zone);
  assert.equal(eloLabel(eloDay(p,'2026-11-11')),'~+51');
  p.elo=1970;trackElo(p,time('2026-11-11T14:00Z'),zone);
  assert.equal(peakElo(p),2051);assert.equal(eloDay(p,'2026-11-11').value,-30);
  assert.equal(eloDay(p,'2026-11-10'),null);
});
test('continuous 07:00 rollover carries the last baseline; outages start a partial period',()=>{
  const p={elo:2400};trackElo(p,time('2026-11-12T04:59:30Z'),zone);
  p.elo=2425;trackElo(p,time('2026-11-12T05:00:30Z'),zone);
  assert.deepEqual(eloDay(p,'2026-11-12'),{value:25,partial:false});
  assert.equal(eloDay(p,'2026-11-11').value,0);
  p.elo=2500;trackElo(p,time('2026-11-13T06:00Z'),zone);
  assert.deepEqual(eloDay(p,'2026-11-13'),{value:0,partial:true});
  p.elo=2450;trackElo(p,time('2026-11-13T07:00Z'),zone);
  assert.equal(eloLabel(eloDay(p,'2026-11-13')),'~-50');assert.equal(peakElo(p),2500);
});
test('DST rollover follows the local 07:00 cutoff',()=>{
  for(const [before,after,key] of [['2026-03-29T03:59:30Z','2026-03-29T04:00:30Z','2026-03-29'],['2026-10-25T04:59:30Z','2026-10-25T05:00:30Z','2026-10-25']]) {
    const p={elo:2000};trackElo(p,time(before),zone);p.elo=2010;trackElo(p,time(after),zone);
    assert.deepEqual(eloDay(p,key),{value:10,partial:false});
  }
});
test('weekly delta uses endpoints across missing days; old observations do not overwrite newer ones',()=>{
  const p={eloTracking:{days:{'2026-11-05':{start:2000,end:2020,partial:false},'2026-11-11':{start:2050,end:2100,partial:true}}}};
  assert.deepEqual(eloWeek(p,'2026-11-11'),{value:100,partial:false});
  assert.equal(eloWeek(p,'2026-11-10').partial,true);
  const live={elo:2000};trackElo(live,time('2026-11-11T13:00Z'),zone);live.elo=1900;trackElo(live,time('2026-11-11T12:00Z'),zone);
  assert.equal(live.eloTracking.lastElo,2000);
});
test('Elo snapshots and peak survive restart without games, metrics or unknown fields',()=>{
  const dir=mkdtempSync(join(tmpdir(),'barni-elo-'));
  try {
    const file=join(dir,'state.json'),store=new Store(file);
    store.state.users[1]={playerId:'p'};const p=store.state.players.p={id:'p',elo:2000,matches:{secret:{stats:{Kills:40}}}};
    trackElo(p,time('2026-11-11T12:00Z'),zone);p.elo=2051;trackElo(p,time('2026-11-11T13:00Z'),zone);
    p.eloTracking.secretMatch={id:'secret'};store.save();
    const reloaded=new Store(file),next=reloaded.state.players.p;
    assert.equal(peakElo(next),2051);assert.equal(eloDay(next,'2026-11-11').value,51);
    assert.ok(!readFileSync(file,'utf8').includes('secret'));assert.equal(next.matches,undefined);
    next.elo=2000;trackElo(next,time('2026-11-11T14:00Z'),zone);assert.equal(peakElo(next),2051);
    for(let i=0;i<40;i++)trackElo(next,time('2026-11-12T12:00Z')+i*86400000,zone);
    assert.equal(Object.keys(next.eloTracking.days).length,32);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('tag uses exact requested current/maximum format and never includes daily change',()=>{
  const p={elo:2438,eloTracking:{peak:4242}};
  assert.equal(tag(p),'2438 ELO | ↑4242');assert.equal(tag(p).length,16);assert.ok(!tag(p).includes('+'));
  assert.ok(tag({elo:12345,eloTracking:{peak:15000}}).length<=16);
});
