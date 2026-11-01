/* fla-support.js — 「困ったときは」問い合わせ先（2026-10-30）
   正本: liff/ 側（アプリ本体も使うため）。docs/poc-kit/html/ へは sync-poc-kit.js がプレビュー用に複製する。
   FIELDLOG 本体の LINE トークを、一言入りで開く（2026-11-01 から。質問には AI が答え、分からないものは担当に回る）。
   運営用アカウント「FIELDLOG サポート」は運営専用なので、お客さんは案内しない。
   SUPPORT_ID が空のあいだは何も表示しない（アカウント作成前でも壊れない）。
   使い方:
     <script src="./fla-support.js?v=YYYY-MM-DD"></script> を読み込むと、ページの一番下に帯が付く。
     帯を付けたくないページは <body data-support="off">。
     自分で置きたい所には <div data-support-slot></div> を置く（そこに入り、一番下には付かない）。
   2026-11-01: アプリの画面（請求・ダッシュボード・設定・現場メモ）では「📨 今の画面を運営に送る」も出す。
     押すと画面の画像を作り、送る内容を見せてから、お客さんが「送る」を押したときだけ EF support-snap へ送る。
     運営の「見るだけ」（FLA.isSupportView）では出さない。 */
(function (global) {
  // ★ 問い合わせ先＝FIELDLOG 本体のベーシックID（@から始まる）
  const SUPPORT_ID_RAW = "@165bmpmn";
  // @ と英数字・記号 ._- だけを受け付ける（それ以外なら表示しない）
  const SUPPORT_ID = /^@[A-Za-z0-9._-]{3,20}$/.test(SUPPORT_ID_RAW) ? SUPPORT_ID_RAW : "";

  const PREFILL = "使い方の質問です：";

  function url(text) {
    if (!SUPPORT_ID) return "";
    return "https://line.me/R/oaMessage/" + SUPPORT_ID + "/?" + encodeURIComponent(text || PREFILL);
  }

  // ── 今の画面を運営に送る（2026-11-01）──────────────────────────────
  const SNAP_PAGES = { "billing.html": "billing", "dashboard.html": "dashboard", "settings.html": "settings", "site-memo.html": "site-memo" };
  const SNAP_FN = "https://qxeqaqnzbsuykmzwkvhx.supabase.co/functions/v1/support-snap";
  const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  function snapPage() { return SNAP_PAGES[(location.pathname.split("/").pop() || "").toLowerCase()] || ""; }
  function canSnap() { return !!(snapPage() && global.FLA && global.FLA.ensureToken && !(global.FLA.isSupportView && global.FLA.isSupportView())); }
  const escH = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const visible = (el) => !!(el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden");

  // 画面の中の場所：見出し・選んでいるタブ・開いている小窓の見出し（文字だけ・短く）
  function place() {
    const parts = [];
    const h1 = Array.from(document.querySelectorAll("header h1, h1")).find(visible);
    if (h1) parts.push(h1.textContent.trim());
    document.querySelectorAll(".tab.active, .tabs .active, [aria-selected='true']").forEach((t) => { if (visible(t)) parts.push(t.textContent.trim()); });
    const modal = Array.from(document.querySelectorAll("#modal.open .modal-title, .sheet.open h2, .modal.open h2, [role='dialog'] h2")).find(visible);
    if (modal) parts.push("小窓：" + modal.textContent.trim());
    return Array.from(new Set(parts.filter(Boolean))).join(" ／ ").slice(0, 200);
  }
  // 画面に出た赤いお知らせ（toast の err）も覚えておく
  function watchToasts() {
    const t = document.getElementById("toast");
    if (!t || !global.FLA || !global.FLA.remember || t.__flaWatched) return;
    t.__flaWatched = true;
    new MutationObserver(() => { if (/\berr\b/.test(t.className) && /\bshow\b/.test(t.className)) global.FLA.remember("toast", t.textContent); })
      .observe(t, { attributes: true, attributeFilter: ["class"] });
  }
  function loadH2C() {
    if (global.html2canvas) return Promise.resolve();
    return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = H2C; sc.onload = () => res(); sc.onerror = () => rej(new Error("load")); document.head.appendChild(sc); });
  }
  // 画面の画像（ページ全体・横幅は最大720px・縦は最大4000px 分）。失敗したら画像なしで送れる
  async function capture() {
    try {
      await loadH2C();
      const W = document.documentElement.clientWidth, H = Math.min(document.documentElement.scrollHeight, 4000);
      const scale = Math.min(1.5, 720 / Math.max(W, 1));
      const box = document.getElementById("fla-snap");
      const cv = await global.html2canvas(document.body, { scale, width: W, height: H, windowWidth: W, x: 0, y: 0, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff", logging: false,
        ignoreElements: (el) => el === box || (el.classList && el.classList.contains("fla-support")) });
      let q = 0.7, url = cv.toDataURL("image/jpeg", q);
      while (url.length > 2_600_000 && q > 0.3) { q -= 0.15; url = cv.toDataURL("image/jpeg", q); }
      return url.length > 2_600_000 ? null : url;
    } catch (_e) { return null; }
  }
  function closeSnap() { const b = document.getElementById("fla-snap"); if (b) b.remove(); }
  async function openSnap() {
    if (document.getElementById("fla-snap")) return;
    const where = place();
    const errs = (global.FLA.recentErrors && global.FLA.recentErrors()) || [];
    const box = document.createElement("div");
    box.id = "fla-snap";
    box.setAttribute("style", "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center;font-family:inherit");
    box.innerHTML = '<div style="background:#fff;color:#1f1e1c;width:100%;max-width:520px;max-height:90vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));box-sizing:border-box;font-size:13.5px;line-height:1.7">' +
      '<div style="font-size:16px;font-weight:bold;margin-bottom:6px">今の画面を運営に送る</div>' +
      '<div style="color:#6b6a63;font-size:12.5px">次の内容が運営に届きます。送ったものは問い合わせの対応にだけ使い、30日で消えます。</div>' +
      '<div id="fla-snap-img" style="margin:10px 0;background:#f4f3ed;border-radius:10px;padding:8px;text-align:center;color:#6b6a63;font-size:12.5px">画面の画像を作っています…</div>' +
      '<div style="font-size:12.5px"><b>画面：</b>' + escH(where || "（不明）") + '<br><b>直前のエラー：</b>' + (errs.length ? escH(errs.length + "件（" + errs[errs.length - 1].msg.slice(0, 60) + "）") : "なし") + '</div>' +
      '<label style="display:block;margin-top:10px;font-weight:bold">一言（なくても送れます）</label>' +
      '<textarea id="fla-snap-cmt" maxlength="300" rows="2" placeholder="例：発行のボタンが押せない" style="width:100%;box-sizing:border-box;border:1px solid #e2e0d8;border-radius:10px;padding:8px 10px;font:inherit;font-size:14px"></textarea>' +
      '<div style="display:flex;gap:10px;margin-top:12px"><button id="fla-snap-no" style="flex:1;padding:12px;border:none;border-radius:12px;background:#f0eee6;color:#555;font:inherit;font-weight:bold">やめる</button>' +
      '<button id="fla-snap-go" disabled style="flex:1;padding:12px;border:none;border-radius:12px;background:#06c755;color:#fff;font:inherit;font-weight:bold;opacity:.5">送る</button></div>' +
      '<div id="fla-snap-msg" style="margin-top:8px;font-size:12.5px;color:#6b6a63"></div></div>';
    box.addEventListener("click", (e) => { if (e.target === box) closeSnap(); });
    document.body.appendChild(box);
    document.getElementById("fla-snap-no").onclick = closeSnap;
    const go = document.getElementById("fla-snap-go");
    const img = await capture();
    if (!document.getElementById("fla-snap")) return;
    document.getElementById("fla-snap-img").innerHTML = img
      ? '<img src="' + img + '" alt="送る画面" style="max-width:100%;max-height:36vh;border:1px solid #e2e0d8;border-radius:6px">'
      : "画面の画像は作れませんでした（文字の情報だけ送ります）";
    go.disabled = false; go.style.opacity = "1";
    go.onclick = async () => {
      go.disabled = true; go.style.opacity = ".5"; go.textContent = "送っています…";
      const msg = document.getElementById("fla-snap-msg");
      try {
        const token = await global.FLA.ensureToken();
        const res = await fetch(SNAP_FN, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send", page: snapPage(), place: where, comment: document.getElementById("fla-snap-cmt").value,
            info: { errors: errs, url: location.pathname + location.search.replace(/([?&])(access_token|id_token|code|state|liff\.[^=]*)=[^&]*/g, "$1"), size: innerWidth + "x" + innerHeight, ua: navigator.userAgent.slice(0, 200) },
            image: img ? img.split(",")[1] : null }) });
        if (res.status === 429) throw new Error("短い時間にたくさん送られています。少し時間をおいてください");
        if (!res.ok) throw new Error("送れませんでした（" + res.status + "）");
        box.firstChild.innerHTML = '<div style="text-align:center;padding:16px 0"><div style="font-size:28px">✅</div><div style="font-weight:bold;font-size:15px;margin-top:6px">運営に届きました</div>' +
          '<div style="color:#6b6a63;font-size:12.5px;margin-top:6px">確認して、FIELDLOG のLINEトークでご連絡します。</div>' +
          '<button style="margin-top:14px;padding:11px 28px;border:none;border-radius:12px;background:#f0eee6;font:inherit;font-weight:bold">閉じる</button></div>';
        box.querySelector("button").onclick = closeSnap;
      } catch (e) {
        msg.style.color = "#c62828"; msg.textContent = (e && e.message) || "送れませんでした";
        go.disabled = false; go.style.opacity = "1"; go.textContent = "送る";
      }
    };
  }

  // 帯の HTML。色はページに依存しないよう直書き（どのページでも読めるコントラスト）
  function html() {
    if (!SUPPORT_ID) return "";
    return '<div class="fla-support" style="max-width:520px;margin:18px auto 0;padding:14px 16px calc(90px + env(safe-area-inset-bottom));text-align:center;font-family:inherit;color:#6b6a63;font-size:12.5px;line-height:1.8">' +
      '<div style="font-weight:bold;color:#1f1e1c;margin-bottom:6px">困ったときは</div>' +
      (canSnap() ? '<button type="button" data-fla-snap style="display:inline-block;background:#fff;color:#1f1e1c;border:1px solid #d9d7cc;font:inherit;font-weight:bold;padding:9px 18px;border-radius:999px;font-size:13.5px;margin-bottom:8px;cursor:pointer">📨 今の画面を運営に送る</button><br>' : "") +
      '<a href="' + url() + '" style="display:inline-block;background:#06c755;color:#fff;text-decoration:none;font-weight:bold;padding:9px 18px;border-radius:999px;font-size:13.5px">💬 LINEで質問する</a>' +
      '<div style="margin-top:6px">FIELDLOG のトークが開きます。質問を送ると AI がすぐ答え、答えられないことは担当からご連絡します。</div></div>';
  }

  // 送るボタンはどこに付いても動くように、押されたときに拾う
  document.addEventListener("click", (e) => { const b = e.target && e.target.closest && e.target.closest("[data-fla-snap]"); if (b && canSnap()) { e.preventDefault(); openSnap(); } });

  function mount() {
    if (!SUPPORT_ID || !document.body) return;
    watchToasts();
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

  global.FLA_SUPPORT = { id: SUPPORT_ID, url: url, html: html, mount: mount, openSnap: openSnap };
})(window);
