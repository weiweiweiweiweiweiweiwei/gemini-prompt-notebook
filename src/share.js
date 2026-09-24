/**
 * 匯出／匯入：讓「Chrome 外掛」和「網頁版」之間可以搬資料。
 *
 * 這個檔案在兩邊是「同一份」，因為它定義的是資料格式的契約。
 * 如果哪天要改格式，兩邊一定要一起改，否則就同步不了。
 *   → 外掛：  src/share.js
 *   → 網頁版：web/share.js
 * tools/checksync.py 會比對這兩份，不一樣就會叫。
 *
 * 匯出格式（.json 檔內容，也是「代碼」解開後的樣子）：
 * {
 *   "app": "gpn", "version": 4, "exportedAt": "2026-09-22T12:34:56.000Z",
 *   "tabs": [
 *     { id, label, color, items: [ { id, title, content } ] },            // 不分資料夾
 *     { id, label, color, folders: [ { id, label, items: [ ... ] } ] },   // 有資料夾
 *   ]
 * }
 * 舊版（v2、v3）匯出的備份也都吃得下，見 store.js 的升級規則。
 * 「最近使用」記錄不放進備份：那是自己的使用習慣，分享給別人時不該帶過去。
 *
 * 依賴 store.js 的共用資料契約（gpnNormalize、GPN_MAX_* 等），載入順序要在它之後。
 */

const GPN_SHARE_APP = 'gpn';

/* ========== 代碼（base64）================================================= */

/** JSON → base64。中文要先轉成 UTF-8 位元組，直接 btoa 會炸掉。 */
function gpnEncodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function gpnDecodeShare(code) {
  // 使用者從信件或聊天視窗複製時，常常會夾帶換行和空白
  const clean = String(code).replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ========== 匯出 ========================================================== */

/** 把目前的資料包成可匯出的物件 */
function gpnBuildExport(data) {
  const items = (list) => list.map((i) => ({ id: i.id, title: i.title, content: i.content }));
  return {
    app: GPN_SHARE_APP,
    version: GPN_VERSION,
    exportedAt: new Date().toISOString(),
    tabs: data.tabs.map((t) => (t.folders
      ? {
          id: t.id, label: t.label, color: t.color,
          folders: t.folders.map((f) => ({ id: f.id, label: f.label, items: items(f.items) })),
        }
      : { id: t.id, label: t.label, color: t.color, items: items(t.items) })),
  };
}

const gpnExportCode = (data) => gpnEncodeShare(gpnBuildExport(data));

function gpnExportFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `常用提示詞-備份-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
}

/** 觸發瀏覽器下載一個 .json 備份檔 */
function gpnDownloadExport(data) {
  const blob = new Blob([JSON.stringify(gpnBuildExport(data), null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = gpnExportFileName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ========== 匯入 ========================================================== */

/**
 * 解析使用者貼上的代碼或選的檔案內容。
 * 兩種都吃：純 JSON 文字，或 base64 代碼。
 * 回傳 { ok, data?, error?, tabCount?, folderCount?, itemCount? }
 */
function gpnParseImport(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: '沒有內容，請先貼上代碼或選一個備份檔' };

  let obj = null;
  try {
    obj = text.startsWith('{') ? JSON.parse(text) : gpnDecodeShare(text);
  } catch {
    return { ok: false, error: '看不懂這段內容，請確認有從頭到尾完整複製到' };
  }

  if (!obj || typeof obj !== 'object') return { ok: false, error: '內容格式不對' };
  if (obj.app && obj.app !== GPN_SHARE_APP) {
    return { ok: false, error: '這不是「常用提示詞」匯出的備份' };
  }
  if (!Array.isArray(obj.tabs)) return { ok: false, error: '這份備份裡找不到書籤資料' };

  // 交給共用的 normalize 修成合法結構（缺欄位、壞資料都會被補好）。
  // version 要一起傳：v3 的備份要靠它才認得出來。
  const data = gpnNormalize({ version: obj.version, tabs: obj.tabs, activeId: obj.tabs[0]?.id });
  const itemCount = gpnCountItems(data);
  if (!itemCount) return { ok: false, error: '這份備份裡一則提示詞都沒有' };

  return {
    ok: true, data,
    tabCount: data.tabs.length, folderCount: gpnCountFolders(data), itemCount,
  };
}

/**
 * 合併：保留現有資料，只把「還沒有的」加進來。這是預設方式，
 * 因為兩台電腦各自新增過東西時，直接覆蓋會讓其中一邊的心血消失。
 *
 * 配對規則（每一層都一樣）：先比 id、再比名稱。
 *   書籤   → 對不上就新增；書籤滿了就併進最後一個書籤
 *   資料夾 → 對不上就新增；資料夾滿了就併進該書籤最後一個資料夾
 *   提示詞 → 同一個清單裡「標題＋內容」完全相同才算重複
 * 兩邊「有沒有開資料夾」不一樣時，以不丟失分類為原則：
 *   備份有資料夾、這台沒有 → 這台的書籤開啟資料夾，原本的提示詞放進「一般」
 *   備份沒資料夾、這台有   → 併進「一般」資料夾（沒有的話就第一個資料夾）
 * 回傳 { data, added, newTabs, newFolders, skipped }
 */
function gpnMergeData(current, incoming) {
  const out = gpnNormalize(current);
  let added = 0, skipped = 0, newTabs = 0, newFolders = 0;

  const mergeItems = (list, incomingItems) => {
    const seen = new Set(list.items.map((i) => i.title + '\u0000' + i.content));
    for (const item of incomingItems) {
      const key = item.title + '\u0000' + item.content;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      list.items.push({ id: gpnNewId(), title: item.title, content: item.content });
      added++;
    }
  };

  for (const inTab of incoming.tabs) {
    let tab = out.tabs.find((t) => t.id === inTab.id) ||
              out.tabs.find((t) => t.label === inTab.label);

    if (!tab) {
      if (out.tabs.length >= GPN_MAX_TABS) {
        // 書籤滿了就把內容併進最後一個，總比整批丟掉好
        tab = out.tabs[out.tabs.length - 1];
      } else {
        // 沿用備份裡的 id：下次再匯入同一份時，才能靠 id 認出是同一個書籤
        tab = { id: inTab.id, label: inTab.label, color: inTab.color, items: [] };
        out.tabs.push(tab);
        newTabs++;
      }
    }

    if (!inTab.folders) {
      const target = tab.folders
        ? tab.folders.find((f) => f.label === GPN_DEFAULT_FOLDER) || tab.folders[0]
        : tab;
      mergeItems(target, inTab.items);
      continue;
    }

    if (!tab.folders) {
      // 原本是空的就直接換成資料夾模式，不必多一個空的「一般」
      if (tab.items.length) gpnEnableFolders(tab);
      else { delete tab.items; tab.folders = []; }
    }

    for (const inFolder of inTab.folders) {
      let folder = tab.folders.find((f) => f.id === inFolder.id) ||
                   tab.folders.find((f) => f.label === inFolder.label);

      if (!folder) {
        if (tab.folders.length >= GPN_MAX_FOLDERS) {
          folder = tab.folders[tab.folders.length - 1];
        } else {
          folder = { id: inFolder.id, label: inFolder.label, items: [] };
          tab.folders.push(folder);
          newFolders++;
        }
      }
      mergeItems(folder, inFolder.items);
    }
  }

  // 最近使用記錄：兩邊合在一起，依使用時間排，同一則只留最新那次（備份檔不含記錄，只有雲端同步會帶）
  out.recent = gpnCleanRecent([...(out.recent || []), ...(incoming.recent || [])]);

  // 資料夾 id 若和別的書籤裡的撞到，normalize 會自動換一個新的
  return { data: gpnNormalize(out), added, newTabs, newFolders, skipped };
}

/** 先算一遍合併結果給使用者看，但不真的寫進去 */
function gpnPreviewMerge(current, incoming) {
  const r = gpnMergeData(current, incoming);
  return { added: r.added, newTabs: r.newTabs, newFolders: r.newFolders, skipped: r.skipped };
}

/* ========== 瀏覽器小工具 ================================================== */

/** 讀使用者選的檔案。File.text() 在舊瀏覽器沒有，補一個 FileReader 備援。 */
function gpnReadFile(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsText(file, 'utf-8');
  });
}

/** 複製到剪貼簿。clipboard API 被擋時退回 execCommand，兩邊都失敗才回 false。 */
async function gpnShareCopy(text) {
  try {
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 800)),
    ]);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('style', 'position:fixed;top:-2000px;left:0;opacity:0');
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* 放棄複製 */ }
    ta.remove();
    return ok;
  }
}
