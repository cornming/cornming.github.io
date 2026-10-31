// 使用統計頁：從 Google Apps Script 讀回匿名的完成統計，畫成圖表。
// 所有文字一律用 textContent 寫入，不拼 innerHTML。
(function () {
  var root = document.querySelector('.stats');
  if (!root) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var APP_NAME = { 'night-yoga': '晚安瑜伽', 'slowjog': 'SlowJog 網頁版' };
  var APP_URL = { 'night-yoga': 'https://cornming.github.io/night-yoga/', 'slowjog': 'https://cornming.github.io/slowjog/' };
  var COURSE_NAME = { quick: '快速放鬆', standard: '睡前舒展', deep: '深度放鬆' };
  var PERIODS = [
    { name: '深夜', range: '0 到 4 點', from: 0, to: 4 },
    { name: '早上', range: '5 到 11 點', from: 5, to: 11 },
    { name: '下午', range: '12 到 17 點', from: 12, to: 17 },
    { name: '晚上', range: '18 到 23 點', from: 18, to: 23 }
  ];

  var statusEl = root.querySelector('.stats-status');
  var bodyEl = root.querySelector('.stats-body');
  var updatedEl = document.getElementById('stats-updated');
  var tabs = root.querySelectorAll('.stats-tabs .chip');
  var data = null;
  var current = 'night-yoga';

  var dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
  var timeFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

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
  function fmt(n) { return Number(n).toLocaleString('zh-TW'); }
  function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

  // 最近 n 天的日期（台北時間），由舊到新
  function lastDays(n) {
    var out = [];
    var now = Date.now();
    for (var i = n - 1; i >= 0; i--) out.push(dayFmt.format(new Date(now - i * 864e5)));
    return out;
  }

  // 圖的上限取整齊的數字：20 以內是 4 的倍數，其餘取 1、2、5 的倍數，這樣中間的刻度一定是整數
  function niceMax(m) {
    if (m <= 4) return 4;
    if (m <= 20) return Math.ceil(m / 4) * 4;
    var p = Math.pow(10, Math.floor(Math.log10(m)));
    var f = m / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // ───────── tooltip：一張卡片一個，滑鼠與鍵盤焦點都會顯示 ─────────
  function attachTip(card, target, text) {
    var tip = card.querySelector('.stats-tip');
    if (!tip) {
      tip = el('div', 'stats-tip');
      tip.hidden = true;
      tip.setAttribute('role', 'tooltip');
      card.appendChild(tip);
    }
    function show() {
      tip.textContent = text;
      tip.hidden = false;
      var c = card.getBoundingClientRect();
      var r = target.getBoundingClientRect();
      var x = r.left - c.left + r.width / 2;
      var w = tip.offsetWidth;
      x = Math.max(w / 2 + 4, Math.min(c.width - w / 2 - 4, x));
      tip.style.left = x + 'px';
      tip.style.top = (r.top - c.top - tip.offsetHeight - 6) + 'px';
    }
    function hide() { tip.hidden = true; }
    target.addEventListener('pointerenter', show);
    target.addEventListener('pointerleave', hide);
    target.addEventListener('focus', show);
    target.addEventListener('blur', hide);
  }

  // ───────── 直條圖（每天、每小時共用）─────────
  // items: [{ label, value, tip, axis }]，axis 為 true 的那幾根下方才標 x 軸文字
  function columnChart(container, items, summary) {
    clear(container);
    var card = container.closest('.stats-card');
    // 依容器的實際寬度畫，文字才不會在手機上被縮得看不清楚
    var W = Math.max(300, Math.round(container.clientWidth || 720)), H = 230, L = 34, R = 6, T = 22, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }));
    var top = niceMax(max);
    var slot = pw / items.length;
    var barW = Math.min(24, slot * 0.62);

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': summary, class: 'stats-svg' });

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
        'aria-label': it.tip
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
      li.appendChild(el('span', 'rank-no', String(i + 1)));
      li.appendChild(el('span', 'rank-name', r.label));
      // 數值貼在長條末端：長條寬度 = 可用寬度 × 比例，數值跟在後面
      var track = el('span', 'rank-track');
      var bar = el('span', 'rank-bar');
      track.style.setProperty('--w', String(max ? Math.max(r.value / max, r.value > 0 ? 0.02 : 0) : 0));
      track.appendChild(bar);
      track.appendChild(el('span', 'rank-val', fmt(r.value) + ' 次（' + pct(r.value, total) + '%）'));
      li.appendChild(track);
      list.appendChild(li);
      attachTip(card, li, r.label + '：' + fmt(r.value) + ' 次，占 ' + pct(r.value, total) + '%');
    });
    container.appendChild(list);
  }

  // ───────── 回訪：第 1 次、第 2 次、第 3 次、第 4 次以後 ─────────
  // 每個瀏覽器的「第 1 次」只會出現一次，所以第 1 次的筆數約等於不同的手機數；
  // 「第 2 次 ÷ 第 1 次」就是第一次來的手機裡，有多少比例又回來做了第 2 次。
  function returnChart(container, rows, first) {
    clear(container);
    var card = container.closest('.stats-card');
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }));
    var list = el('ol', 'stats-rank');
    rows.forEach(function (r, i) {
      var li = el('li', 'rank-row');
      li.tabIndex = 0;
      li.appendChild(el('span', 'rank-no', String(i + 1)));
      li.appendChild(el('span', 'rank-name', r.label));
      var track = el('span', 'rank-track');
      var bar = el('span', 'rank-bar');
      track.style.setProperty('--w', String(max ? Math.max(r.value / max, r.value > 0 ? 0.02 : 0) : 0));
      track.appendChild(bar);
      var text = fmt(r.value) + ' 次' + (r.ofFirst && first ? '（' + pct(r.value, first) + '%）' : '');
      track.appendChild(el('span', 'rank-val', text));
      li.appendChild(track);
      list.appendChild(li);
      attachTip(card, li, r.label + '：' + text);
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
    try {
      renderChecked();
    } catch (e) {
      showStatus('統計資料的格式讀不懂，請稍後再試。');
    }
  }

  function renderChecked() {
    var a = data && data.apps && data.apps[current];
    if (!a) { showStatus('這個作品目前沒有資料。'); return; }
    if (!Array.isArray(a.byHour) || a.byHour.length !== 24) throw new Error('bad byHour');

    if (!a.total) {
      bodyEl.hidden = true;
      clear(statusEl);
      statusEl.hidden = false;
      statusEl.appendChild(document.createTextNode('還沒有人完成過' + APP_NAME[current] + '。'));
      var link = el('a', null, '去試試看，你可以是第一個');
      link.href = APP_URL[current];
      statusEl.appendChild(document.createTextNode(' '));
      statusEl.appendChild(link);
      return;
    }
    statusEl.hidden = true;
    bodyEl.hidden = false;

    var days = lastDays(30);
    var byDay = a.byDay || {};
    var dayVals = days.map(function (d) { return byDay[d] || 0; });
    var last7 = sum(dayVals.slice(-7));
    var hours = a.byHour || [];
    var peak = hours.reduce(function (best, v, i) { return v > hours[best] ? i : best; }, 0);

    // 重點數字
    var tiles = document.getElementById('stats-tiles');
    clear(tiles);
    tiles.appendChild(tile('累計完成', fmt(a.total) + ' 次'));
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
      '「' + best.p.name + '」（' + best.p.range + '）最多，占 ' + pct(best.v, a.total) + '%。' +
      shares.filter(function (s) { return s !== best; }).map(function (s) {
        return s.p.name + ' ' + pct(s.v, a.total) + '%';
      }).join('、') + '。';

    // 課程排行榜（只有有固定課程的作品才有）
    var courseCard = document.getElementById('card-courses');
    var courses = a.byCourse || {};
    var courseKeys = Object.keys(courses);
    var rows = [];
    if (courseKeys.length) {
      courseCard.hidden = false;
      rows = courseKeys.map(function (k) { return { label: COURSE_NAME[k] || k, value: courses[k] }; })
        .sort(function (x, y) { return y.value - x.value; });
      rankChart(document.getElementById('chart-courses'), rows);
    } else {
      courseCard.hidden = true;
    }

    // 回訪（舊版收集端沒有這個欄位時，整張卡片不顯示）
    var returnCard = document.getElementById('card-return');
    var nth = a.byNth || {};
    var n1 = Number(nth['1']) || 0, n2 = Number(nth['2']) || 0, n3 = Number(nth['3']) || 0, n4 = Number(nth['4+']) || 0;
    var returnRows = [];
    if (n1 + n2 + n3 + n4 === 0) {
      returnCard.hidden = true;
    } else {
      returnCard.hidden = false;
      returnRows = [
        { label: '第 1 次', value: n1, ofFirst: true },
        { label: '第 2 次', value: n2, ofFirst: true },
        { label: '第 3 次', value: n3, ofFirst: true },
        { label: '第 4 次以後', value: n4, ofFirst: false }
      ];
      returnChart(document.getElementById('chart-return'), returnRows, n1);
      var insight = n1
        ? '第一次來的手機裡，有 ' + pct(n2, n1) + '% 又回來做了第 2 次' +
          (n2 ? '；做過第 2 次的，有 ' + pct(n3, n2) + '% 做到第 3 次' : '') + '。'
        : '還沒有第 1 次完成的紀錄。';
      if (n1 > 0 && n1 < 20) insight += ' 目前只有 ' + n1 + ' 筆第 1 次，樣本太少，比例先別當真。';
      document.getElementById('insight-return').textContent = insight;
      var unknown = Number(a.nthUnknown) || 0;
      document.getElementById('note-return').textContent =
        '換手機或清除瀏覽資料會被當成新的人，最近才第一次來的還沒有機會回來，所以這個比例通常會偏低。' +
        (unknown ? '更早的 ' + fmt(unknown) + ' 筆沒有這項資料，沒有算進來。' : '');
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

    if (returnRows.length) {
      tables.appendChild(table('回訪（同一支手機第幾次完成）', ['第幾次', '次數'],
        returnRows.map(function (r) { return [r.label, fmt(r.value)]; })));
    }

    // 更新時間
    if (data.updated) {
      var t = new Date(data.updated);
      if (!isNaN(t)) updatedEl.textContent = '資料更新於 ' + timeFmt.format(t) + '（台北時間）';
    }
  }

  function showStatus(msg) {
    bodyEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = msg;
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      current = tab.dataset.app;
      tabs.forEach(function (t) { t.setAttribute('aria-pressed', String(t === tab)); });
      if (data) render();
    });
  });

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
    .then(function (j) { clearTimeout(timer); data = j; render(); })
    .catch(function () { clearTimeout(timer); showStatus('暫時讀不到統計資料，請稍後再試。'); });
})();
