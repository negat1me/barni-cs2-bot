import {peakElo,latestEloDay,eloLabel} from './elo-tracking.js';
import {escapeHtml as h, summary} from './domain.js';
export const numeric = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export const averageStat = (matches, key) => {
  const values = matches.map(m => numeric(m.stats?.[key])).filter(v => v != null);
  return values.length ? values.reduce((a,b) => a+b,0)/values.length : null;
};
const rate = matches => {
  const known = matches.filter(m => m.win != null);
  return known.length ? 100*known.filter(m => m.win).length/known.length : null;
};
export async function loadSamples(api, id) {
  const matches = new Map();
  for (let offset=0; offset<=200 && matches.size<20; offset+=20) {
    const data = await api.faceit(`/players/${id}/games/cs2/stats`, {limit:20, offset});
    for (const item of data.items ?? []) {
      const s=item.stats ?? {}, matchId=s['Match Id'], finished=Number(s['Match Finished At']);
      if (!matchId || !Number.isFinite(finished) || finished<=0 || matches.has(matchId)) continue;
      matches.set(matchId, {id:matchId, finished, map:s.Map, win:String(s.Result)==='1' ? true : String(s.Result)==='0' ? false : null, stats:s});
    }
    if ((data.items?.length ?? 0)<20) break;
  }
  const rows=[...matches.values()].sort((a,b)=>b.finished-a.finished).slice(0,20);
  return rows;
}
export function formCard(p, matches) {
  const recent=matches.slice(0,10), previous=matches.slice(10,20);
  const lines=[`<b>📈 ${h(p.nickname)} · Форма</b>`, `ELO ${p.elo} · MAX ${peakElo(p)??'—'} · Δ день ${eloLabel(latestEloDay(p))}`, `Останні <b>${recent.length}</b> / попередні <b>${previous.length}</b>`, ''];
  if (!recent.length) return lines.concat('Немає завершених матчів.').join('\n');
  const kd = ms => summary(ms).kd==='∞' ? Infinity : numeric(summary(ms).kd);
  const metrics=[['ADR',averageStat(recent,'ADR'),averageStat(previous,'ADR'),1,''],['K/D',kd(recent),kd(previous),2,''],['AVG K',averageStat(recent,'Kills'),averageStat(previous,'Kills'),1,''],['WR',rate(recent),rate(previous),0,'%']];
  for (const [label,current,old,digits,suffix] of metrics) {
    const display = n => n==null ? '—' : n===Infinity ? '∞' : n.toFixed(digits)+suffix;
    const change = current==null || old==null || !Number.isFinite(current) || !Number.isFinite(old) ? '' : Math.abs(current-old)<10**(-digits)/2 ? ' · →' : ` · ${current>old?'↑':'↓'} ${Math.abs(current-old).toFixed(digits)}${label==='WR'?' п.п.':''}`;
    lines.push(`${label}  <b>${display(current)}</b> / ${display(old)}${change}`);
  }
  lines.push('', summary(recent).form);
  if (matches.length<20) lines.push('<i>Неповна вибірка — потрібно 20 матчів.</i>');
  if (matches.some(m=>m.win==null || ['Kills','Deaths','ADR'].some(k=>numeric(m.stats?.[k])==null))) lines.push('<i>Середні за доступними даними.</i>');
  return lines.join('\n');
}
export function stackMaps(samples, totalPlayers) {
  const maps=new Map();
  for (const matches of samples) {
    const playerMaps=new Map();
    for (const m of matches) if (typeof m.map==='string' && m.map) {
      const list=playerMaps.get(m.map) ?? []; list.push(m); playerMaps.set(m.map,list);
    }
    for (const [name,list] of playerMaps) {
      const map=maps.get(name) ?? {name, players:0, wr:[]};
      map.players++;
      const wr=rate(list);
      if(wr!=null)map.wr.push(wr);
      maps.set(name,map);
    }
  }
  const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
  const ranked=[...maps.values()].map(m=>({...m,wr:avg(m.wr)})).sort((a,b)=>b.players-a.players || (b.wr??-1)-(a.wr??-1)).slice(0,3);
  if(!ranked.length)return '<b>🗺 Карти стаку</b>\nПоки немає даних FACEIT.';
  return ['<b>🗺 Карти стаку</b>', ...ranked.map(m=>`${h(m.name.replace(/^de_/,''))} · ${m.players}/${totalPlayers} · WR <b>${m.wr==null?'—':Math.round(m.wr)+'%'}</b>`), '<i>AVG за гравцями · останні 20 кожного</i>'].join('\n');
}
export function partyClock(text) { return /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/.exec(text ?? '')?.slice(1).map(v=>v.padStart(2,'0')).join(':') ?? null; }
export function nextPartyTime(text, zone, now=Date.now()) {
  const clock=partyClock(text); if(!clock)return null;
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  // First real local occurrence; handles DST gaps and repeated hours without fixed UTC offsets.
  for(let t=Math.ceil(now/60000)*60000;t<=now+48*3600000;t+=60000) if(formatter.format(t)===clock)return t;
  return null;
}
export function partyAction(party, user, action) {
  party.reserves ??= [];
  const id=String(user.id), active=party.participants.some(p=>p.id===id), reserve=party.reserves.some(p=>p.id===id);
  const entry={id,name:(user.first_name||'Гравець').slice(0,64)};
  if(action==='join') {
    if(active)return 'Ти вже в п’ятірці.';
    if(party.participants.length>=5)return 'П’ятірка повна. Можна стати запасним.';
    party.reserves=party.reserves.filter(p=>p.id!==id); party.participants.push(entry);
  } else if(action==='reserve') {
    if(reserve)return 'Ти вже серед запасних.';
    if(party.reserves.length>=10)return 'Список запасних повний.';
    party.participants=party.participants.filter(p=>p.id!==id); party.reserves.push(entry);
  } else {
    if(!active&&!reserve)return 'Ти ще не приєднався.';
    party.participants=party.participants.filter(p=>p.id!==id); party.reserves=party.reserves.filter(p=>p.id!==id);
  }
  // FIFO promotion when someone frees a place. A player choosing reserve stays there.
  if(active && action!=='join' && party.participants.length<5) {
    const i=party.reserves.findIndex(p=>p.id!==id);
    if(i>=0)party.participants.push(...party.reserves.splice(i,1));
  }
  return null;
}
