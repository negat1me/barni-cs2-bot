import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {statsModel, statsSvg, renderStatsImage, avatarPng} from '../src/stats-image.js';
const player={nickname:'negatime',elo:2438,level:10,country:'ua',region:'EU',observedAt:Date.parse('2026-11-12T12:00:00Z')};
const matches=[{win:true,stats:{Kills:'20',Deaths:'15',Assists:'4',ADR:'89.2','Headshots %':'55','K/R Ratio':'0.91'}},{win:false,stats:{Kills:'21',Deaths:'0',Assists:'5',ADR:'90','Headshots %':'50','K/R Ratio':'1.00'}}];
test('period data uses integer KDA, paired total KD, real ranks and missing-data markers',()=>{
 const m=statsModel({player,matches,ranks:{country:179,region:4501}});
 assert.deepEqual(m.primary[0],['K/D/A','21/8/5']);assert.deepEqual(m.primary[1],['K/D','2.73']);
 assert.equal(m.countryRank,'#179');assert.equal(m.regionRank,'#4,501');assert.equal(m.countryName,'Україна');
 assert.deepEqual(m.form,['W','L']);assert.equal(m.incomplete,false);
 const empty=statsModel({player,matches:[]});assert.equal(empty.primary[0][1],'—/—/—');assert.equal(empty.secondary[2][1],'—');assert.equal(empty.countryRank,'—');assert.equal(empty.empty,true);
 const partial=statsModel({player,matches:[{win:null,stats:{Kills:'0'}}]});assert.ok(partial.incomplete);assert.equal(partial.primary[0][1],'0/—/—');
});
test('lifetime keeps lifetime metrics separate from recent averages',()=>{
 const m=statsModel({player,period:'all',lifetime:{Matches:'1000',Wins:'600','Average K/D Ratio':'1.25','Average Headshots %':'53','Current Win Streak':'0'}});
 assert.equal(m.primary[0][1],'1.25');assert.equal(m.primary[1][1],'—');assert.equal(m.secondary[1][1],'600 / 400');assert.equal(m.secondary[3][1],'0');assert.equal(m.form.length,0);
});
test('all three periods render real PNGs with bundled Cyrillic font, escaped text and avatar fallback',async()=>{
 for(const period of ['today','recent','all']) {
  const data={player:{...player,nickname:'<barni>&'.repeat(10)},period,matches,ranks:{country:179,region:4501}};
  assert.ok(!statsSvg(statsModel(data)).includes('<barni>'));
  const png=await renderStatsImage(data);assert.equal(png.subarray(1,4).toString(),'PNG');
  const meta=await sharp(png).metadata();assert.equal(meta.width,1120);assert.equal(meta.height,748);
 }
});
test('avatar loads only bounded FACEIT raster images and rejects redirects, huge files and malformed images',async()=>{
 let calls=0;const image=await sharp({create:{width:4,height:4,channels:3,background:'#ff762d'}}).png().toBuffer();
 const fetcher=async(_,options)=>{calls++;assert.equal(options.redirect,'error');return new Response(image,{headers:{'content-type':'image/png'}});};
 assert.equal(await avatarPng('http://127.0.0.1/a',fetcher),null);assert.equal(calls,0);
 assert.equal(await avatarPng('https://example.com/a',fetcher),null);assert.equal(calls,0);
 const png=await avatarPng('https://assets.faceit-cdn.net/avatars/test',fetcher);assert.equal((await sharp(png).metadata()).width,112);
 assert.ok(await avatarPng('https://distribution.faceit-cdn.net/images/test.jpg',fetcher));
 assert.equal(await avatarPng('https://assets.faceit-cdn.net/a',async()=>new Response(image,{headers:{'content-type':'image/png','content-length':'4000000'}})),null);
 assert.equal(await avatarPng('https://assets.faceit-cdn.net/a',async()=>new Response('invalid',{headers:{'content-type':'image/png'}})),null);
});
