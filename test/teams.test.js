import test from 'node:test';
import assert from 'node:assert/strict';
import {teamMentions,balanceTeams} from '../src/teams.js';
import {Bot} from '../src/bot.js';
import {renderCommandImage,teamsSvg} from '../src/command-images.js';
import sharp from 'sharp';
const players=[3000,2900,2400,2300,2200,2100,2000,1900,1800,1700].map((elo,i)=>({id:String(i+1),nickname:'Player'+(i+1),elo,level:10}));
test('5v5 split reaches the global minimum without omitting, duplicating or mutating players',()=>{
  const result=balanceTeams(players),original=players.map(p=>p.elo);
  assert.equal(result.a.length,5);assert.equal(result.b.length,5);
  assert.equal(new Set([...result.a,...result.b].map(p=>p.id)).size,10);
  let optimum=Infinity;
  for(let mask=0;mask<1024;mask++)if(mask.toString(2).replaceAll('0','').length===5) {
    const sum=players.reduce((s,p,i)=>s+(mask&(1<<i)?p.elo:-p.elo),0);optimum=Math.min(optimum,Math.abs(sum));
  }
  assert.equal(result.difference,optimum/5);assert.deepEqual(players.map(p=>p.elo),original);
  assert.deepEqual(balanceTeams([...players].reverse()).a,result.a);
  assert.throws(()=>balanceTeams(players.slice(0,9)));assert.throws(()=>balanceTeams([...players.slice(0,9),players[0]]));
  assert.throws(()=>balanceTeams(players.map((p,i)=>i? p:{...p,elo:null})));
});
test('mention parsing supports Telegram @handles, ID mentions and UTF-16 offsets',()=>{
  const text='/teams@BarniBot '+players.map((_,i)=>'@User'+i).join(' ');
  assert.equal(teamMentions({text}).length,10);
  assert.throws(()=>teamMentions({text:'/teams @User0 @user0 '+players.slice(2).map((_,i)=>'@User'+(i+2)).join(' ')}),/один раз/);
  assert.throws(()=>teamMentions({text:'/teams @User0'}),/рівно 10/);
  const native='/teams 🎮 '+players.map(p=>p.nickname).join(' ');
  const entities=players.map(p=>({type:'text_mention',offset:native.indexOf(p.nickname),length:p.nickname.length,user:{id:Number(p.id),first_name:p.nickname}}));
  assert.deepEqual(teamMentions({text:native,entities}).map(m=>m.id),players.map(p=>p.id));
});
function fixture() {
  const state={users:Object.fromEntries(players.map(p=>[p.id,{playerId:p.id}])),players:Object.fromEntries(players.map(p=>[p.id,{id:p.id}])),chats:{'-1':{members:players.map(p=>p.id),tags:true,tagState:{}}}};
  const calls=[],images=[];
  const api={tg:async(method,body)=>{
    calls.push([method,body]);if(method==='getChatMember')return {status:'member',user:{id:body.user_id,username:'User'+(body.user_id-1),first_name:'P'+body.user_id}};
  },faceit:async path=>{const p=players.find(p=>path.endsWith('/'+p.id));return {player_id:p.id,nickname:p.nickname,games:{cs2:{faceit_elo:p.elo,skill_level:10}}};},tgUpload:async(method,body)=>{calls.push([method,body]);}};
  const bot=new Bot(api,{state,save(){}},{zone:'Europe/Kyiv',interval:60000});
  bot.renderImage=async(kind,data)=>{images.push([kind,data]);return Buffer.from('png');};
  const message={chat:{id:-1,type:'supergroup'},from:{id:99},text:'/teams '+players.map((_,i)=>'@User'+i).join(' ')};
  return {bot,state,api,calls,images,message};
}
test('teams resolves current Telegram usernames and includes only selected linked members',async()=>{
  const {bot,calls,images,message,state}=fixture();await bot.handle({message});
  assert.equal(images[0][0],'teams');assert.equal(images[0][1].a.length,5);assert.equal(calls.at(-1)[0],'sendPhoto');
  assert.match(calls.at(-1)[1].caption,/tg:\/\/user\?id=/);assert.equal(state.chats[-1].party,undefined);
  assert.equal(Object.values(state.players).some(p=>p.matches),false);
});
test('teams rejects missing links, departed users, unknown handles and duplicate accounts before posting teams',async()=>{
  for(const type of ['link','left','unknown','duplicate']) {
    const f=fixture();
    if(type==='link')delete f.state.users['1'];
    if(type==='left'){const tg=f.api.tg;f.api.tg=(m,b)=>m==='getChatMember'&&b.user_id===1?Promise.resolve({status:'left',user:{id:1,username:'User0'}}):tg(m,b);}
    if(type==='unknown')f.message.text=f.message.text.replace('@User0','@Unknown');
    if(type==='duplicate'){f.state.users['2'].playerId='1';}
    await f.bot.handle({message:f.message});assert.equal(f.images.length,0,type);assert.equal(f.calls.at(-1)[0],'sendMessage',type);assert.match(f.calls.at(-1)[1].text,/⚠️/);
  }
});
test('teams card renders ten players with rounded averages and escaped nicknames',async()=>{
  const teams=balanceTeams(players.map((p,i)=>i?p:{...p,nickname:'<Player>&'}));
  assert.match(teamsSvg(teams),/&lt;Player&gt;&amp;/);
  const png=await renderCommandImage('teams',teams);const metadata=await sharp(png).metadata();assert.equal(metadata.width,1120);assert.equal(metadata.height,828);
});
