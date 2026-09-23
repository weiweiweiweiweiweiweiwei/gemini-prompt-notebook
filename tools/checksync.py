#!/usr/bin/env python3
"""
比對「外掛」和「網頁版」之間必須一模一樣的共用程式碼。

兩邊靠匯出／匯入交換資料，只要格式分岔就同步不了，而這種 bug 很難發現——
通常要等到使用者真的搬資料才會炸。所以用這個腳本把它變成一個會叫的檢查。

用法：
    python tools/checksync.py           # 檢查，不一樣就 exit 1
    python tools/checksync.py --fix     # 用 src/ 的內容覆寫 web/ 的對應片段

檢查兩件事：
    1. 整個檔案一模一樣：
         share.js   匯出／匯入的格式
         panel.js   面板本體（網頁版和外掛長得、用起來一模一樣，靠的就是這份）
         styles.css 面板的樣式
    2. src/store.js  == web/store.js        （只有「共用資料契約」那一段）
    3. manifest.json 的 version == panel.js 的 GPN_APP_VERSION
       （設定視窗左下角顯示的版本號，用來確認外掛和網頁版是不是同一版）
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WHOLE_FILES = ['share.js', 'panel.js', 'styles.css']
BEGIN = '/* ==== 共用資料契約 開始'
END = '/* ==== 共用資料契約 結束'


def read(p):
    return p.read_text(encoding='utf-8')


def block(text, path):
    """抓出兩個標記之間（含標記行）的片段"""
    lines = text.split('\n')
    try:
        i = next(n for n, l in enumerate(lines) if l.startswith(BEGIN))
        j = next(n for n, l in enumerate(lines) if l.startswith(END))
    except StopIteration:
        sys.exit(f'FAIL  {path} 裡找不到「共用資料契約」標記')
    if j < i:
        sys.exit(f'FAIL  {path} 的標記順序顛倒了')
    return i, j, '\n'.join(lines[i:j + 1])


def first_diff(a, b):
    """回報第一行不一樣的地方，方便直接去改"""
    al, bl = a.split('\n'), b.split('\n')
    for n in range(max(len(al), len(bl))):
        x = al[n] if n < len(al) else '(沒有這一行)'
        y = bl[n] if n < len(bl) else '(沒有這一行)'
        if x != y:
            return f'    第 {n + 1} 行\n      src: {x}\n      web: {y}'
    return '    長度不同'


def main():
    fix = '--fix' in sys.argv
    problems = []

    # ---- 1. 整個檔案要一模一樣 ----
    for name in WHOLE_FILES:
        src, web = ROOT / 'src' / name, ROOT / 'web' / name
        if not web.exists():
            if fix:
                web.write_text(read(src), encoding='utf-8', newline='')
                print(f'FIXED {name}（新建）')
            else:
                problems.append(f'web/{name} 不存在')
        elif read(src) != read(web):
            if fix:
                web.write_text(read(src), encoding='utf-8', newline='')
                print(f'FIXED {name}')
            else:
                problems.append(f'{name} 兩邊不一樣\n' + first_diff(read(src), read(web)))
        else:
            print(f'OK    {name}')

    # ---- 2. store.js 的共用片段 ----
    src_store, web_store = ROOT / 'src/store.js', ROOT / 'web/store.js'
    _, _, src_block = block(read(src_store), 'src/store.js')
    web_text = read(web_store)
    i, j, web_block = block(web_text, 'web/store.js')

    if src_block != web_block:
        if fix:
            lines = web_text.split('\n')
            lines[i:j + 1] = src_block.split('\n')
            web_store.write_text('\n'.join(lines), encoding='utf-8', newline='')
            print('FIXED store.js 共用片段')
        else:
            problems.append('store.js 的共用資料契約兩邊不一樣\n' + first_diff(src_block, web_block))
    else:
        print('OK    store.js 共用片段（%d 行）' % len(src_block.split('\n')))

    # ---- 3. 版本號 ----
    manifest_ver = json.loads(read(ROOT / 'manifest.json'))['version']
    m = re.search(r"const GPN_APP_VERSION = '([^']+)'", read(ROOT / 'src/panel.js'))
    panel_ver = m.group(1) if m else '(找不到)'
    if manifest_ver != panel_ver:
        problems.append(f'版本號不一樣：manifest.json 是 {manifest_ver}，panel.js 是 {panel_ver}'
                        '（--fix 不會改這個，請手動把兩邊改成同一個）')
    else:
        print(f'OK    版本號 {manifest_ver}')

    if problems:
        print()
        for p in problems:
            print('FAIL  ' + p)
        print('\n用 python tools/checksync.py --fix 可以直接用 src/ 的內容覆蓋 web/')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
