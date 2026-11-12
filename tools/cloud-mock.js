/**
 * wx-server-sdk 的内存替身，只够跑 cloudfunctions/ 里用到的那部分接口，供 tools/test-cloud.js 使用。
 * 它验证的是云函数的业务逻辑，不能代替在云开发环境里的真实调用。
 */
const Module = require('module');
const path = require('path');

function createCloud() {
  const state = {
    openid: 'user-a',
    now: Date.now(),
    data: {},          // 集合名 → 文档数组
    phones: {},        // code → 手机号
    sent: [],          // 发出的订阅消息
    sendError: null,   // 设了就让发送失败
    addFails: null,    // 'after'：写入成功后抛错（模拟响应丢失）；'before'：没写入就抛错
    getError: null,    // (集合名) => true 时这次查询抛错（模拟数据库一时出错）
    onUpdate: null,    // (集合名, 条件) => Promise：条件更新真正执行之前先等它，用来排出特定的先后顺序
    absent: { counters: true, point_logs: true, settings: true, admin_web: true, news_subs: true },
    files: {}          // 云存储：fileID → 内容（Buffer）   // 还没建的集合：读写会报错，createCollection 之后才能用
  };
  let seq = 0;
  const col = (name) => {
    if (state.absent[name]) throw new Error('collection not exists: ' + name);
    return (state.data[name] = state.data[name] || []);
  };
  const val = (v) => (v instanceof Date ? v.getTime() : v);
  const isOp = (v) => v && typeof v === 'object' && v.$op;

  function match(doc, cond) {
    return Object.keys(cond).every((k) => {
      const c = cond[k];
      const v = doc[k];
      if (!isOp(c)) return val(v) === val(c);
      if (c.$op === 'gte') return v != null && val(v) >= val(c.v);
      if (c.$op === 'lt') return v != null && val(v) < val(c.v);
      if (c.$op === 'lte') return v != null && val(v) <= val(c.v);
      if (c.$op === 'exists') return (v !== undefined) === c.v;
      throw new Error('替身不支持的查询指令：' + c.$op);
    });
  }
  function apply(doc, data) {
    Object.keys(data).forEach((k) => {
      const d = data[k];
      if (isOp(d) && d.$op === 'inc') doc[k] = (doc[k] || 0) + d.v;
      else if (isOp(d) && d.$op === 'remove') delete doc[k];
      else doc[k] = d;
    });
  }
  const copy = (d) => Object.assign({}, d);

  function query(name, cond, order, max, offset) {
    const q = {
      where: (c) => query(name, c, order, max, offset),
      orderBy: (field, dir) => query(name, cond, { field: field, dir: dir }, max, offset),
      limit: (n) => query(name, cond, order, n, offset),
      skip: (n) => query(name, cond, order, max, n),
      async get() {
        if (state.getError && state.getError(name)) throw new Error('database timeout');
        let list = col(name).filter((d) => match(d, cond || {}));
        if (order) list = list.slice().sort((a, b) => (val(a[order.field]) - val(b[order.field])) * (order.dir === 'desc' ? -1 : 1));
        return { data: list.slice(offset || 0, (offset || 0) + (max || 20)).map(copy) };
      },
      async count() { return { total: col(name).filter((d) => match(d, cond || {})).length }; },
      async update(o) {
        if (state.onUpdate) await state.onUpdate(name, cond || {});
        const list = col(name).filter((d) => match(d, cond || {}));
        list.forEach((d) => apply(d, o.data));
        return { stats: { updated: list.length } };
      },
      async add(o) {
        const doc = copy(o.data);
        if (!doc._id) doc._id = 'id' + (++seq);
        if (col(name).some((d) => d._id === doc._id)) throw new Error('duplicate key: ' + doc._id);
        const mode = state.addFails;
        state.addFails = null;
        if (mode === 'before') throw new Error('network error');
        col(name).push(doc);
        if (mode === 'after') throw new Error('response lost');
        return { _id: doc._id };
      },
      doc: (id) => ({
        async set(o) {
          const list = col(name);
          const i = list.findIndex((d) => d._id === id);
          const doc = Object.assign({ _id: id }, o.data);
          if (i >= 0) list[i] = doc; else list.push(doc);
          return { _id: id };
        },
        async update(o) {
          const doc = col(name).find((d) => d._id === id);
          if (doc) apply(doc, o.data);
          return { stats: { updated: doc ? 1 : 0 } };
        }
      })
    };
    return q;
  }

  const db = {
    command: {
      gte: (v) => ({ $op: 'gte', v: v }),
      lt: (v) => ({ $op: 'lt', v: v }),
      lte: (v) => ({ $op: 'lte', v: v }),
      exists: (v) => ({ $op: 'exists', v: v }),
      inc: (v) => ({ $op: 'inc', v: v }),
      remove: () => ({ $op: 'remove' })
    },
    serverDate: () => new Date(state.now),
    async createCollection(name) {
      if (!state.absent[name]) throw new Error('collection already exists: ' + name);
      delete state.absent[name];
      return { errMsg: 'createCollection:ok' };
    },
    collection: (name) => query(name)
  };

  const sdk = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: state.openid, ENV: 'mock-env' }),
    async uploadFile(o) {
      const fileID = 'cloud://mock-env/' + o.cloudPath;
      state.files[fileID] = o.fileContent;
      return { fileID: fileID };
    },
    async getTempFileURL(o) {
      return { fileList: o.fileList.map((id) => (state.files[id] ? { fileID: id, tempFileURL: 'https://files.test/' + id.replace('cloud://mock-env/', ''), status: 0 } : { fileID: id, tempFileURL: '', status: 1 })) };
    },
    openapi: {
      phonenumber: {
        async getPhoneNumber(o) {
          if (!state.phones[o.code]) throw Object.assign(new Error('invalid code'), { errCode: 40029 });
          return { errCode: 0, phoneInfo: { phoneNumber: state.phones[o.code], purePhoneNumber: state.phones[o.code], countryCode: '86' } };
        }
      },
      subscribeMessage: {
        async send(o) {
          if (state.sendError) throw Object.assign(new Error('send failed'), { errCode: state.sendError });
          state.sent.push(o);
          return { errCode: 0 };
        }
      }
    }
  };

  /** 用替身加载一个云函数（cloudfunctions/<name>/index.js），时间也换成替身的时钟 */
  function load(name) {
    const file = path.resolve(__dirname, '../cloudfunctions', name, 'index.js');
    const dir = path.dirname(file);
    Object.keys(require.cache).forEach((k) => { if (k.startsWith(dir)) delete require.cache[k]; });
    const original = Module._load;
    Module._load = function (request) {
      if (request === 'wx-server-sdk') return sdk;
      return original.apply(this, arguments);
    };
    try { return require(file); } finally { Module._load = original; }
  }

  /** 在替身的时钟下执行（云函数里用的是 Date.now()） */
  async function run(fn) {
    const realNow = Date.now;
    Date.now = () => state.now;
    try { return await fn(); } finally { Date.now = realNow; }
  }

  return { state: state, sdk: sdk, load: load, run: run, col: col };
}

module.exports = { createCloud };
