// lib/markdown.js：段落、列表、加粗、链接、裸网址；转义防注入；虚拟节点输出

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'preact';
import {
  parseMarkdown, parseInline, safeHref, markdownToHtml, markdownToText, renderMarkdown, Markdown, escapeHtml,
} from '../../src/lib/markdown.js';

test('链接安全：只放行 http(s)、mailto、tel、站内 #/…', () => {
  for (const ok of ['https://example.com/a?b=1', 'http://example.com', 'mailto:a@example.com', 'tel:+000000', '#/t/demo-island/map']) {
    assert.equal(safeHref(ok), ok, ok);
  }
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x',
    'data:text/html,<b>1</b>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', '/relative', '#top', 'https://', 'https:// example.com', '', null]) {
    assert.equal(safeHref(bad), null, String(bad));
  }
});

test('段落：空行分段，段内换行变 <br>，首尾空行忽略，Windows 换行也认', () => {
  assert.equal(markdownToHtml('第一段\n第一段第二行\n\n\n第二段'), '<p>第一段<br>第一段第二行</p><p>第二段</p>');
  assert.equal(markdownToHtml('\n\n只有一段\n\n'), '<p>只有一段</p>');
  assert.equal(markdownToHtml('a\r\nb\r\n\r\nc'), '<p>a<br>b</p><p>c</p>');
  assert.equal(markdownToHtml(''), '');
  assert.equal(markdownToHtml(null), '');
});

test('列表：- * • 和编号（1. / 1、），缩进续行，段落后面不空行直接接列表，换类型另起一个列表', () => {
  assert.equal(markdownToHtml('- 一\n* 二\n• 三'), '<ul><li>一</li><li>二</li><li>三</li></ul>');
  assert.equal(markdownToHtml('1. 一\n2. 二'), '<ol><li>一</li><li>二</li></ol>');
  assert.equal(markdownToHtml('3、三\n4、四'), '<ol start="3"><li>三</li><li>四</li></ol>');
  assert.equal(markdownToHtml('- 一\n  续行\n- 二'), '<ul><li>一<br>续行</li><li>二</li></ul>');
  assert.equal(markdownToHtml('注意：\n- 先问价\n- 夜里叫车'), '<p>注意：</p><ul><li>先问价</li><li>夜里叫车</li></ul>');
  assert.equal(markdownToHtml('- 一\n1. 二'), '<ul><li>一</li></ul><ol><li>二</li></ol>');
  assert.equal(markdownToHtml('- 一\n结尾一段'), '<ul><li>一</li></ul><p>结尾一段</p>');
  // 不是列表：负数、加粗开头、小数开头
  assert.equal(markdownToHtml('-50 元'), '<p>-50 元</p>');
  assert.equal(markdownToHtml('**重要**：带护照'), '<p><strong>重要</strong>：带护照</p>');
  assert.equal(markdownToHtml('1.5 小时'), '<p>1.5 小时</p>');
});

test('加粗、链接、裸网址、转义字符', () => {
  assert.equal(markdownToHtml('上车前确认**打表**'), '<p>上车前确认<strong>打表</strong></p>');
  assert.equal(markdownToHtml('**没闭合'), '<p>**没闭合</p>');
  assert.equal(markdownToHtml('****'), '<p>****</p>');
  assert.equal(markdownToHtml('[Grab](https://www.grab.com) 下单'),
    '<p><a href="https://www.grab.com" target="_blank" rel="noopener noreferrer">Grab</a> 下单</p>');
  assert.equal(markdownToHtml('[**菜单**](https://example.com/menu)'),
    '<p><a href="https://example.com/menu" target="_blank" rel="noopener noreferrer"><strong>菜单</strong></a></p>');
  assert.equal(markdownToHtml('[看地图](#/t/demo-island/map)'), '<p><a href="#/t/demo-island/map">看地图</a></p>', '站内链接不新开标签');
  assert.equal(markdownToHtml('[写信](mailto:a@example.com)'), '<p><a href="mailto:a@example.com">写信</a></p>');
  assert.equal(markdownToHtml('[有括号](https://example.com/a_(b))'),
    '<p><a href="https://example.com/a_(b)" target="_blank" rel="noopener noreferrer">有括号</a></p>');
  assert.equal(markdownToHtml('[尖括号](<https://example.com/a b>)'), '<p>尖括号</p>', '网址里有空格：不生成链接，只留文字');
  assert.equal(markdownToHtml('见 https://example.com/guide。'),
    '<p>见 <a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">https://example.com/guide</a>。</p>', '中文句号不算网址');
  assert.equal(markdownToHtml('(https://example.com/x)'),
    '<p>(<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">https://example.com/x</a>)</p>', '外面的括号不算网址');
  assert.equal(markdownToHtml('wiki https://example.com/a_(b), ok'),
    '<p>wiki <a href="https://example.com/a_(b)" target="_blank" rel="noopener noreferrer">https://example.com/a_(b)</a>, ok</p>');
  assert.equal(markdownToHtml('xhttps://example.com'), '<p>xhttps://example.com</p>', '前面紧挨字母不识别');
  assert.equal(markdownToHtml('\\*\\*不是加粗\\*\\* \\[不是链接\\](x)'), '<p>**不是加粗** [不是链接](x)</p>');
  assert.equal(markdownToHtml('## 小标题'), '<p><strong>小标题</strong></p>');
  assert.equal(markdownToHtml('#标签不是标题'), '<p>#标签不是标题</p>');
});

test('防注入：HTML 一律转义，危险链接只留文字', () => {
  const html = markdownToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> "引号" & \'单引号\'');
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt; &quot;引号&quot; &amp; &#39;单引号&#39;</p>');
  assert.equal(markdownToHtml('[点我](javascript:alert(1))'), '<p>点我</p>');
  assert.equal(markdownToHtml('[点我](data:text/html,1)'), '<p>点我</p>');
  assert.equal(markdownToHtml('[x](https://example.com/"onmouseover="alert(1))'),
    '<p><a href="https://example.com/&quot;onmouseover=&quot;alert(1)" target="_blank" rel="noopener noreferrer">x</a></p>', '属性里的引号被转义');
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  // 链接文字里不再嵌套链接
  const nodes = parseInline('[看 https://example.com](https://example.org)');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'link');
  assert.deepEqual(nodes[0].children, [{ type: 'text', value: '看 https://example.com' }]);
});

test('AST：块结构', () => {
  const blocks = parseMarkdown('标题行\n\n- a\n- b\n\n2. x');
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'list', 'list']);
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[2].ordered, true);
  assert.equal(blocks[2].start, 2);
});

test('纯文本：去掉语法，列表用 • 和编号', () => {
  assert.equal(markdownToText('上车前确认**打表**，或用 [Grab](https://grab.com)。\n\n- 先问价\n- 夜里叫车\n\n3. 三'),
    '上车前确认打表，或用 Grab。\n\n• 先问价\n• 夜里叫车\n\n3. 三');
  assert.equal(markdownToText('<b>不是标签</b>'), '<b>不是标签</b>', '纯文本不转义（给复制用）');
});

test('虚拟节点：不经过 innerHTML，文字是文本节点，站外链接带 rel，节点合法（没有被展开拷贝）', () => {
  const vnodes = renderMarkdown('a **b** [c](https://x.example)\n<script>1</script>');
  assert.equal(vnodes.length, 1);
  const p = vnodes[0];
  assert.equal(p.type, 'p');
  const kids = p.props.children;
  assert.equal(kids[0], 'a ');
  assert.equal(kids[1].type, 'strong');
  assert.equal(kids[3].type, 'a');
  assert.equal(kids[3].props.href, 'https://x.example');
  assert.equal(kids[3].props.rel, 'noopener noreferrer');
  assert.equal(kids[3].props.target, '_blank');
  assert.equal(kids[4].type, 'br');
  assert.equal(kids[5], '<script>1</script>', '脚本只是一段文字');
  for (const k of kids) if (typeof k !== 'string') assert.equal(k.constructor, undefined, 'Preact 虚拟节点的 constructor 必须是 undefined');
  assert.ok(!JSON.stringify(vnodes, (key, v) => (key.startsWith('_') ? undefined : v)).includes('dangerouslySetInnerHTML'));
  const list = renderMarkdown('3. a\n4. b')[0];
  assert.equal(list.type, 'ol');
  assert.equal(list.props.start, 3);

  const el = Markdown({ text: '- x', class: 'tip__body', 'data-testid': 't' });
  assert.equal(el.type, 'div');
  assert.equal(el.props.class, 'md tip__body');
  assert.equal(el.props['data-testid'], 't');
  const custom = h(Markdown, { text: 'y', as: 'section' });
  assert.equal(custom.props.as, 'section');
  assert.equal(Markdown({ text: 'y', as: 'section' }).type, 'section');
});
