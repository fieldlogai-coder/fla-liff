/* fla-support.js — 「困ったときは」問い合わせ先（2026-10-30）
   正本: liff/ 側（アプリ本体も使うため）。docs/poc-kit/html/ へは sync-poc-kit.js がプレビュー用に複製する。
   運営用の LINE 公式アカウント「FIELDLOG サポート」のトークを、一言入りで開く。
   SUPPORT_ID が空のあいだは何も表示しない（アカウント作成前でも壊れない）。
   使い方:
     <script src="./fla-support.js?v=YYYY-MM-DD"></script> を読み込むと、ページの一番下に帯が付く。
     帯を付けたくないページは <body data-support="off">。
     自分で置きたい所には <div data-support-slot></div> を置く（そこに入り、一番下には付かない）。 */
(function (global) {
  // ★ FIELDLOG サポートのベーシックID（@から始まる）。決まったらここだけ書き換える
  const SUPPORT_ID_RAW = "@556axvhf";
  // @ と英数字・記号 ._- だけを受け付ける（それ以外なら表示しない）
  const SUPPORT_ID = /^@[A-Za-z0-9._-]{3,20}$/.test(SUPPORT_ID_RAW) ? SUPPORT_ID_RAW : "";

  const PREFILL = "FIELDLOG についての問い合わせです。\n会社名：\nお名前：\n内容：";

  function url(text) {
    if (!SUPPORT_ID) return "";
    return "https://line.me/R/oaMessage/" + SUPPORT_ID + "/?" + encodeURIComponent(text || PREFILL);
  }

  // 帯の HTML。色はページに依存しないよう直書き（どのページでも読めるコントラスト）
  function html() {
    if (!SUPPORT_ID) return "";
    return '<div class="fla-support" style="max-width:520px;margin:18px auto 0;padding:14px 16px calc(90px + env(safe-area-inset-bottom));text-align:center;font-family:inherit;color:#6b6a63;font-size:12.5px;line-height:1.8">' +
      '<div style="font-weight:bold;color:#1f1e1c;margin-bottom:6px">困ったときは</div>' +
      '<a href="' + url() + '" style="display:inline-block;background:#06c755;color:#fff;text-decoration:none;font-weight:bold;padding:9px 18px;border-radius:999px;font-size:13.5px">💬 LINEで運営に問い合わせる</a>' +
      '<div style="margin-top:6px">FIELDLOG サポート（ID ' + SUPPORT_ID.replace(/[<>&"']/g, "") + '）に届きます。<br>友だち追加の画面が出たら、追加してから送ってください。</div></div>';
  }

  function mount() {
    if (!SUPPORT_ID || !document.body) return;
    const slots = document.querySelectorAll("[data-support-slot]");
    if (slots.length) { slots.forEach(function (s) { s.innerHTML = html(); }); return; }
    if (document.body.getAttribute("data-support") === "off") return;
    if (document.querySelector(".fla-support")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = html();
    document.body.appendChild(wrap.firstChild);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  global.FLA_SUPPORT = { id: SUPPORT_ID, url: url, html: html, mount: mount };
})(window);
