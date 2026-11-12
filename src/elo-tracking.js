import {dayKey,previousDay,signed} from './domain.js';

export function trackElo(p,now=Date.now(),zone='Europe/Kyiv') {
  if(!Number.isFinite(p.elo)||p.elo<0)throw new Error('Некоректне Elo для відстеження.');
  const key=dayKey(now,zone);
  let tracking=p.eloTracking;
  if(!tracking||!Number.isFinite(tracking.peak)||!Number.isFinite(tracking.lastElo)||!Number.isFinite(tracking.lastAt)) {
    tracking=p.eloTracking={startedAt:now,peak:p.elo,lastElo:p.elo,lastAt:now,days:{}};
  }
  if(now<tracking.lastAt)return tracking;
  tracking.days??={};
  if(!tracking.days[key]) {
    const continuous=dayKey(tracking.lastAt,zone)===previousDay(key)&&now-tracking.lastAt<=180000;
    tracking.days[key]={start:continuous?tracking.lastElo:p.elo,end:p.elo,firstAt:now,lastAt:now,partial:!continuous};
  }
  tracking.days[key].end=p.elo;
  tracking.days[key].lastAt=now;
  tracking.peak=Math.max(tracking.peak,p.elo);
  tracking.lastElo=p.elo;tracking.lastAt=now;
  // Only rating observations and daily endpoints; never retain matches.
  for(const old of Object.keys(tracking.days).sort().slice(0,-32))delete tracking.days[old];
  return tracking;
}
export function eloDay(p,key=dayKey(),zone='Europe/Kyiv') {
  const exact=p.exactEloDays?.[key];
  if(exact&&(!Number.isFinite(exact.profileElo)||key!==Object.keys(p.eloTracking?.days??{}).sort().at(-1)||exact.profileElo===p.elo))return {value:exact.value,partial:false,source:'analyser'};
  const day=p.eloTracking?.days?.[key];
  return day&&Number.isFinite(day.start)&&Number.isFinite(day.end)?{value:day.end-day.start,partial:!!day.partial||p.missingEloDays?.includes(key)===true}:null;
}
export function eloWeek(p,key=dayKey()) {
  let current=key;const exact=[];
  for(let i=0;i<7;i++,current=previousDay(current))exact.push(eloDay(p,current));
  if(exact.every(day=>day?.source==='analyser'))return {value:exact.reduce((sum,d)=>sum+d.value,0),partial:false,source:'analyser'};
  let first=key;for(let i=0;i<6;i++)first=previousDay(first);
  const entries=Object.entries(p.eloTracking?.days??{}).filter(([k])=>k>=first&&k<=key).sort(([a],[b])=>a.localeCompare(b));
  if(!entries.length)return null;
  const [firstKey,start]=entries[0],end=entries.at(-1)[1];
  return {value:end.end-start.start,partial:firstKey!==first||!!start.partial||!!p.missingEloDays?.some(day=>day>=first&&day<=key)};
}
export const eloLabel=change=>change?`${change.partial?'~':''}${signed(change.value)}`:'—';
export const latestEloDay=p=>eloDay(p,Object.keys(p.eloTracking?.days??{}).sort().at(-1));
export const peakElo=p=>{
  const values=[p.eloTracking?.peak,p.analyser?.highestElo].filter(Number.isFinite);
  return values.length?Math.max(...values,...(Number.isFinite(p.elo)?[p.elo]:[])):null;
};
export function eloNote(p,zone='Europe/Kyiv') {
  const tracking=p.eloTracking;
  if(Number.isFinite(p.analyser?.highestElo))return 'MAX: Faceit Analyser + спостереження бота · ~ неповний день';
  if(!tracking)return 'MAX — від початку відстеження';
  const date=new Date(tracking.startedAt).toLocaleDateString('uk-UA',{timeZone:zone,day:'2-digit',month:'2-digit',year:'numeric'});
  return `MAX відстежується з ${date} · ~ зміна за неповний день`;
}
