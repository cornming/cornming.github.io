// 在本機用假的 Google 服務跑 Code.gs 的邏輯：node apps-script/Code.test.js
// 這只驗證程式邏輯（驗證輸入、限流、統計），不能代替部署後在真正的 Google 環境試一次。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

function load() {
  const rows = [['時間', '作品', '課程', '小時']];
  const cells = {};
  const cache = new Map();
  const out = (s) => ({ text: s, setMimeType() { return this; } });
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheets: () => [{
          appendRow: (r) => rows.push(r),
          getDataRange: () => ({ getValues: () => rows }),
          getRange: (a) => ({
            getValue: () => (a === 'E1' ? (rows[0][4] || '') : cells[a] || ''),
            setValue: (v) => { if (a === 'E1') rows[0][4] = v; else cells[a] = v; },
          }),
        }],
      }),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: out, MimeType: { JSON: 'json' } },
    Utilities: { formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d) },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).text);
  const stats = () => { cache.delete('stats'); return JSON.parse(ctx.doGet().text); };
  return { rows, post, stats, cache };
}

// vm 沙盒裡建立的陣列和外面的不同執行環境，比對前先轉成純資料
const plain = (x) => JSON.parse(JSON.stringify(x));

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok  ' + name); }

test('收下合法的一筆，並把 nth 寫進第 5 欄', () => {
  const { rows, post } = load();
  assert.deepStrictEqual(post({ app: 'night-yoga', course: 'quick', hour: 22, nth: '2' }), { ok: true });
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(plain(rows[1].slice(1)), ['night-yoga', 'quick', 22, '2']);
  assert.strictEqual(Object.prototype.toString.call(rows[1][0]), '[object Date]');
});

test('第一次收到時自動補上第 5 欄表頭，之後不再動', () => {
  const { rows, post } = load();
  post({ app: 'slowjog', course: '', hour: 6, nth: '1' });
  assert.strictEqual(rows[0][4], '第幾次');
  rows[0][4] = '被人改過';
  post({ app: 'slowjog', course: '', hour: 7, nth: '1' });
  assert.strictEqual(rows[0][4], '被人改過', '已有表頭就不要覆蓋');
});

test('舊版網頁沒有 nth、或值不認得時，nth 欄留空但這筆照收', () => {
  const { rows, post } = load();
  assert.strictEqual(post({ app: 'night-yoga', course: 'deep', hour: 21 }).ok, true);
  assert.strictEqual(post({ app: 'night-yoga', course: 'deep', hour: 21, nth: '99' }).ok, true);
  assert.strictEqual(post({ app: 'night-yoga', course: 'deep', hour: 21, nth: { a: 1 } }).ok, true);
  assert.deepStrictEqual(plain(rows.slice(1).map((r) => r[4])), ['', '', '']);
});

test('不認得的作品、課程、小時一律不收', () => {
  const { rows, post } = load();
  const bad = [
    { app: 'other', course: '', hour: 1 },
    { app: 'night-yoga', course: 'nope', hour: 1 },
    { app: 'slowjog', course: 'quick', hour: 1 },
    { app: 'night-yoga', course: 'quick', hour: 24 },
    { app: 'night-yoga', course: 'quick', hour: -1 },
    { app: 'night-yoga', course: 'quick', hour: 1.5 },
    { app: 'night-yoga', course: 'quick', hour: 'x' },
  ];
  for (const b of bad) assert.strictEqual(post(b).ok, false, JSON.stringify(b));
  assert.strictEqual(post('not json').ok, false);
  assert.strictEqual(rows.length, 1);
});

test('全站每分鐘最多收 30 筆', () => {
  const { rows, post } = load();
  let ok = 0;
  for (let i = 0; i < 40; i++) if (post({ app: 'night-yoga', course: 'quick', hour: 1, nth: '1' }).ok) ok++;
  assert.strictEqual(ok, 30);
  assert.strictEqual(rows.length, 31);
});

test('統計：依第幾次分級，舊資料算在「未知」', () => {
  const { rows, post, stats } = load();
  rows.push([new Date(), 'night-yoga', 'quick', 22]);            // 舊資料，只有 4 欄
  rows.push([new Date(), 'night-yoga', 'quick', 22, '']);        // 舊版網頁
  post({ app: 'night-yoga', course: 'quick', hour: 22, nth: '1' });
  post({ app: 'night-yoga', course: 'standard', hour: 23, nth: '1' });
  post({ app: 'night-yoga', course: 'standard', hour: 23, nth: '2' });
  post({ app: 'night-yoga', course: 'standard', hour: 23, nth: '3' });
  post({ app: 'night-yoga', course: 'deep', hour: 0, nth: '4+' });
  post({ app: 'slowjog', course: '', hour: 6, nth: '1' });
  const s = stats().apps;
  assert.strictEqual(s['night-yoga'].total, 7);
  assert.deepStrictEqual(s['night-yoga'].byNth, { '1': 2, '2': 1, '3': 1, '4+': 1 });
  assert.strictEqual(s['night-yoga'].nthUnknown, 2);
  assert.deepStrictEqual(s['night-yoga'].byCourse, { quick: 3, standard: 3, deep: 1 });
  assert.strictEqual(s.slowjog.total, 1);
  assert.deepStrictEqual(s.slowjog.byNth, { '1': 1, '2': 0, '3': 0, '4+': 0 });
  assert.strictEqual(s['night-yoga'].byHour.length, 24);
});

test('統計不含任何能識別個人的欄位', () => {
  const { post, stats } = load();
  post({ app: 'night-yoga', course: 'quick', hour: 22, nth: '1' });
  const json = JSON.stringify(stats());
  assert.ok(!/email|ip|user|device/i.test(json.replace(/"updated"/, '')));
});

console.log(`\n${n} 個測試全部通過`);
