// 作品完成統計：收集「完成一次」的匿名紀錄，並提供統計資料給統計頁。
// 只記錄：時間、作品、課程、小時。不記錄任何能識別個人的資料。
//
// 另外有一條「診斷紀錄」：測試頁（例如 SlowJog 的聲音測試頁）在使用者自己打開「回傳測試紀錄」開關時，
// 會把頁面上的測試紀錄送來，寫進試算表最後面的「診斷紀錄」分頁（不影響第一個分頁的統計），
// 讓開發者可以直接看到測試結果，不用請使用者複製貼上。內容只有紀錄文字、瀏覽器 userAgent 與隨機的測試代號。

const ALLOWED = {
  // 晚安瑜伽的課程代號 = data/routines.json 的課程 id。「躺著做」系列（lying-）每上線一堂，就要加進這裡並重新部署；
  // 沒加的話使用者不受影響，只是那堂課的完成次數不會被統計。名稱對照在 assets/js/stats.js 的 COURSE_NAME。
  'night-yoga': ['quick', 'standard', 'deep', 'lying-01'],
  'slowjog': [''],           // SlowJog 網頁版：沒有固定課程，課程欄留空
  'slowjog-android': ['']    // SlowJog Android App：同樣沒有固定課程；與網頁版分開統計
};
const MAX_PER_MINUTE = 30;   // 全站每分鐘最多收幾筆，避免被大量灌數字
const CACHE_SECONDS = 60;    // 統計結果快取幾秒

const DIAG_SHEET = '診斷紀錄';
const DIAG_MAX_ROWS = 3000;       // 診斷分頁最多幾列，滿了就停止收（避免被灌）
const DIAG_MAX_PER_MINUTE = 60;   // 全站每分鐘最多收幾批診斷紀錄
const DIAG_MAX_TEXT = 4000;       // 每一批最多幾個字

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 診斷紀錄：只寫進另一個分頁。run、page 只留英數字，內容前面固定加「> 」：
// 試算表會把「=」開頭的文字當成公式（例如 =IMPORTXML 可以把資料送到外面），所以不能讓內容以「=」開頭。
function diag_(d) {
  const run = String(d.run || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
  const page = String(d.page || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32);
  const text = String(d.text || '').slice(0, DIAG_MAX_TEXT);
  if (!run || !text) return out_({ ok: false });

  const cache = CacheService.getScriptCache();
  const key = 'diag_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(key) || 0);
  if (n >= DIAG_MAX_PER_MINUTE) return out_({ ok: false, error: 'busy' });
  cache.put(key, String(n + 1), 120);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(DIAG_SHEET);
    if (!sh) {
      // 放在最後面，第一個分頁（統計）不能動
      sh = ss.insertSheet(DIAG_SHEET, ss.getNumSheets());
      sh.appendRow(['時間', '測試代號', '頁面', '內容']);
    }
    if (sh.getLastRow() > DIAG_MAX_ROWS) return out_({ ok: false, error: 'full' });
    sh.appendRow([new Date(), run, page, '> ' + text]);
  } finally {
    lock.releaseLock();
  }
  return out_({ ok: true });
}

// 網頁在使用者「完成一次」時呼叫
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d && d.type === 'diag') return diag_(d);
    const app = String(d.app || '');
    const course = String(d.course || '');
    const hour = Number(d.hour);
    if (!ALLOWED[app] || ALLOWED[app].indexOf(course) < 0) return out_({ ok: false });
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return out_({ ok: false });

    const cache = CacheService.getScriptCache();
    const key = 'rate_' + Math.floor(Date.now() / 60000);
    const n = Number(cache.get(key) || 0);
    if (n >= MAX_PER_MINUTE) return out_({ ok: false, error: 'busy' });
    cache.put(key, String(n + 1), 120);

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      sheet_().appendRow([new Date(), app, course, hour]);
    } finally {
      lock.releaseLock();
    }
    cache.remove('stats');
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false });
  }
}

// 統計頁讀取統計資料
function doGet() {
  const cache = CacheService.getScriptCache();
  let s = cache.get('stats');
  if (!s) {
    s = JSON.stringify(buildStats_());
    cache.put('stats', s, CACHE_SECONDS);
  }
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}

function buildStats_() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  const apps = {};
  Object.keys(ALLOWED).forEach(function (a) {
    apps[a] = { total: 0, byHour: new Array(24).fill(0), byCourse: {}, byDay: {} };
    ALLOWED[a].forEach(function (c) { if (c) apps[a].byCourse[c] = 0; });
  });
  rows.forEach(function (r) {
    const a = apps[r[1]];
    if (!a) return;
    a.total++;
    const h = Number(r[3]);
    if (h >= 0 && h <= 23) a.byHour[h]++;
    if (r[2] && a.byCourse[r[2]] !== undefined) a.byCourse[r[2]]++;
    const t = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (!isNaN(t)) {
      const day = Utilities.formatDate(t, 'Asia/Taipei', 'yyyy-MM-dd');
      a.byDay[day] = (a.byDay[day] || 0) + 1;
    }
  });
  return { updated: new Date().toISOString(), apps: apps };
}
