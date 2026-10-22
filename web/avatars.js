/**
 * 分身的頭像（4.24.0）：全部用 SVG 畫，不用放圖片檔。
 *
 * 分身沒有 Google 大頭貼，所以建立的時候挑一個（預設隨便抽一個），之後建立的人、用分身的人都可以換。
 * 選了哪一個（id，只能是小寫英文字母）記在分身檔案的 appProperties（avatar），見 sync.js 的「分身」。
 *
 * 兩組：
 *   動物（style: 'line'）幾何、極簡，像摺紙：整張臉是一個直線的多邊形，裡面幾條摺線把臉分成幾塊面；
 *     只有耳朵內側、眼睛、鼻子（熊貓的黑眼圈、企鵝的頭）塗成實心黑，其他都是白的。
 *   人物（style: 'flat'）扁平插畫：膚色的臉、深藍的頭髮、紅紅的臉頰和嘴巴，每個人的髮型、衣服不一樣。
 * 底色都是很淡的顏色，一排放在一起時分得出誰是誰，又不會花。
 * 座標都以 64 × 64 來想；左右對稱的部分只寫左邊，pair() 會自動鏡射出右邊。
 */
const GPN_AVATARS = (() => {
  const LINE = '#232323', PAPER = '#fffdf8';
  /** 多邊形（白的面） */
  const face = (pts) => `<polygon points="${pts}" fill="${PAPER}"/>`;
  /** 多邊形（實心黑） */
  const ink = (pts) => `<polygon points="${pts}" fill="${LINE}"/>`;
  /** 摺線 */
  const fold = (d) => `<path d="${d}" fill="none"/>`;
  /** 菱形的眼睛 */
  const dot = (cx, cy, r = 1.9, fill = LINE) =>
    `<polygon points="${cx - r},${cy} ${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r}" fill="${fill}"/>`;
  /** 左右對稱：left 是左邊的 SVG，右邊自動鏡射 */
  const pair = (left) => left + `<g transform="matrix(-1 0 0 1 64 0)">${left}</g>`;

  /* ---- 人物用的零件 ---- */
  const HAIR = '#1f2a48', SKIN = '#f6c6ae', NECK = '#eab39a', CHEEK = '#f08f8f', RED = '#e2513c', SNOW = '#f3f0ea';
  /** 脖子、肩膀和衣服：下緣沿著頭像的圓（不會畫出圓外） */
  const body = (color) => `<rect x="28" y="44" width="8" height="9" fill="${NECK}"/>` +
    `<path d="M10.83 56 Q14 51.5 24 51 L40 51 Q50 51.5 53.17 56 A32 32 0 0 1 10.83 56 Z" fill="${color}"/>`;
  /** 襯衫的 V 領 */
  const collar = (color = SNOW) => `<path d="M26 51 L32 56.5 L38 51 Z" fill="${color}"/>`;
  const ears = (r = 3.6) => pair(`<circle cx="19.6" cy="35" r="${r}" fill="${SKIN}"/>`);
  const head = (x = 20, y = 18, w = 24, h = 29) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2 - 1}" fill="${SKIN}"/>`;
  /** 五官：眼睛、眉毛、腮紅、鼻子、張開的嘴 */
  const looks = ({ eyeY = 34, browY = 30, brow = true, mouthW = 5, mouthY = 41.6 } = {}) =>
    pair(`<circle cx="27" cy="${eyeY}" r="1.55" fill="${HAIR}"/>`) +
    (brow ? pair(`<path d="M24.8 ${browY} h4" fill="none" stroke="${HAIR}" stroke-width="1.6" stroke-linecap="round"/>`) : '') +
    pair(`<circle cx="24.6" cy="39.6" r="2.3" fill="${CHEEK}" opacity=".7"/>`) +
    '<path d="M32.2 35.6 v3 h1.3" fill="none" stroke="#e09a80" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    `<path d="M${32 - mouthW / 2} ${mouthY} h${mouthW} a${mouthW / 2} ${mouthW / 2} 0 0 1 -${mouthW} 0 z" fill="${RED}"/>`;
  const dots = (list, color) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`).join('');

  const animals = [
    {
      id: 'cat', label: '貓咪', bg: '#ece3d8', group: '動物', style: 'line',
      art: face('16,10 27,19 32,18 37,19 48,10 50,30 46,42 32,50 18,42 14,30') +
        fold('M32 18 L32 38') +
        pair(fold('M27 19 L23 29 M14 30 L23 29 L29.8 38 M18 42 L29.8 38 L32 50') +
          ink('17.6,14.5 24.4,19.5 19.4,24') + ink('22.5,32 25.5,30 28.5,32 25.5,33.6')) +
        ink('29.8,38 34.2,38 32,40.8'),
    },
    {
      // 垂下來的黑耳朵：和尖耳朵的貓咪一眼分得出來
      id: 'dog', label: '小狗', bg: '#efe2d0', group: '動物', style: 'line',
      art: face('20,18 32,16 44,18 50,30 47,43 32,51 17,43 14,30') +
        fold('M32 16 L32 35') +
        pair(fold('M14 30 L24 38 M17 43 L26 46') + ink('20,18 12.5,20.5 9.5,33 14.5,38 19.5,29') + dot(25.5, 30)) +
        face('24,38 32,35 40,38 38,46 26,46') + ink('29,37.4 35,37.4 32,40.8'),
    },
    {
      id: 'rabbit', label: '兔子', bg: '#ede3e6', group: '動物', style: 'line',
      art: pair(face('20,27 18,6 24.5,3.5 28,24') + ink('21,9 23.8,7 25.6,21.5')) +
        face('18,32 25,24 32,23 39,24 46,32 45,43 32,52 19,43') +
        fold('M32 32 L32 40.4') +
        pair(fold('M25 24 L32 32 M18 32 L26 37 M19 43 L30.4 40.4 L32 52') + dot(25.5, 33.5, 1.8)) +
        ink('30.4,40.4 33.6,40.4 32,42.4'),
    },
    {
      id: 'bear', label: '小熊', bg: '#e8e1d6', group: '動物', style: 'line',
      art: pair(face('12,21 15,12 23,11 26,18') + ink('16.2,14.2 21.8,13.4 19.2,18.6')) +
        face('14,26 22,17 42,17 50,26 50,40 42,50 22,50 14,40') +
        face('25,38 32,35 39,38 37,46 27,46') +
        fold('M32 26 L32 35') +
        pair(fold('M22 17 L32 26 M14 26 L22 31 M14 40 L25 38 M22 50 L27 46') + dot(25.5, 30.5)) +
        ink('29.4,37.2 34.6,37.2 32,40.2'),
    },
    {
      id: 'panda', label: '熊貓', bg: '#e3e9e3', group: '動物', style: 'line',
      art: pair(ink('12,22 14,12 23,10 26,17')) +
        face('14,27 22,17 42,17 50,27 50,40 42,50 22,50 14,40') +
        fold('M32 25 L32 41') +
        pair(fold('M22 17 L32 25 M14 40 L21 39.5 M22 50 L29.6 43.8') +
          ink('18.5,33 24,25.5 30,29 28,38 21,39.5') + dot(25.2, 31.8, 1.7, PAPER)) +
        ink('29.6,41 34.4,41 32,43.8'),
    },
    {
      id: 'fox', label: '狐狸', bg: '#efe1d6', group: '動物', style: 'line',
      art: face('12,8 25,18 39,18 52,8 50,28 32,52 14,28') +
        fold('M32 28 L32 45.6') +
        pair(fold('M25 18 L32 28 M14 28 L25 34 L32 52') +
          ink('14.6,12.4 21.8,18.4 16.2,22') + ink('21.5,29.4 27.6,30.4 23.4,32.6')) +
        ink('29.8,45.6 34.2,45.6 32,48.6'),
    },
    {
      id: 'penguin', label: '企鵝', bg: '#e1e6ec', group: '動物', style: 'line',
      art: ink('16,20 26,12 38,12 48,20 51,34 44,48 20,48 13,34') +
        face('20,26 27,20 32,24 37,20 44,26 45,37 38,45 26,45 19,37') +
        fold('M32 24 L32 34.2') +
        pair(fold('M19 37 L29 34.2 M26 45 L32 38.6') + dot(26.5, 30, 1.8)) +
        ink('29,34.2 35,34.2 32,38.6'),
    },
    {
      id: 'hamster', label: '倉鼠', bg: '#efe8d9', group: '動物', style: 'line',
      art: pair(face('14,19 17,11.5 24,12.5 24.5,19') + ink('17.6,14.2 22.2,14.4 21.6,18')) +
        face('12,30 20,18 44,18 52,30 52,40 44,50 20,50 12,40') +
        fold('M32 18 L32 37.4') +
        pair(fold('M20 18 L26 27 M12 30 L22 37 L20 50 M22 37 L30.6 37.4') + dot(25.5, 31, 1.8)) +
        ink('30.6,37.4 33.4,37.4 32,39.2'),
    },
    {
      id: 'owl', label: '貓頭鷹', bg: '#e5e2ea', group: '動物', style: 'line',
      art: face('16,8 25,17 39,17 48,8 50,26 49,42 40,52 24,52 15,42 14,26') +
        fold('M32 41.4 L32 46') +
        pair(fold('M16 8 L19 26.5 M15 42 L25 37 M24 52 L32 46') +
          face('25,23 31,26.5 31,33.5 25,37 19,33.5 19,26.5') +
          ink('25,27 27.6,28.5 27.6,31.5 25,33 22.4,31.5 22.4,28.5')) +
        ink('29.6,36.6 34.4,36.6 32,41.4'),
    },
    {
      id: 'frog', label: '青蛙', bg: '#e1e8dc', group: '動物', style: 'line',
      art: pair(face('13,22 16,12 25,10 29,17 27,24') + ink('21,13.6 23.6,15.1 23.6,18.1 21,19.6 18.4,18.1 18.4,15.1')) +
        face('10,32 16,22 48,22 54,32 50,44 38,50 26,50 14,44') +
        fold('M20 38 L32 43 L44 38') +
        pair(fold('M16 22 L24 30 M10 32 L20 38 M26 50 L32 43') + dot(29.4, 30.5, 0.9)),
    },
    {
      id: 'chick', label: '小雞', bg: '#eeead6', group: '動物', style: 'line',
      art: ink('29.4,15 31,7.5 35,9 33.6,14.6') +
        face('18,18 32,14 46,18 52,32 46,46 32,50 18,46 12,32') +
        fold('M32 14 L32 32.4') +
        pair(fold('M18 18 L25 27 M12 32 L28.4 35 M18 46 L32 38.6') + dot(25, 29)) +
        ink('28.4,35 32,32.4 35.6,35 32,38.6'),
    },
    {
      id: 'koala', label: '無尾熊', bg: '#e0e5e8', group: '動物', style: 'line',
      art: pair(face('6,24 10,13 20,10 26,18 20,28 11,31') + ink('11,17.6 18.6,14 21.4,20 15.4,25')) +
        face('16,24 26,16 38,16 48,24 49,38 42,49 22,49 15,38') +
        fold('M32 24 L32 32.6') +
        pair(fold('M26 16 L32 24 M15 38 L27.4 38 M22 49 L29 44') + dot(24.5, 30, 1.8)) +
        ink('29,32.6 35,32.6 36.6,38 35,44 29,44 27.4,38'),
    },
  ];

  const people = [
    {
      id: 'beanie', label: '毛帽', bg: '#fde4de',
      art: body('#6b4fae') + '<rect x="26.5" y="47" width="11" height="6.5" rx="2" fill="#8466c8"/>' + ears() + head() +
        `<path d="M23.5 23 Q23.5 13.5 32 13.5 Q40.5 13.5 40.5 23 Z" fill="${RED}"/>` +
        '<rect x="22.5" y="20.5" width="19" height="4.2" rx="2" fill="#c43d2b"/><circle cx="32" cy="12.6" r="2.2" fill="#c43d2b"/>' +
        pair(`<rect x="24" y="28.6" width="6" height="2.8" rx="1.2" fill="${HAIR}"/>`) + looks({ brow: false, mouthW: 6 }),
    },
    {
      id: 'sidepart', label: '旁分', bg: '#e4ecfb',
      art: body(RED) + collar() + `<circle cx="32" cy="59.2" r="1" fill="${SNOW}"/>` + ears() + head() +
        `<path d="M19.8 31 Q18.2 16.5 30.5 15.2 Q43.5 14.2 44.6 27.5 L44.4 31 Q41.5 21.5 33 22.2 Q26 23 22.4 27.6 Z" fill="${HAIR}"/>` +
        looks(),
    },
    {
      id: 'hood', label: '帽兜', bg: '#fdf0d6',
      art: body('#ea6a3d') + '<rect x="15.5" y="12" width="33" height="41" rx="16.5" fill="#ea6a3d"/>' +
        '<rect x="18.5" y="15.5" width="27" height="34" rx="13.5" fill="#f3936a"/>' + head(21, 19, 22, 28) +
        pair(`<path d="M25.6 34.4 q1.6 -1.8 3.2 0" fill="none" stroke="${HAIR}" stroke-width="1.5" stroke-linecap="round"/>`) +
        pair(`<circle cx="24.8" cy="39.6" r="2.2" fill="${CHEEK}" opacity=".7"/>`) +
        `<path d="M29.8 41.6 h4.4 a2.2 2.2 0 0 1 -4.4 0 z" fill="${RED}"/>` +
        pair(`<path d="M26 51 v5" stroke="${SNOW}" stroke-width="1.4" stroke-linecap="round"/>`),
    },
    {
      id: 'quiff', label: '飛機頭', bg: '#e3f2ec',
      art: body('#e9a23b') + '<rect x="26" y="49" width="12" height="4" rx="2" fill="#c98422"/>' + ears(4.3) + head() +
        `<path d="M20.2 29 Q19 19 25 15.5 Q31 11 38.5 13 Q46 15.5 44 29 Q42.5 22.5 36.5 22.4 L27 22.4 Q22.5 23 20.2 29 Z" fill="${HAIR}"/>` +
        `<path d="M23 17.5 Q27 7.5 40 10.5 Q44.5 11.8 45 15.5 Q38 12.5 33 15 Q28 17.6 23 17.5 Z" fill="${HAIR}"/>` +
        looks(),
    },
    {
      id: 'grandpa', label: '爺爺', bg: '#efe7fa',
      art: body('#d84a37') + collar() + ears() + head() + '<ellipse cx="27.5" cy="21.6" rx="3.2" ry="1.4" fill="#fbdccb"/>' +
        pair(`<path d="M19 37 Q17.2 26.5 22.8 23.6 Q21.8 30 23.4 37 Z" fill="${SNOW}"/>`) +
        pair(`<rect x="23.6" y="28.6" width="6.6" height="2.9" rx="1.45" fill="${SNOW}"/>`) +
        looks({ brow: false, mouthW: 4, mouthY: 42.8 }) +
        `<path d="M27.2 41 Q32 37.6 36.8 41 Q32 42.6 27.2 41 Z" fill="${SNOW}"/>`,
    },
    {
      id: 'bob', label: '鮑伯頭', bg: '#fde4ea',
      art: `<rect x="16.5" y="16" width="31" height="29" rx="13" fill="${HAIR}"/>` + body(SNOW) +
        `<path d="M24 51 L40 51 L38 53.5 L26 53.5 Z" fill="${RED}"/>` + head() +
        `<path d="M20 31 Q19.5 17.8 32 17.4 Q44.5 17.8 44 31 Q41 23 33 22 Q27.5 25.5 20 31 Z" fill="${HAIR}"/>` +
        looks(),
    },
    {
      id: 'curly', label: '捲髮', bg: '#e2f0f5',
      art: body('#3a8b85') + collar() +
        dots([[19.5, 28, 6.5], [44.5, 28, 6.5], [23, 19.5, 7], [32, 16.5, 7.5], [41, 19.5, 7]], HAIR) + ears() + head() +
        dots([[24.5, 22.5, 4], [30.5, 20.6, 4.3], [36.8, 21, 4], [41.4, 24.2, 3.3], [22, 25.4, 3]], HAIR) +
        looks({ browY: 30.5 }),
    },
    {
      id: 'bigbob', label: '蘑菇頭', bg: '#fdf1d9',
      art: `<circle cx="32" cy="31" r="17.5" fill="${HAIR}"/><rect x="14.5" y="31" width="35" height="15" rx="7" fill="${HAIR}"/>` +
        body(SNOW) + `<path d="M26.6 50.6 L32 53 L26.6 55.4 Z M37.4 50.6 L32 53 L37.4 55.4 Z" fill="${RED}"/>` +
        '<circle cx="32" cy="53" r="1.6" fill="#c43d2b"/>' + head() +
        `<path d="M20 28.5 Q20 17.6 32 17.2 Q44 17.6 44 28.5 Q38 26.4 32 26.6 Q26 26.4 20 28.5 Z" fill="${HAIR}"/>` +
        looks({ browY: 30.4 }),
    },
    {
      id: 'buns', label: '雙丸子', bg: '#e8eefc',
      art: body(RED) + collar() +
        pair(`<circle cx="20.5" cy="16.5" r="5.6" fill="${HAIR}"/>` +
          `<rect x="21.5" y="19.4" width="4.5" height="2.4" rx="1.2" fill="${RED}" transform="rotate(-40 23.75 20.6)"/>`) +
        ears() + head(21, 20, 22, 27) +
        `<path d="M21 31 Q20.2 19.5 32 19.4 Q43.8 19.5 43 31 Q40 24.8 32 24.6 Q24 24.8 21 31 Z" fill="${HAIR}"/>` +
        looks({ eyeY: 34.5, browY: 31, mouthW: 4 }),
    },
    {
      id: 'longhair', label: '長直髮', bg: '#e6f3e9',
      art: `<rect x="16.5" y="17" width="31" height="40" rx="14" fill="${HAIR}"/>` + body('#e9a23b') +
        '<path d="M27 51 L32 55 L37 51 Z" fill="#b8352a"/>' + head() +
        `<path d="M20 35 Q19 18 32 17.6 Q45 18 44 35 L42.2 35 Q41.4 24.4 32 22.6 Q22.6 24.4 21.8 35 Z" fill="${HAIR}"/>` +
        looks(),
    },
    {
      id: 'grandma', label: '奶奶', bg: '#fbe6ef',
      art: body('#7d5ab8') + collar() + `<rect x="17" y="17.5" width="30" height="24" rx="12" fill="${SNOW}"/>` + head() +
        dots([[24.5, 19.6, 4.6], [32, 17.2, 5], [39.5, 19.6, 4.6]], SNOW) +
        `<path d="M20.5 28 Q22 21 32 21.4 Q42 21 43.5 28 Q38 24.8 32 25 Q26 24.8 20.5 28 Z" fill="${SNOW}"/>` +
        looks({ brow: false, mouthW: 4 }) +
        pair(`<circle cx="27" cy="34" r="3.3" fill="none" stroke="${HAIR}" stroke-width="1.2"/>`) +
        `<path d="M30.3 34 h3.4" stroke="${HAIR}" stroke-width="1.2"/>`,
    },
    {
      id: 'topbun', label: '丸子頭', bg: '#e3f1f6',
      art: body('#3a8b85') + collar() + `<circle cx="32" cy="11.5" r="6.4" fill="${HAIR}"/>` + ears() +
        pair(`<circle cx="19.4" cy="39.6" r="1.2" fill="${RED}"/>`) + head() +
        `<rect x="28.2" y="16.2" width="7.6" height="2.4" rx="1.2" fill="${RED}"/>` +
        `<path d="M20 31.5 Q19.4 18.4 32 18 Q44.6 18.4 44 31.5 Q42 22.4 32 21.8 Q22 22.4 20 31.5 Z" fill="${HAIR}"/>` +
        looks(),
    },
  ].map((a) => ({ ...a, group: '人物', style: 'flat' }));

  return [...animals, ...people];
})();

/** 這個頭像的 SVG（認不得的 id 回傳空字串，畫面會改用文字頭像） */
function gpnAvatarSvg(id) {
  const a = GPN_AVATARS.find((x) => x.id === id);
  if (!a) return '';
  const art = a.style === 'line'
    ? `<g stroke="#232323" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${a.art}</g>` : a.art;
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="${a.bg}"/>${art}</svg>`;
}

/** 隨便抽一個（建立分身時的預設） */
const gpnRandomAvatar = () => GPN_AVATARS[Math.floor(Math.random() * GPN_AVATARS.length)].id;
