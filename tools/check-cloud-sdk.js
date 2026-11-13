/**
 * 使用锁定的真实 wx-server-sdk 检查事务包装层契约。
 * 底层传输替换为本地对象，不访问云环境或调用微信开放接口。
 */
const assert = require('assert');
const path = require('path');

async function check(name) {
  const sdk = require(path.resolve(__dirname, '../cloudfunctions', name, 'node_modules/wx-server-sdk'));
  sdk.init({ env: 'sdk-contract-check' });
  const db = sdk.database();
  const writes = [];
  const original = db._db.runTransaction;
  db._db.runTransaction = (callback) => callback({
    collection: (collection) => ({
      doc: (id) => ({
        get: async () => ({ data: id === 'missing' ? null : { _id: id, points: 500 } }),
        set: async (data) => { writes.push({ collection, id, data }); return { updated: 1 }; },
        update: async (data) => { writes.push({ collection, id, data }); return { updated: 1 }; },
        delete: async () => ({ deleted: 1 })
      }),
      add: async (data) => { writes.push({ collection, data }); return { id: data._id }; }
    })
  });
  try {
    const result = await db.runTransaction(async (transaction) => {
      const member = await transaction.collection('members').doc('member').get();
      assert.strictEqual(member.data.points, 500);
      const updated = await transaction.collection('members').doc('member').update({ data: { points: 600 } });
      assert.strictEqual(updated.stats.updated, 1);
      const inserted = await transaction.collection('point_logs').add({ data: { _id: 'operation', delta: 100 } });
      assert.strictEqual(inserted._id, 'operation');
      await transaction.collection('point_logs').doc('snapshot').set({ data: { delta: 100 } });
      const removed = await transaction.collection('point_logs').doc('snapshot').remove();
      assert.strictEqual(removed.stats.removed, 1);
      await assert.rejects(transaction.collection('members').doc('missing').get(), /does not exist/);
      return 'committed-result';
    });
    assert.strictEqual(result, 'committed-result');
    assert.strictEqual(writes[0].data.points, 600);
    assert.strictEqual(writes[1].data._id, 'operation');
    assert.strictEqual(writes[2].data.delta, 100);
  } finally {
    db._db.runTransaction = original;
  }
  console.log(name + ' SDK 事务契约检查通过');
}

(async () => {
  await check('api');
  await check('remind');
})().catch((error) => { console.error(error); process.exitCode = 1; });
