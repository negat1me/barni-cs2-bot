import {normalizeAnalyserMatch} from './analytics.js';
const DAY=86400000;
const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
export function normalizeAnalyserStats(body,id,now) {
  if(!body||Array.isArray(body)||typeof body!=='object')throw new Error('Invalid stats');
  const returned=body.playerId??body.segment_value;
  if(String(returned).toLowerCase()!==id.toLowerCase()||body.segment_value&&String(body.segment_value).toLowerCase()!==id.toLowerCase())throw new Error('Player mismatch');
  const highestElo=finite(body.highest_elo),lowestElo=finite(body.lowest_elo);
  if(highestElo==null||highestElo<0||lowestElo!=null&&(lowestElo<0||lowestElo>highestElo))throw new Error('Invalid Elo');
  const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
  return {playerId:id,highestElo,lowestElo,firstOccurrence:date(body.first_occurrence),lastOccurrence:date(body.last_occurrence),checkedAt:now,attemptedAt:now,retryAt:0};
}
export const hasAnalyserPeak=p=>Number.isFinite(p?.analyser?.highestElo);
export function usesAnalyser(data) {
  if(data.analyserUsed||data.match?.analyserUsed||data.matches?.some(m=>m.analyserUsed))return true;
  const players=[data.player,...(Array.isArray(data.a)?data.a:data.a?[data.a]:[]),...(Array.isArray(data.b)?data.b:data.b?[data.b]:[]),...(data.rows??[]).map(row=>row.p)];
  return players.some(p=>hasAnalyserPeak(p)||Object.values(p?.exactEloDays??{}).some(day=>day.source==='analyser'));
}
export const analyserCredit='<a href="https://faceitanalyser.com">Powered by Faceit Analyser</a>';
export function creditSvg(svg,data) {
  if(!usesAnalyser(data))return svg;
  const height=Number(/<svg[^>]*\bheight="(\d+)"/.exec(svg)?.[1]);
  if(!height)return svg;
  return svg.replace('</svg>',`<text x="1076" y="${height-7}" text-anchor="end" font-family="Noto Sans" font-size="11" fill="#929daf">Powered by Faceit Analyser · faceitanalyser.com</text></svg>`);
}

export class FaceitAnalyser {
  constructor({key,fetcher=fetch,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    this.key=key;this.fetcher=fetcher;this.now=now;this.wait=wait;this.enabled=!!key;
    this.pending=new Map();this.cache=new Map();this.queue=Promise.resolve();this.lastRequest=-Infinity;this.blockedUntil=0;
    this.status=this.enabled?'готовий':'ключ не задано';
    this.datasets=new Map();this.datasetPending=new Map();
  }
  async document(kind,id,params={}) {
    const task=this.queue.then(async()=>{
      if(!this.enabled||this.now()<this.blockedUntil)return null;
      const delay=1100-(this.now()-this.lastRequest);if(delay>0)await this.wait(delay);
      this.lastRequest=this.now();
      const url=new URL(`https://faceitanalyser.com/api/${kind}/${encodeURIComponent(id)}/cs2`);
      url.search=new URLSearchParams({...params,key:this.key}).toString();
      try {
        const response=await this.fetcher(url.href,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok) {
          const seconds=response.status===429?Math.max(1,Math.min(86400,Number(response.headers.get('retry-after'))||60)):response.status===401||response.status===403?3600:900;
          if([401,403,429].includes(response.status))this.blockedUntil=this.now()+seconds*1000;
          this.status=`HTTP ${response.status}; повторимо пізніше`;return null;
        }
        const body=await response.json();this.status='дані отримано';return body;
      } catch {this.blockedUntil=this.now()+900000;this.status='тимчасово недоступний';return null;}
    });
    this.queue=task.catch(()=>{});return task;
  }
  async matches(id,version,from=0) {
    if(!this.enabled)return null;
    const cached=this.datasets.get(id),now=this.now();
    if(cached?.version===version&&now<cached.retryAt)return cached.value;
    if(cached?.version===version&&now-cached.checkedAt<DAY)return cached.value;
    const key=id+':'+version;
    if(this.datasetPending.has(key))return this.datasetPending.get(key);
    const run=(async()=>{
      const rows=[];let truncated=false,invalid=false;
      for(let page=1;page<=4;page++) {
        // The documented date-range filter currently returns empty results.
        // History is newest first, so stop after crossing the requested window.
        const body=await this.document('matches',id,{page,page_size:500});
        if(!body||!Array.isArray(body.segments)) {
          const value=cached?.value?{...cached.value,stale:true}:null;
          this.datasets.set(id,{version,checkedAt:0,retryAt:this.now()+900000,value});return value;
        }
        for(const raw of body.segments){const match=normalizeAnalyserMatch(raw,id);if(match)rows.push(match);else invalid=true;}
        if(body.segments.length<500||from>0&&rows.some(match=>match.started!=null&&match.started<from))break;
        if(page===4)truncated=true;
      }
      const value={matches:rows,available:true,truncated:truncated||invalid,stale:false};
      this.datasets.set(id,{version,checkedAt:this.now(),retryAt:0,retries:cached?.version===version?cached.retries??0:0,value});
      while(this.datasets.size>100)this.datasets.delete(this.datasets.keys().next().value);
      return value;
    })();
    this.datasetPending.set(key,run);
    try{return await run;}finally{this.datasetPending.delete(key);}
  }
  retryMatchesSoon(id) {
    const entry=this.datasets.get(id);if(!entry)return;
    if(entry.retryAt>this.now())return;
    entry.retries=(entry.retries??0)+1;
    const delay=entry.retries<=3?120000:21600000;
    entry.checkedAt=this.now()-DAY+delay;entry.retryAt=this.now()+delay;
  }
  async stats(id,cached) {
    const cache=cached?.playerId===id?cached:this.cache.get(id);
    const now=this.now();
    if(!this.enabled)return cache??null;
    if(cache&&(hasAnalyserPeak({analyser:cache})&&now>=cache.checkedAt&&now-cache.checkedAt<DAY || cache.retryAt>now))return cache;
    if(this.pending.has(id))return this.pending.get(id);
    const task=this.queue.then(()=>this.request(id,cache));
    this.queue=task.catch(()=>{});this.pending.set(id,task);
    try {
      const record=await task;this.cache.set(id,record);
      while(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);
      return record;
    } finally {this.pending.delete(id);}
  }
  async request(id,cached) {
    let now=this.now();
    const failed=retryAt=>({...cached,playerId:id,attemptedAt:this.now(),retryAt});
    if(now<this.blockedUntil)return failed(this.blockedUntil);
    const delay=1100-(now-this.lastRequest);if(delay>0)await this.wait(delay);
    now=this.now();this.lastRequest=now;
    const url=new URL(`https://faceitanalyser.com/api/stats/${encodeURIComponent(id)}/cs2`);
    url.searchParams.set('key',this.key);
    try {
      // Credentials stay on the documented origin and never enter errors or logs.
      const response=await this.fetcher(url.href,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!response.ok) {
        const retry=response.status===429?Math.max(1,Math.min(86400,Number(response.headers.get('retry-after'))||60))*1000:response.status===404?6*3600000:response.status===401||response.status===403?3600000:900000;
        if([401,403,429].includes(response.status))this.blockedUntil=this.now()+retry;
        this.status=`HTTP ${response.status}; повторимо пізніше`;
        return failed(this.now()+retry);
      }
      const record=normalizeAnalyserStats(await response.json(),id,this.now());
      this.status='дані отримано';return record;
    } catch {
      this.status='тимчасово недоступний';this.blockedUntil=this.now()+900000;
      return failed(this.blockedUntil);
    }
  }
}
