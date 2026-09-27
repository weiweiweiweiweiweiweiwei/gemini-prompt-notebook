/**
 * 內建背景（設定 → 背景）：全部用 canvas 畫出來，不用放圖片檔，也不佔下載空間。
 * src/backgrounds.js 和 web/backgrounds.js 必須一字不差（tools/checksync.py 會檢查）。
 *
 * 每一張都是為了「霧面玻璃」設計的：
 *   大塊、顏色分明的色塊 —— 被玻璃模糊之後會變成柔和的色彩層次，筆記本才會「透」得漂亮；
 *   細碎的花紋一模糊就糊成一片灰，所以刻意不用。
 * 畫的時候一律用「相對位置」（寬高的比例），同一個函式畫 240px 的縮圖和 1920px 的大圖，長相一樣。
 *
 * 只有網頁版、外掛的工具列小視窗會用到（面板就是整個畫面的地方），見 panel.js 的「背景」。
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
