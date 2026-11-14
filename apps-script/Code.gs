// 作品完成統計：收集「完成一次」的匿名紀錄，並提供統計資料給統計頁。
// 只記錄：時間、作品、課程、小時。不記錄任何能識別個人的資料。
//
// 另外有一條「診斷紀錄」：測試頁（例如 SlowJog 的聲音測試頁）在使用者自己打開「回傳測試紀錄」開關時，
// 會把頁面上的測試紀錄送來，寫進試算表最後面的「診斷紀錄」分頁（不影響第一個分頁的統計），
// 讓開發者可以直接看到測試結果，不用請使用者複製貼上。內容只有紀錄文字、瀏覽器 userAgent 與隨機的測試代號。

const ALLOWED = {
  // 統計頁固定列出的課程（沒人做過也會列出，顯示 0）
  'night-yoga': ['quick', 'standard', 'deep'],
  'slowjog': [''],           // SlowJog 網頁版：沒有固定課程，課程欄留空
  'slowjog-android': ['']    // SlowJog Android App：同樣沒有固定課程；與網頁版分開統計
};
// 另外接受的課程代號「格式」：晚安瑜伽「躺著做」系列，lying-01 到 lying-07（設計稿共 7 堂）。
// 這些課程不預先列在統計裡，有人完成過才會出現，所以系列新增一堂不用改這裡、也不用重新部署；
// 課程的中文名稱在 assets/js/stats.js 的 COURSE_NAME（網站更新就好）。
// 只有系列超過 7 堂、或有別的新系列時，才需要改這裡並重新部署。
const ALLOWED_PATTERNS = {
  'night-yoga': /^lying-0[1-7]$/
};
function courseAllowed_(app, course) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, app)) return false;
  if (ALLOWED[app].indexOf(course) >= 0) return true;
  const re = Object.prototype.hasOwnProperty.call(ALLOWED_PATTERNS, app) ? ALLOWED_PATTERNS[app] : null;
  return !!(re && re.test(course));
}
const MAX_PER_MINUTE = 30;     // 全站每分鐘最多收幾筆，避免被大量灌數字
const CACHE_SECONDS = 60;      // 統計結果快取幾秒
const BY_DAY_RETENTION_DAYS = 45; // byDay 僅保留近期天數，避免快取 JSON 隨時間逼近 CacheService 100KB 上限

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

// 診斷紀錄：只寫進另一個分頁。run、page 只留安全字元（並去除前導公式符號），內容前面固定加「> 」：
// 試算表會把「=」「+」「-」「@」開頭的文字當成公式（例如 =IMPORTXML 可以把資料送到外面）。
function diag_(d) {
  const run = String(d.run || '').replace(/[^A-Za-z0-9_-]/g, '').replace(/^[-+=@]+/, '').slice(0, 16);
  const page = String(d.page || '').replace(/[^A-Za-z0-9_.-]/g, '').replace(/^[-+=@]+/, '').slice(0, 32);
  const text = String(d.text || '').slice(0, DIAG_MAX_TEXT);
  if (!run || !text) return out_({ ok: false });

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const cache = CacheService.getScriptCache();
    const key = 'diag_' + Math.floor(Date.now() / 60000);
    const n = Number(cache.get(key) || 0);
    if (n >= DIAG_MAX_PER_MINUTE) return out_({ ok: false, error: 'busy' });
    cache.put(key, String(n + 1), 120);

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
    if (!e || !e.postData || typeof e.postData.contents !== 'string') return out_({ ok: false });
    const d = JSON.parse(e.postData.contents);
    if (!d || typeof d !== 'object') return out_({ ok: false });
    if (d.type === 'diag') return diag_(d);

    const app = typeof d.app === 'string' ? d.app : '';
    const course = d.course == null ? '' : (typeof d.course === 'string' ? d.course : null);
    if (course === null) return out_({ ok: false });
    if (typeof d.hour !== 'number' || !Number.isInteger(d.hour) || d.hour < 0 || d.hour > 23) {
      return out_({ ok: false });
    }
    if (!courseAllowed_(app, course)) return out_({ ok: false });

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      const cache = CacheService.getScriptCache();
      const key = 'rate_' + Math.floor(Date.now() / 60000);
      const n = Number(cache.get(key) || 0);
      if (n >= MAX_PER_MINUTE) return out_({ ok: false, error: 'busy' });
      cache.put(key, String(n + 1), 120);

      sheet_().appendRow([new Date(), app, course, d.hour]);
      cache.remove('stats');
    } finally {
      lock.releaseLock();
    }
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false });
  }
}

// 統計頁讀取統計資料
function doGet() {
  try {
    const cache = CacheService.getScriptCache();
    let s = cache.get('stats');
    if (!s) {
      const lock = LockService.getScriptLock();
      const locked = typeof lock.tryLock === 'function' ? lock.tryLock(3000) : (lock.waitLock(3000), true);
      try {
        s = cache.get('stats');
        if (!s) {
          s = JSON.stringify(buildStats_());
          try {
            cache.put('stats', s, CACHE_SECONDS);
          } catch (cacheErr) {
            // 快取寫入失敗（例如超過 100KB 上限）時仍正常回傳統計 JSON
          }
        }
      } finally {
        if (locked) lock.releaseLock();
      }
    }
    return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return out_({ error: 'unavailable' });
  }
}

function parseHourCell_(val) {
  if (typeof val === 'number') {
    return Number.isInteger(val) && val >= 0 && val <= 23 ? val : -1;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!/^\d{1,2}$/.test(trimmed)) return -1;
    const n = Number(trimmed);
    return n >= 0 && n <= 23 ? n : -1;
  }
  return -1;
}

function buildStats_() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  const apps = {};
  Object.keys(ALLOWED).forEach(function (a) {
    apps[a] = { total: 0, byHour: new Array(24).fill(0), byCourse: {}, byDay: {} };
    ALLOWED[a].forEach(function (c) { if (c) apps[a].byCourse[c] = 0; });
  });
  const cutoffMs = Date.now() - BY_DAY_RETENTION_DAYS * 864e5;
  const cutoffDay = Utilities.formatDate(new Date(cutoffMs), 'Asia/Taipei', 'yyyy-MM-dd');

  rows.forEach(function (r) {
    if (!Array.isArray(r) || typeof r[1] !== 'string') return;
    if (!Object.prototype.hasOwnProperty.call(apps, r[1])) return;
    const a = apps[r[1]];
    a.total++;
    const h = parseHourCell_(r[3]);
    if (h >= 0) a.byHour[h]++;
    const c = typeof r[2] === 'string' ? r[2] : '';
    if (c && courseAllowed_(r[1], c)) {
      a.byCourse[c] = (Object.prototype.hasOwnProperty.call(a.byCourse, c) ? a.byCourse[c] : 0) + 1;
    }
    let t = null;
    if (r[0] instanceof Date || Object.prototype.toString.call(r[0]) === '[object Date]') {
      t = r[0];
    } else if (typeof r[0] === 'string' && r[0].trim() !== '') {
      t = new Date(r[0]);
    }
    if (t && !isNaN(t)) {
      const day = Utilities.formatDate(t, 'Asia/Taipei', 'yyyy-MM-dd');
      if (day >= cutoffDay) {
        a.byDay[day] = (a.byDay[day] || 0) + 1;
      }
    }
  });
  return { updated: new Date().toISOString(), apps: apps };
}
