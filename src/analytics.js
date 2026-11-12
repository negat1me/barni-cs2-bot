import {dayKey,previousDay,normalizeMatch,escapeHtml as h} from './domain.js';
import {numeric,averageStat} from './insights.js';

export function dayStart(key,zone='Europe/Kyiv') {
  const target=Date.parse(`${key}T07:00:00Z`);
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let time=target;
  for(let i=0;i<4;i++) {
    const parts=formatter.formatToParts(time),get=type=>Number(parts.find(p=>p.type===type).value);
    const local=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'));
    const correction=target-local;if(!correction)break;time+=correction;
  }
  return time;
}
export function analyticsWindow(now=Date.now(),zone='Europe/Kyiv') {
  const endDay=dayKey(now,zone);let startDay=endDay;
  for(let i=0;i<29;i++)startDay=previousDay(startDay);
  const from=dayStart(startDay,zone);
  return {from,to:now,startDay,endDay};
}
export function parseDelta(value) {
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string')return null;
  const match=/^\s*\(?\s*([+-]?\d+(?:\.\d+)?)\s*\)?\s*$/.exec(value);
  return match?Number(match[1]):null;
}
export function normalizeAnalyserMatch(raw,id) {
  if(!raw||String(raw.playerId??raw._id?.playerId).toLowerCase()!==id.toLowerCase()||raw.game&&raw.game!=='cs2')return null;
  const matchId=raw.matchId??raw.mid??raw._id?.matchId;
  if(typeof matchId!=='string'||!matchId)return null;
  if(raw.status&&!['finished','applied'].includes(String(raw.status).toLowerCase()))return null;
  if(raw.played===false||String(raw.played)==='0')return null;
  const stat=(...keys)=>{for(const k of keys){const n=numeric(raw[k]);if(n!=null)return n;}return null;};
  const delta=raw.elo_enabled===false?0:parseDelta(raw.elo_delta)??parseDelta(raw.elod);
  const kills=stat('k','i6'),deaths=stat('d','i8'),assists=stat('a','i7');
  return {id:matchId,round:String(raw.matchRound??'1'),elo:stat('elo'),eloDelta:delta,
    date:typeof raw.date==='string'?raw.date:null,map:raw.map??raw.i1,
    win:String(raw.w??raw.i10)==='1'?true:String(raw.w??raw.i10)==='0'?false:null,
    started:stat('created_at'),stats:{Kills:kills,Deaths:deaths,Assists:assists,ADR:stat('adr','c10'),'Headshots %':stat('c4'),'K/R Ratio':stat('krr','c3'),
      'Quadro Kills':stat('i15'),'Penta Kills':stat('i16'),'Triple Kills':stat('i14')},
    score:raw.s??raw.i18,url:`https://www.faceit.com/en/cs2/room/${encodeURIComponent(matchId)}`,source:'analyser'};
}
export function mapStats(matches) {
  const groups=new Map();
  for(const m of matches)if(m.map){const rows=groups.get(m.map)??[];rows.push(m);groups.set(m.map,rows);}
  return [...groups].map(([map,rows])=>{
    const wins=rows.filter(m=>m.win===true).length,losses=rows.filter(m=>m.win===false).length;
    const paired=rows.filter(m=>numeric(m.stats?.Kills)!=null&&numeric(m.stats?.Deaths)!=null);
    const kills=paired.reduce((s,m)=>s+Number(m.stats.Kills),0),deaths=paired.reduce((s,m)=>s+Number(m.stats.Deaths),0);
    return {map,count:rows.length,known:wins+losses,wins,losses,wr:wins+losses?100*wins/(wins+losses):null,adr:averageStat(rows,'ADR'),kd:paired.length?(deaths?kills/deaths:kills?Infinity:null):null};
  }).sort((a,b)=>b.count-a.count||a.map.localeCompare(b.map));
}
export function bestMatches(matches) {
  const metric=(label,key,value)=>{
    const rows=matches.map(match=>({match,value:value(match)})).filter(v=>v.value!=null);
    rows.sort((a,b)=>b.value-a.value||b.match.finished-a.match.finished);
    return {label,key,match:rows[0]?.match??null,value:rows[0]?.value??null,covered:new Set(rows.map(row=>row.match.id)).size};
  };
  return [metric('Фраги','kills',m=>numeric(m.stats?.Kills)),metric('ADR','adr',m=>numeric(m.stats?.ADR)),metric('K/D','kd',m=>{
    const k=numeric(m.stats?.Kills),d=numeric(m.stats?.Deaths);return k==null||d==null?null:d?k/d:k?Infinity:null;
  })];
}
export function buildAnalytics(id,dataset,rawHistory,window,zone='Europe/Kyiv') {
  const history=rawHistory.map(m=>normalizeMatch(m,id)).filter(m=>m.finished).sort((a,b)=>b.finished-a.finished);
  const indexed=new Map(history.map(m=>[m.id,m])),rows=[],seen=new Set(),deltaGroups=new Map();
  for(const m of dataset?.matches??[]) {
    const key=`${m.id}:${m.round}`;if(seen.has(key))continue;seen.add(key);
    const deltas=deltaGroups.get(m.id)??[];deltas.push(m.eloDelta);deltaGroups.set(m.id,deltas);
    const official=indexed.get(m.id);if(!official)continue;
    rows.push({...m,...official,map:m.map,stats:m.stats,elo:m.elo,eloDelta:m.eloDelta,round:m.round,win:official.win??m.win,score:official.score||m.score,source:'analyser'});
  }
  rows.sort((a,b)=>b.finished-a.finished||Number(b.round)-Number(a.round));
  const groups=new Map();for(const m of rows){const list=groups.get(m.id)??[];list.push(m);groups.set(m.id,list);}
  const matchDeltas=new Map();
  for(const [key,values] of deltaGroups) {
    if(values.every(v=>v!=null)&&new Set(values).size===1)matchDeltas.set(key,values[0]);
  }
  const exactDays={},missingDays=[];
  let key=window.endDay;
  for(let i=0;i<30;i++,key=previousDay(key)) {
    const games=history.filter(m=>m.finished>=window.from&&m.finished<=window.to&&dayKey(m.finished,zone)===key);
    if(dataset?.available&&games.every(m=>matchDeltas.has(m.id)))exactDays[key]={value:games.reduce((sum,m)=>sum+matchDeltas.get(m.id),0),partial:false,source:'analyser',count:games.length};
    else missingDays.push(key);
  }
  const games=history.filter(m=>m.finished>=window.from&&m.finished<=window.to);
  const selected=rows.filter(m=>m.finished>=window.from&&m.finished<=window.to);
  const unique=[...groups.values()].map(list=>list[0]).filter(m=>m.finished>=window.from&&m.finished<=window.to);
  const points=unique.filter(m=>Number.isFinite(m.elo)&&m.elo>=0).sort((a,b)=>a.finished-b.finished).map(m=>({time:m.finished,elo:m.elo,id:m.id}));
  const covered=new Set(selected.map(m=>m.id)).size;
  const complete=!!dataset?.available&&covered===games.length&&!dataset.truncated&&!dataset.stale;
  const best=bestMatches(selected);
  return {matches:selected,history,matchDeltas,exactDays,missingDays,maps:mapStats(selected),best,graph:{points,from:window.from,to:window.to,expected:games.length,covered:points.length,complete:complete&&points.length===games.length},
    window,expected:games.length,covered,mapCovered:new Set(selected.filter(m=>m.map).map(m=>m.id)).size,bestComplete:complete&&best.every(record=>record.covered===games.length),complete,stale:!!dataset?.stale,period:'30 ігрових днів',analyserUsed:!!dataset?.available,available:!!dataset?.available};
}
export function applyExactDays(p,data) {
  p.exactEloDays=Object.fromEntries(Object.entries(data.exactDays).map(([key,value])=>[key,{...value,profileElo:p.elo}]));
  p.missingEloDays=data.missingDays;
}
export function partyMapSummary(sets,total,mixed=false) {
  const maps=new Map();
  for(const rows of sets)for(const row of rows)if(row.count>=5&&row.wr!=null) {
    const entry=maps.get(row.map)??{name:row.map,players:0,rates:[],count:0};
    entry.players++;entry.rates.push(row.wr);entry.count+=row.count;maps.set(row.map,entry);
  }
  const ranked=[...maps.values()].map(m=>({...m,wr:m.rates.reduce((a,b)=>a+b,0)/m.rates.length})).sort((a,b)=>b.players-a.players||b.wr-a.wr).slice(0,3);
  return ['<b>🗺 Карти стаку</b>',...ranked.map(m=>`${h(m.name.replace(/^de_/,''))} · ${m.players}/${total} · WR <b>${Math.round(m.wr)}%</b> · N ${m.count}`),
    ...(!ranked.length?['Замало даних: потрібно 5 матчів на карту.']:[]),`<i>AVG за гравцями · 30 днів${mixed?' / останні 20 без Analyser':''} · не лише спільні матчі</i>`].join('\n');
}
