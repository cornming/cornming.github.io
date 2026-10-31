// 作品完成統計：收集「完成一次」的匿名紀錄，並提供統計資料給統計頁。
// 只記錄：時間、作品、課程、小時、這個瀏覽器第幾次完成的分級。不記錄任何能識別個人的資料。

const ALLOWED = {
  'night-yoga': ['quick', 'standard', 'deep'],
  'slowjog': ['']            // SlowJog 沒有固定課程，課程欄留空
};
const NTH_VALUES = ['1', '2', '3', '4+'];  // 第幾次完成，只分四級，不收確切次數
const MAX_PER_MINUTE = 30;   // 全站每分鐘最多收幾筆，避免被大量灌數字
const CACHE_SECONDS = 60;    // 統計結果快取幾秒

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 網頁在使用者「完成一次」時呼叫
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const app = String(d.app || '');
    const course = String(d.course || '');
    const hour = Number(d.hour);
    // 舊版網頁沒有這個欄位，或值不認得時留空，不影響其他統計
    const nth = NTH_VALUES.indexOf(String(d.nth || '')) >= 0 ? String(d.nth) : '';
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
      const sh = sheet_();
      // 第一次收到新欄位時，自動補上表頭
      if (!sh.getRange('E1').getValue()) sh.getRange('E1').setValue('第幾次');
      sh.appendRow([new Date(), app, course, hour, nth]);
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
    apps[a] = { total: 0, byHour: new Array(24).fill(0), byCourse: {}, byDay: {}, byNth: { '1': 0, '2': 0, '3': 0, '4+': 0 }, nthUnknown: 0 };
    ALLOWED[a].forEach(function (c) { if (c) apps[a].byCourse[c] = 0; });
  });
  rows.forEach(function (r) {
    const a = apps[r[1]];
    if (!a) return;
    a.total++;
    const h = Number(r[3]);
    if (h >= 0 && h <= 23) a.byHour[h]++;
    if (r[2] && a.byCourse[r[2]] !== undefined) a.byCourse[r[2]]++;
    if (a.byNth[r[4]] !== undefined) a.byNth[r[4]]++;
    else a.nthUnknown++;
    const t = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (!isNaN(t)) {
      const day = Utilities.formatDate(t, 'Asia/Taipei', 'yyyy-MM-dd');
      a.byDay[day] = (a.byDay[day] || 0) + 1;
    }
  });
  return { updated: new Date().toISOString(), apps: apps };
}
