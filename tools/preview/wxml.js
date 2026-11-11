/**
 * 极简 WXML 解析与渲染，仅供本地预览用（tools/preview/README.md）。
 * 支持：{{ }} 表达式、wx:if / wx:elif / wx:else、wx:for、block、template / import / include、slot。
 * 不支持：WXS、事件、双向绑定。
 */
const fs = require('fs');
const path = require('path');

// ---------- 解析 ----------

function parse(src) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let i = 0;
  const n = src.length;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src[i] === '<' && src[i + 1] === '/') {
      const end = src.indexOf('>', i);
      const name = src.slice(i + 2, end).trim();
      if (top().tag !== name) throw new Error('WXML 标签未配对：</' + name + '>，当前打开的是 <' + top().tag + '>');
      stack.pop();
      i = end + 1;
      continue;
    }
    if (src[i] === '<' && /[a-zA-Z]/.test(src[i + 1] || '')) {
      let j = i + 1;
      while (j < n && /[\w-]/.test(src[j])) j++;
      const node = { type: 'el', tag: src.slice(i + 1, j), attrs: {}, children: [] };
      let selfClose = false;
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === '>') { j++; break; }
        if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break; }
        let k = j;
        while (k < n && !/[\s=>/]/.test(src[k])) k++;
        const name = src.slice(j, k);
        if (!name) throw new Error('WXML 属性解析失败：' + src.slice(i, i + 80));
        j = k;
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === '=') {
          j++;
          while (j < n && /\s/.test(src[j])) j++;
          const q = src[j];
          if (q !== '"' && q !== "'") throw new Error('WXML 属性值需要引号：' + name);
          const e = src.indexOf(q, j + 1);
          node.attrs[name] = src.slice(j + 1, e);
          j = e + 1;
        } else {
          node.attrs[name] = true;
        }
      }
      top().children.push(node);
      if (!selfClose) stack.push(node);
      i = j;
      continue;
    }
    let j = src.indexOf('<', i + 1);
    if (j < 0) j = n;
    const text = src.slice(i, j);
    if (text.trim()) top().children.push({ type: 'text', text: text });
    i = j;
  }
  if (stack.length > 1) throw new Error('WXML 标签未闭合：<' + top().tag + '>');
  return root;
}

// ---------- 表达式 ----------

const fnCache = new Map();
function evalExpr(code, scope) {
  let fn = fnCache.get(code);
  if (!fn) {
    fn = new Function('__s', 'with(__s){return (' + code + ')}');
    fnCache.set(code, fn);
  }
  return fn(scope);
}

function makeScope(data, parent) {
  const layer = Object.assign(Object.create(null), data);
  return new Proxy(layer, {
    has: (t, k) => typeof k === 'string',
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return parent ? parent[k] : undefined;
    }
  });
}

/** 属性或文本里的 {{ }}。整段只有一个 {{ }} 时保留原始类型。 */
function interpolate(str, scope, objectLiteral) {
  if (str === true) return true;
  const parts = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) parts.push(str.slice(last, m.index));
    const code = objectLiteral ? '{' + m[1] + '}' : m[1];
    parts.push({ v: evalExpr(code, scope) });
    last = re.lastIndex;
  }
  if (last < str.length) parts.push(str.slice(last));
  if (parts.length === 1 && typeof parts[0] === 'object') return parts[0].v;
  return parts.map((p) => (typeof p === 'object' ? (p.v == null ? '' : String(p.v)) : p)).join('');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const RPX = 390 / 750;
const rpx2px = (s) => String(s).replace(/(-?\d*\.?\d+)rpx/g, (_, v) => Math.round(parseFloat(v) * RPX * 1000) / 1000 + 'px');

// ---------- 渲染 ----------

/**
 * ctx: { file, templates, components: { tag: path }, renderComponent(tag, props, slots, attrs), slots }
 */
function renderNodes(nodes, scope, ctx) {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'text') {
      out += esc(interpolate(node.text, scope));
      continue;
    }
    const a = node.attrs;
    // 条件链
    if ('wx:if' in a) {
      let chosen = interpolate(a['wx:if'], scope) ? node : null;
      let j = i + 1;
      while (j < nodes.length && nodes[j].type === 'el' && ('wx:elif' in nodes[j].attrs || 'wx:else' in nodes[j].attrs)) {
        if (!chosen && ('wx:else' in nodes[j].attrs || interpolate(nodes[j].attrs['wx:elif'], scope))) chosen = nodes[j];
        j++;
      }
      i = j - 1;
      if (chosen) out += renderFor(chosen, scope, ctx);
      continue;
    }
    out += renderFor(node, scope, ctx);
  }
  return out;
}

function renderFor(node, scope, ctx) {
  const a = node.attrs;
  if (!('wx:for' in a)) return renderEl(node, scope, ctx);
  let list = interpolate(a['wx:for'], scope);
  if (typeof list === 'number') list = Array.from({ length: list }, (_, k) => k);
  if (!list) return '';
  const itemName = a['wx:for-item'] || 'item';
  const indexName = a['wx:for-index'] || 'index';
  let out = '';
  const entries = Array.isArray(list) ? list.map((v, k) => [k, v]) : Object.entries(list);
  for (const [k, v] of entries) {
    const s = makeScope({ [itemName]: v, [indexName]: k }, scope);
    if ('wx:if' in a && !interpolate(a['wx:if'], s)) continue;
    out += renderEl(node, s, ctx);
  }
  return out;
}

const CONTROL = /^(wx:|bind|catch|capture-bind|capture-catch|mut-bind|model:|hover-|generic:)/;

function renderEl(node, scope, ctx) {
  const tag = node.tag;
  const a = node.attrs;
  if (tag === 'block') return renderNodes(node.children, scope, ctx);
  if (tag === 'wxs') throw new Error('预览不支持 WXS');
  if (tag === 'import') {
    loadTemplates(path.resolve(path.dirname(ctx.file), a.src), ctx.templates);
    return '';
  }
  if (tag === 'include') {
    const file = path.resolve(path.dirname(ctx.file), a.src);
    const sub = parse(fs.readFileSync(file, 'utf8'));
    return renderNodes(sub.children.filter((c) => c.tag !== 'template'), scope, Object.assign({}, ctx, { file: file }));
  }
  if (tag === 'template') {
    if (a.name) { ctx.templates[a.name] = { node: node, file: ctx.file }; return ''; }
    const name = interpolate(a.is, scope);
    const tpl = ctx.templates[name];
    if (!tpl) throw new Error('找不到模板：' + name);
    const data = a.data ? interpolate(a.data, scope, true) : {};
    return renderNodes(tpl.node.children, makeScope(data, null), Object.assign({}, ctx, { file: tpl.file }));
  }
  if (tag === 'slot') {
    const name = a.name ? interpolate(a.name, scope) : '';
    return (ctx.slots && ctx.slots[name]) || '';
  }

  // 通用属性
  const attrs = {};
  const props = {};
  for (const k of Object.keys(a)) {
    if (CONTROL.test(k)) continue;
    const v = interpolate(a[k], scope);
    if (k === 'class' || k === 'style' || k === 'id' || k === 'hidden' || k === 'slot' || k.startsWith('data-')) attrs[k] = v;
    else props[k] = v;
  }
  let style = attrs.style ? rpx2px(attrs.style) : '';
  if (attrs.hidden) style += ';display:none!important';
  const common = (extraStyle) => {
    let s = '';
    if (attrs.id) s += ' id="' + escAttr(attrs.id) + '"';
    if (attrs.class) s += ' class="' + escAttr(attrs.class) + '"';
    const st = [style, extraStyle].filter(Boolean).join(';');
    if (st) s += ' style="' + escAttr(st) + '"';
    for (const k of Object.keys(attrs)) if (k.startsWith('data-')) s += ' ' + k + '="' + escAttr(attrs[k]) + '"';
    // 输入框是原生组件，预览里画不出来：把值和占位字带到属性上，base.css 用伪元素显示
    if (tag === 'input' || tag === 'textarea') {
      const text = props.value == null || props.value === '' ? '' : String(props.value);
      s += ' data-pv="' + escAttr(text || String(props.placeholder || '')) + '"' + (text ? '' : ' data-pv-empty="1"');
    }
    return s;
  };

  // 自定义组件
  if (ctx.components && ctx.components[tag]) {
    const slots = {};
    const groups = {};
    for (const c of node.children) {
      const name = c.type === 'el' && typeof c.attrs.slot === 'string' ? interpolate(c.attrs.slot, scope) : '';
      (groups[name] = groups[name] || []).push(c);
    }
    for (const name of Object.keys(groups)) slots[name] = renderNodes(groups[name], scope, ctx);
    const camel = {};
    for (const k of Object.keys(props)) camel[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = props[k];
    const r = ctx.renderComponent(ctx.components[tag], camel, slots);
    return '<wx-comp data-c="' + escAttr(r.id) + '" data-tag="' + tag + '"' + common() + '>' + r.html + '</wx-comp>';
  }

  const inner = () => renderNodes(node.children, scope, ctx);
  if (tag === 'image') {
    const mode = props.mode || 'scaleToFill';
    let host = '';
    let img = 'display:block;width:100%;height:100%;';
    if (mode === 'widthFix') { host = 'height:auto'; img = 'display:block;width:100%;height:auto;'; }
    else if (mode === 'heightFix') { host = 'width:auto'; img = 'display:block;height:100%;width:auto;'; }
    else if (mode === 'aspectFit') img += 'object-fit:contain;';
    else if (mode === 'aspectFill') img += 'object-fit:cover;';
    else if (mode !== 'scaleToFill') img += 'object-fit:none;object-position:' + mode + ';';
    return '<wx-image' + common(host) + '><img src="' + escAttr(props.src || '') + '" style="' + img + '" alt=""></wx-image>';
  }
  if (tag === 'video') {
    const fit = props['object-fit'] || 'contain';
    return '<wx-video' + common() + '><video src="' + escAttr(props.src || '') + '"' + (props.poster ? ' poster="' + escAttr(props.poster) + '"' : '') +
      (props.controls === false ? '' : ' controls') + ' preload="none" style="display:block;width:100%;height:100%;object-fit:' + fit + '"></video></wx-video>';
  }
  if (tag === 'scroll-view') {
    const st = (props['scroll-x'] ? 'overflow-x:auto;overflow-y:hidden;' : '') + (props['scroll-y'] ? 'overflow-y:auto;' : '');
    return '<wx-scroll-view' + common(st) + '>' + inner() + '</wx-scroll-view>';
  }
  return '<wx-' + tag + common() + '>' + inner() + '</wx-' + tag + '>';
}

function loadTemplates(file, templates) {
  const ast = parse(fs.readFileSync(file, 'utf8'));
  for (const c of ast.children) {
    if (c.type === 'el' && c.tag === 'template' && c.attrs.name) templates[c.attrs.name] = { node: c, file: file };
    if (c.type === 'el' && c.tag === 'import') loadTemplates(path.resolve(path.dirname(file), c.attrs.src), templates);
  }
}

/** 渲染一个 WXML 文件 */
function renderFile(file, data, ctx) {
  const ast = parse(fs.readFileSync(file, 'utf8'));
  const c = Object.assign({ templates: {} }, ctx, { file: file });
  // 先登记本文件定义的模板和 import
  for (const node of ast.children) {
    if (node.type === 'el' && node.tag === 'template' && node.attrs.name) c.templates[node.attrs.name] = { node: node, file: file };
    if (node.type === 'el' && node.tag === 'import') loadTemplates(path.resolve(path.dirname(file), node.attrs.src), c.templates);
  }
  return renderNodes(ast.children, makeScope(data, null), c);
}

// ---------- WXSS ----------

const TAGS = 'view|text|image|button|scroll-view|navigator|video|swiper|swiper-item|label|input|textarea|rich-text|canvas|icon|picker|form|checkbox|radio|switch|slider|progress|cover-view|cover-image';
const TAG_RE = new RegExp('(^|[\\s>+~,])(' + TAGS + ')(?=[\\s.:#>+~,]|$)', 'g');

function readWxss(file, seen) {
  seen = seen || new Set();
  if (seen.has(file) || !fs.existsSync(file)) return '';
  seen.add(file);
  let css = fs.readFileSync(file, 'utf8');
  css = css.replace(/@import\s+["']([^"']+)["']\s*;/g, (_, p) => readWxss(path.resolve(path.dirname(file), p), seen));
  return css;
}

/** WXSS → CSS：rpx 换算、标签选择器加 wx- 前缀、page → body、:host → 组件宿主 */
function wxssToCss(css, hostId) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  css = rpx2px(css);
  return css.replace(/([^{}]+)\{/g, (m, sel) => {
    const t = sel.trim();
    if (!t || t.startsWith('@') || /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(t)) return m;
    let s = sel.replace(/(^|[\s,])page(?=[\s.:,{]|$)/g, '$1body').replace(TAG_RE, '$1wx-$2');
    if (hostId) s = s.replace(/:host/g, 'wx-comp[data-c="' + hostId + '"]');
    return s + '{';
  });
}

module.exports = { parse, renderFile, readWxss, wxssToCss, rpx2px };
