// 用法：node tests/site.test.js
// 檢查統計前端計算工具函式與 _data/ 作品清單、封面圖片參照的一致性。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const statsHelpers = require(path.join(root, 'assets/js/stats.js'));

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('✓', name);
}

ok('stats helper: niceMax 刻度永遠是 4 的倍數或 1/2/5×10^k', () => {
  assert.strictEqual(statsHelpers.niceMax(0), 4);
  assert.strictEqual(statsHelpers.niceMax(NaN), 4);
  assert.strictEqual(statsHelpers.niceMax(13), 16);
  assert.strictEqual(statsHelpers.niceMax(20), 20);
  assert.strictEqual(statsHelpers.niceMax(21), 50);
  assert.strictEqual(statsHelpers.niceMax(195), 200);
  assert.strictEqual(statsHelpers.niceMax(499), 500);
  assert.strictEqual(statsHelpers.niceMax(501), 1000);
});

ok('stats helper: appFromHash 安全比對已知代號且不受原型鏈影響', () => {
  assert.strictEqual(statsHelpers.appFromHash('#night-yoga'), 'night-yoga');
  assert.strictEqual(statsHelpers.appFromHash('#slowjog-android'), 'slowjog-android');
  assert.strictEqual(statsHelpers.appFromHash('#unknown'), null);
  assert.strictEqual(statsHelpers.appFromHash('#toString'), null);
  assert.strictEqual(statsHelpers.appFromHash('#constructor'), null);
});

ok('stats helper: lastDays 依台北時區由舊到新產生不重複日期', () => {
  // 2026-11-14T00:10:00Z = 台北 2026-11-14 08:10
  const days = statsHelpers.lastDays(3, Date.parse('2026-11-14T00:10:00Z'));
  assert.deepStrictEqual(days, ['2026-11-12', '2026-11-13', '2026-11-14']);
});

ok('stats helper: numOrZero / sum / pct 排除無效值與負數', () => {
  assert.strictEqual(statsHelpers.numOrZero(-5), 0);
  assert.strictEqual(statsHelpers.numOrZero(NaN), 0);
  assert.strictEqual(statsHelpers.numOrZero('42'), 42);
  assert.strictEqual(statsHelpers.sum([10, -2, '5', null]), 15);
  assert.strictEqual(statsHelpers.pct(5, 0), 0);
  assert.strictEqual(statsHelpers.pct(1, 3), 33);
});

ok('site.js 語法可解析', () => {
  const vm = require('vm');
  new vm.Script(fs.readFileSync(path.join(root, 'assets/js/site.js'), 'utf8'));
});

ok('YAML 資料與作品封面圖檔一致且分類鍵存在', () => {
  const rawJson = execFileSync(
    'ruby',
    [
      '-ryaml',
      '-rjson',
      '-e',
      'puts JSON.generate({categories: YAML.load_file("_data/categories.yml"), projects: YAML.load_file("_data/projects.yml"), more: YAML.load_file("_data/more_projects.yml")})'
    ],
    { cwd: root, encoding: 'utf8' }
  );
  const data = JSON.parse(rawJson);
  const catKeys = new Set(data.categories.map((c) => c.key));
  assert.ok(catKeys.size > 0, 'categories.yml 不可為空');

  for (const p of data.projects) {
    assert.ok(p.name && typeof p.name === 'string', '每個作品必須有 name');
    assert.ok(p.summary && typeof p.summary === 'string', `${p.name} 必須有 summary`);
    assert.ok(Array.isArray(p.categories) && p.categories.length > 0, `${p.name} 必須有 categories`);
    for (const c of p.categories) {
      assert.ok(catKeys.has(c), `${p.name} 使用了未定義的分類 ${c}`);
    }
    if (p.image) {
      const imgPath = path.join(root, p.image.replace(/^\//, ''));
      assert.ok(fs.existsSync(imgPath), `找不到封面圖片：${p.image}`);
    }
    if (p.links) {
      for (const l of p.links) {
        assert.ok(l.label && l.url, `${p.name} 連結缺欄位`);
      }
    }
  }
  for (const m of data.more) {
    assert.ok(m.name && m.summary, 'more_projects 每筆都要有 name 與 summary');
  }
});

console.log('\n全部 ' + passed + ' 項通過');
