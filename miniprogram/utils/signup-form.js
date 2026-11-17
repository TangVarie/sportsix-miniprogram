/**
 * 报名表：把活动上的报名表（event.form）整理成页面要显示的样子，并在本机先检查一遍填得对不对。
 * 检查的规则和云函数 api 的 cleanAnswers 一致（电话、证件号码、日期的格式，必填项），云端还会再查一次。
 */
const copy = require('../content/signup-form.js');

/** 18 位居民身份证号按国家标准核对最后一位；其他证件只看是不是 6 到 30 位字母数字 */
function idnoOk(v) {
  if (!/^[0-9A-Z]{6,30}$/.test(v)) return false;
  if (!/^\d{17}[\dX]$/.test(v)) return true;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(v[i]) * w[i];
  return '10X98765432'[sum % 11] === v[17];
}

/** 整理一项的值：电话去掉空格和横线，证件号码去掉空格、字母变大写，其余去掉首尾空格 */
function normalize(field, value) {
  if (field.kind === 'multi') return Array.isArray(value) ? value.filter((v) => field.options.indexOf(v) >= 0) : [];
  const s = value == null ? '' : String(value);
  if (field.kind === 'phone') return s.replace(/[\s-]/g, '');
  if (field.kind === 'idno') return s.replace(/\s/g, '').toUpperCase();
  return s.trim();
}

/**
 * 检查整张表。values 是 { 项的 id: 值 }。
 * 返回 { answers, errors, first }：answers 是要交给云端的整理好的值；errors 是 { 项的 id: 'missing' | 'phone' | 'idno' }；
 * first 是第一处错误的提示语（没有错误是空字符串）。
 */
function check(fields, values) {
  const answers = {};
  const errors = {};
  let first = '';
  (fields || []).forEach((f) => {
    const v = normalize(f, values && values[f.id]);
    const empty = Array.isArray(v) ? !v.length : !v;
    let err = '';
    if (empty) { if (f.required) err = 'missing'; } else if (f.kind === 'phone' && !/^\+?\d{5,20}$/.test(v)) err = 'phone';
    else if (f.kind === 'idno' && !idnoOk(v)) err = 'idno';
    if (err) { errors[f.id] = err; if (!first) first = copy.errors[err]; }
    if (!empty) answers[f.id] = v;
  });
  return { answers: answers, errors: errors, first: first };
}

/** 报名表 → 页面上每一项的显示数据。values 是现在填的内容，errors 是 check 给的错误 */
function view(fields, values, errors) {
  const today = new Date();
  const two = (n) => (n < 10 ? '0' : '') + n;
  const end = today.getFullYear() + '-' + two(today.getMonth() + 1) + '-' + two(today.getDate());
  return (fields || []).map((f, i) => {
    const v = values ? values[f.id] : undefined;
    const item = {
      id: f.id, kind: f.kind, label: f.label, required: !!f.required,
      error: !!(errors && errors[f.id]), last: i === fields.length - 1,
      value: f.kind === 'multi' ? '' : (v == null ? '' : String(v)),
      placeholder: copy.placeholders[f.kind] || copy.placeholders.text
    };
    if (f.kind === 'single' || f.kind === 'multi') {
      const picked = f.kind === 'multi' ? (Array.isArray(v) ? v : []) : [v];
      item.options = f.options.map((o) => ({ text: o, on: picked.indexOf(o) >= 0 }));
    }
    if (f.kind === 'date') item.end = end;
    return item;
  });
}

/** 这场活动有没有报名表 */
function hasForm(event) {
  const e = event && (event.raw || event);
  return !!(e && Array.isArray(e.form) && e.form.length);
}

module.exports = { check, view, hasForm, idnoOk, normalize };
