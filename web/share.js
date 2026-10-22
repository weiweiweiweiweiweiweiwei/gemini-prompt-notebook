/**
 * 匯出／匯入、合併：備份檔、兩台電腦的資料合在一起、分身用的挑選。
 *
 * 匯出格式（.json 備份檔的內容）：
 * {
 *   "app": "gpn", "version": 4, "exportedAt": "2026-09-22T12:34:56.000Z",
 *   "tabs": [
 *     { id, label, color, items: [ { id, title, content } ] },            // 不分資料夾
 *     { id, label, color, folders: [ { id, label, items: [ ... ] } ] },   // 有資料夾
 *   ]
 * }
 * 另外還有（4.15.0 起）：
 *   favs、marks、markTypes   我的最愛、其他符號（星號）、設定裡使用中的符號
 *   recent                   最近使用記錄
 *   look: { bg, wallpaper }  背景：選了哪一張；自己上傳的圖（data: 網址）
 *   trash                    資源回收桶（4.20.0 起）
 * 換電腦時這些都要跟著過去，不然新電腦只剩提示詞，我的最愛、星號、使用記錄全是空的。
 * 舊版（v2、v3、沒有上面這些欄位的）匯出的備份也都吃得下，見 store.js 的升級規則。
 *
 * 依賴 store.js 的共用資料契約（gpnNormalize、GPN_MAX_* 等），載入順序要在它之後。
 */

const GPN_SHARE_APP = 'gpn';

/* ========== 舊版的「代碼」（base64）========================================
   以前設定裡有「複製代碼／貼上代碼」，現在統一只用備份檔。
   但有人可能把以前複製的代碼存成檔案，所以匯入時還是認得。 */

function gpnDecodeShare(code) {
  // 使用者從信件或聊天視窗複製時，常常會夾帶換行和空白
  const clean = String(code).replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ========== 匯出 ========================================================== */

/** 把目前的資料包成可匯出的物件。look：這台電腦的背景（{ bg, wallpaper }，沒有就不放） */
function gpnBuildExport(data, look = null) {
  const items = (list) => list.map((i) => ({ id: i.id, title: i.title, content: i.content, ...(i.from ? { from: i.from } : {}) }));
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
    favs: data.favs || [],
    marks: data.marks || {},
    markTypes: data.markTypes || [],
    recent: data.recent || [],
    trash: data.trash || [],
    ...(look && look.bg ? { look } : {}),
  };
}

/**
 * 備份檔名。有連結 Google 雲端硬碟時，用帳號 @ 前面那段，一看就知道是哪個帳號的：
 *   apple@gmail.com → 罐頭P_apple_20261004.json；沒連結 → 罐頭P-備份-20261004.json
 */
function gpnExportFileName(email = '') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const who = String(email).split('@')[0].replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  return who ? `罐頭P_${who}_${day}.json` : `罐頭P-備份-${day}.json`;
}

/** 觸發瀏覽器下載一個 .json 備份檔。email：連結的 Google 帳號（取檔名用）；look：背景 */
function gpnDownloadExport(data, { email = '', look = null } = {}) {
  const blob = new Blob([JSON.stringify(gpnBuildExport(data, look), null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = gpnExportFileName(email);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ========== 匯入 ========================================================== */

/**
 * 解析選的備份檔內容。
 * 兩種都吃：純 JSON 文字，或舊版的 base64 代碼。
 * 回傳 { ok, data?, error?, tabCount?, folderCount?, itemCount? }
 */
function gpnParseImport(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: '這個檔案是空的' };

  let obj = null;
  try {
    obj = text.startsWith('{') ? JSON.parse(text) : gpnDecodeShare(text);
  } catch {
    return { ok: false, error: '看不懂這個檔案，請選「罐頭P」下載的備份檔' };
  }

  if (!obj || typeof obj !== 'object') return { ok: false, error: '內容格式不對' };
  if (obj.app && obj.app !== GPN_SHARE_APP) {
    return { ok: false, error: '這不是「罐頭P」匯出的備份' };
  }
  if (!Array.isArray(obj.tabs)) return { ok: false, error: '這份備份裡找不到書籤資料' };

  // 交給共用的 normalize 修成合法結構（缺欄位、壞資料都會被補好）。
  // version 要一起傳：v3 的備份要靠它才認得出來。
  const data = gpnNormalize({
    version: obj.version, tabs: obj.tabs, activeId: obj.tabs[0]?.id,
    favs: obj.favs, marks: obj.marks, markTypes: obj.markTypes, recent: obj.recent, trash: obj.trash,
  });
  const itemCount = gpnCountItems(data);
  if (!itemCount) return { ok: false, error: '這份備份裡一則提示詞都沒有' };

  // 4.15.0 以前的備份沒有我的最愛、星號、使用記錄：完全取代時，這台原本的要留著
  const personal = ['favs', 'marks', 'markTypes', 'recent', 'trash'].some((k) => k in obj);
  const markedCount = data.favs.length + Object.values(data.marks).reduce((n, ids) => n + ids.length, 0);
  // 背景：只收認得的值，上傳的圖一定要是圖片的 data: 網址
  const look = obj.look && typeof obj.look.bg === 'string'
    ? { bg: obj.look.bg.slice(0, 40), wallpaper: /^data:image\//.test(String(obj.look.wallpaper || '')) ? obj.look.wallpaper : null }
    : null;

  return {
    ok: true, data, personal, look,
    tabCount: data.tabs.length, folderCount: gpnCountFolders(data), itemCount,
    markedCount, recentCount: data.recent.length,
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
  // 對方的提示詞 id → 合併後是哪一則（「我的最愛」要靠它找回來，因為加進來的會換新 id）
  const idMap = new Map();

  const mergeItems = (list, incomingItems) => {
    const seen = new Map(list.items.map((i) => [i.title + '\u0000' + i.content, i.id]));
    for (const item of incomingItems) {
      const key = item.title + '\u0000' + item.content;
      if (seen.has(key)) { skipped++; idMap.set(item.id, seen.get(key)); continue; }
      const id = gpnNewId();
      seen.set(key, id);
      idMap.set(item.id, id);
      list.items.push({ id, title: item.title, content: item.content });
      added++;
    }
  };

  for (const inTab of incoming.tabs) {
    let tab = out.tabs.find((t) => t.id === inTab.id) ||
              out.tabs.find((t) => t.label === inTab.label);

    if (!tab) {
      if (out.tabs.filter((t) => t.id !== GPN_MAIL_ID).length >= GPN_MAX_TABS) {
        // 書籤滿了就把內容併進最後一個，總比整批丟掉好
        tab = out.tabs[out.tabs.length - 1];
      } else {
        // 沿用備份裡的 id：下次再匯入同一份時，才能靠 id 認出是同一個書籤
        tab = { id: inTab.id, label: inTab.label, color: inTab.color, note: inTab.note, items: [] };
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

  // 最近使用記錄：兩邊合在一起，依使用時間排，同一則只留最新那次。
  // 對方的記錄指向對方的提示詞 id，加進來的提示詞換了新 id，要跟著換才找得到
  out.recent = gpnCleanRecent([
    ...(out.recent || []),
    ...(incoming.recent || []).map((r) => ({ ...r, id: idMap.get(r.id) || r.id })),
  ]);
  // 我的最愛、其他符號：兩邊的都留著，這邊的排前面
  out.favs = [...(out.favs || []), ...(incoming.favs || []).map((id) => idMap.get(id))];
  out.marks = { ...(out.marks || {}) };
  for (const [m, ids] of Object.entries(incoming.marks || {})) {
    out.marks[m] = [...(out.marks[m] || []), ...ids.map((id) => idMap.get(id))];
  }
  out.markTypes = [...(out.markTypes || []), ...(incoming.markTypes || [])];
  // 使用次數：同一則取兩邊比較多的那個（沒有上次同步的紀錄，分不出各自多用了幾次，取大的才不會重複算）
  out.uses = { ...(out.uses || {}) };
  for (const [id, n] of Object.entries(incoming.uses || {})) {
    const to = idMap.get(id) || id;
    out.uses[to] = Math.max(out.uses[to] || 0, n);
  }
  out.gone = [...(out.gone || []), ...(incoming.gone || [])];
  // 回收桶：兩邊的都留著（同一則只留一筆；備份裡已經在筆記本的那則，normalize 會拿掉）
  out.trash = [...(out.trash || []), ...(incoming.trash || [])];

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

/* ========== 分身的小工具 ==========
   畫面（panel.js）和同步（sync.js）都會用到，所以放在每個地方都有載入的這裡。分身是什麼見 sync.js 的「分身」。 */

const GPN_CLONE_DAYS = 365;                                   // 分身的壽命
const GPN_CLONE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';  // 拿掉 0 O 1 I，抄的時候不會看錯

/** 16 碼的分身代號：每碼 32 種（一個位元組取 5 個位元，剛好平均） */
function gpnNewCloneId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => GPN_CLONE_ALPHABET[b & 31]).join('');
}
const gpnCleanCloneId = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const gpnIsCloneId = (id) => typeof id === 'string' && id.length === 16 && [...id].every((c) => GPN_CLONE_ALPHABET.includes(c));
/** K7QM3XPA9RVDH2WN → K7QM-3XPA-9RVD-H2WN */
const gpnFormatCloneId = (id) => String(id || '').replace(/(.{4})(?=.)/g, '$1-');

/** 分身的名稱：雲端硬碟的 appProperties 一個最多 124 個位元組（中文一個字 3 個），所以限制長度 */
function gpnCloneLabel(label) {
  let s = String(label || '').replace(/\s+/g, ' ').trim() || '分身';
  while (new TextEncoder().encode(s).length > 90) s = s.slice(0, -1);
  return s;
}

/**
 * 從筆記本挑出勾選的部分，做成分身的筆記本。pick：{ tabs, folders, items }（都是 Set，放 id）。
 * 勾了提示詞，它所在的書籤、資料夾自動帶上；空的書籤、資料夾要自己勾了才帶。
 * id 全部照舊：「再推一次」靠 id 認出是同一則。我的最愛、星號、使用記錄、回收桶不帶過去。
 */
function gpnCloneSubset(d, pick) {
  const copy = (it) => ({ id: it.id, title: it.title, content: it.content });
  const tabs = [];
  for (const t of d.tabs) {
    const head = { id: t.id, label: t.label, color: t.color, note: t.note };
    if (t.folders) {
      const folders = t.folders
        .map((f) => ({ id: f.id, label: f.label, items: f.items.filter((i) => pick.items.has(i.id)).map(copy) }))
        .filter((f) => f.items.length || pick.folders.has(f.id));
      if (folders.length || pick.tabs.has(t.id)) tabs.push(folders.length ? { ...head, folders } : { ...head, items: [] });
    } else {
      const items = t.items.filter((i) => pick.items.has(i.id)).map(copy);
      if (items.length || pick.tabs.has(t.id)) tabs.push({ ...head, items });
    }
  }
  return gpnNormalize({ version: GPN_VERSION, activeId: tabs[0]?.id, tabs, recent: [], favs: [], marks: {}, markTypes: [], trash: [] });
}

/**
 * 再推一次：把 sub（勾選的部分）疊到分身現在的內容上。
 *   同一則（同 id）→ 標題、內容換成最新的（不管分身把它搬到哪裡，都留在原地）
 *   分身沒有的     → 加到同一個書籤、資料夾（分身沒有那個書籤、資料夾就新增；書籤滿了放最後一個）
 *   分身自己新增的、刪掉的（沒有再勾的）→ 不動；分身丟進回收桶、這次又勾了的 → 拿出來
 * 回傳 { data, added, updated }
 */
function gpnCloneOverlay(clone, sub) {
  const out = gpnNormalize(JSON.parse(JSON.stringify(clone)));
  const where = new Map();
  for (const t of out.tabs) for (const l of gpnListsOf(t)) for (const it of l.items) where.set(it.id, it);
  let added = 0, updated = 0;
  for (const st of sub.tabs) {
    let t = out.tabs.find((x) => x.id === st.id);
    if (!t) {
      if (out.tabs.length < GPN_MAX_TABS) {
        t = st.folders ? { id: st.id, label: st.label, color: st.color, folders: [] } : { id: st.id, label: st.label, color: st.color, items: [] };
        out.tabs.push(t);
      } else {
        t = out.tabs[out.tabs.length - 1];
      }
    }
    for (const sl of gpnListsOf(st)) {
      let list = null;                 // 加新的提示詞要放哪裡（用到才決定）
      const target = () => {
        if (list) return list;
        if (!t.folders) return (list = t);
        list = sl !== st && t.folders.find((f) => f.id === sl.id);
        if (!list && sl !== st && t.folders.length < GPN_MAX_FOLDERS) {
          list = { id: sl.id, label: sl.label, items: [] };
          t.folders.push(list);
        }
        if (!list) {
          if (!t.folders.length) t.folders.push({ id: 'f_' + t.id, label: GPN_DEFAULT_FOLDER, items: [] });
          list = t.folders[t.folders.length - 1];
        }
        return list;
      };
      if (sl !== st && t.folders && !t.folders.some((f) => f.id === sl.id) && !sl.items.length) target();
      for (const it of sl.items) {
        const have = where.get(it.id);
        if (have) {
          if (have.title !== it.title || have.content !== it.content) updated++;
          have.title = it.title;
          have.content = it.content;
        } else {
          const copy = { id: it.id, title: it.title, content: it.content };
          target().items.push(copy);
          where.set(it.id, copy);
          added++;
        }
      }
    }
  }
  out.trash = (out.trash || []).filter((r) => !where.has(r.id));
  return { data: gpnNormalize(out), added, updated };
}
