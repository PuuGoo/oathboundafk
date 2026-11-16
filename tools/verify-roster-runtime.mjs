// PROTOTYPE - NOT FOR PRODUCTION
// QA trên production preview, profile tạm và save giả; không đọc dữ liệu người chơi.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { OATHBOUND_HEROES } from '../src/game/oathboundHeroes.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'production/qa/evidence/roster3d');
const origin='http://127.0.0.1:3002';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const index=Number(process.argv[2]||0);
assert.ok(Number.isInteger(index)&&index>=0&&index<5);
const blocked=process.argv.includes('--fallback');
const accessible=process.argv.includes('--accessible');
const roster=OATHBOUND_HEROES.map(h=>h.heroId);
const group=roster.slice(index*5,index*5+5);
for(const id of roster) { if(group.length===5)break; if(!group.includes(id))group.push(id); }
const prefix=`group-${index}${blocked?'-fallback':accessible?'-accessible':''}`;
const scratch=path.join(process.env.LOCALAPPDATA,'hermes/cache/scratch');
fs.mkdirSync(scratch,{recursive:true}); fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.join(scratch,'roster3d-qa-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader',
  '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{stdio:'ignore'});
let ws;
const result={mode:prefix,group,errors:[],failedAssets:[],frames:{},observations:{},hashes:{}};
try {
  let targets;
  for(let i=0;i<100;i++) {
    try {const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();if(targets.some(t=>t.type==='page'))break;}catch{}
    await sleep(80);
  }
  assert.ok(targets?.some(t=>t.type==='page'),'Chrome debugging page unavailable');
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let seq=0;const pending=new Map();
  ws.onmessage=ev=>{
    const m=JSON.parse(ev.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}
    else if(m.method==='Runtime.exceptionThrown')result.errors.push(m.params.exceptionDetails);
    else if(m.method==='Network.responseReceived'&&m.params.response.status>=400)result.failedAssets.push({url:new URL(m.params.response.url).pathname,status:m.params.response.status});
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  const canvas="document.querySelector('[data-battle-renderer] canvas')";
  const state=`JSON.parse(${canvas}?.dataset.heroes3d||'{}')`;
  const wait=async(expression,ms=10000)=>{const until=Date.now()+ms;while(Date.now()<until){if(await evaluate(expression))return;await sleep(60);}throw Error('Timed out: '+expression+'\n'+JSON.stringify(await evaluate(state)));};
  const click=async expression=>{
    const rect=await evaluate(`(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    assert.ok(rect,'Missing control '+expression);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
  };
  const shot=async name=>{const bytes=Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64');const file=`${prefix}-${name}.png`;fs.writeFileSync(path.join(output,file),bytes);result.frames[file]=hash(bytes);};
  const pause=async()=>{
    await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'p',code:'KeyP',windowsVirtualKeyCode:80});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'p',code:'KeyP',windowsVirtualKeyCode:80});
    await wait(`!!document.querySelector('[data-testid=pause-modal]')&&(${state}).paused===true`);
    await evaluate("document.querySelector('[data-testid=pause-modal]').style.visibility='hidden'");
  };
  const resume=async()=>{await evaluate("document.querySelector('[data-testid=pause-modal]').style.visibility='visible'");await click("document.querySelector('[data-testid=resume-battle-btn]')");await wait(`(${state}).paused===false`);};
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1100,height:880,deviceScaleFactor:1,mobile:false});
  if(blocked)await call('Network.setBlockedURLs',{urls:['*lucius.glb*']});
  if(accessible)await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const specs=JSON.parse(fs.readFileSync(path.join(root,'tools/hero-models.json'),'utf8'));
  for(const file of ['dist/index.html',...fs.readdirSync(path.join(root,'dist/assets')).filter(f=>/\.(js|css)$/.test(f)).map(f=>'dist/assets/'+f),...group.map(id=>'public/assets/models/'+(id==='belinda'?'belinda':specs.find(s=>s.heroId===id).id)+'.glb')]){
    const expected=hash(fs.readFileSync(path.join(root,file)));const response=await fetch(origin+'/'+file.replace(/^dist\//,'').replace(/^public\//,''));
    assert.ok(response.ok&&hash(Buffer.from(await response.arrayBuffer()))===expected,'Wrong served build: '+file);result.hashes[file]=expected;
  }
  // Khởi tạo fixture trước mã ứng dụng, chỉ trong profile mới.
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)}){const group=${JSON.stringify(group)};localStorage.setItem('eternal_realms_save_v1',JSON.stringify({gold:16500,formation:group,ownedHeroes:Object.fromEntries(group.map(heroId=>[heroId,{heroId,level:12,stars:2,copies:2,equipment:{weapon:1,armor:1,relic:1}}])),currentStageId:1,autoUltimate:false,battleSpeed:1}));}`});
  await call('Page.navigate',{url:origin+'/?autostart=1'});
  await wait("!!document.querySelector('[aria-label=\"Tạm dừng\"]')");
  await pause();
  await wait(`(${state}).units?.filter(u=>${JSON.stringify(group)}.includes(u.heroId)).length>=5`);
  const expected=group.filter(id=>!blocked||id!=='celestial_guardian');
  await wait(`${JSON.stringify(expected)}.every(id=>(${state}).units?.some(u=>u.heroId===id&&(${state}).drawn?.includes(u.id)))`,15000);
  result.observations.opening=await evaluate(state);
  if(blocked){
    assert.ok(result.observations.opening.units.filter(u=>u.heroId==='celestial_guardian').every(u=>!result.observations.opening.drawn.includes(u.id)));
    assert.ok(result.observations.opening.units.some(u=>u.heroId==='belinda'&&result.observations.opening.drawn.includes(u.id)),'Failed Lucius must not disable Belinda');
  }
  await shot('opening');
  const crop=async()=>{const clip=await evaluate(`(()=>{const r=${canvas}.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);return(await call('Page.captureScreenshot',{format:'png',clip})).data;};
  const pixels=await crop(),frozen=JSON.stringify(await evaluate(state));await sleep(400);
  result.observations.pauseStable=pixels===await crop()&&frozen===JSON.stringify(await evaluate(state));
  assert.equal(result.observations.pauseStable,true,'Paused models/pixels changed');
  await resume();
  if(accessible){
    await click("document.querySelector('[data-testid=hud-settings-btn]')");
    await click("document.querySelector('[data-testid=preset-btn-low]')");
    result.observations.lowSelected=await evaluate("document.querySelector('[data-testid=preset-btn-low]').getAttribute('aria-pressed')==='true'");
    result.observations.reducedMotionMedia=await evaluate("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    assert.equal(result.observations.lowSelected,true,'LOW preset did not activate');
    assert.equal(result.observations.reducedMotionMedia,true,'Reduced-motion preference did not activate');
    await click("document.querySelector('[data-testid=classic-settings-modal] [data-testid=popup-close-btn]')");
  }
  const start=(await evaluate(state)).elapsedMs;
  await wait(`(${state}).elapsedMs>=${start+1800}`);
  result.observations.combat=await evaluate(state);await shot('combat');
  await click("document.querySelector('[data-testid=toggle-speed-btn]')");await wait(`(${state}).speed===2`);
  result.observations.x2=await evaluate(state);await shot('x2');
  assert.deepEqual(result.errors,[]);
  fs.writeFileSync(path.join(output,`${prefix}-browser.json`),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({mode:prefix,group,drawn:result.observations.opening.drawn,errors:result.errors.length,failedAssets:result.failedAssets,pauseStable:result.observations.pauseStable}));
}catch(error){
  fs.writeFileSync(path.join(output,`${prefix}-failure.json`),JSON.stringify({...result,failure:String(error)},null,2)+'\n');throw error;
}finally{
  ws?.close();chrome.kill();
  await new Promise(resolve=>{if(chrome.exitCode!==null)resolve();else{chrome.once('exit',resolve);setTimeout(resolve,3000);}});
  try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}
}
