// 深色／淺色切換：預設跟隨系統，按下後記住選擇
(function () {
  var root = document.documentElement;
  var btn = document.querySelector('.theme-toggle');
  if (!btn) return;
  var media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function currentTheme() {
    if (root.dataset.theme === 'dark' || root.dataset.theme === 'light') return root.dataset.theme;
    return media && media.matches ? 'dark' : 'light';
  }

  function syncButton() {
    var dark = currentTheme() === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? '目前為深色模式，點擊切換為淺色模式' : '目前為淺色模式，點擊切換為深色模式');
  }

  syncButton();
  if (media) {
    var onMediaChange = function () {
      if (!root.dataset.theme) syncButton();
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onMediaChange);
    else if (typeof media.addListener === 'function') media.addListener(onMediaChange);
  }

  btn.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
    syncButton();
  });
})();

// 作品分類篩選
(function () {
  var chips = document.querySelectorAll('.filters .chip');
  var cards = document.querySelectorAll('.grid .card');
  var empty = document.querySelector('.empty-filter');
  var status = document.querySelector('.filters-status');
  if (!chips.length) return;
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var f = chip.dataset.filter;
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
      var shown = 0;
      cards.forEach(function (card) {
        var match = f === 'all' || (' ' + card.dataset.cats + ' ').indexOf(' ' + f + ' ') !== -1;
        card.hidden = !match;
        if (match) shown++;
      });
      if (empty) empty.hidden = shown !== 0;
      if (status) {
        status.textContent = f === 'all'
          ? '顯示全部 ' + shown + ' 件作品'
          : '分類「' + chip.textContent + '」共顯示 ' + shown + ' 件作品';
      }
    });
  });
})();
