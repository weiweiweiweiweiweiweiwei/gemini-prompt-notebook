/**
 * 把 stage.html 一格一格錄成 mp4。
 *
 *   node render.js                         → out/特務P-使用情境.mp4（1920×1080、30fps）
 *   node render.js --fps 60                → 60fps
 *   node render.js --stills 5,12.5,20      → 只截那幾秒的畫面成 PNG（檢查用，很快）
 *
 * 用電腦上的 Chrome 無頭模式打開 stage.html?render，時間由這裡推進（見 vtime.js），
 * 所以錄出來的動畫不會因為電腦忙而忽快忽慢。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const ffmpegPath = require('ffmpeg-static');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const FPS = Number(opt('fps', 30));
const stills = opt('stills', '') ? opt('stills').split(',').map(Number) : null;
const OUT_DIR = path.join(__dirname, 'out');
const OUT = path.resolve(opt('out', path.join(OUT_DIR, '特務P-使用情境.mp4')));
const MAX_SECONDS = 120;

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[頁面]', m.text()); });
  page.on('pageerror', (e) => console.error('[頁面錯誤]', e.message));

  await page.goto(pathToFileURL(path.join(__dirname, 'stage.html')).href + '?render');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.evaluate(() => window.__start());

  const cdp = await page.context().newCDPSession(page);
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');

  let ff = null;
  if (!stills) {
    ff = spawn(ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', OUT,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  const write = (buf) => new Promise((r) => { if (ff.stdin.write(buf)) r(); else ff.stdin.once('drain', r); });

  const dt = 1000 / FPS;
  const lastStill = stills ? Math.max(...stills) : Infinity;
  const pending = stills ? [...stills].sort((a, b) => a - b) : [];
  const started = Date.now();
  let lastMouse = null;

  for (let f = 0; f < MAX_SECONDS * FPS; f++) {
    const t = f * dt;
    const st = await page.evaluate(async (ms) => {
      if (ms) await window.__vt.advance(ms);
      return { m: window.__mouse, ops: window.__mouseOps.splice(0), done: !!window.__done };
    }, f ? dt : 0);

    // 真的滑鼠跟著畫面上的游標走：滑過卡片會有 hover，點擊也是真的點
    const key = st.m.x.toFixed(1) + ',' + st.m.y.toFixed(1);
    if (key !== lastMouse) { await page.mouse.move(st.m.x, st.m.y); lastMouse = key; }
    for (const op of st.ops) { if (op === 'down') await page.mouse.down(); else await page.mouse.up(); }
    await page.evaluate(() => window.__vt.seek());   // 滑鼠觸發的新動畫也要停在正確的時間點

    if (stills) {
      while (pending.length && t >= pending[0] * 1000 - dt / 2) {
        const s = pending.shift();
        const file = path.join(OUT_DIR, `still-${String(s).replace('.', '_')}s.png`);
        fs.writeFileSync(file, await shot());
        console.log('截圖', file);
      }
      if (!pending.length || t > lastStill * 1000) break;
    } else {
      await write(await shot());
      if (f % FPS === 0) process.stdout.write(`\r錄到 ${(t / 1000).toFixed(0)} 秒（花了 ${((Date.now() - started) / 1000).toFixed(0)} 秒）`);
    }
    if (st.done) {
      console.log(`\n影片長度 ${(t / 1000).toFixed(1)} 秒`);
      break;
    }
  }

  await browser.close();
  if (ff) {
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('\n完成：' + OUT);
  }
})().catch((e) => { console.error(e); process.exit(1); });
