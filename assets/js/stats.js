// 使用統計頁：從 Google Apps Script 讀回匿名的完成統計，畫成圖表。
// 所有文字一律用 textContent 寫入，不拼 innerHTML。
(function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var APP_NAME = { 'night-yoga': '晚安瑜伽', 'slowjog': 'SlowJog 網頁版', 'slowjog-android': 'SlowJog Android' };
  var APP_URL = {
    'night-yoga': 'https://night-yoga.netlify.app/',
    'slowjog': 'https://slowjog.netlify.app/',
    'slowjog-android': 'https://github.com/cornming/slowjog/releases/latest'
  };
  var COURSE_NAME = {
    quick: '快速放鬆', standard: '睡前舒展', deep: '深度放鬆',
    // 「躺著做」系列（night-yoga-src 的 docs/lying-series/）；有人完成過才會出現在統計裡
    'lying-01': '躺好就好', 'lying-02': '放鬆髖部', 'lying-03': '溫柔扭轉', 'lying-04': '腿與臀',
    'lying-05': '側臥入睡', 'lying-06': '胸口與肩膀', 'lying-07': '完整睡前流程'
  };
  var PERIODS = [
    { name: '深夜', range: '0 到 4 點', from: 0, to: 4 },
    { name: '早上', range: '5 到 11 點', from: 5, to: 11 },
    { name: '下午', range: '12 到 17 點', from: 12, to: 17 },
    { name: '晚上', range: '18 到 23 點', from: 18, to: 23 }
  ];

  var dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
  var timeFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }
  function numOrZero(v) {
    var n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  function fmt(n) { return numOrZero(n).toLocaleString('zh-TW'); }
  function pct(n, total) { return total > 0 ? Math.round((n / total) * 100) : 0; }
  function sum(a) { return a.reduce(function (x, y) { return x + numOrZero(y); }, 0); }

  // 網址後面的 #作品代號 可以直接指定要看哪個作品，例如 /stats/#slowjog
  function appFromHash(hash) {
    var id = String(hash || '').replace(/^#/, '');
    return hasOwn(APP_NAME, id) ? id : null;
  }

  // 最近 n 天的日期（台北時間），由舊到新
  function lastDays(n, nowMs) {
    var out = [];
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    for (var i = n - 1; i >= 0; i--) out.push(dayFmt.format(new Date(now - i * 864e5)));
    return out;
  }

  // 圖的上限取整齊的數字：20 以內是 4 的倍數，其餘取 1、2、5 的倍數，這樣中間的刻度一定是整數
  function niceMax(m) {
    if (!Number.isFinite(m) || m <= 4) return 4;
    if (m <= 20) return Math.ceil(m / 4) * 4;
    var p = Math.pow(10, Math.floor(Math.log10(m)));
    var f = m / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // 匯出純函式給單元測試（Node 環境沒有 .stats 容器，不會執行下面的瀏覽器邏輯）
  if (typeof module === 'object' && module.exports) {
    module.exports = { appFromHash: appFromHash, lastDays: lastDays, niceMax: niceMax, numOrZero: numOrZero, pct: pct, sum: sum };
  }
  if (typeof document === 'undefined') return;

  var root = document.querySelector('.stats');
  if (!root) return;

  var statusEl = root.querySelector('.stats-status');
  var bodyEl = root.querySelector('.stats-body');
  var updatedEl = document.getElementById('stats-updated');
  var tabs = root.querySelectorAll('.stats-tabs .chip');
  var data = null;
  var current = 'night-yoga';
  var tipSeq = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function hideAllTips() {
    root.querySelectorAll('.stats-tip').forEach(function (tip) { tip.hidden = true; });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideAllTips();
  });

  // ───────── tooltip：一張卡片一個，滑鼠、觸控與鍵盤焦點都會顯示 ─────────
  function ensureCardTip(card) {
    var tip = card.querySelector('.stats-tip');
    if (!tip) {
      tip = el('div', 'stats-tip');
      tip.hidden = true;
      tip.id = 'stats-tip-' + (++tipSeq);
      tip.setAttribute('role', 'tooltip');
      card.appendChild(tip);
    }
    return tip;
  }

  function attachTip(card, target, text) {
    var tip = ensureCardTip(card);
    target.setAttribute('aria-describedby', tip.id);
    function show() {
      tip.textContent = text;
      tip.hidden = false;
      var c = card.getBoundingClientRect();
      var r = target.getBoundingClientRect();
      var x = r.left - c.left + r.width / 2;
      var w = tip.offsetWidth;
      x = Math.max(w / 2 + 4, Math.min(c.width - w / 2 - 4, x));
      tip.style.left = x + 'px';
      tip.style.top = Math.max(4, r.top - c.top - tip.offsetHeight - 6) + 'px';
    }
    function hide() { tip.hidden = true; }
    target.addEventListener('pointerenter', show);
    target.addEventListener('pointerleave', hide);
    target.addEventListener('focus', show);
    target.addEventListener('blur', hide);
    target.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (tip.hidden || tip.textContent !== text) show();
        else hide();
      }
    });
  }

  // ───────── 直條圖（每天、每小時共用）─────────
  // items: [{ label, value, tip, axis }]，axis 為 true 的那幾根下方才標 x 軸文字
  function columnChart(container, items, summary) {
    clear(container);
    var card = container.closest('.stats-card');
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }));
    var top = niceMax(max);
    // 左側邊距依最大刻度字元數動態展開，避免四位數以上被截掉
    var L = Math.max(34, 14 + fmt(top).length * 7);
    var W = Math.max(300, Math.round(container.clientWidth || 720)), H = 230, R = 6, T = 22, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var slot = pw / items.length;
    var barW = Math.min(24, slot * 0.62);

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': summary, class: 'stats-svg' });

    [0, top / 2, top].forEach(function (t) {
      var y = T + ph - (t / top) * ph;
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: t === 0 ? 'axis' : 'grid' }));
      s.appendChild(svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' }, fmt(t)));
    });

    var maxIndex = items.reduce(function (best, it, i) { return it.value > items[best].value ? i : best; }, 0);

    items.forEach(function (it, i) {
      var cx = L + slot * i + slot / 2;
      var g = svg('g', { class: 'col' });
      var h = (it.value / top) * ph;
      if (it.value > 0) {
        // 資料端 4px 圓角、貼著基準線的一端是直角
        var x0 = cx - barW / 2, x1 = cx + barW / 2, y0 = T + ph, y1 = T + ph - Math.max(h, 4), r = Math.min(4, (y0 - y1) / 2);
        g.appendChild(svg('path', {
          class: 'bar',
          d: 'M' + x0 + ' ' + y0 + 'V' + (y1 + r) + 'Q' + x0 + ' ' + y1 + ' ' + (x0 + r) + ' ' + y1 +
             'H' + (x1 - r) + 'Q' + x1 + ' ' + y1 + ' ' + x1 + ' ' + (y1 + r) + 'V' + y0 + 'Z'
        }));
      }
      // 只標最高的那一根，其餘靠刻度、tooltip 與表格
      if (i === maxIndex && it.value > 0) {
        g.appendChild(svg('text', { x: cx, y: T + ph - Math.max(h, 4) - 6, 'text-anchor': 'middle', class: 'value' }, fmt(it.value)));
      }
      if (it.axis) g.appendChild(svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, it.label));
      // 比長條大的透明感應區：整個欄位寬、整個繪圖區高
      var hit = svg('rect', {
        x: cx - slot / 2, y: T, width: slot, height: ph, class: 'hit', tabindex: '0',
        role: 'button', 'aria-label': it.tip
      });
      g.appendChild(hit);
      s.appendChild(g);
      attachTip(card, hit, it.tip);
    });

    container.appendChild(s);
  }

  // ───────── 橫條排行榜 ─────────
  function rankChart(container, rows) {
    clear(container);
    var card = container.closest('.stats-card');
    var total = sum(rows.map(function (r) { return r.value; }));
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }));
    var list = el('ol', 'stats-rank');
    rows.forEach(function (r, i) {
      var li = el('li', 'rank-row');
      li.tabIndex = 0;
      var tipText = r.label + '：' + fmt(r.value) + ' 次，占 ' + pct(r.value, total) + '%';
      li.setAttribute('aria-label', '第 ' + (i + 1) + ' 名，' + tipText);
      li.appendChild(el('span', 'rank-no', String(i + 1)));
      li.appendChild(el('span', 'rank-name', r.label));
      var track = el('span', 'rank-track');
      var fill = el('span', 'rank-fill');
      fill.setAttribute('aria-hidden', 'true');
      var bar = el('span', 'rank-bar');
      var ratio = max > 0 ? Math.max(r.value / max, r.value > 0 ? 0.02 : 0) : 0;
      fill.style.setProperty('--w', String(ratio));
      fill.appendChild(bar);
      track.appendChild(fill);
      track.appendChild(el('span', 'rank-val', fmt(r.value) + ' 次（' + pct(r.value, total) + '%）'));
      li.appendChild(track);
      list.appendChild(li);
      attachTip(card, li, tipText);
    });
    container.appendChild(list);
  }

  // ───────── 表格檢視 ─────────
  function table(caption, head, rows) {
    var t = el('table', 'stats-table');
    t.appendChild(el('caption', null, caption));
    var thead = el('thead');
    var tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      r.forEach(function (c) { row.appendChild(el('td', null, c)); });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    return t;
  }

  function tile(label, value, note) {
    var d = el('div', 'stats-tile');
    d.appendChild(el('p', 'tile-label', label));
    d.appendChild(el('p', 'tile-value', value));
    if (note) d.appendChild(el('p', 'tile-note', note));
    return d;
  }

  // ───────── 組畫面 ─────────
  // 資料格式怪異（欄位缺漏、型別不對）時，不要留下畫到一半的圖，改顯示一句說明
  function render() {
    hideAllTips();
    try {
      renderChecked();
    } catch (e) {
      showStatus('統計資料的格式讀不懂，請稍後再試。');
    }
  }

  function renderChecked() {
    if (!hasOwn(APP_NAME, current)) { showStatus('找不到這個作品的統計。'); return; }
    var a = data && data.apps && hasOwn(data.apps, current) ? data.apps[current] : null;
    if (!a) { showStatus('這個作品目前沒有資料。'); return; }
    if (!Array.isArray(a.byHour) || a.byHour.length !== 24) throw new Error('bad byHour');

    var total = numOrZero(a.total);
    if (!total) {
      bodyEl.hidden = true;
      clear(statusEl);
      statusEl.hidden = false;
      statusEl.appendChild(document.createTextNode('還沒有人完成過' + APP_NAME[current] + '。'));
      var link = el('a', null, '去試試看，你可以是第一個');
      link.href = APP_URL[current];
      statusEl.appendChild(document.createTextNode(' '));
      statusEl.appendChild(link);
      updatedEl.textContent = '';
      return;
    }
    statusEl.hidden = true;
    bodyEl.hidden = false;

    var days = lastDays(30);
    var byDay = a.byDay || {};
    var dayVals = days.map(function (d) { return hasOwn(byDay, d) ? numOrZero(byDay[d]) : 0; });
    var last7 = sum(dayVals.slice(-7));
    var hours = a.byHour.map(numOrZero);
    var hoursTotal = sum(hours) || total;
    var peak = hours.reduce(function (best, v, i) { return v > hours[best] ? i : best; }, 0);

    // 重點數字
    var tiles = document.getElementById('stats-tiles');
    clear(tiles);
    tiles.appendChild(tile('累計完成', fmt(total) + ' 次'));
    tiles.appendChild(tile('最近 7 天', fmt(last7) + ' 次'));
    tiles.appendChild(tile('最多人完成的時段', peak + ' 到 ' + ((peak + 1) % 24) + ' 點', '共 ' + fmt(hours[peak]) + ' 次'));

    // 每天
    columnChart(document.getElementById('chart-days'),
      days.map(function (d, i) {
        var md = Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10));
        return { label: md, value: dayVals[i], axis: i % 5 === 4 || i === 0, tip: md + '：' + fmt(dayVals[i]) + ' 次' };
      }),
      '最近 30 天每天完成次數的直條圖，共 ' + fmt(sum(dayVals)) + ' 次');

    // 每小時
    columnChart(document.getElementById('chart-hours'),
      hours.map(function (v, h) {
        return { label: String(h), value: v, axis: h % 3 === 0, tip: h + ' 點到 ' + ((h + 1) % 24) + ' 點：' + fmt(v) + ' 次' };
      }),
      '一天 24 小時各時段完成次數的直條圖，最多的是 ' + peak + ' 點，共 ' + fmt(hours[peak]) + ' 次');

    // 時段的白話說明
    var shares = PERIODS.map(function (p) {
      return { p: p, v: sum(hours.slice(p.from, p.to + 1)) };
    });
    var best = shares.reduce(function (b, s) { return s.v > b.v ? s : b; }, shares[0]);
    document.getElementById('insight-hours').textContent =
      '「' + best.p.name + '」（' + best.p.range + '）最多，占 ' + pct(best.v, hoursTotal) + '%。' +
      shares.filter(function (s) { return s !== best; }).map(function (s) {
        return s.p.name + ' ' + pct(s.v, hoursTotal) + '%';
      }).join('、') + '。';

    // 課程排行榜（只有有固定課程的作品才有）
    var courseCard = document.getElementById('card-courses');
    var courses = a.byCourse || {};
    var courseKeys = Object.keys(courses);
    var rows = [];
    if (courseKeys.length) {
      courseCard.hidden = false;
      rows = courseKeys.map(function (k) {
        return { label: hasOwn(COURSE_NAME, k) ? COURSE_NAME[k] : k, value: numOrZero(courses[k]) };
      }).sort(function (x, y) { return y.value - x.value; });
      rankChart(document.getElementById('chart-courses'), rows);
    } else {
      courseCard.hidden = true;
    }

    // 表格
    var tables = document.getElementById('stats-tables');
    clear(tables);
    tables.appendChild(table('最近 30 天，每天完成次數', ['日期', '次數'],
      days.map(function (d, i) { return [d, fmt(dayVals[i])]; }).reverse()));
    tables.appendChild(table('各小時完成次數', ['小時', '次數'],
      hours.map(function (v, h) { return [h + ' 點', fmt(v)]; })));
    if (rows.length) {
      tables.appendChild(table('課程排行榜', ['名次', '課程', '次數'],
        rows.map(function (r, i) { return [String(i + 1), r.label, fmt(r.value)]; })));
    }

    // 更新時間
    if (data.updated) {
      var t = new Date(data.updated);
      updatedEl.textContent = !isNaN(t) ? '資料更新於 ' + timeFmt.format(t) + '（台北時間）' : '';
    } else {
      updatedEl.textContent = '';
    }
  }

  function showStatus(msg) {
    hideAllTips();
    bodyEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = msg;
    updatedEl.textContent = '';
  }

  function selectApp(app) {
    current = app;
    tabs.forEach(function (t) { t.setAttribute('aria-pressed', String(t.dataset.app === app)); });
    if (data) render();
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      selectApp(tab.dataset.app);
      // 把選到的作品寫回網址，重新整理或把網址貼給別人時會停在同一個分頁
      try { history.replaceState(null, '', '#' + current); } catch (e) {}
    });
  });
  window.addEventListener('hashchange', function () {
    var app = appFromHash(location.hash);
    if (app && app !== current) selectApp(app);
  });
  var initialApp = appFromHash(location.hash);
  if (initialApp) selectApp(initialApp);

  // 視窗寬度改變（轉向、縮放）時重畫，圖才會貼合新的寬度
  var lastWidth = window.innerWidth;
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (data) render(); }, 150);
  });

  var endpoint = root.dataset.endpoint;
  if (!endpoint) { showStatus('統計網址還沒設定。'); return; }
  // 15 秒讀不到就放棄，不讓畫面一直停在「讀取中」
  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
  fetch(endpoint, ctl ? { signal: ctl.signal } : undefined)
    .then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then(function (j) {
      clearTimeout(timer);
      if (j && j.error) { showStatus('暫時讀不到統計資料，請稍後再試。'); return; }
      data = j;
      render();
    })
    .catch(function () { clearTimeout(timer); showStatus('暫時讀不到統計資料，請稍後再試。'); });
})();
