import {fileURLToPath} from 'node:url';
import {escapeHtml as xml, summary,dayKey} from './domain.js';
import {peakElo,eloDay,eloLabel,eloNote} from './elo-tracking.js';
import {averageStat, numeric} from './insights.js';

const fontFiles = ['Regular', 'Bold'].map(weight => fileURLToPath(new URL(`../assets/fonts/NotoSans-${weight}.ttf`, import.meta.url)));
let sharpModule, resvgModule;
// Native modules load only when an image is requested. A broken binary must not
// prevent the bot from starting and serving the existing text fallbacks.
const loadSharp = () => sharpModule ??= import('sharp').then(module => module.default);
export const colors = {bg:'#10131b', panel:'#191e2a', stroke:'#293143', muted:'#929daf', text:'#f5f7fc', orange:'#ff762d', green:'#64d9a0', red:'#f47c85'};
export const n = (value, digits=0, suffix='') => numeric(value)==null ? '—' : Number(value).toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits, useGrouping:false})+suffix;
const rank = value => numeric(value)>0 ? '#'+Number(value).toLocaleString('en-US') : '—';
export const text = (x,y,value,size=22,fill=colors.text,weight=400,extra='') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${xml(value)}</text>`;
export const box = (x,y,w,h,fill=colors.panel,r=16) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
export const trim = (value,max) => [...String(value ?? '')].length>max ? [...String(value)].slice(0,max-1).join('')+'…' : String(value ?? '');

export function statsModel({player:p, period='today', matches=[], lifetime={}, ranks={}, label,zone='Europe/Kyiv'}) {
  const all=period==='all', s=summary(matches), known=s.wins+s.losses;
  const count=all ? numeric(lifetime.Matches) : matches.length;
  const wins=all ? numeric(lifetime.Wins) : s.wins;
  const losses=all ? count!=null && wins!=null && count>=wins ? count-wins : null : s.losses;
  const kda=['Kills','Deaths','Assists'].map(k=>n(averageStat(matches,k))).join('/');
  const primary=all ? [
    ['K/D',n(lifetime['Average K/D Ratio'],2)], ['K/R',n(lifetime['Average K/R Ratio'],2)],
    ['HS',n(lifetime['Average Headshots %'],0,'%')], ['BEST STREAK',n(lifetime['Longest Win Streak'])]
  ] : [
    ['K/D/A',kda], ['K/D',s.kd], ['ADR',n(averageStat(matches,'ADR'),1)], ['HS',n(averageStat(matches,'Headshots %'),0,'%')]
  ];
  const secondary=[['МАТЧІ',n(count)], ['W / L',`${n(wins)} / ${n(losses)}`],
    ['WIN RATE',all ? n(lifetime['Win Rate %'],0,'%') : known ? n(100*wins/known,0,'%') : '—'],
    all ? ['WIN STREAK',n(lifetime['Current Win Streak'])] : ['K/R',n(averageStat(matches,'K/R Ratio'),2)]];
  const incomplete=!all && matches.some(m=>['Kills','Deaths','Assists','ADR','Headshots %','K/R Ratio'].some(k=>numeric(m.stats?.[k])==null) || m.win==null);
  const country=/^[a-z]{2}$/i.test(p.country ?? '') ? p.country.toUpperCase() : '';
  const countryName=country ? new Intl.DisplayNames(['uk'],{type:'region'}).of(country) : 'Країна';
  return {player:p, period, label:label ?? (all?'За весь час':period==='recent'?'Останні 20 матчів':'Сьогодні'), primary, secondary,
    country,countryName, countryRank:rank(ranks.country), regionRank:rank(ranks.region),
    peak:peakElo(p),change:eloDay(p,dayKey(p.observedAt??Date.now(),zone)),
    empty:!all && !matches.length, incomplete, form:all?[]:matches.slice(0,5).map(m=>m.win===true?'W':m.win===false?'L':'—')};
}

// FACEIT-hosted images only. No auth headers, cookies, redirects or disk cache.
export async function avatarPng(url, fetcher=fetch) {
  try {
    const u=new URL(url);
    if(u.protocol!=='https:' || u.username || u.password || u.port || !['assets.faceit-cdn.net','distribution.faceit-cdn.net','cdn.faceit.com'].includes(u.hostname))return null;
    const sharp=await loadSharp();
    const response=await fetcher(u.href,{signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok || !/^image\/(png|jpeg|webp|gif)(?:;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length'))>2*1024*1024)return null;
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024){await response.body.cancel().catch(()=>{});return null;}chunks.push(chunk);}
    return await sharp(Buffer.concat(chunks),{limitInputPixels:16*1024*1024,animated:false}).resize(112,112,{fit:'cover'}).png().toBuffer();
  } catch {return null;}
}

export function statsSvg(model,avatar=null,zone='Europe/Kyiv') {
  const {player:p}=model;
  const nickname=trim(p.nickname,28), nickSize=nickname.length>20?32:40;
  const initial=String(p.nickname ?? '?').slice(0,1).toUpperCase();
  const portrait=avatar ? `<image x="44" y="88" width="112" height="112" href="data:image/png;base64,${avatar.toString('base64')}" clip-path="url(#avatar)"/>` : box(44,88,112,112,'#30384b',56)+text(100,162,initial,49,colors.text,700,'text-anchor="middle"');
  const countryIcon=model.country==='UA' ? `<path d="M68 254h28v9H68z" fill="#4391ed"/><path d="M68 263h28v9H68z" fill="#ffda5b"/>` : text(68,271,model.country||'—',20,colors.orange,700);
  const columns=model.period==='all'?[258,258,258,258]:[390,214,214,214];
  let offset=44;
  const metrics=model.primary.map(([label,value],i)=>{const x=offset;offset+=columns[i];return text(x+24,413,label,18,colors.muted,700)+text(x+24,464,value,model.period!=='all' && i===0?43:39,colors.text,700);}).join('');
  const secondary=model.secondary.map(([label,value],i)=>{
    const x=68+258*i;
    const metric=label==='W / L' ? `<text x="${x}" y="582" font-size="31" font-weight="700"><tspan fill="${colors.green}">${xml(value.split(' / ')[0])}</tspan><tspan fill="${colors.muted}"> / </tspan><tspan fill="${colors.red}">${xml(value.split(' / ')[1])}</tspan></text>` : text(x,582,value,31,colors.text,700);
    return text(x,539,label,17,colors.muted,700)+metric;
  }).join('');
  const form=model.form.map((value,i)=>box(209+i*54,634,44,36,value==='W'?'#1f3c34':value==='L'?'#422c36':'#2a3040',8)+text(231+i*54,659,value,19,value==='W'?colors.green:value==='L'?colors.red:colors.muted,700,'text-anchor="middle"')).join('');
  const date=Number.isFinite(p.observedAt)?new Date(p.observedAt).toLocaleString('uk-UA',{timeZone:zone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  const note=model.empty?'Матчів ще немає · обери інший період':model.incomplete?'AVG за доступними даними':model.period==='all'?'Загальна статистика FACEIT':'AVG / матч · новіші результати ліворуч';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="748" viewBox="0 0 1120 748">
  <defs><clipPath id="avatar"><circle cx="100" cy="144" r="56"/></clipPath><linearGradient id="glow"><stop stop-color="#ff762d" stop-opacity=".16"/><stop offset="1" stop-color="#ff762d" stop-opacity="0"/></linearGradient></defs>
  <g font-family="Noto Sans"><rect width="1120" height="748" fill="${colors.bg}"/>
  <path d="M1120 0H660L930 210H1120Z" fill="url(#glow)"/>
  <path d="M44 36h18l-5 12H44z" fill="${colors.orange}"/>${text(74,49,'BARNI',19,colors.text,700)}${text(166,49,'/ FACEIT CS2',17,colors.muted)}
  ${portrait}<circle cx="100" cy="144" r="58" fill="none" stroke="${colors.stroke}" stroke-width="2"/>
  ${text(180,135,nickname,nickSize,colors.text,700)}
  ${box(180,157,86,31,'#442a22',8)}${text(223,179,`LVL ${p.level ?? '—'}`,16,colors.orange,700,'text-anchor="middle"')}
  ${text(282,179,[model.country,p.region].filter(Boolean).join('  ·  '),19,colors.muted)}
  ${text(1076,104,'ELO',18,colors.muted,700,'text-anchor="end"')}${text(1076,169,n(p.elo),61,colors.orange,700,'text-anchor="end"')}
  ${text(1076,203,`MAX ${n(model.peak)} · Δ день ${eloLabel(model.change)}`,17,colors.muted,400,'text-anchor="end"')}
  ${box(44,224,506,80)}${box(570,224,506,80)}${countryIcon}
  ${text(112,271,trim(model.countryName,22),21,colors.muted)}${text(526,274,model.countryRank,32,colors.text,700,'text-anchor="end"')}
  ${text(594,271,p.region?`Регіон ${p.region}`:'Регіон',21,colors.muted)}${text(1052,274,model.regionRank,32,colors.text,700,'text-anchor="end"')}
  ${text(44,351,model.label,26,colors.text,700)}${text(1076,350,model.period==='all'?'LIFETIME':'PERFORMANCE',16,colors.orange,700,'text-anchor="end"')}
  ${box(44,380,1032,108)}${metrics}${box(44,510,1032,94)}${secondary}
  ${model.form.length?text(44,659,'ОСТАННІ',17,colors.muted,700)+form:text(44,660,model.empty?'Матчів не знайдено':'CS2 · FACEIT',21,colors.muted)}
  ${text(44,703,note,14,colors.muted)}${text(44,729,eloNote(p,zone),13,colors.muted)}${text(1076,714,date,16,colors.muted,400,'text-anchor="end"')}
  </g></svg>`;
}

export async function renderStatsImage(data,{fetcher=fetch,zone='Europe/Kyiv'}={}) {
  const model=statsModel({...data,zone});
  const avatar=await avatarPng(model.player.avatar,fetcher);
  return renderSvg(statsSvg(model,avatar,zone));
}

export async function renderSvg(svg) {
  const {renderAsync}=await (resvgModule ??= import('@resvg/resvg-js'));
  const rendered=await renderAsync(svg,{font:{fontFiles,loadSystemFonts:false,defaultFontFamily:'Noto Sans'}});
  return rendered.asPng();
}
