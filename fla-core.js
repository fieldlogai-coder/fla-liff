// fla-core.js — FLA LIFF 共通基盤（認証・REST・定数・エスケープ）
// 各LIFF(HTML)は「LIFF SDK → fla-core.js → ページ内スクリプト」の順で読み込むこと。
// キャッシュ対策のため <script src="./fla-core.js?v=YYYYMMDD"> のようにバージョンを付ける。
// 設計: docs/PRODUCT_SPLIT_ARCHITECTURE_2026-06-21.md（移行プラン①共通基盤抽出）
(function (global) {
  "use strict";

  const SUPA_URL  = "https://qxeqaqnzbsuykmzwkvhx.supabase.co";
  const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4ZXFhcW56YnN1eWttendrdmh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDQzNDQsImV4cCI6MjA4OTcyMDM0NH0.jbXmGxpT2ZZ5DtB590-5GH-Pt3ofVNIsysL-ybq1v18";
  const AUTH_FN   = `${SUPA_URL}/functions/v1/auth-session`;

  let flaToken    = "";   // Supabase JWT（auth-session 発行・role=authenticated）
  let flaTokenExp = 0;    // 失効時刻（ms epoch）。余裕をもって再取得する
  let flaFixed    = false; // 運営の「見るだけ」（support-access が出した証明を使う。auth-session は呼ばない）

  // 直前のエラーを覚えておく（「今の画面を運営に送る」で一緒に送る・2026-11-01）。最大10件・中身は短く切る
  const recent = [];
  function remember(kind, msg) {
    try {
      recent.push({ at: new Date().toISOString(), kind: kind, msg: String(msg == null ? "" : msg).slice(0, 300) });
      if (recent.length > 10) recent.shift();
    } catch (_e) { /* 無視 */ }
  }
  global.addEventListener("error", function (e) { remember("error", (e && e.message) || "error"); });
  global.addEventListener("unhandledrejection", function (e) { remember("promise", e && e.reason && (e.reason.message || e.reason)); });
  // 画面に出したエラーの表示（各画面の toast(…, true)）も拾う
  (function () {
    const orig = console.error;
    console.error = function () {
      try { remember("console", Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : (typeof a === "string" ? a : JSON.stringify(a)); }).join(" ")); } catch (_e) { /* 無視 */ }
      return orig.apply(console, arguments);
    };
  })();

  // 運営の「見るだけ」用：渡された証明をそのまま使う（期限が来たら開き直してもらう）
  function useToken(token, expiresIn) {
    flaToken = token; flaTokenExp = Date.now() + (Number(expiresIn) || 3600) * 1000; flaFixed = true;
  }

  // 運営の「見るだけ」で開く共通の入口（2026-11-01・ダッシュボード／現場メモ／登録で使う。請求は billing.html に自前の版あり）
  //   supportCompanyId() … URL の ?support=会社ID（無ければ null）
  //   openSupport(cid, need) … EF support-access で「見るだけ」の証明をもらい useToken する。
  //     need="all" のときは、お客さんが「全部」を選んでいないと開かない。失敗は Error(画面に出す文)。
  //   戻り値 { company_name, grant_expires_at, scope }。画面の上に紫の帯を出し、body に support-mode を付ける
  function supportCompanyId() {
    const v = new URLSearchParams(global.location.search).get("support");
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  }
  async function openSupport(cid, need) {
    let res;
    try {
      res = await fetch(`${SUPA_URL}/functions/v1/support-access`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session", id_token: liff.getIDToken(), company_id: cid }) });
    } catch (_e) { throw new Error("通信できませんでした。開き直してください。"); }
    if (res.status === 403) {
      const e = (await res.json().catch(() => ({}))).error;
      throw new Error(e === "no grant" ? "この会社からの許可がありません（期限切れ・取り消しを含む）。お客さんに設定の画面で「運営に見せる」を押してもらってください。" : "この画面は運営専用です。");
    }
    if (!res.ok) throw new Error(`開けませんでした（HTTP ${res.status}）。`);
    const d = await res.json();
    if (need === "all" && d.scope !== "all") throw new Error("この会社は「請求だけ」を見せる許可です。この画面を見るには、お客さんに設定の画面で範囲を「全部」にしてもらってください。");
    useToken(d.access_token, d.expires_in);
    global.document.body.classList.add("support-mode");
    const bar = global.document.createElement("div");
    bar.className = "fla-support-bar no-print";
    bar.setAttribute("style", "position:sticky;top:0;z-index:150;background:#5b3fd0;color:#fff;font-size:13px;line-height:1.6;padding:8px 14px;text-align:center");
    const until = d.grant_expires_at ? new Date(d.grant_expires_at).toLocaleDateString("ja-JP") : "";
    bar.textContent = `👀 運営が見ています（見るだけ）｜${d.company_name || ""}｜許可は ${until} まで・この画面は1時間で閉じます`;
    global.document.body.prepend(bar);
    return d;
  }

  // LINE ID トークン → auth-session → Supabase JWT。期限が近ければ再取得。
  async function ensureToken() {
    if (flaFixed) {
      if (flaToken && Date.now() < flaTokenExp) return flaToken;
      throw new Error("見るための期限（1時間）が切れました。運営ダッシュボードから開き直してください");
    }
    if (flaToken && Date.now() < flaTokenExp - 60000) return flaToken;
    const idToken = liff.getIDToken();
    if (!idToken) throw new Error("IDトークンを取得できません（再ログインしてください）");
    // auth-session(EF) は Authorization の anon JWT だけで通る。apikey を送ると CORS 許可ヘッダ外で
    // プリフライトに弾かれる（"Load failed"）ため、ここでは apikey を付けない。
    const res = await fetch(AUTH_FN, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SUPA_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch (_e) { /* 本文なし */ }
      // 未登録ユーザーは auth-session が 401 "worker not registered" を返す。
      // 各LIFFの初期化catchで FLA.notRegisteredHtml() の案内を出す（「初期化に失敗」と誤解させない）。
      if (res.status === 401 && detail === "worker not registered") {
        const err = new Error("この画面は利用登録済みの方専用です");
        err.code = "NOT_REGISTERED";
        throw err;
      }
      throw new Error(`認証に失敗しました (HTTP ${res.status}${detail ? "・" + detail : ""})`);
    }
    const data = await res.json();
    flaToken = data.access_token;
    flaTokenExp = Date.now() + ((data.expires_in ?? 3600) * 1000);
    return flaToken;
  }

  // PoC観測キット: LIFFのREST失敗を app_events に記録（fire-and-forget・失敗は無視）
  function logEvent(kind, detail) {
    try {
      fetch(`${SUPA_URL}/rest/v1/app_events`, {
        method: "POST",
        headers: { "apikey": SUPA_ANON, "Authorization": `Bearer ${flaToken}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ level: "error", kind, detail }),
      }).catch(function () { /* 記録失敗は無視 */ });
    } catch (_e) { /* 記録失敗は無視 */ }
  }

  // REST 呼び出し: apikey=anon 据え置き、Authorization=user JWT。401（期限切れ等）は1回だけ再取得して再試行。
  // path は "/workers?..." のように /rest/v1 以下を渡す。init は fetch と同じ（method/headers/body）。
  // ※ 写真アップロード(Storage) は anon のままにしたい箇所があるため、それは本ヘルパーを通さないこと。
  async function rest(path, init = {}) {
    await ensureToken();
    const run = () => fetch(`${SUPA_URL}/rest/v1${path}`, {
      ...init,
      headers: { "apikey": SUPA_ANON, "Authorization": `Bearer ${flaToken}`, ...(init.headers || {}) },
    });
    let res = await run();
    if (res.status === 401) { flaToken = ""; await ensureToken(); res = await run(); }
    // 409(重複=UIで案内済み) と app_events 自身は記録しない（ノイズ・再帰防止）
    if (!res.ok) remember("fetch", (init.method || "GET") + " " + path.split("?")[0] + " → " + res.status);
    if (!res.ok && res.status !== 409 && path.indexOf("/app_events") !== 0) {
      logEvent("liff_fetch_failed", {
        path: path.split("?")[0],
        method: (init.method || "GET"),
        status: res.status,
        page: (location.pathname.split("/").pop() || ""),
      });
    }
    return res;
  }

  // 締め日連動の請求期間（M3.5-a・案A=直近に締めた期間）
  // closingDay が null または 28以上 → 末日締め（前月1日〜前月末日）
  // closingDay=D(1〜27) → 実行日がD日以降なら当月D日締め・D日より前なら前月D日締め
  //   （期間＝締め月の前月(D+1)日 〜 締め月D日）
  // ※ billing.html の同名関数と同一ロジック（請求発行の二重発行ガードと期間を一致させるため）。
  //   billing.html 側はページ内に同じ関数を持ったまま（退行回避）。統合は次の機会に。
  function billingPeriod(closingDay, now = new Date()) {
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate(); // m は 0-based
    const iso = (yy, mm, dd) => `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const lastDay = (yy, mm) => new Date(yy, mm + 1, 0).getDate();
    const cd = (closingDay == null || closingDay >= 28) ? null : closingDay;
    if (cd === null) {
      const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
      return { periodStart: iso(py, pm, 1), periodEnd: iso(py, pm, lastDay(py, pm)) };
    }
    let ey = y, em = m;
    if (d < cd) { em = m - 1; if (em < 0) { em = 11; ey = y - 1; } }
    let sy = ey, sm = em - 1; if (sm < 0) { sm = 11; sy = ey - 1; }
    return { periodStart: iso(sy, sm, cd + 1), periodEnd: iso(ey, em, cd) };
  }

  // 未登録ユーザー向けの案内（各LIFFの初期化catchで #loading に流し込んで使う）
  function notRegisteredHtml() {
    return '<div style="max-width:420px;margin:0 auto;padding:0 16px;text-align:left;font-size:14px;line-height:1.9;color:#1f1e1c">' +
      '<div style="font-size:16px;font-weight:bold;margin-bottom:8px">この画面は、利用登録済みの方専用です</div>' +
      '<div>お使いのLINEアカウントは、まだFIELDLOGに登録されていません。</div>' +
      '<div style="background:#f4f3ed;border-radius:10px;padding:10px 14px;margin:10px 0">' +
      '<b>登録のしかた</b>：FIELDLOGのトークに「<b>合言葉</b>」→「<b>お名前</b>」の順に送信（合言葉は会社の担当者にご確認ください）</div>' +
      '<div>どんな画面か見てみたい方は：<br>' +
      '<a href="https://fieldlogai-coder.github.io/fla-liff/demo.html" style="color:#1d9e75;font-weight:bold">🖐 さわれるデモ（登録不要・架空データ）</a><br>' +
      '<a href="https://fieldlogai-coder.github.io/fla-liff/" style="color:#1d9e75;font-weight:bold">📚 資料室（説明資料・使い方）</a></div>' +
      // 問い合わせ先（fla-support.js が読み込まれていて ID が決まっているときだけ）
      (global.FLA_SUPPORT && global.FLA_SUPPORT.id
        ? '<div style="margin-top:10px">登録できないときは：<br><a href="' + global.FLA_SUPPORT.url() + '" style="color:#1d9e75;font-weight:bold">💬 LINEで運営に問い合わせる</a></div>'
        : '') +
      '</div>';
  }

  // HTML エスケープ（属性・テキスト共用。' も含める）
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  const recentErrors = () => recent.slice();
  const isSupportView = () => flaFixed;
  global.FLA = { SUPA_URL, SUPA_ANON, AUTH_FN, ensureToken, useToken, rest, esc, billingPeriod, notRegisteredHtml, recentErrors, remember, isSupportView, supportCompanyId, openSupport };
})(window);
