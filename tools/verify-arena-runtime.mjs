// PROTOTYPE - NOT FOR PRODUCTION
// QA sân đấu 3D trên production preview, profile tạm và save giả; không đọc save thật.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { OATHBOUND_HEROES } from '../src/game/oathboundHeroes.ts';
import { arenaFogDepth, arenaLighting, ARENA_DEFINITIONS } from '../src/game/arena3d.ts';
import { canvasFogColor } from './arena-fog-colour.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'production/qa/evidence/arena3d');
const origin = 'http://127.0.0.1:3002';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stageId = Number(process.argv[2] || 1);
const seconds = Number(process.argv[3] || 20);
const verifyFog = process.argv.includes('--verify-fog');
const prefix = `arena-runtime-stage${stageId}-${seconds}s${verifyFog ? '-fog' : ''}`;
const scratch = path.join(process.env.LOCALAPPDATA, 'hermes/cache/scratch');
fs.mkdirSync(scratch, { recursive: true }); fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(scratch, 'arena3d-qa-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const group = OATHBOUND_HEROES.slice(0, 5).map(hero => hero.heroId);
const result = { mode: prefix, stageId, group, errors: [], failedAssets: [], hashes: {}, frames: {}, arenas: {} };

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
  const arenaState = `JSON.parse(${canvas}?.dataset.arena3d||'{}')`;
  const heroState = `JSON.parse(${canvas}?.dataset.heroes3d||'{}')`;
  const wait = async (expression, ms = 20000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(60); }
    throw Error('Timed out: ' + expression + ' :: ' + JSON.stringify(await evaluate(arenaState)));
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  if (verifyFog) {
    // Chỉ trong profile QA: đọc uniform thật khi shader đang vẽ, không thay dữ liệu game.
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__arenaFogDraws = new Map();
      const proto = WebGL2RenderingContext.prototype;
      const original = proto.drawElements;
      proto.drawElements = function (...args) {
        const program = this.getParameter(this.CURRENT_PROGRAM);
        if (program) {
          const near = this.getUniformLocation(program, 'fogNear');
          if (near !== null) {
            const far = this.getUniformLocation(program, 'fogFar');
            const color = this.getUniformLocation(program, 'fogColor');
            if (far !== null && color !== null) {
              const state = { near: this.getUniform(program, near), far: this.getUniform(program, far),
                color: Array.from(this.getUniform(program, color)) };
              window.__arenaFogDraws.set(JSON.stringify(state), state);
            }
          }
        }
        return original.apply(this, args);
      };
    })();` });
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 880, deviceScaleFactor: 1, mobile: false });
  // Hash của mọi GLB sân phải khớp file build đang phục vụ.
  for (const definition of ARENA_DEFINITIONS) {
    const file = path.join(root, 'public' + definition.url);
    const expected = hash(fs.readFileSync(file));
    const response = await fetch(origin + definition.url);
    assert.ok(response.ok, `arena not served: ${definition.url}`);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected, 'Wrong served arena: ' + definition.url);
    result.hashes[definition.url] = expected;
  }
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `if(location.origin===${JSON.stringify(origin)}){const group=${JSON.stringify(group)};localStorage.setItem('eternal_realms_save_v1',JSON.stringify({gold:16500,formation:group,ownedHeroes:Object.fromEntries(group.map(heroId=>[heroId,{heroId,level:14,stars:3,copies:2,equipment:{weapon:1,armor:1,relic:1}}])),currentStageId:${stageId},autoUltimate:true,battleSpeed:1}));}`,
  });
  await call('Page.navigate', { url: origin + '/?autostart=1' });
  await wait("!!document.querySelector('[aria-label=\"Tạm dừng\"]')");
  await wait(`(${heroState}).units?.length>0`);
  const scene = await evaluate(arenaState);
  result.arenas.initial = scene;
  assert.ok(scene.scene, 'stage has no Blender arena');
  // Chờ scene tải và vẽ thật; lỗi 404 sẽ hiện status failed chứ không treo.
  await wait(`(${arenaState}).drawn===true`, 25000);
  result.arenas.ready = await evaluate(arenaState);
  assert.equal(result.arenas.ready.drawn, true, 'arena never rendered');
  if (verifyFog) {
    await wait('window.__arenaFogDraws?.size > 0');
    result.fogUniforms = await evaluate('[...window.__arenaFogDraws.values()]');
    // fogColor lên GPU là kênh sRGB vì canvas renderer.outputColorSpace = SRGBColorSpace.
    // Ngưỡng near/far đọc từ cùng `tools/arena-fog.json` mà runtime dùng.
    const sceneId = result.arenas.ready.scene;
    const depth = arenaFogDepth(sceneId);
    const expected = canvasFogColor(arenaLighting(sceneId).ground);
    result.fogExpected = { near: depth.near, far: depth.far, color: expected };
    assert.ok(result.fogUniforms.some(fog => Math.abs(fog.near - depth.near) < 1e-5
      && Math.abs(fog.far - depth.far) < 1e-5
      && fog.color.every((channel, index) => Math.abs(channel - expected[index]) < 1e-5)),
    'No drawn shader used the expected arena fog uniforms');
  }
  const shot = async name => {
    const bytes = Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    fs.writeFileSync(path.join(output, `${prefix}-${name}.png`), bytes);
    result.frames[name] = hash(bytes);
  };
  await shot('opening');
  // Cùng trận, tắt/bật ×2 rồi xác nhận sân vẫn được vẽ.
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
  await wait(`!!document.querySelector('[data-testid=pause-modal]')&&(${heroState}).paused===true`);
  await evaluate("document.querySelector('[data-testid=pause-modal]').style.visibility='hidden'");
  await sleep(400);
  const clip = await evaluate(`(()=>{const box=${canvas}.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height,scale:1}})()`);
  const capture = async () => (await call('Page.captureScreenshot', { format: 'png', clip })).data;
  const paused = [];
  for (let index = 0; index < 3; index++) {
    const png = Buffer.from(await capture(), 'base64');
    fs.writeFileSync(path.join(output, `${prefix}-paused-${index}.png`), png);
    paused.push(hash(png));
    if (index < 2) await sleep(400);
  }
  result.pausePixelsStable = paused[1] === paused[2];
  assert.equal(result.pausePixelsStable, true, 'paused arena pixels changed');
  await shot('paused');
  await evaluate("document.querySelector('[data-testid=pause-modal]').style.visibility='visible'");
  const rect = await evaluate(`(()=>{const box=document.querySelector('[data-testid=resume-battle-btn]').getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, ...rect, button: 'left', clickCount: 1 });
  await wait(`(${heroState}).paused===false`);
  const speedRect = await evaluate(`(()=>{const box=document.querySelector('[data-testid=toggle-speed-btn]').getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, ...speedRect, button: 'left', clickCount: 1 });
  await wait(`(${heroState}).speed===2`);
  await sleep(seconds * 1000);
  result.arenas.afterX2 = await evaluate(arenaState);
  assert.equal(result.arenas.afterX2.drawn, true, 'arena stopped drawing under x2');
  await shot('x2');
  assert.deepEqual(result.errors, []);
  fs.writeFileSync(path.join(output, `${prefix}-browser.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ mode: prefix, scene: result.arenas.ready.scene, drawn: result.arenas.ready.drawn,
    pausePixelsStable: result.pausePixelsStable, x2Drawn: result.arenas.afterX2.drawn,
    errors: result.errors.length, failedAssets: result.failedAssets,
    ...(verifyFog ? { fogUniforms: result.fogUniforms } : {}) }));
} catch (error) {
  fs.writeFileSync(path.join(output, `${prefix}-failure.json`), JSON.stringify({ ...result, failure: String(error) }, null, 2) + '\n');
  throw error;
} finally {
  // Chỉ dừng cây Chrome do lượt QA này tạo, không đụng trình duyệt của người dùng.
  if (chrome.pid && chrome.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  ws?.close(); chrome.kill();
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 3000); } });
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* profile tạm */ }
}
