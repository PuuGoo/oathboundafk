// PROTOTYPE - NOT FOR PRODUCTION
// QA hiệu ứng Blender trên production preview, profile tạm và save giả; không đọc save thật.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { OATHBOUND_HEROES } from '../src/game/oathboundHeroes.ts';
import { HERO_VFX_DEFINITIONS } from '../src/game/heroVfx.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'production/qa/evidence/vfx3d');
const origin = 'http://127.0.0.1:3002';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const seconds = Number(process.argv[2] || 45);
const prefix = `vfx-runtime-${seconds}s`;
const scratch = path.join(process.env.LOCALAPPDATA, 'hermes/cache/scratch');
fs.mkdirSync(scratch, { recursive: true }); fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(scratch, 'vfx3d-qa-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

// Nhóm mở đầu chứa hero cần kiểm; mặc định là các hero đang bật hiệu ứng 3D.
const enabled = new Set(HERO_VFX_DEFINITIONS.map(definition => definition.heroId));
const heroes = new Map(OATHBOUND_HEROES.map(hero => [hero.heroId, hero]));
const requested = (process.argv.find(arg => arg.startsWith('--heroes=')) || '').slice(9).split(',').filter(Boolean);
const group = requested.length ? [...requested]
  : OATHBOUND_HEROES.map(hero => hero.heroId).filter(id => enabled.has(id)).slice(0, 5);
for (const hero of OATHBOUND_HEROES) { if (group.length >= 5) break; if (!group.includes(hero.heroId)) group.push(hero.heroId); }
for (const heroId of requested) assert.ok(heroes.has(heroId), `unknown hero in --heroes: ${heroId}`);
const result = { mode: prefix, group, errors: [], failedAssets: [], hashes: {}, seen: {}, models: {}, pauseStable: null, speed2: null };

let ws;
try {
  let targets;
  for (let i = 0; i < 100; i++) {
    try {
      const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some(target => target.type === 'page')) break;
    } catch { /* Chrome chưa mở cổng debug. */ }
    await sleep(80);
  }
  assert.ok(targets?.some(target => target.type === 'page'), 'Chrome debugging page unavailable');
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0; const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id); pending.delete(message.id);
      message.error ? waiter?.reject(Error(JSON.stringify(message.error))) : waiter?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') result.errors.push(message.params.exceptionDetails);
    else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      result.failedAssets.push({ url: new URL(message.params.response.url).pathname, status: message.params.response.status });
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  const canvas = "document.querySelector('[data-battle-renderer] canvas')";
  const heroState = `JSON.parse(${canvas}?.dataset.heroes3d||'{}')`;
  const vfxState = `JSON.parse(${canvas}?.dataset.heroVfx||'{}')`;
  const wait = async (expression, ms = 15000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(60); }
    throw Error('Timed out: ' + expression);
  };
  const click = async expression => {
    const rect = await evaluate(`(()=>{const element=${expression};if(!element)return null;const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
    assert.ok(rect, 'Missing control ' + expression);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
  };
  const shot = async name => {
    const bytes = Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    fs.writeFileSync(path.join(output, `${prefix}-${name}.png`), bytes);
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 880, deviceScaleFactor: 1, mobile: false });
  // Artifact thật của build phải khớp hash, gồm cả GLB hiệu ứng.
  const served = ['dist/index.html',
    ...HERO_VFX_DEFINITIONS.filter(definition => group.includes(definition.heroId))
      .map(definition => 'public' + definition.url)];
  for (const file of served) {
    const expected = hash(fs.readFileSync(path.join(root, file)));
    const response = await fetch(origin + '/' + file.replace(/^dist\//, '').replace(/^public\//, ''));
    assert.ok(response.ok && hash(Buffer.from(await response.arrayBuffer())) === expected, 'Wrong served build: ' + file);
    result.hashes[file] = expected;
  }
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `if(location.origin===${JSON.stringify(origin)}){const group=${JSON.stringify(group)};localStorage.setItem('eternal_realms_save_v1',JSON.stringify({gold:16500,formation:group,ownedHeroes:Object.fromEntries(group.map(heroId=>[heroId,{heroId,level:14,stars:3,copies:2,equipment:{weapon:1,armor:1,relic:1}}])),currentStageId:1,autoUltimate:true,battleSpeed:1}));}`,
  });
  await call('Page.navigate', { url: origin + '/?autostart=1' });
  await wait("!!document.querySelector('[aria-label=\"Tạm dừng\"]')");
  await wait(`(${heroState}).units?.length>0`);
  // Gom bằng chứng: effect nào do GLB vẽ, ở slot nào, trong suốt cửa sổ quan sát.
  const until = Date.now() + seconds * 1000;
  let passes = 0;
  while (Date.now() < until) {
    const data = await evaluate(vfxState);
    result.models = data.models || result.models;
    for (const effect of data.effects || []) {
      const key = `${effect.heroId}:${effect.kind}:${effect.slot || '-'}:${effect.rendered3d ? '3d' : 'canvas'}`;
      result.all = result.all || {};
      result.all[key] = (result.all[key] || 0) + 1;
      if (!effect.rendered3d) continue;
      result.seen[key] = (result.seen[key] || 0) + 1;
    }
    passes++;
    const drawnSlots = new Set(Object.keys(result.seen));
    const hasBasic = [...drawnSlots].some(key => key.includes(':cast:basic'));
    const hasActive = [...drawnSlots].some(key => key.includes(':cast:active'));
    const hasUltimate = [...drawnSlots].some(key => key.includes(':cast:ultimate'));
    const hasImpact = [...drawnSlots].some(key => key.includes(':impact:'));
    if (hasBasic && hasActive && hasUltimate && hasImpact && passes > 5) break;
    await sleep(120);
  }
  await shot('combat');
  // Chỉ id do GLB vẽ mới được ghi; art Canvas2D cũ không thể làm test này xanh.
  // Slot active cần tự kiểm riêng: ở stage 1 Belinda bị stun/knockback nên cast bị huỷ.
  const drawnKeys = Object.keys(result.seen);
  assert.equal(result.models.belinda, 'ready', 'committed Blender effect never loaded');
  for (const [label, needle] of [['basic cast', ':cast:basic'], ['ultimate cast', ':cast:ultimate'],
    ['damage impact', ':impact:']]) {
    assert.ok(drawnKeys.some(key => key.includes(needle)), `no Blender-drawn ${label} observed`);
  }
  // Mỗi hero đang bật trong nhóm phải thật sự có ít nhất một hiệu ứng do GLB vẽ.
  for (const heroId of group) {
    if (!HERO_VFX_DEFINITIONS.some(definition => definition.heroId === heroId)) continue;
    assert.equal(result.models[heroId], 'ready', `${heroId}: effect asset never became ready`);
    assert.ok(drawnKeys.some(key => key.startsWith(heroId + ':')), `${heroId}: no Blender-drawn effect observed`);
  }
  result.activeObserved = drawnKeys.some(key => key.includes(':cast:active'));
  // Pause phải giữ nguyên pixel canvas và tuổi effect.
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
  await wait(`!!document.querySelector('[data-testid=pause-modal]')&&(${heroState}).paused===true`);
  await evaluate("document.querySelector('[data-testid=pause-modal]').style.visibility='hidden'");
  const clip = await evaluate(`(()=>{const box=${canvas}.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height,scale:1}})()`);
  const firstPixels = (await call('Page.captureScreenshot', { format: 'png', clip })).data;
  const firstState = JSON.stringify(await evaluate(vfxState));
  await sleep(500);
  result.pauseStable = firstPixels === (await call('Page.captureScreenshot', { format: 'png', clip })).data
    && firstState === JSON.stringify(await evaluate(vfxState));
  assert.equal(result.pauseStable, true, 'Paused effect pixels or ages changed');
  await shot('paused');
  await evaluate("document.querySelector('[data-testid=pause-modal]').style.visibility='visible'");
  await click("document.querySelector('[data-testid=resume-battle-btn]')");
  await wait(`(${heroState}).paused===false`);
  await click("document.querySelector('[data-testid=toggle-speed-btn]')");
  await wait(`(${heroState}).speed===2`);
  result.speed2 = (await evaluate(heroState)).speed;
  const before = Object.values(result.seen).reduce((total, count) => total + count, 0);
  await sleep(1500);
  const after = (await evaluate(vfxState)).effects?.filter(effect => effect.rendered3d).length || 0;
  result.speed2Frames = { beforePasses: passes, drawnAfter: after };
  assert.deepEqual(result.errors, []);
  fs.writeFileSync(path.join(output, `${prefix}-browser.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ group, models: result.models, seen: result.seen, all: result.all,
    errors: result.errors.length, failedAssets: result.failedAssets,
    pauseStable: result.pauseStable, speed2: result.speed2, before }));
} catch (error) {
  fs.writeFileSync(path.join(output, `${prefix}-failure.json`), JSON.stringify({ ...result, failure: String(error) }, null, 2) + '\n');
  throw error;
} finally {
  ws?.close(); chrome.kill();
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 3000); } });
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* profile tạm */ }
}
