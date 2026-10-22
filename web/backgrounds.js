/**
 * 內建背景（設定 → 背景）：全部用 canvas 畫出來，不用放圖片檔，也不佔下載空間。
 *
 * 每一張都是為了「霧面玻璃」設計的：
 *   大塊、顏色分明的色塊 —— 被玻璃模糊之後會變成柔和的色彩層次，筆記本才會「透」得漂亮；
 *   細碎的花紋一模糊就糊成一片灰，所以刻意不用。
 * 畫的時候一律用「相對位置」（寬高的比例），同一個函式畫 240px 的縮圖和 1920px 的大圖，長相一樣。
 *
 * 見 panel.js 的「背景」。
 * 標了 live 的是動態背景：gpnAnimateBackground 一直重畫（見最下面）。
 */

/** 可重現的亂數：同一張背景每次畫出來都一樣（山的稜線、星星的位置） */
function gpnSeededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gpnLinear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

/** 一團橢圓色塊（rot：旋轉角度，弧度） */
function gpnBlob(ctx, x, y, rx, ry, color, alpha = 1, rot = 0) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * 森林（靜態的「森林」和動態的「搖曳森林」共用）：一層一層的樹影，越遠越淡，上面透下來一點晨光。
 * sway 為 true 時，每棵樹的樹梢跟著 t 左右輕輕擺：近的擺得多、遠的擺得少，
 * 相鄰的樹差一點點時間，看起來像一陣風從林子裡吹過去。
 */
function gpnForest(ctx, w, h, t, sway) {
  const k = w / 1920;
  ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#c8e6c9'], [0.45, '#5f8f6b'], [1, '#13301f']]);
  ctx.fillRect(0, 0, w, h);
  ctx.filter = `blur(${Math.round(80 * k)}px)`;
  gpnBlob(ctx, 0.30 * w, 0.10 * h, 0.30 * w, 0.18 * h, '#fff6d5', sway ? 0.62 + 0.08 * Math.sin(t * 0.5) : 0.7);
  ctx.filter = 'none';
  const rnd = gpnSeededRandom(33);
  [['#4c7a5a', 0.45], ['#335f44', 0.58], ['#21452f', 0.72], ['#12291b', 0.86]].forEach(([c, base], layer) => {
    const n = 26, step = w / n;
    const amp = sway ? step * (0.10 + 0.08 * layer) : 0;  // 近的（下面的）擺得比較多
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      const tip = (base - (0.06 + rnd() * 0.12)) * h;      // 一棵棵尖尖的樹
      const dx = amp * Math.sin(t * 0.9 - i * 0.35 + layer * 0.8);
      ctx.lineTo(x - step / 2, base * h);
      ctx.lineTo(x + dx, tip);
    }
    ctx.lineTo(w, base * h);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  });
}

/**
 * 內建背景清單。draw(ctx, w, h)：畫滿整個 w × h。
 * tone：整張圖偏暗（dark）、中間（mid）、偏亮（light）。淺色主題配上偏暗的圖時，玻璃要調得實一點字才看得清楚。
 * 座標以 1920 × 1200 的畫面來想，再用 k（寬的比例）、v（高的比例）換算。
 */
const GPN_BACKGROUNDS = [
  {
    id: 'sunset', label: '夕陽', tone: 'mid',
    // 深藍到珊瑚橘的漸層，加上幾顆大圓：玻璃後面會變成暖暖的一塊一塊
    draw(ctx, w, h) {
      const k = w / 1920, v = h / 1200;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, w, h, [[0, '#1d3557'], [0.45, '#e76f51'], [1, '#f4a261']]);
      ctx.fillRect(0, 0, w, h);
      for (const [x, y, r, c] of [[300, 250, 260, '#ffd166'], [1500, 300, 340, '#2a9d8f'],
        [900, 950, 420, '#264653'], [1700, 1000, 200, '#e9c46a']]) {
        gpnBlob(ctx, x * k, y * v, r * k, r * k, c, 0.7);
      }
    },
  },
  {
    id: 'aurora', label: '極光', tone: 'dark',
    // 深夜藍的天空、一點星星，上面飄著青綠、紫色的光帶
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#050816'], [1, '#0d1b3a']]);
      ctx.fillRect(0, 0, w, h);
      const rnd = gpnSeededRandom(7);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 140; i++) {
        ctx.globalAlpha = 0.25 + rnd() * 0.5;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h * 0.75, (0.6 + rnd() * 1.4) * Math.max(k, 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.filter = `blur(${Math.round(140 * k)}px)`;
      gpnBlob(ctx, 0.22 * w, 0.40 * h, 0.34 * w, 0.13 * h, '#22d3ee', 0.60, -0.25);
      gpnBlob(ctx, 0.56 * w, 0.28 * h, 0.36 * w, 0.12 * h, '#34d399', 0.55, 0.15);
      gpnBlob(ctx, 0.84 * w, 0.52 * h, 0.24 * w, 0.20 * h, '#8b5cf6', 0.60);
      gpnBlob(ctx, 0.40 * w, 0.80 * h, 0.30 * w, 0.12 * h, '#6366f1', 0.45);
      ctx.filter = 'none';
    },
  },
  {
    id: 'pastel', label: '粉彩', tone: 'light',
    // 淺色系：蜜桃、薰衣草、薄荷、天空藍，適合喜歡明亮畫面的人
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, w, h, [[0, '#fff4f1'], [1, '#eef1ff']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(150 * k)}px)`;
      for (const [x, y, r, c, a] of [[0.12, 0.20, 0.28, '#ffc4a8', 0.9], [0.86, 0.22, 0.26, '#c9b6ff', 0.9],
        [0.72, 0.88, 0.30, '#a6e3c9', 0.9], [0.16, 0.90, 0.22, '#9fd0ff', 0.85], [0.50, 0.50, 0.18, '#ffe6a1', 0.6]]) {
        gpnBlob(ctx, x * w, y * h, r * w, r * w, c, a);
      }
      ctx.filter = 'none';
    },
  },
  {
    id: 'mountain', label: '山嵐', tone: 'mid',
    // 清晨的山：天空從藍灰到蜜桃色，太陽，層層疊疊的山，越遠越淡，中間有一點霧
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#7f9cc4'], [0.5, '#e9c9c1'], [0.72, '#f8dcc0']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(60 * k)}px)`;
      gpnBlob(ctx, 0.70 * w, 0.46 * h, 0.13 * w, 0.13 * w, '#ffe1b8', 0.7);
      ctx.filter = 'none';
      gpnBlob(ctx, 0.70 * w, 0.46 * h, 0.055 * w, 0.055 * w, '#fff3de', 0.95);

      const layers = [
        ['#9aaccb', 0.58, 0.10], ['#7890b6', 0.66, 0.09], ['#5a739c', 0.75, 0.08],
        ['#3e5680', 0.84, 0.07], ['#26375a', 0.94, 0.06],
      ];
      const rnd = gpnSeededRandom(21);
      layers.forEach(([color, base, amp], i) => {
        const n = 7;
        const pts = Array.from({ length: n + 1 }, (_, j) =>
          [(j / n) * w, (base - amp * (0.25 + 0.75 * rnd())) * h]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(pts[0][0], pts[0][1]);
        for (let j = 1; j < pts.length; j++) {
          const [px, py] = pts[j - 1], [x, y] = pts[j];
          ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        }
        ctx.lineTo(w, pts[n][1]);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        if (i < layers.length - 1) {       // 山腳的霧，讓下一層山浮出來
          ctx.fillStyle = gpnLinear(ctx, 0, (base - amp) * h, 0, (base + 0.04) * h,
            [[0, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0.22)']]);
          ctx.fillRect(0, (base - amp) * h, w, h);
        }
      });
    },
  },
  {
    id: 'ocean', label: '海浪', tone: 'dark',
    // 深海藍到湖水綠，一層一層起伏的浪
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#0b2545'], [0.5, '#13315c'], [1, '#134e5e']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(120 * k)}px)`;
      gpnBlob(ctx, 0.78 * w, 0.18 * h, 0.22 * w, 0.14 * h, '#8ecae6', 0.35);
      ctx.filter = 'none';
      const rnd = gpnSeededRandom(5);
      const bands = [
        ['#1d4e89', 0.44, 0.05, 1.3], ['#1f6f8b', 0.55, 0.05, 1.7], ['#2a9d8f', 0.66, 0.045, 1.1],
        ['#57c4ad', 0.77, 0.04, 1.9], ['#a7e2d0', 0.89, 0.035, 1.5],
      ];
      for (const [color, base, amp, f] of bands) {
        const ph = rnd() * Math.PI * 2;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += Math.max(2, 8 * k)) {
          const t = (x / w) * Math.PI * 2;
          ctx.lineTo(x, (base + amp * Math.sin(t * f + ph) + amp * 0.4 * Math.sin(t * f * 2.3 + ph * 1.7)) * h);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'bauhaus', label: '包浩斯', tone: 'light',
    // 米色底上的幾何色塊：赤陶、深藍、芥末黃、鼠尾草綠，像一張現代海報
    draw(ctx, w, h) {
      const k = w / 1920, v = h / 1200;
      ctx.fillStyle = '#efe6d6';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(1250 * k, 430 * v);
      ctx.rotate(-0.2);
      ctx.fillStyle = '#203a5c';
      ctx.fillRect(-200 * k, -380 * k, 400 * k, 760 * k);
      ctx.restore();
      gpnBlob(ctx, 560 * k, 470 * v, 330 * k, 330 * k, '#d9643a');
      ctx.fillStyle = '#e9ae2f';
      ctx.beginPath();
      ctx.arc(1560 * k, 1200 * v, 420 * k, Math.PI, 0);
      ctx.fill();
      gpnBlob(ctx, 170 * k, 1070 * v, 230 * k, 230 * k, '#8ea98a');
      gpnBlob(ctx, 930 * k, 840 * v, 72 * k, 72 * k, '#1d1d1f');
      ctx.strokeStyle = '#e8a6a0';
      ctx.lineWidth = 56 * k;
      ctx.beginPath();
      ctx.arc(1760 * k, 170 * v, 250 * k, Math.PI * 0.5, Math.PI * 1.4);
      ctx.stroke();
    },
  },  /* ---- 4.17.0 新增 ---- */
  {
    id: 'lavender', label: '薰衣草', tone: 'mid',
    // 傍晚的紫：從深紫到粉紅的對角漸層，幾團柔軟的紫粉色光
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, w, h, [[0, '#3b2a6b'], [0.55, '#9b6bc4'], [1, '#f2a7c3']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(110 * k)}px)`;
      for (const [x, y, r, c, a] of [[0.18, 0.30, 0.22, '#c9a7ff', 0.7], [0.80, 0.25, 0.18, '#ffd1e8', 0.6],
        [0.62, 0.78, 0.26, '#7b5bd6', 0.6], [0.10, 0.85, 0.16, '#ff9ec7', 0.55]]) {
        gpnBlob(ctx, x * w, y * h, r * w, r * w, c, a);
      }
      ctx.filter = 'none';
    },
  },
  {
    id: 'forest', label: '森林', tone: 'dark',
    // 深綠的林子：一層一層的樹影，越遠越淡，上面透下來一點晨光
    draw(ctx, w, h) { gpnForest(ctx, w, h, 0, false); },
  },
  {
    id: 'sakura', label: '櫻花', tone: 'light',
    // 淡粉色的春天：大朵柔和的花團，一點點嫩綠
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#fff7f9'], [1, '#ffe4ec']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(40 * k)}px)`;
      const rnd = gpnSeededRandom(12);
      for (let i = 0; i < 14; i++) {
        const c = ['#ffb7c9', '#ff9fb8', '#ffd0dc', '#f7a8c4'][i % 4];
        gpnBlob(ctx, rnd() * w, rnd() * h, (0.05 + rnd() * 0.09) * w, (0.05 + rnd() * 0.09) * w, c, 0.75);
      }
      gpnBlob(ctx, 0.88 * w, 0.88 * h, 0.10 * w, 0.07 * w, '#c8e6b0', 0.7);
      gpnBlob(ctx, 0.08 * w, 0.12 * h, 0.08 * w, 0.05 * w, '#d4ecbd', 0.6);
      ctx.filter = 'none';
    },
  },
  {
    id: 'dune', label: '沙丘', tone: 'mid',
    // 沙漠的午後：淡藍的天，幾道金色、橘色的沙丘弧線
    draw(ctx, w, h) {
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#a9cbe0'], [0.45, '#f6dfc0']]);
      ctx.fillRect(0, 0, w, h);
      gpnBlob(ctx, 0.78 * w, 0.20 * h, 0.05 * w, 0.05 * w, '#fff2cf', 0.95);
      [['#e9b872', 0.48, 0.10], ['#d9944e', 0.60, 0.12], ['#c4743a', 0.74, 0.10], ['#9b5428', 0.88, 0.08]]
        .forEach(([c, base, amp], i) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.moveTo(0, h);
          ctx.lineTo(0, (base + amp * (i % 2 ? 0.3 : -0.2)) * h);
          ctx.bezierCurveTo(0.30 * w, (base - amp) * h, 0.55 * w, (base + amp * 0.8) * h, w, (base - amp * 0.4) * h);
          ctx.lineTo(w, h);
          ctx.closePath();
          ctx.fill();
        });
    },
  },
  {
    id: 'citylights', label: '夜景', tone: 'dark',
    // 夜晚的城市：深藍底，失焦的一顆顆暖色燈光（散景）
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#0b1026'], [1, '#1b1f3b']]);
      ctx.fillRect(0, 0, w, h);
      const rnd = gpnSeededRandom(44);
      ctx.filter = `blur(${Math.round(18 * k)}px)`;
      for (let i = 0; i < 46; i++) {
        const c = ['#ffb347', '#ff6f61', '#ffd56b', '#7fd8ff', '#c792ea'][i % 5];
        const r = (0.015 + rnd() * 0.045) * w;
        gpnBlob(ctx, rnd() * w, (0.25 + rnd() * 0.75) * h, r, r, c, 0.35 + rnd() * 0.4);
      }
      ctx.filter = 'none';
    },
  },
  {
    id: 'mint', label: '薄荷', tone: 'light',
    // 清爽的薄荷綠：斜斜的寬色帶，乾淨不搶眼
    draw(ctx, w, h) {
      ctx.fillStyle = '#eefaf5';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.35);
      const band = Math.hypot(w, h);
      [['#c9f0e1', -0.36], ['#a7e3cc', -0.12], ['#d8f5ea', 0.10], ['#8fd8bd', 0.30]].forEach(([c, at]) => {
        ctx.fillStyle = c;
        ctx.fillRect(-band, at * band, band * 2, 0.13 * band);
      });
      ctx.restore();
    },
  },
  {
    id: 'citrus', label: '柑橘', tone: 'light',
    // 夏天的水果：橘子、檸檬、萊姆的大圓，在奶油色的底上
    draw(ctx, w, h) {
      const k = w / 1920, v = h / 1200;
      ctx.fillStyle = '#fff6e6';
      ctx.fillRect(0, 0, w, h);
      for (const [x, y, r, c] of [[380, 320, 300, '#ff9f43'], [1500, 260, 240, '#ffd93d'], [1180, 920, 340, '#a3d65c'],
        [260, 1020, 200, '#ffd93d'], [1780, 760, 180, '#ff9f43'], [820, 560, 140, '#ffe8a3']]) {
        gpnBlob(ctx, x * k, y * v, r * k, r * k, c, 0.85);
        gpnBlob(ctx, x * k, y * v, r * 0.72 * k, r * 0.72 * k, '#ffffff', 0.18);
      }
    },
  },
  {
    id: 'deepsea', label: '深海', tone: 'dark',
    // 海裡往上看：深藍到青綠，從水面斜斜照下來的光
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#1b8a9c'], [0.5, '#0d4f6b'], [1, '#03182b']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(30 * k)}px)`;
      ctx.fillStyle = '#bdf4ff';
      for (const [x, spread, a] of [[0.25, 0.06, 0.18], [0.45, 0.04, 0.14], [0.62, 0.07, 0.2], [0.80, 0.05, 0.12]]) {
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo((x - spread / 3) * w, 0);
        ctx.lineTo((x + spread / 3) * w, 0);
        ctx.lineTo((x + spread * 2) * w, h);
        ctx.lineTo((x - spread) * w, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
    },
  },
  {
    id: 'autumn', label: '秋楓', tone: 'mid',
    // 秋天的楓葉色：酒紅、橘、焦糖、金黃的大色塊
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, w, h, [[0, '#f3d9a4'], [1, '#c8553d']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(90 * k)}px)`;
      for (const [x, y, r, c, a] of [[0.15, 0.25, 0.20, '#e07a1f', 0.8], [0.70, 0.18, 0.18, '#f2b134', 0.8],
        [0.50, 0.70, 0.24, '#9c2c2c', 0.75], [0.90, 0.80, 0.18, '#d1495b', 0.7], [0.12, 0.85, 0.14, '#8d5524', 0.7]]) {
        gpnBlob(ctx, x * w, y * h, r * w, r * w, c, a);
      }
      ctx.filter = 'none';
    },
  },
  {
    id: 'nebula', label: '星雲', tone: 'dark',
    // 宇宙：黑底、滿天星，中間一大片洋紅和藍紫的星雲
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = '#05030f';
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(130 * k)}px)`;
      gpnBlob(ctx, 0.40 * w, 0.45 * h, 0.30 * w, 0.18 * h, '#c2185b', 0.65, -0.4);
      gpnBlob(ctx, 0.62 * w, 0.52 * h, 0.28 * w, 0.16 * h, '#3949ab', 0.7, 0.3);
      gpnBlob(ctx, 0.52 * w, 0.40 * h, 0.12 * w, 0.10 * h, '#ff8a65', 0.5);
      ctx.filter = 'none';
      const rnd = gpnSeededRandom(77);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 220; i++) {
        ctx.globalAlpha = 0.2 + rnd() * 0.7;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, (0.5 + rnd() * 1.6) * Math.max(k, 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'washi', label: '和紙', tone: 'light',
    // 素雅的和紙：米白底，幾塊淡淡的米色、灰綠、淺藍，像拼貼的紙
    draw(ctx, w, h) {
      const k = w / 1920, v = h / 1200;
      ctx.fillStyle = '#f7f3ea';
      ctx.fillRect(0, 0, w, h);
      const rect = (x, y, rw, rh, rot, c) => {
        ctx.save();
        ctx.translate(x * k, y * v);
        ctx.rotate(rot);
        ctx.fillStyle = c;
        ctx.fillRect(-rw * k / 2, -rh * k / 2, rw * k, rh * k);
        ctx.restore();
      };
      rect(420, 380, 620, 420, -0.08, '#e9dcc5');
      rect(1420, 330, 520, 360, 0.06, '#d5dfd0');
      rect(1050, 880, 760, 380, -0.03, '#dbe6ee');
      rect(240, 1000, 380, 300, 0.1, '#efd9cf');
      rect(1720, 980, 320, 260, -0.12, '#e6e0d0');
    },
  },
  {
    id: 'memphis', label: '孟菲斯', tone: 'light',
    // 80 年代的孟菲斯風：奶油底上的圓、三角、波浪線，粉藍、桃紅、鵝黃
    draw(ctx, w, h) {
      const k = w / 1920, v = h / 1200;
      ctx.fillStyle = '#fff8ec';
      ctx.fillRect(0, 0, w, h);
      gpnBlob(ctx, 1450 * k, 300 * v, 260 * k, 260 * k, '#7ecbf2');
      gpnBlob(ctx, 300 * k, 900 * v, 220 * k, 220 * k, '#ffd23f');
      ctx.fillStyle = '#ff6f91';
      ctx.beginPath();
      ctx.moveTo(380 * k, 140 * v);
      ctx.lineTo(760 * k, 520 * v);
      ctx.lineTo(160 * k, 560 * v);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6c5ce7';
      ctx.fillRect(1100 * k, 760 * v, 300 * k, 300 * k);
      ctx.strokeStyle = '#2d3436';
      ctx.lineWidth = 26 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const x = (820 + i * 70) * k, y = (300 + (i % 2 ? 60 : -60)) * v;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      gpnBlob(ctx, 1700 * k, 1000 * v, 120 * k, 120 * k, '#ff6f91');
    },
  },
  {
    id: 'neon', label: '霓虹', tone: 'dark',
    // 夜店的霓虹：深紫底，桃紅、青藍、紫色的光暈交疊
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = '#12002b';
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(140 * k)}px)`;
      gpnBlob(ctx, 0.20 * w, 0.30 * h, 0.25 * w, 0.25 * w, '#ff2e97', 0.75);
      gpnBlob(ctx, 0.80 * w, 0.30 * h, 0.22 * w, 0.22 * w, '#00e5ff', 0.65);
      gpnBlob(ctx, 0.55 * w, 0.85 * h, 0.28 * w, 0.20 * w, '#7c3aed', 0.75);
      ctx.filter = 'none';
    },
  },
  {
    id: 'lake', label: '湖光', tone: 'mid',
    // 平靜的湖：上面是天空，中間一條遠山，下面是倒影（同樣的顏色更淡）
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, 0.55 * h, [[0, '#8fb8de'], [1, '#f3d1b5']]);
      ctx.fillRect(0, 0, w, 0.55 * h);
      ctx.fillStyle = gpnLinear(ctx, 0, 0.55 * h, 0, h, [[0, '#e9c6ad'], [1, '#6f97bd']]);
      ctx.fillRect(0, 0.55 * h, w, 0.45 * h);
      const rnd = gpnSeededRandom(8);
      const pts = Array.from({ length: 9 }, (_, i) => [(i / 8) * w, (0.42 + rnd() * 0.08) * h]);
      for (const [dir, alpha] of [[1, 1], [-1, 0.45]]) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#5a6f8f';
        ctx.beginPath();
        ctx.moveTo(0, 0.55 * h);
        for (const [x, y] of pts) ctx.lineTo(x, 0.55 * h + dir * (y - 0.55 * h));
        ctx.lineTo(w, 0.55 * h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.filter = `blur(${Math.round(40 * k)}px)`;
      gpnBlob(ctx, 0.25 * w, 0.30 * h, 0.06 * w, 0.06 * w, '#fff1d6', 0.9);
      gpnBlob(ctx, 0.25 * w, 0.80 * h, 0.06 * w, 0.03 * w, '#fff1d6', 0.45);
      ctx.filter = 'none';
    },
  },
  {
    id: 'snowfield', label: '雪原', tone: 'light',
    // 冬天的早上：淡藍的天、白白的雪坡一層層，遠處一點淡紫的山影
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#dbe9f7'], [0.5, '#eef4fb'], [1, '#ffffff']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(70 * k)}px)`;
      gpnBlob(ctx, 0.75 * w, 0.15 * h, 0.18 * w, 0.12 * w, '#fff4e0', 0.8);
      gpnBlob(ctx, 0.25 * w, 0.48 * h, 0.40 * w, 0.10 * h, '#b9b4dc', 0.55);
      gpnBlob(ctx, 0.80 * w, 0.55 * h, 0.35 * w, 0.09 * h, '#a9c3e6', 0.5);
      gpnBlob(ctx, 0.35 * w, 0.75 * h, 0.55 * w, 0.12 * h, '#d6e4f3', 0.8);
      gpnBlob(ctx, 0.70 * w, 0.92 * h, 0.50 * w, 0.10 * h, '#c7d9ee', 0.6);
      ctx.filter = 'none';
    },
  },
  {
    id: 'bamboo', label: '竹林', tone: 'mid',
    // 青綠的竹林：一根根粗細不一的竹子，前面深、後面淺，上面透著光
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#e6f2c8'], [0.6, '#8fbf7a'], [1, '#3f6b3a']]);
      ctx.fillRect(0, 0, w, h);
      const rnd = gpnSeededRandom(58);
      [['#a9cf8a', 0.5, 14], ['#6fa45c', 0.7, 10], ['#3e7340', 0.9, 7]].forEach(([c, a, n]) => {
        ctx.fillStyle = c;
        ctx.globalAlpha = a;
        for (let i = 0; i < n; i++) {
          const x = rnd() * w, bw = (24 + rnd() * 50) * k * (a + 0.3);
          ctx.fillRect(x, 0, bw, h);
        }
      });
      ctx.globalAlpha = 1;
      ctx.filter = `blur(${Math.round(90 * k)}px)`;
      gpnBlob(ctx, 0.6 * w, 0.08 * h, 0.30 * w, 0.14 * h, '#fbffe0', 0.6);
      ctx.filter = 'none';
    },
  },
  {
    id: 'wheat', label: '麥田', tone: 'mid',
    // 黃昏的麥田：金黃色的田一層層延伸到遠方，天空是淡淡的桃色
    draw(ctx, w, h) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#ffd8b0'], [0.4, '#ffe6a8'], [1, '#c98a2e']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(80 * k)}px)`;
      gpnBlob(ctx, 0.70 * w, 0.30 * h, 0.12 * w, 0.12 * w, '#fff3c4', 0.9);
      ctx.filter = 'none';
      [['#f2c86b', 0.50], ['#e2ac48', 0.62], ['#cf9236', 0.76], ['#a96f24', 0.90]].forEach(([c, base], i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 1; x += w / 40) {
          ctx.lineTo(x, (base + 0.02 * Math.sin(x / w * Math.PI * (2 + i) + i)) * h);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });
    },
  },  /* ---- 動態背景（4.18.0）----
     live: true 的會一直動：draw(ctx, w, h, t) 的 t 是秒數，gpnAnimateBackground 每秒畫 24 張。
     縮圖、判斷明暗用 t = 0 那一張。都刻意「慢」：在背景裡輕輕流動，不搶筆記本的注意力。 */
  {
    id: 'live-aurora', label: '流動極光', tone: 'dark', live: true,
    // 深夜的天空，幾條極光慢慢飄、星星一閃一閃
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#040714'], [1, '#0c1838']]);
      ctx.fillRect(0, 0, w, h);
      const rnd = gpnSeededRandom(7);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 120; i++) {
        const x = rnd() * w, y = rnd() * h * 0.8, ph = rnd() * 6.28, sp = 0.6 + rnd() * 1.6;
        ctx.globalAlpha = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * sp + ph));
        ctx.beginPath();
        ctx.arc(x, y, (0.6 + rnd() * 1.3) * Math.max(k, 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.filter = `blur(${Math.round(130 * k)}px)`;
      const s = (f, p) => Math.sin(t * f + p);
      gpnBlob(ctx, (0.25 + 0.08 * s(0.21, 0)) * w, (0.38 + 0.05 * s(0.17, 1)) * h, 0.34 * w, 0.12 * h, '#22d3ee', 0.55, -0.25 + 0.15 * s(0.13, 2));
      gpnBlob(ctx, (0.58 + 0.07 * s(0.18, 3)) * w, (0.28 + 0.06 * s(0.23, 4)) * h, 0.36 * w, 0.11 * h, '#34d399', 0.5, 0.15 + 0.12 * s(0.11, 5));
      gpnBlob(ctx, (0.82 + 0.05 * s(0.15, 6)) * w, (0.52 + 0.06 * s(0.19, 7)) * h, 0.24 * w, 0.19 * h, '#8b5cf6', 0.55);
      gpnBlob(ctx, (0.40 + 0.09 * s(0.12, 8)) * w, (0.80 + 0.04 * s(0.2, 9)) * h, 0.30 * w, 0.11 * h, '#6366f1', 0.4);
      ctx.filter = 'none';
    },
  },
  {
    id: 'live-waves', label: '起伏海浪', tone: 'dark', live: true,
    // 一層一層的浪慢慢起伏
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#0b2545'], [0.5, '#13315c'], [1, '#134e5e']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(120 * k)}px)`;
      gpnBlob(ctx, 0.78 * w, 0.18 * h, 0.22 * w, 0.14 * h, '#8ecae6', 0.35);
      ctx.filter = 'none';
      const rnd = gpnSeededRandom(5);
      const bands = [
        ['#1d4e89', 0.44, 0.05, 1.3, 0.35], ['#1f6f8b', 0.55, 0.05, 1.7, -0.45], ['#2a9d8f', 0.66, 0.045, 1.1, 0.55],
        ['#57c4ad', 0.77, 0.04, 1.9, -0.6], ['#a7e2d0', 0.89, 0.035, 1.5, 0.7],
      ];
      for (const [color, base, amp, f, speed] of bands) {
        const ph = rnd() * Math.PI * 2 + t * speed;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += Math.max(2, 8 * k)) {
          const a = (x / w) * Math.PI * 2;
          ctx.lineTo(x, (base + amp * Math.sin(a * f + ph) + amp * 0.4 * Math.sin(a * f * 2.3 + ph * 1.7)) * h);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'live-lava', label: '熔岩燈', tone: 'mid', live: true,
    // 像熔岩燈：幾團暖色的光球慢慢上下漂
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, w, h, [[0, '#2b1055'], [1, '#d53369']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(90 * k)}px)`;
      const balls = [[0.15, 0.20, '#ff9a3c', 0.09], [0.38, 0.11, '#ffd23f', 0.07], [0.60, 0.17, '#ff5e78', 0.08],
        [0.82, 0.13, '#ffb26b', 0.10], [0.28, 0.09, '#f72585', 0.06], [0.72, 0.10, '#ffc857', 0.05]];
      balls.forEach(([x, r, c, sp], i) => {
        const y = 0.5 + 0.38 * Math.sin(t * sp * 3 + i * 1.7);
        gpnBlob(ctx, (x + 0.03 * Math.sin(t * 0.2 + i)) * w, y * h, r * w, r * w * 1.15, c, 0.8);
      });
      ctx.filter = 'none';
    },
  },
  {
    id: 'live-meteor', label: '流星雨', tone: 'dark', live: true,
    // 滿天星，每隔幾秒劃過一道流星
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#02030a'], [1, '#151a3a']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(140 * k)}px)`;
      gpnBlob(ctx, 0.7 * w, 0.75 * h, 0.35 * w, 0.18 * h, '#3b2f7a', 0.6);
      ctx.filter = 'none';
      const rnd = gpnSeededRandom(77);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 200; i++) {
        const x = rnd() * w, y = rnd() * h, ph = rnd() * 6.28;
        ctx.globalAlpha = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.3 + ph));
        ctx.beginPath();
        ctx.arc(x, y, (0.5 + rnd() * 1.4) * Math.max(k, 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      // 三道流星輪流出現：每道 7 秒一輪，劃過的時間約 1.2 秒
      for (let m = 0; m < 3; m++) {
        const cycle = 7, local = (t + m * 2.6) % cycle;
        if (local > 1.2) continue;
        const r2 = gpnSeededRandom(100 + m + Math.floor((t + m * 2.6) / cycle) * 7);
        const sx = (0.3 + r2() * 0.6) * w, sy = r2() * 0.35 * h;
        const p = local / 1.2, len = 0.18 * w;
        const hx = sx - p * 0.45 * w, hy = sy + p * 0.3 * h;
        const g = ctx.createLinearGradient(hx, hy, hx + len, hy - len * 0.66);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = Math.sin(p * Math.PI);
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(1, 3 * k);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + len, hy - len * 0.66);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'live-sakura', label: '飄落櫻花', tone: 'light', live: true,
    // 淡粉色的底，花瓣慢慢飄下來、一邊轉
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#fff7f9'], [1, '#ffe1ea']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(60 * k)}px)`;
      gpnBlob(ctx, 0.15 * w, 0.2 * h, 0.2 * w, 0.14 * w, '#ffc4d4', 0.7);
      gpnBlob(ctx, 0.85 * w, 0.75 * h, 0.22 * w, 0.15 * w, '#ffb3c8', 0.6);
      ctx.filter = 'none';
      const rnd = gpnSeededRandom(12);
      for (let i = 0; i < 40; i++) {
        const x0 = rnd(), sp = 0.025 + rnd() * 0.035, size = (10 + rnd() * 16) * k, ph = rnd() * 6.28;
        const y = ((rnd() + t * sp) % 1.1) - 0.05;
        const x = x0 + 0.03 * Math.sin(t * 0.8 + ph);
        ctx.save();
        ctx.translate(x * w, y * h);
        ctx.rotate(t * (0.4 + rnd()) + ph);
        ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(t + ph)));
        ctx.fillStyle = ['#ff9fb8', '#ffb7c9', '#f7a8c4'][i % 3];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'live-rainbow', label: '彩虹漸層', tone: 'mid', live: true,
    // 幾團柔和的顏色慢慢繞圈、互相融在一起
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = '#f2e9ff';
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(150 * k)}px)`;
      const cols = ['#ff8fab', '#ffc06e', '#7ee8c7', '#7aa8ff', '#c28bff'];
      cols.forEach((c, i) => {
        const a = t * 0.12 + (i / cols.length) * Math.PI * 2;
        gpnBlob(ctx, (0.5 + 0.32 * Math.cos(a)) * w, (0.5 + 0.30 * Math.sin(a * 1.2)) * h, 0.26 * w, 0.26 * w, c, 0.85);
      });
      ctx.filter = 'none';
    },
  },
  {
    id: 'live-forest', label: '搖曳森林', tone: 'dark', live: true,
    // 「森林」那張，樹梢跟著風輕輕左右擺，晨光跟著慢慢明暗
    draw(ctx, w, h, t = 0) { gpnForest(ctx, w, h, t, true); },
  },
  {
    id: 'live-firefly', label: '螢火蟲', tone: 'dark', live: true,
    // 夜裡的林子，一群黃綠色的小光點慢慢飄、一明一暗
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#0b1a24'], [0.6, '#10291f'], [1, '#061209']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(120 * k)}px)`;
      gpnBlob(ctx, 0.5 * w, 0.85 * h, 0.5 * w, 0.18 * h, '#1f4a2f', 0.7);
      ctx.filter = 'none';
      const rnd = gpnSeededRandom(44);
      [['#163322', 0.62], ['#0c2016', 0.80]].forEach(([c, base]) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(0, h);
        const n = 18;
        for (let i = 0; i <= n; i++) {
          ctx.lineTo((i - 0.5) / n * w, base * h);
          ctx.lineTo(i / n * w, (base - (0.08 + rnd() * 0.14)) * h);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });
      for (let i = 0; i < 45; i++) {
        const x0 = rnd(), y0 = 0.25 + rnd() * 0.7, ph = rnd() * 6.28, sp = 0.15 + rnd() * 0.25, blink = 0.6 + rnd() * 0.6;
        const x = (x0 + 0.04 * Math.sin(t * sp + ph)) * w;
        const y = (y0 + 0.03 * Math.cos(t * sp * 1.3 + ph)) * h;
        const glow = 0.15 + 0.85 * Math.max(0, Math.sin(t * blink + ph));
        const r = (14 + rnd() * 10) * Math.max(k, 0.5);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(230,255,140,${0.9 * glow})`);
        g.addColorStop(1, 'rgba(230,255,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'live-snow', label: '飄雪', tone: 'light', live: true,
    // 淡藍灰的冬天，雪花慢慢飄下來、左右晃
    draw(ctx, w, h, t = 0) {
      const k = w / 1920;
      ctx.fillStyle = gpnLinear(ctx, 0, 0, 0, h, [[0, '#c9d8ea'], [1, '#eef3f9']]);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = `blur(${Math.round(90 * k)}px)`;
      gpnBlob(ctx, 0.2 * w, 0.85 * h, 0.4 * w, 0.12 * h, '#ffffff', 0.9);
      gpnBlob(ctx, 0.8 * w, 0.2 * h, 0.25 * w, 0.18 * w, '#b3c6e0', 0.6);
      ctx.filter = 'none';
      const rnd = gpnSeededRandom(21);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 90; i++) {
        const x0 = rnd(), sp = 0.02 + rnd() * 0.04, r = (3 + rnd() * 7) * Math.max(k, 0.5), ph = rnd() * 6.28;
        const y = ((rnd() + t * sp) % 1.1) - 0.05;
        const x = x0 + 0.02 * Math.sin(t * 0.7 + ph);
        ctx.globalAlpha = 0.6 + 0.4 * rnd();
        ctx.beginPath();
        ctx.arc(x * w, y * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
];

/**
 * 把背景畫到 canvas 上（整張畫滿）。
 * 大圖（網頁背景）另外加一層很淡的顆粒：漸層在大螢幕上才不會出現一圈一圈的色階。
 */
function gpnPaintBackground(canvas, id) {
  const bg = GPN_BACKGROUNDS.find((b) => b.id === id);
  if (!bg) return false;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.save();
  bg.draw(ctx, w, h);
  ctx.restore();

  if (w >= 1000) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 160;
    const tc = tile.getContext('2d');
    const img = tc.createImageData(160, 160);
    const rnd = gpnSeededRandom(99);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = 96 + rnd() * 64;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  return true;
}

/**
 * 動態背景：在 canvas 上一直重畫，回傳「停下來」的函式。
 * 畫小一點的圖（寬 960）再讓 CSS 放大：本來就是柔和的色塊，放大看不出來，電腦也輕鬆很多。
 * 每秒 24 張就夠順；分頁看不到時瀏覽器會自己暫停。
 * 使用者在系統設定要求「減少動態」的話，只畫一張不動的。
 */
function gpnAnimateBackground(canvas, id) {
  const bg = GPN_BACKGROUNDS.find((b) => b.id === id);
  if (!bg) return () => {};
  const ctx = canvas.getContext('2d');
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  let raf = 0, last = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / 24) return;
    last = now;
    ctx.save();
    bg.draw(ctx, canvas.width, canvas.height, (now - start) / 1000);
    ctx.restore();
  };
  if (still) {
    bg.draw(ctx, canvas.width, canvas.height, 0);
    return () => {};
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
