/**
 * 錄影模式的「假時間」。
 *
 * 一格一格截圖時，每一格實際要花 100ms 以上，如果讓畫面照真的時間跑，
 * 動畫會快轉、忽快忽慢。所以網址有 ?render 時，把時間相關的東西全部換掉，
 * 改由 render.js 呼叫 __vt.advance(ms) 推進：
 *
 *   setTimeout / setInterval / requestAnimationFrame / Date / performance.now
 *     → 只有 advance 的時候才會前進
 *   CSS 的 animation、transition（包括面板 Shadow DOM 裡的）
 *     → 用 Web Animations API 暫停，每一格把 currentTime 設到對應的時間點
 *
 * 沒有 ?render 就什麼都不做，畫面照一般的時間播放（預覽用）。
 */
(() => {
  'use strict';
  if (!/[?&]render\b/.test(location.search)) return;

  const realSetTimeout = window.setTimeout.bind(window);
  const RealDate = Date;
  const epoch = RealDate.now();
  let now = 0;                          // 從開始到現在的虛擬毫秒數

  /* ---------- 計時器 ---------- */
  const timers = new Map();
  let seq = 1;
  const add = (fn, ms, args, every) => {
    const id = seq++;
    timers.set(id, { fn, at: now + Math.max(0, +ms || 0), args, every, order: id });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, 0);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, Math.max(1, +ms || 0));
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  let frames = [];
  window.requestAnimationFrame = (fn) => { const id = seq++; frames.push({ id, fn }); return id; };
  window.cancelAnimationFrame = (id) => { frames = frames.filter((f) => f.id !== id); };

  /* ---------- 時鐘 ---------- */
  class VDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(epoch + now); }
    static now() { return epoch + now; }
  }
  window.Date = VDate;
  const perfStart = performance.now();
  performance.now = () => perfStart + now;

  /* ---------- CSS 動畫 ---------- */
  const born = new WeakMap();           // 每個動畫是在虛擬時間的哪一刻出現的
  const roots = [document];
  function seek() {
    const seen = new Set();
    for (const r of roots) for (const a of r.getAnimations()) seen.add(a);
    for (const a of seen) {
      if (!born.has(a)) { born.set(a, now); a.pause(); }
      const t = now - born.get(a);
      const end = a.effect ? a.effect.getComputedTiming().endTime : 0;
      if (Number.isFinite(end) && t >= end) {
        if (a.playState !== 'finished') a.finish();
      } else {
        a.currentTime = t;
      }
    }
  }

  // 讓 Promise 之類的後續動作跑完再繼續（真的等一個工作週期）
  const flush = () => new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

  const hooks = [];

  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      let next = null;
      for (const t of timers.values()) {
        if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.order < next.order))) next = t;
      }
      if (!next) break;
      const id = [...timers].find(([, v]) => v === next)[0];
      now = Math.max(now, next.at);
      if (next.every) { next.at = now + next.every; next.order = seq++; } else timers.delete(id);
      try { typeof next.fn === 'function' ? next.fn(...next.args) : 0; } catch (e) { console.error(e); }
      await flush();
    }
    now = target;
    const run = frames; frames = [];
    for (const f of run) { try { f.fn(performance.now()); } catch (e) { console.error(e); } }
    await flush();
    for (const h of hooks) h(now);
    seek();
    return now;
  }

  window.__vt = {
    on: true,
    advance,
    seek,
    flush,
    now: () => now,
    addRoot: (r) => roots.push(r),
    onFrame: (fn) => hooks.push(fn),
    realSetTimeout,
  };
})();
