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
    return res;
  }

  // HTML エスケープ（属性・テキスト共用。' も含める）
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  global.FLA = { SUPA_URL, SUPA_ANON, AUTH_FN, ensureToken, rest, esc };
})(window);
