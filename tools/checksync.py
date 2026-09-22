#!/usr/bin/env python3
"""
比對「外掛」和「網頁版」之間必須一模一樣的共用程式碼。

兩邊靠匯出／匯入交換資料，只要格式分岔就同步不了，而這種 bug 很難發現——
通常要等到使用者真的搬資料才會炸。所以用這個腳本把它變成一個會叫的檢查。

用法：
    python tools/checksync.py           # 檢查，不一樣就 exit 1
    python tools/checksync.py --fix     # 用 src/ 的內容覆寫 web/ 的對應片段

檢查兩件事：
    1. src/share.js  == web/share.js        （整個檔案）
    2. src/store.js  == web/store.js        （只有「共用資料契約」那一段）
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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

    # ---- 1. share.js 整個檔案 ----
    src_share, web_share = ROOT / 'src/share.js', ROOT / 'web/share.js'
    if not web_share.exists():
        if fix:
            web_share.write_text(read(src_share), encoding='utf-8', newline='')
            print('FIXED share.js（新建）')
        else:
            problems.append('web/share.js 不存在')
    elif read(src_share) != read(web_share):
        if fix:
            web_share.write_text(read(src_share), encoding='utf-8', newline='')
            print('FIXED share.js')
        else:
            problems.append('share.js 兩邊不一樣\n' + first_diff(read(src_share), read(web_share)))
    else:
        print('OK    share.js')

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

    if problems:
        print()
        for p in problems:
            print('FAIL  ' + p)
        print('\n用 python tools/checksync.py --fix 可以直接用 src/ 的內容覆蓋 web/')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
