# cornming.github.io

我的個人作品集網站：<https://cornming.github.io>

用 Jekyll 寫的靜態網站，GitHub Pages 會自動建置，不需要另外設定 Actions。推上 `main` 之後，一兩分鐘網站就會更新。

## 新增一件作品

打開 [`_data/projects.yml`](_data/projects.yml)，複製其中一段、改成新作品的內容即可，欄位說明寫在檔案最上面。

```yaml
- name: 作品名稱
  en: repo-name
  categories: [web]
  summary: 一兩句話說明這是什麼。
  highlights:
    - 重點一
    - 重點二
  tech: [JavaScript]
  image: /assets/img/projects/your-image.jpg   # 沒有圖就拿掉這行，改用 icon + accent
  links:
    - label: 線上試用
      url: https://cornming.github.io/repo-name/
    - label: 原始碼
      url: https://github.com/cornming/repo-name
```

- 卡片的順序就是檔案裡的順序。
- 封面圖建議 16:10（例如 1600×1000），放進 `assets/img/projects/`。
- 分類定義在 [`_data/categories.yml`](_data/categories.yml)，可以自己新增。

## 寫一篇文章

在 `_posts/` 新增 `YYYY-MM-DD-英文網址.md`，可以參考 [`_drafts/文章範本.md`](_drafts/文章範本.md)。
只要有一篇文章，導覽列就會自動出現「文章」，首頁也會顯示最新三篇。

## 修改個人資訊

名稱、地區、頭像、網站說明都在 [`_config.yml`](_config.yml)；首頁的自我介紹在 [`index.html`](index.html) 最上面。

## 在自己電腦上預覽

需要 Ruby。

```bash
bundle install
bundle exec jekyll serve
# 打開 http://localhost:4000
```
