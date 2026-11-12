import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

test('shared lockfile contains native sharp, libvips and resvg packages for all supported targets',()=>{
  const {packages}=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  const targets=[
    ['darwin-arm64','darwin-arm64'],['darwin-x64','darwin-x64'],
    ['linux-x64','linux-x64-gnu'],['linux-arm64','linux-arm64-gnu'],
    ['linuxmusl-x64','linux-x64-musl'],['linuxmusl-arm64','linux-arm64-musl'],
    ['win32-x64','win32-x64-msvc'],['win32-arm64','win32-arm64-msvc']
  ];
  for(const [sharp,resvg] of targets) {
    for(const path of [`@img/sharp-${sharp}`,`@resvg/resvg-js-${resvg}`]) {
      const entry=packages['node_modules/'+path];
      assert.ok(entry?.optional,`${path} missing from shared lockfile`);
      assert.ok(entry.integrity,`${path} has no integrity hash`);
    }
    if(!sharp.startsWith('win32'))assert.ok(packages[`node_modules/@img/sharp-libvips-${sharp}`],`libvips missing for ${sharp}`);
  }
});

test('bot starts without native image modules and answers image commands with text fallback',()=>{
  const loader='data:text/javascript,'+encodeURIComponent(`export async function resolve(specifier,context,nextResolve){if(specifier==='sharp'||specifier==='@resvg/resvg-js')throw new Error('Native binary unavailable');return nextResolve(specifier,context);}`);
  const botUrl=new URL('../src/bot.js',import.meta.url).href;
  const code=`
    import {register} from 'node:module';
    register(${JSON.stringify(loader)},import.meta.url);
    const {Bot}=await import(${JSON.stringify(botUrl)});
    const calls=[];
    const api={tg:async(method,body)=>calls.push([method,body]),tgUpload:async()=>{throw new Error('Unexpected upload');}};
    const bot=new Bot(api,{state:{players:{},users:{},chats:{}},save(){}},{zone:'Europe/Kyiv',interval:60000});
    await bot.sendImage(-1,'form',{player:{nickname:'Player',elo:2000},matches:[]},{caption:'Form',fallback:'Stats text'});
    if(calls[0]?.[0]!=='sendMessage'||calls[0]?.[1].text!=='Stats text')throw new Error('Fallback failed');
    console.log('text fallback OK');`;
  const output=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000});
  assert.match(output,/text fallback OK/);
});
