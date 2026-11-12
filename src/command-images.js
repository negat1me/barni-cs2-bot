import {colors as c, n, text as t, box as b, trim, avatarPng, renderSvg} from './stats-image.js';
import {summary, escapeHtml as xml} from './domain.js';
import {averageStat, numeric} from './insights.js';

const middle='text-anchor="middle"', end='text-anchor="end"';
const fmt=(v,d=0,s='')=>v===Infinity?'∞':n(v,d,s);
const ratio=matches=>summary(matches).kd==='∞'?Infinity:numeric(summary(matches).kd);
const wr=matches=>{const s=summary(matches);return s.wins+s.losses?100*s.wins/(s.wins+s.losses):null;};
const kda=matches=>['Kills','Deaths','Assists'].map(key=>averageStat(matches,key));
const partial=matches=>matches.some(m=>m.win==null || ['Kills','Deaths','Assists','ADR','Headshots %','K/R Ratio'].some(key=>numeric(m.stats?.[key])==null));
const profileUrl=p=>`https://www.faceit.com/en/players/${encodeURIComponent(p.nickname)}`;
export {profileUrl};

function frame(height,title,subtitle,body,footer='FACEIT · CS2') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="${height}" viewBox="0 0 1120 ${height}">
    <defs><linearGradient id="glow"><stop stop-color="#ff762d" stop-opacity=".14"/><stop offset="1" stop-color="#ff762d" stop-opacity="0"/></linearGradient></defs>
    <g font-family="Noto Sans"><rect width="1120" height="${height}" fill="${c.bg}"/>
    <path d="M1120 0H720L980 180H1120Z" fill="url(#glow)"/>
    <path d="M44 36h18l-5 12H44z" fill="${c.orange}"/>${t(74,49,'BARNI',19,c.text,700)}${t(166,49,'/ FACEIT CS2',17,c.muted)}
    ${t(1076,49,title,18,c.orange,700,end)}${subtitle?t(44,105,subtitle,30,c.text,700):''}
    ${body}${t(44,height-28,footer,16,c.muted)}</g></svg>`;
}
function portrait(p,image,x,y,size,id) {
  const r=size/2;
  const face=image?`<defs><clipPath id="${id}"><circle cx="${x+r}" cy="${y+r}" r="${r}"/></clipPath></defs><image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${image.toString('base64')}" clip-path="url(#${id})"/>`
    :b(x,y,size,size,'#30384b',r)+t(x+r,y+size*.68,String(p.nickname??'?').slice(0,1).toUpperCase(),size*.45,c.text,700,middle);
  return face+`<circle cx="${x+r}" cy="${y+r}" r="${r}" fill="none" stroke="${c.stroke}" stroke-width="2"/>`;
}
function playerName(x,y,name,width,maxChars=28,size=36) {
  const value=trim(name,maxChars);
  return t(x,y,value,Math.min(size,width/Math.max(1,value.length*.96)),c.text,700);
}
function playerHeader(p,image) {
  return portrait(p,image,44,88,96,'player-avatar')+playerName(164,130,p.nickname,680)+t(164,166,`LVL ${p.level??'—'}  ·  ${p.region??'CS2'}`,19,c.muted)+t(1076,124,fmt(p.elo),47,c.orange,700,end)+t(1076,160,'ELO · поточне',16,c.muted,400,end);
}
function formStrip(matches,x,y,limit=5) {
  return matches.slice(0,limit).map((m,i)=>{
    const win=m.win===true,loss=m.win===false;
    return b(x+i*48,y,38,34,win?'#1f3c34':loss?'#422c36':'#2a3040',8)+t(x+i*48+19,y+24,win?'W':loss?'L':'—',17,win?c.green:loss?c.red:c.muted,700,middle);
  }).join('');
}
export function leaderboardPages(rows,size=10) {
  if(!Number.isInteger(size)||size<1||size>10)throw new Error('Page size must be 1–10');
  const pages=[];
  for(let i=0;i<rows.length;i+=size)pages.push({rows:rows.slice(i,i+size),offset:i});
  return pages.length?pages:[{rows:[],offset:0}];
}
export function leaderboardSvg({rows,kind='top',day='',offset=0,page=1,pages=1,zone='Europe/Kyiv'},avatars=[]) {
  const daily=kind==='summary', h=rows.length?230+rows.length*84:340;
  const palette=['#edc775','#bdc9df','#d69e7a'];
  let body=t(72,160,'#',17,c.muted,700)+t(daily?125:200,160,'ГРАВЕЦЬ',17,c.muted,700);
  body+=daily?t(658,160,'МАТЧІ',17,c.muted,700,middle)+t(841,160,'W / L',17,c.muted,700,middle)+t(1048,160,'WR',17,c.muted,700,end)
    :t(790,160,'LVL',17,c.muted,700,middle)+t(1048,160,'ELO',17,c.muted,700,end);
  rows.forEach(({p,matches=[]},i)=>{
    const y=180+i*84,place=offset+i+1,color=!daily&&place<=3?palette[place-1]:c.muted;
    body+=b(44,y,1032,72,!daily&&place<=3?['#2b271f','#242a36','#2e2524'][place-1]:c.panel,12)+t(72,y+45,place,25,color,700);
    if(daily) {
      const s=summary(matches);
      body+=playerName(125,y+31,p.nickname,420,27,23)+t(125,y+55,`${fmt(p.elo)} ELO`,16,c.muted)
        +t(658,y+45,matches.length,27,c.text,700,middle)
        +`<text x="841" y="${y+45}" font-size="25" font-weight="700" text-anchor="middle"><tspan fill="${c.green}">${s.wins}</tspan><tspan fill="${c.muted}"> / </tspan><tspan fill="${c.red}">${s.losses}</tspan></text>`
        +t(1048,y+45,fmt(wr(matches),0,'%'),27,c.text,700,end);
    } else body+=portrait(p,avatars[i],125,y+12,48,`row-avatar-${i}`)+playerName(200,y+45,p.nickname,480,29,25)+t(790,y+45,fmt(p.level),25,c.muted,700,middle)+t(1048,y+46,fmt(p.elo),33,color===c.muted?c.orange:color,700,end);
  });
  if(!rows.length)body+=t(560,246,'Поки немає результатів',25,c.muted,400,middle);
  const missing=rows.some(r=>r.matches?.some(m=>m.win==null));
  const footer=(daily?`Доба 07:00–07:00 · ${zone} · порядок за поточним Elo`:'Поточний Elo · учасники чату')+(missing?' · є невідомі результати':'')+(pages>1?` · ${page}/${pages}`:'');
  return frame(h,daily?'SUMMARY':'LEADERBOARD',daily?`Підсумок · ${day.split('-').reverse().join('.')}`:'Топ чату',body,footer);
}

export function compareModel({a,b,aMatches,bMatches}) {
  const metric=(label,left,right,digits=0,suffix='')=>({label,left,right,digits,suffix});
  return {a,b,aMatches,bMatches,metrics:[
    metric('ELO',numeric(a.elo),numeric(b.elo)), metric('WIN RATE',wr(aMatches),wr(bMatches),0,'%'),
    {label:'K/D/A',left:kda(aMatches),right:kda(bMatches),parts:true},
    metric('K/D',ratio(aMatches),ratio(bMatches),2), metric('ADR',averageStat(aMatches,'ADR'),averageStat(bMatches,'ADR'),1),
    metric('HS',averageStat(aMatches,'Headshots %'),averageStat(bMatches,'Headshots %'),0,'%'),
    metric('K/R',averageStat(aMatches,'K/R Ratio'),averageStat(bMatches,'K/R Ratio'),2)
  ],incomplete:partial(aMatches)||partial(bMatches)};
}
// Compare the displayed precision; equal-looking numbers stay neutral.
export function better(left,right,digits=0,lower=false) {
  if(left==null||right==null)return 0;
  const a=Number.isFinite(left)?Number(left.toFixed(digits)):left,b=Number.isFinite(right)?Number(right.toFixed(digits)):right;
  if(a===b)return 0;
  return (lower?a<b:a>b)?-1:1;
}
function compared(metric,x,y,side) {
  if(metric.parts) {
    // Deaths are better when lower; compare each component separately.
    return `<text x="${x}" y="${y}" font-size="30" font-weight="700" text-anchor="middle">`+metric[side].map((v,i)=>{
      const winner=better(metric.left[i],metric.right[i],0,i===1);
      return `${i?`<tspan fill="${c.muted}">/</tspan>`:''}<tspan fill="${winner===(side==='left'?-1:1)?c.green:c.text}">${xml(fmt(v))}</tspan>`;
    }).join('')+'</text>';
  }
  const winner=better(metric.left,metric.right,metric.digits);
  return t(x,y,fmt(metric[side],metric.digits,metric.suffix),32,winner===(side==='left'?-1:1)?c.green:c.text,700,middle);
}
export function compareSvg(model,avatars=[]) {
  const {a,b:other,aMatches,bMatches}=model;
  let body=b(44,88,498,116)+b(578,88,498,116)+portrait(a,avatars[0],68,106,76,'a-avatar')+portrait(other,avatars[1],602,106,76,'b-avatar')
    +playerName(164,138,a.nickname,350,20,28)+playerName(698,138,other.nickname,350,20,28)
    +t(164,174,`LVL ${a.level??'—'} · ${aMatches.length} матчів`,18,c.muted)+t(698,174,`LVL ${other.level??'—'} · ${bMatches.length} матчів`,18,c.muted);
  model.metrics.forEach((metric,i)=>{
    const y=228+i*68;
    body+=b(44,y,1032,58)+t(560,y+36,metric.label,17,c.muted,700,middle)+compared(metric,286,y+40,'left')+compared(metric,832,y+40,'right');
  });
  body+=formStrip(aMatches,170,730)+formStrip(bMatches,704,730);
  return frame(826,'COMPARE','',body,`Останні до 20 матчів · AVG / матч · ELO поточне${model.incomplete?' · неповні дані':''}`);
}

export function lastModel({player,match:m},zone='Europe/Kyiv') {
  const s=m.stats??{},own=numeric(m.ownScore),opponent=numeric(m.opponentScore);
  const date=Number.isFinite(m.finished)&&m.finished>0?new Date(m.finished).toLocaleString('uk-UA',{timeZone:zone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  const duration=m.started>0&&m.finished>m.started?`${Math.round((m.finished-m.started)/60000)} хв`:'';
  return {player,match:m,result:m.win===true?'WIN':m.win===false?'LOSS':'Результат —',color:m.win===true?c.green:m.win===false?c.red:c.muted,
    score:own!=null&&opponent!=null?`${own} : ${opponent}`:m.score||'—',
    map:String(m.map??'Карта —').replace(/^de_/,''),context:[date,duration,m.region].filter(Boolean).join(' · '),
    kda:['Kills','Deaths','Assists'].map(k=>fmt(s[k])).join('/'),kd:fmt(ratio([m]),2),
    adr:fmt(s.ADR,1),hs:fmt(s['Headshots %'],0,'%'),kr:fmt(s['K/R Ratio'],2),
    multi:[['2K','Double Kills'],['3K','Triple Kills'],['4K','Quadro Kills'],['ACE','Penta Kills']].filter(([,k])=>numeric(s[k])>0).map(([label,key])=>`${label} ${fmt(s[key])}`).join('   ·   '),incomplete:partial([m])};
}
export function lastSvg(model,avatars=[]) {
  const m=model.match;
  let body=playerHeader(model.player,avatars[0])+b(44,220,1032,164)+t(68,260,model.result,22,model.color,700)
    +t(68,328,trim(model.map.toUpperCase(),21),48,c.text,700)+t(1048,326,model.score,70,model.color,700,end)
    +t(68,362,trim(m.team??'—',33),19,c.muted)+t(1048,362,trim(m.opponent??'—',33),19,c.muted,400,end);
  const metrics=[['K/D/A',model.kda,390],['K/D',model.kd,214],['ADR',model.adr,214],['HS',model.hs,214]];
  let x=44;body+=b(44,410,1032,110);
  for(const [label,value,width] of metrics){body+=t(x+24,445,label,18,c.muted,700)+t(x+24,494,value,label==='K/D/A'?43:39,c.text,700);x+=width;}
  body+=b(44,542,1032,84)+t(68,573,'K/R',17,c.muted,700)+t(68,607,model.kr,27,c.text,700)+t(300,594,model.multi||'CS2 · матч завершено',23,c.muted);
  body+=t(44,674,model.context,20,c.muted);
  return frame(740,'ОСТАННІЙ МАТЧ','',body,`LVL / ELO — поточні${model.incomplete?' · частина показників недоступна':''}`);
}

export function formModel({player,matches}) {
  const recent=matches.slice(0,10),previous=matches.slice(10,20);
  const entries=[['ADR',averageStat(recent,'ADR'),averageStat(previous,'ADR'),1,''],['K/D',ratio(recent),ratio(previous),2,''],['AVG K',averageStat(recent,'Kills'),averageStat(previous,'Kills'),0,''],['WIN RATE',wr(recent),wr(previous),0,'%']];
  const metrics=entries.map(([label,current,old,digits,suffix])=>{
    const delta=current!=null&&old!=null&&Number.isFinite(current)&&Number.isFinite(old)?Number((current-old).toFixed(digits)):null;
    return {label,current,old,digits,suffix,delta};
  });
  return {player,recent,previous,metrics,incomplete:matches.length<20||matches.some(m=>m.win==null||['Kills','Deaths','ADR'].some(k=>numeric(m.stats?.[k])==null))};
}
export function formSvg(model,avatars=[]) {
  let body=playerHeader(model.player,avatars[0])+t(68,248,'ПОКАЗНИК',17,c.muted,700)+t(476,248,`Попередні ${model.previous.length}`,19,c.muted,700,middle)+t(748,248,`Останні ${model.recent.length}`,19,c.text,700,middle)+t(1048,248,'ЗМІНА',17,c.muted,700,end);
  model.metrics.forEach((metric,i)=>{
    const y=270+i*90,color=metric.delta==null||metric.delta===0?c.muted:metric.delta>0?c.green:c.red;
    const delta=metric.delta==null?'—':`${fmt(Math.abs(metric.delta),metric.digits)}${metric.label==='WIN RATE'?' п.п.':''}`;
    // Vector arrows keep the same appearance without relying on extra symbol fonts.
    const arrow=metric.delta==null?'':`<path d="${metric.delta===0?`M887 ${y+38}H903M897 ${y+32}L903 ${y+38}L897 ${y+44}`:metric.delta>0?`M895 ${y+47}V${y+29}M889 ${y+35}L895 ${y+29}L901 ${y+35}`:`M895 ${y+29}V${y+47}M889 ${y+41}L895 ${y+47}L901 ${y+41}`}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    body+=b(44,y,1032,76)+t(68,y+48,metric.label,22,c.muted,700)+t(476,y+50,fmt(metric.old,metric.digits,metric.suffix),32,c.muted,700,middle)+t(748,y+50,fmt(metric.current,metric.digits,metric.suffix),35,color===c.muted?c.text:color,700,middle)+arrow+t(1048,y+48,delta,24,color,700,end);
  });
  body+=model.recent.length?t(44,685,'ОСТАННІ',17,c.muted,700)+formStrip(model.recent,220,660,10):t(44,686,'Завершених матчів немає',23,c.muted);
  return frame(758,'ФОРМА','',body,`AVG / матч · новіші результати ліворуч${model.incomplete?' · неповна вибірка або дані':''}`);
}

async function avatarsFor(players,fetcher) {
  const result=new Array(players.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,players.length)},async()=>{
    while(cursor<players.length){const i=cursor++;result[i]=await avatarPng(players[i].avatar,fetcher);}
  }));
  return result;
}
export async function renderCommandImage(kind,data,{fetcher=fetch,zone='Europe/Kyiv'}={}) {
  if(kind==='top'||kind==='summary') {
    const avatars=kind==='top'?await avatarsFor(data.rows.map(r=>r.p),fetcher):[];
    return renderSvg(leaderboardSvg({...data,kind,zone},avatars));
  }
  if(kind==='compare')return renderSvg(compareSvg(compareModel(data),await avatarsFor([data.a,data.b],fetcher)));
  if(kind==='last')return renderSvg(lastSvg(lastModel(data,zone),await avatarsFor([data.player],fetcher)));
  if(kind==='form')return renderSvg(formSvg(formModel(data),await avatarsFor([data.player],fetcher)));
  throw new Error('Unknown image kind');
}
