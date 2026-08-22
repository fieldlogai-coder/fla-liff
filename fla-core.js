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

  // LINE ID トークン → auth-session → Supabase JWT。期限が近ければ再取得。
  async function ensureToken() {
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
    if (!res.ok) throw new Error(`認証に失敗しました (HTTP ${res.status})`);
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

  // HTML エスケープ（属性・テキスト共用。' も含める）
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  global.FLA = { SUPA_URL, SUPA_ANON, AUTH_FN, ensureToken, rest, esc, billingPeriod };
})(window);
