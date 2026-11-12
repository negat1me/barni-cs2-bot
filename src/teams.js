export function teamMentions(message) {
  const text=message.text??'', command=/^\/teams(?:@\w+)?(?:\s|$)/i.exec(text);
  const start=command?.[0].length??0;
  const entities=(message.entities??[]).filter(e=>['mention','text_mention'].includes(e.type)&&e.offset>=start);
  const mentions=entities.length?entities.map(e=>e.type==='text_mention'
    ?{id:String(e.user?.id??''),label:e.user?.first_name??'Гравець',bot:e.user?.is_bot}
    :{username:text.slice(e.offset+1,e.offset+e.length).toLowerCase(),label:text.slice(e.offset,e.offset+e.length)})
    :[...text.slice(start).matchAll(/@([a-z0-9_]{1,32})\b/gi)].map(m=>({username:m[1].toLowerCase(),label:m[0]}));
  if(mentions.length!==10)throw new Error(`Обери рівно 10 гравців: /teams @гравець1 @гравець2 … @гравець10. Зараз: ${mentions.length}.`);
  const keys=mentions.map(m=>m.id?'id:'+m.id:'name:'+m.username);
  if(new Set(keys).size!==10)throw new Error('Кожного гравця потрібно вибрати лише один раз.');
  if(mentions.some(m=>m.bot||(!m.username&&!/^\d+$/.test(m.id??''))))throw new Error('Обирай гравців, а не ботів.');
  return mentions;
}

export function balanceTeams(players) {
  if(players.length!==10||new Set(players.map(p=>p.id)).size!==10)throw new Error('Для поділу потрібні 10 різних FACEIT-профілів.');
  if(players.some(p=>!Number.isFinite(p.elo)||p.elo<0))throw new Error('Для кожного гравця потрібне актуальне Elo.');
  const sorted=[...players].sort((a,b)=>b.elo-a.elo||String(a.id).localeCompare(String(b.id)));
  const total=sorted.reduce((sum,p)=>sum+p.elo,0);
  let best=null;
  // Fix the first player in A to enumerate all 126 unique 5v5 partitions once.
  function search(indices,next,sum) {
    if(indices.length===5) {
      const difference=Math.abs(total-2*sum);
      if(!best||difference<best.difference)best={indices:[...indices],difference};
      return;
    }
    for(let i=next;i<=sorted.length-(5-indices.length);i++)search([...indices,i],i+1,sum+sorted[i].elo);
  }
  search([0],1,sorted[0].elo);
  const selected=new Set(best.indices);
  const a=sorted.filter((_,i)=>selected.has(i)),b=sorted.filter((_,i)=>!selected.has(i));
  const sumA=a.reduce((sum,p)=>sum+p.elo,0),sumB=total-sumA;
  return {a,b,sumA,sumB,avgA:sumA/5,avgB:sumB/5,difference:best.difference/5};
}
