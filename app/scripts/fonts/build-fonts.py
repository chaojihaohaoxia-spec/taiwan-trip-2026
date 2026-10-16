#!/usr/bin/env python3
# =====================================================================
# scripts/fonts/build-fonts.py：生成网页字体（P2「杂志宋体」）——裁剪、思源宋体按 unicode-range 分片、写 @font-face。
#
# 产物（都进仓库）：
#   app/static/fonts/*.woff2       字体文件（构建时由 esbuild 从 CSS 的 url() 带进 assets/，文件名加内容哈希）
#   app/static/fonts/fonts.json    清单：每个文件的字族、字重、字数、字节数、unicode-range、要不要预加载
#   app/src/styles/fonts.css       @font-face（生成的，别手改）
#
# 用到的字体（全部 SIL OFL 1.1，授权原文在 app/static/fonts/licenses/）：
#   思源宋体 Noto Serif SC 2.003 SemiBold（600）      标题、行程名、大按钮
#   Instrument Serif 1.000 正体 / 斜体（400）          大号数字
#   「P2 Figure One」= 思源宋体 Regular 的「1」和「₫」（U+0031、U+20AB）：Instrument Serif 的 1 像小写 l、又没有 ₫（越南盾符号
#   会回退到思源宋体 600，在细的数字旁边特别黑），大号数字里用它顶替；另有斜体（同样两个字，按 Instrument Serif 斜体的
#   13° 斜切，给倒计时这类斜体数字用）
#
# 用法（在 app/ 目录）：
#   python3 scripts/fonts/build-fonts.py --raw <原始字体目录> [--extra-text <文件> ...]
#   python3 scripts/fonts/build-fonts.py --raw <目录> --check      # 只生成到临时目录、打印报告，不写仓库
#
#   <原始字体目录> 里要有（下载地址见 app/static/fonts/README.md）：
#     NotoSerifSC-SemiBold.otf、NotoSerifSC-Regular.otf（notofonts/noto-cjk Serif2.003 的 SubsetOTF/SC）
#     InstrumentSerif-Regular.ttf、InstrumentSerif-Italic.ttf（google/fonts ofl/instrumentserif）
#   找不到时也会在子目录里递归找同名文件。
#
#   --extra-text：额外要收进思源宋体子集的文字（例如仓库外的真实行程 JSON，里面的生僻地名）。
#     只读取其中出现过的字符，不复制任何内容；仓库里的脚本、数据都不含真实行程的内容。
#
# 依赖：Python 3.9+、fonttools 4.60+、brotli（pip3 install --user fonttools brotli）。
#
# 思源宋体的字符集 = 《通用规范汉字表》一级 3500 字（data/tgh-level1-3500.txt，来自 Unicode Unihan 的 kTGH）
#   + ASCII、Latin-1、越南语字母 + 常用中文标点和符号
#   + 仓库里界面文字、演示数据出现过的字（src/、demo/source/ 扫出来的）+ --extra-text 里出现过的字
#
# 分片（让首屏只下载用到的几片）：
#   - latin：基本拉丁 + Latin-1 + 常用标点（· “ ” — … 等），精确列出；ext：越南语等扩展拉丁、箭头、①–⑳ 等符号，
#     声明成一整段 U+0100–2E7F（latin 写在它后面，latin 里的字先匹配 latin）
#   - 常用字分片：按 Google Fonts 给 Noto Serif SC 的分片方案（data/google-noto-serif-sc-slices.json，只取范围数据），
#     从最常用的第 119 片往下取，每片 = Google 那一片 ∩ 我们的子集，太小的并到相邻一片；unicode-range 精确列出每个字
#   - 其余的字（不太常用的、Google 没排的）：按码位顺序切成每片约 TAIL_CHARS 个字的区块，unicode-range 写成
#     一整段连续区间（CSS 小）。区块的区间会覆盖到常用字分片里的字——没关系：@font-face 后声明的先匹配，
#     常用字分片写在区块后面，一个字只会去下载它真正所在的那一片（脚本会逐字验证这一点）。
# =====================================================================

import argparse
import hashlib
import io
import json
import os
import re
import sys
import tempfile
from pathlib import Path

try:
    from fontTools import subset as ftsubset
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover
    sys.exit('缺少 fonttools：pip3 install --user fonttools brotli')

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
OUT_DIR = APP / 'static' / 'fonts'
CSS_OUT = APP / 'src' / 'styles' / 'fonts.css'
DATA = HERE / 'data'

# ---- 分片参数 ---------------------------------------------------------
#: 常用字分片：从 Google 第 119 片往下取，直到累计字数到这个数（按首屏 CSS 体积和首屏字体下载量权衡出来的，见 static/fonts/README.md；
#: 页面级 CSS 改成按需加载以后首屏样式表有了余量，从 350 提到 1000：首屏 CSS 多 2.3 KB，常见几屏少下载 12–70 KB 字体）
TIER_LIMIT = 1000
#: 常用字分片小于这个字数就并到前一片
TIER_MIN = 90
#: 常用字分片：每片最多多少个字（Google 一片约 188 字，再切小）
TIER_CHARS = 60
#: 其余字的区块：每片大约多少个字
TAIL_CHARS = 75

# ---- 字符集 -----------------------------------------------------------
# Google Fonts 对拉丁字体的 latin 分片范围
GOOGLE_LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
# 越南语 + 扩展拉丁（Google 的 vietnamese + latin-ext 里我们用得到的部分）
VIETNAMESE = 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB'
# 拉丁字体（Instrument Serif）收的范围：拉丁 + Latin-1 + 越南语 + 常用标点、货币、箭头、比较符号
LATIN_FONT_RANGE = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0303-0304,U+0308-0309,'
                    'U+0323,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2194,U+2212,U+2215,U+2248,U+2260,U+2264-2265,U+FEFF,U+FFFD,'
                    'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+1EA0-1EF9,U+20AB')
# 常用中文标点、全角符号、少量常用符号
CJK_PUNCT = set('，。、；：？！“”‘’（）《》〈〉【】〔〕「」『』〖〗—–…·～￥％＋－×÷＝＜＞／＆＃＠＊※°℃・〇　‰′″←↑→↓↔⇄≈≤≥−≡①②③④⑤⑥⑦⑧⑨⑩¥€©®™')
CJK_PUNCT |= {chr(c) for c in range(0x3000, 0x3020)}
CJK_PUNCT |= {chr(c) for c in range(0xFF01, 0xFF5F)}
CJK_PUNCT |= {chr(c) for c in range(0x2010, 0x2028)}
CJK_PUNCT |= {chr(c) for c in range(0x2460, 0x2474)}

#: 只给 Noto Serif SC 600 用的 OpenType 特性：pyftsubset 默认那一组（kern、locl、mark……）。
#: 不留竖排（vert/vrt2…）和 palt/halt：网页不竖排；palt 会把“，”压成半角（P2 规定标题不开 palt）
CJK_OPTIONS = dict(desubroutinize=True, hinting=False, name_IDs=[0, 1, 2, 3, 4, 5, 6, 13, 14], name_languages=[0x409], notdef_outline=True)
LATIN_OPTIONS = dict(layout_features=['*'], name_IDs=[0, 1, 2, 3, 4, 5, 6, 13, 14], name_languages=[0x409], notdef_outline=True)


#: P2 Figure One 接管的字：「1」和越南盾符号「₫」
FIGURE_ONE_CPS = {0x31, 0x20AB}
FIGURE_ONE_RANGE = 'U+31,U+20AB'
#: 斜体「1」的字宽和左边距（字体单位，1000/em；见 slanted_font）
ITALIC_ONE_ADVANCE = 400
ITALIC_ONE_LSB = -15


def slanted_font(data, angle):
    """把一个（很小的）CFF 字体的每个字形按 angle 度斜切（以基线为轴，x' = x + tan(angle)·y，再整体左移半个
    x 字高处的偏移，让字身大致留在原来的字宽里），返回新的 woff2。字宽、度量、名字照抄原字体，名字里标成 Italic。"""
    import math
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.boundsPen import BoundsPen

    src = TTFont(io.BytesIO(data), recalcTimestamp=False)
    gs = src.getGlyphSet()
    order = src.getGlyphOrder()
    cmap = src.getBestCmap()
    hmtx = src['hmtx']
    t = math.tan(math.radians(angle))
    shift = -t * 250  # 半个 x 字高（思源宋体 x 字高约 500/1000）
    names = ['.notdef'] + [n for n in order if n != '.notdef']
    by_name = {name: cp for cp, name in cmap.items()}
    charstrings = {}
    metrics = {}
    for name in names:
        width = hmtx[name][0]
        dx = shift
        # 「1」：思源宋体的 1 是等宽数字的宽度（471），斜体里两个 1 之间空得太开（Instrument Serif 斜体的数字很紧，
        # 左边距是负的）。收窄到 ITALIC_ONE_ADVANCE，字身左移到左边距 ITALIC_ONE_LSB（和 Instrument Serif 斜体的 2、3 差不多）
        if by_name.get(name) == 0x31:
            bp = BoundsPen(None)
            gs[name].draw(TransformPen(bp, (1, 0, t, 1, shift, 0)))
            dx = shift + (ITALIC_ONE_LSB - bp.bounds[0])
            width = ITALIC_ONE_ADVANCE
        pen = T2CharStringPen(width, None)
        gs[name].draw(TransformPen(pen, (1, 0, t, 1, dx, 0)))
        charstrings[name] = pen.getCharString()
        bp = BoundsPen(None)
        gs[name].draw(TransformPen(bp, (1, 0, t, 1, dx, 0)))
        metrics[name] = (width, int(round(bp.bounds[0])) if bp.bounds else 0)
    fb = FontBuilder(src['head'].unitsPerEm, isTTF=False)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({cp: name for cp, name in cmap.items()})
    family = 'P2 Figure One'
    fb.setupCFF('P2FigureOne-Italic', {'FullName': f'{family} Italic'}, charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    hhea = src['hhea']
    fb.setupHorizontalHeader(ascent=hhea.ascent, descent=hhea.descent, lineGap=hhea.lineGap)
    os2 = src['OS/2']
    fb.setupOS2(
        sTypoAscender=os2.sTypoAscender, sTypoDescender=os2.sTypoDescender, sTypoLineGap=os2.sTypoLineGap,
        usWinAscent=os2.usWinAscent, usWinDescent=os2.usWinDescent, fsSelection=0x01, usWeightClass=400,
    )
    fb.setupNameTable({'familyName': family, 'styleName': 'Italic', 'uniqueFontIdentifier': f'{family} Italic',
                       'fullName': f'{family} Italic', 'psName': 'P2FigureOne-Italic',
                       'copyright': src['name'].getDebugName(0) or '', 'licenseDescription': src['name'].getDebugName(13) or '',
                       'licenseInfoURL': src['name'].getDebugName(14) or ''})
    fb.setupPost(italicAngle=-angle)
    fb.font['head'].macStyle = 0x02
    # 时间戳照抄原字体（每次生成一字节不差，见 subset_font）
    fb.font['head'].created = src['head'].created
    fb.font['head'].modified = src['head'].modified
    fb.font.recalcTimestamp = False
    out = io.BytesIO()
    fb.font.flavor = 'woff2'
    fb.font.save(out)
    return out.getvalue()


def parse_ranges(spec):
    """'U+0000-00FF,U+0131' 或 '0000-00ff,131' → set(int)"""
    out = set()
    for part in spec.replace(' ', '').split(','):
        if not part:
            continue
        part = part[2:] if part.upper().startswith('U+') else part
        if '-' in part:
            a, b = part.split('-')
            out.update(range(int(a, 16), int(b, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


def to_ranges(cps):
    """sorted ints → [(a, b)]"""
    cps = sorted(cps)
    out = []
    for c in cps:
        if out and c == out[-1][1] + 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return [tuple(r) for r in out]


def fmt_ranges(ranges):
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in ranges)


def find_file(root, name):
    p = Path(root) / name
    if p.exists():
        return p
    hits = list(Path(root).rglob(name))
    if not hits:
        sys.exit(f'在 {root} 里找不到 {name}（见 app/static/fonts/README.md 的下载地址）')
    return hits[0]


def repo_text_chars():
    """仓库里界面文字和演示数据出现过的字符（src/ 的代码、样式，demo/source 的虚构行程）"""
    chars = set()
    roots = [APP / 'src', APP / 'demo' / 'source']
    for root in roots:
        for p in root.rglob('*'):
            if p.suffix in ('.js', '.jsx', '.css', '.json', '.html', '.md') and p.is_file():
                chars |= set(p.read_text(encoding='utf-8', errors='ignore'))
    return chars


def is_cjk(c):
    return c >= 0x2E80


def subset_font(src_font_bytes, unicodes, options, flavor='woff2'):
    """把（已经裁好的）字体再裁到 unicodes，返回 woff2 字节。
    不改写 head 表里的修改时间（recalcTimestamp=False）：同样的输入每次生成一字节不差，字体文件名里的内容哈希不变，
    用户手机上 Service Worker 缓存的字体不会因为重新生成一次就全部作废。"""
    font = TTFont(io.BytesIO(src_font_bytes), recalcTimestamp=False)
    opts = ftsubset.Options()
    for k, v in options.items():
        setattr(opts, k, v)
    opts.flavor = flavor
    s = ftsubset.Subsetter(options=opts)
    s.populate(unicodes=sorted(unicodes))
    s.subset(font)
    buf = io.BytesIO()
    font.flavor = flavor
    font.save(buf)
    return buf.getvalue()


def cmap_of(font_bytes):
    return set(TTFont(io.BytesIO(font_bytes), lazy=True).getBestCmap().keys())


def load_google_slices():
    data = json.loads((DATA / 'google-noto-serif-sc-slices.json').read_text(encoding='utf-8'))
    return {k: parse_ranges(v) for k, v in data['slices'].items()}


def plan_noto_slices(cps, google):
    """把思源宋体子集的码位分成若干片。返回 [{id, chars, declared, order}]，按 CSS 声明顺序（先声明的优先级低）"""
    latin_set = parse_ranges(GOOGLE_LATIN)
    viet_set = parse_ranges(VIETNAMESE)
    latin = {c for c in cps if c in latin_set}
    ext = {c for c in cps if not is_cjk(c) and c not in latin}
    cjk = {c for c in cps if is_cjk(c)}
    assert not (viet_set & latin_set & cps) or True

    rank = {}
    for key, s in google.items():
        if key.isdigit():
            for c in s:
                rank[c] = int(key)

    # 常用字分片：Google 119、118……每片 ∩ 子集
    tiers = []
    used = set()
    total = 0
    for idx in sorted((int(k) for k in google if k.isdigit()), reverse=True):
        mine = (google[str(idx)] & cjk) - used
        if not mine:
            continue
        if total >= TIER_LIMIT:
            break
        tiers.append({'id': f't{idx}', 'chars': mine, 'google': [idx]})
        used |= mine
        total += len(mine)
    # 太小的并到相邻一片：优先并进更常用的前一片；最常用的那片太小（Google 第 119 片大多是拉丁和标点）就并进后一片
    merged = []
    carry = None
    for t in tiers:
        if carry:
            t['chars'] |= carry['chars']
            t['google'] = carry['google'] + t['google']
            carry = None
        if len(t['chars']) < TIER_MIN:
            if merged:
                merged[-1]['chars'] |= t['chars']
                merged[-1]['google'] += t['google']
            else:
                carry = t
            continue
        merged.append(t)
    if carry:
        merged.append(carry)
    # 每片再按码位切成不超过 TIER_CHARS 个字的小片：标题里的字很分散（一屏几十个字几乎每片都会碰到），
    # 片越小，一屏实际下载的字节越少
    tiers = []
    for t in merged:
        base = f't{t["google"][0]}' if len(t['google']) == 1 else f't{t["google"][0]}-{t["google"][-1]}'
        chars = sorted(t['chars'])
        parts = max(1, round(len(chars) / TIER_CHARS))
        size = len(chars) / parts
        for i in range(parts):
            chunk = set(chars[round(i * size):round((i + 1) * size)])
            if chunk:
                tiers.append({'id': base if parts == 1 else f'{base}{"abcdefgh"[i]}', 'chars': chunk, 'google': t['google']})

    # 其余：按码位切区块，区间连续（覆盖整个 CJK 区，包括子集里没有的字和常用字分片里的字）
    rest = sorted(cjk - used)
    n_blocks = max(1, round(len(rest) / TAIL_CHARS))
    size = len(rest) / n_blocks
    blocks = []
    for i in range(n_blocks):
        chunk = rest[round(i * size):round((i + 1) * size)]
        if chunk:
            blocks.append(chunk)
    tails = []
    lo = 0x2E80
    for i, chunk in enumerate(blocks):
        hi = blocks[i + 1][0] - 1 if i + 1 < len(blocks) else 0xFFFF
        tails.append({'id': f'b{i + 1:02d}', 'chars': set(chunk), 'declared': [(lo, hi)]})
        lo = hi + 1

    slices = []
    # 声明顺序：区块（优先级最低）→ 常用字分片（从不太常用到最常用）→ 扩展拉丁 → 拉丁
    for t in tails:
        slices.append(t)
    for t in reversed(tiers):
        t['declared'] = to_ranges(t['chars'])
        slices.append(t)
    if ext:
        # 扩展拉丁、越南语、符号：声明成一整段 U+0100–2E7F（CSS 小）；其中属于 latin 那片的字，latin 写在后面先匹配
        slices.append({'id': 'ext', 'chars': ext, 'declared': [(0x0100, 0x2E7F)]})
    if latin:
        slices.append({'id': 'latin', 'chars': latin, 'declared': to_ranges(latin)})
    return slices


def verify_plan(slices, cps):
    """逐字验证：分片互不重叠、合起来 = 子集；每个字按“后声明先匹配”找到的第一片就是它所在的那片"""
    problems = []
    seen = {}
    for s in slices:
        for c in s['chars']:
            if c in seen:
                problems.append(f'U+{c:04X} 同时在 {seen[c]} 和 {s["id"]}')
            seen[c] = s['id']
    union = set(seen)
    if union != cps:
        problems.append(f'分片合起来和子集不一致：少 {len(cps - union)} 个、多 {len(union - cps)} 个')
    ordered = list(reversed(slices))  # 浏览器检查的顺序

    def covers(s, c):
        return any(a <= c <= b for a, b in s['declared'])

    for c in cps:
        first = next((s for s in ordered if covers(s, c)), None)
        if first is None:
            problems.append(f'U+{c:04X} 没有任何一片声明它')
        elif first['id'] != seen.get(c):
            problems.append(f'U+{c:04X} 会先去下载 {first["id"]}，但它在 {seen.get(c)}')
    # 子集里没有的汉字：最多只白下载一片（落在某个区块），不会连续下载好几片
    for c in range(0x4E00, 0xA000, 7):
        if c in cps:
            continue
        hits = [s['id'] for s in ordered if covers(s, c)]
        if len(hits) > 1:
            problems.append(f'子集外的 U+{c:04X} 会依次下载 {hits}')
            break
    return problems


def css_face(family, file, weight, style, ranges, size, comment=None, extra=''):
    """ranges 为 None 时不写 unicode-range（预加载、一定会下载的拉丁字体：写了也省不下请求，只占首屏 CSS）"""
    lines = []
    if comment:
        lines.append(f'/* {comment} */')
    lines.append('@font-face {')
    lines.append(f'  font-family: "{family}";')
    # 不写 format("woff2")、不写默认的 font-style: normal：所有目标浏览器都认 woff2，省首屏 CSS
    lines.append(f'  src: url("../../static/fonts/{file}");')
    lines.append(f'  font-weight: {weight};')
    if style != 'normal':
        lines.append(f'  font-style: {style};')
    lines.append('  font-display: swap;')
    if extra:
        lines.append(extra)
    if ranges:
        lines.append(f'  unicode-range: {ranges};')
    lines.append(f'}}  /* {size / 1024:.1f} KB */')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description='生成网页字体（P2 杂志宋体）')
    ap.add_argument('--raw', required=True, help='原始字体所在目录')
    ap.add_argument('--extra-text', action='append', default=[], help='额外收进思源宋体子集的文字文件（只取字符）')
    ap.add_argument('--check', action='store_true', help='只打印报告、写到临时目录，不改仓库')
    args = ap.parse_args()

    raw = Path(args.raw)
    out_dir = Path(tempfile.mkdtemp(prefix='rs7885-fonts-')) if args.check else OUT_DIR
    css_out = out_dir / 'fonts.css' if args.check else CSS_OUT
    out_dir.mkdir(parents=True, exist_ok=True)

    src = {
        'serif600': find_file(raw, 'NotoSerifSC-SemiBold.otf'),
        'serif400': find_file(raw, 'NotoSerifSC-Regular.otf'),
        'instr': find_file(raw, 'InstrumentSerif-Regular.ttf'),
        'instrI': find_file(raw, 'InstrumentSerif-Italic.ttf'),
    }

    # ---------- 思源宋体：字符集 ----------
    tgh = set((DATA / 'tgh-level1-3500.txt').read_text(encoding='utf-8').strip())
    assert len(tgh) == 3500, f'通用规范一级字表应为 3500 字，实际 {len(tgh)}'
    latin_chars = {chr(c) for c in range(0x20, 0x7F)} | {chr(c) for c in range(0xA0, 0x100)}
    viet = {chr(c) for c in parse_ranges(VIETNAMESE)}
    repo = repo_text_chars()
    extra = set()
    for f in args.extra_text:
        extra |= set(Path(f).read_text(encoding='utf-8', errors='ignore'))
    wanted = tgh | latin_chars | viet | CJK_PUNCT
    # 仓库文字、额外文字里：汉字、全角、CJK 标点全收；拉丁类只收常见的（上面已有）
    for ch in repo | extra:
        o = ord(ch)
        if o >= 0x2E80 and not (0xD800 <= o <= 0xDFFF) and o <= 0xFFFF:
            wanted.add(ch)
    wanted_cps = {ord(c) for c in wanted}

    serif600 = TTFont(src['serif600'])
    serif_cmap = set(serif600.getBestCmap().keys())
    cps = wanted_cps & serif_cmap
    missing_extra = sorted(c for c in {ord(ch) for ch in extra} if c >= 0x3400 and c <= 0x9FFF and c not in serif_cmap)
    full = subset_font(src['serif600'].read_bytes(), cps, CJK_OPTIONS)
    full_cmap = cmap_of(full)
    print(f'思源宋体 600 子集：{len(full_cmap)} 个码位，{len(full) / 1024:.1f} KB（单个文件时）')
    if missing_extra:
        print(f'  --extra-text 里有 {len(missing_extra)} 个汉字思源宋体本身没有（会回退到系统字体）')

    # ---------- 分片 ----------
    google = load_google_slices()
    slices = plan_noto_slices(full_cmap, google)
    problems = verify_plan(slices, full_cmap)
    if problems:
        print('分片验证没通过：\n  ' + '\n  '.join(problems[:20]))
        sys.exit(1)

    manifest = {'generated_by': 'scripts/fonts/build-fonts.py', 'note': '由脚本生成，别手改', 'faces': []}
    css_parts = []
    written = set()

    def write(name, data):
        (out_dir / name).write_bytes(data)
        written.add(name)
        return len(data)

    total_slices = 0
    slice_faces = []
    for s in slices:
        data = subset_font(full, {c for c in s['chars']}, CJK_OPTIONS)
        got = cmap_of(data)
        if got != s['chars']:
            print(f'分片 {s["id"]} 的实际字符和计划不一致（{len(got)} vs {len(s["chars"])}）')
            sys.exit(1)
        name = f'noto-serif-sc-600-{s["id"]}.woff2'
        size = write(name, data)
        total_slices += size
        rng = fmt_ranges(s['declared'])
        slice_faces.append((s, name, size, rng))
        manifest['faces'].append({
            'family': 'Noto Serif SC', 'weight': '600', 'style': 'normal', 'file': name, 'slice': s['id'],
            'chars': len(s['chars']), 'bytes': size, 'unicodeRange': rng, 'owns': fmt_ranges(to_ranges(s['chars'])), 'preload': False,
            **({'google': s['google']} if 'google' in s else {}),
        })
    union = set()
    for s in slices:
        union |= s['chars']
    assert union == full_cmap

    # ---------- 拉丁字体：各一个文件（拆成 latin / 越南语两片试过：越南语字母是组合字形，拆开要把基础字母再带一份，
    #            省不了几 KB，反而多一个请求；这几个文件都预加载） ----------
    want_latin = parse_ranges(LATIN_FONT_RANGE)

    def latin_face(path, family, weight, style, name, hinting, preload=True):
        font = path.read_bytes()
        chars = cmap_of(font) & want_latin
        opts = dict(LATIN_OPTIONS, hinting=hinting)
        data = subset_font(font, chars, opts)
        got = cmap_of(data)
        size = write(name, data)
        rng = fmt_ranges(to_ranges(got))
        manifest['faces'].append({
            'family': family, 'weight': weight, 'style': style, 'file': name, 'slice': 'all',
            'chars': len(got), 'bytes': size, 'unicodeRange': rng, 'preload': preload,
        })
        return [(family, name, weight, style, rng, size)]

    # Instrument Serif 只在大字号（≥19px）用：去掉 TrueType 微调指令（Apple 平台本来就不用），小 27%
    instr = latin_face(src['instr'], 'Instrument Serif', '400', 'normal', 'instrument-serif-400.woff2', False)
    # 斜体只给倒计时这类少数地方用：不预加载（登录页、行程列表、设置页用不到，白下载 16KB）；Service Worker 第一次用到就缓存
    instr_i = latin_face(src['instrI'], 'Instrument Serif', '400', 'italic', 'instrument-serif-400-italic.woff2', False, preload=False)

    # ---------- P2 Figure One：思源宋体 Regular 的“1”和“₫”（正体 + 斜切的斜体） ----------
    one = subset_font(src['serif400'].read_bytes(), FIGURE_ONE_CPS, CJK_OPTIONS)
    one_size = write('p2-figure-one.woff2', one)
    manifest['faces'].append({
        'family': 'P2 Figure One', 'weight': '400', 'style': 'normal', 'file': 'p2-figure-one.woff2', 'slice': 'one',
        'chars': len(FIGURE_ONE_CPS), 'bytes': one_size, 'unicodeRange': FIGURE_ONE_RANGE, 'preload': True, 'sizeAdjust': '92%',
    })
    italic_angle = -TTFont(src['instrI'])['post'].italicAngle
    one_i = slanted_font(one, italic_angle)
    one_i_size = write('p2-figure-one-italic.woff2', one_i)
    manifest['faces'].append({
        'family': 'P2 Figure One', 'weight': '400', 'style': 'italic', 'file': 'p2-figure-one-italic.woff2', 'slice': 'one',
        'chars': len(FIGURE_ONE_CPS), 'bytes': one_i_size, 'unicodeRange': FIGURE_ONE_RANGE, 'preload': False, 'sizeAdjust': '92%',
        'slant': italic_angle,
    })

    # ---------- CSS ----------
    head = f'''/* =====================================================================
   styles/fonts.css：网页字体的 @font-face（scripts/fonts/build-fonts.py 生成，别手改）
   字体文件在 app/static/fonts/，构建时 esbuild 按这里的 url() 把它们带进 assets/（文件名加内容哈希）。
   全部 SIL OFL 1.1，授权原文在 app/static/fonts/licenses/，来源和版本见 app/static/fonts/README.md。
   用法见 styles/README.md「字体」：标题 var(--font-serif) / 主数字 var(--font-figure)；其余（正文、标签、小号数字）用系统字体，不下载。

   思源宋体 Noto Serif SC 600 一共 {len(full_cmap)} 个码位，切成 {len(slices)} 片（合计 {total_slices / 1024:.0f} KB）：
   浏览器按 unicode-range 只下载页面上真的用到的那几片。@font-face 后声明的先匹配：
   区块（不太常用的字，区间连续）写在前面，常用字分片（精确列字）写在后面，一个字只会去下载它所在的那一片。
   ===================================================================== */
'''
    css_parts.append(head)
    css_parts.append('/* ---------- 思源宋体 Noto Serif SC 2.003 · SemiBold 600 · 区块 → 常用字分片 → 扩展拉丁 → 拉丁 ---------- */')
    for s, name, size, rng in slice_faces:
        label = {'latin': '拉丁', 'ext': '越南语 / 扩展拉丁 / 符号'}.get(s['id'])
        if not label:
            label = f'常用字（Google 第 {"、".join(map(str, s["google"]))} 片）' if 'google' in s else '区块'
        css_parts.append(css_face('Noto Serif SC', name, '600', 'normal', rng, size, f'{s["id"]} · {label} · {len(s["chars"])} 字'))
    # 拉丁字体：不写 unicode-range（字体里没有的字浏览器照样逐字回退到字体栈里的下一个；实际覆盖范围记在 fonts.json），
    # 省首屏 CSS。正体预加载；斜体不预加载（只有倒计时这类少数地方用，用到时才下载）
    css_parts.append('\n/* ---------- Instrument Serif 1.000 · 400 正体 / 斜体（大号数字；不写 unicode-range；正体预加载，斜体用到时才下载） ---------- */')
    for fam, name, w, st, rng, size in instr + instr_i:
        css_parts.append(css_face(fam, name, w, st, None, size))
    css_parts.append(f'''
/* ---------- P2 Figure One：思源宋体 Regular 的「1」和「₫」 ----------
   Instrument Serif 的 1 像小写 l（"05-11" 读成 "05-ll"），而且没有 ₫（越南盾符号回退到思源宋体 600，在细数字旁边特别黑）：
   大号数字里这两个字用它顶替（--font-figure / --font-figure-italic 的第一个字体）；size-adjust 92% 让它和 Instrument Serif 的
   数字一样高。斜体是同样两个字按 Instrument Serif 斜体的角度（{italic_angle:g}°）斜切出来的（倒计时「1 天」不会读成「l 天」）。 */''')
    css_parts.append(css_face('P2 Figure One', 'p2-figure-one.woff2', '400', 'normal', FIGURE_ONE_RANGE, one_size, extra='  size-adjust: 92%;'))
    css_parts.append(css_face('P2 Figure One', 'p2-figure-one-italic.woff2', '400', 'italic', FIGURE_ONE_RANGE, one_i_size, extra='  size-adjust: 92%;'))
    css = '\n'.join(css_parts) + '\n'
    css_out.write_text(css, encoding='utf-8')

    # 清掉旧的字体文件（只删本脚本生成的 .woff2）
    if not args.check:
        for p in out_dir.glob('*.woff2'):
            if p.name not in written:
                p.unlink()
    manifest['notoSerifSC'] = {'codepoints': len(full_cmap), 'singleFileBytes': len(full), 'slices': len(slices), 'slicesBytes': total_slices}
    manifest['sha256'] = hashlib.sha256(css.encode()).hexdigest()[:16]
    (out_dir / 'fonts.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    # ---------- 报告 ----------
    print(f'分片 {len(slices)} 片，合计 {total_slices / 1024:.1f} KB（单文件 {len(full) / 1024:.1f} KB）')
    for s, name, size, rng in slice_faces:
        print(f'  {name:42} {len(s["chars"]):5} 字 {size / 1024:7.1f} KB  range {len(rng):5} 字符')
    for f in manifest['faces']:
        if f['family'] != 'Noto Serif SC':
            print(f'  {f["file"]:42} {f["chars"]:5} 字 {f["bytes"] / 1024:7.1f} KB  {"预加载" if f["preload"] else ""}')
    print(f'CSS {len(css)} 字节 → {css_out}')
    print(f'字体文件 → {out_dir}')


if __name__ == '__main__':
    main()
