/* fla-invoice-layout.js — 元請の指定書式（請求書の型 layout.json）を HTML に描く（④d-2・2026-10-31）
   型は EF invoice-layout から受け取る（その会社の請求の権限がある人だけ）。様式の元ファイルは扱わない。
   使い方:
     const html = FLA_LAYOUT.render(layout, values, { editable: false });
     values = { "company.name": "…", "lines.0.desc": "…", … }（型の slot 名 → 表示する文字）
     FLA_LAYOUT.values(layout, inv, plines, comp, st, subject) で請求データから values を作れる
   直接直せる表（2026-10-31）:
     const sheet = FLA_LAYOUT.mount(箱の要素, layout, values, { params: { "kind.text": "請負請求書" } });
     様式で「入力してよいマス」（型の in）だけをタップして直せる。それ以外は触れない。
     様式の計算式（型の f：SUM・IF・ROUND・四則演算など）を画面の中で計算し直し、計算のマスに出す。
     sheet.setParam(名前, 値) で印刷範囲の外の値（請求書の種類など）を変える。sheet.inputs() で直した値を取り出す。 */
(function (global) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 入力欄の目印（黄色）は、出来上がりの請求書には出さない
  const HINT_FILLS = new Set(["#ffffcc", "#ffff99"]);
  const okColor = (v) => /^#[0-9a-f]{6}$/i.test(v || "") ? v : null;
  const okBorder = (v) => /^\d+px (solid|dashed|dotted|double) #[0-9a-f]{6}$/i.test(v || "") ? v : null;

  // ── 描き方（2026-10-31 改）────────────────────────────────────────────
  // 表（table）の罫線の重ね合わせは、スマホで PDF を作る部品（html2canvas）が二重・太線・途切れに描いてしまう。
  // そこで、マスは位置を決めて置き（Excel と同じ列幅・行の高さ）、罫線は Excel と同じく「境目ごとに1本」を
  // 自分で決めて線として引く（隣り合うマスの線が違うときは太い方）。
  // フォントは様式どおり MS Pゴシック。入っていない端末（スマホ）は文字幅が同じ BIZ UDPゴシック を読み込む。
  const FONT_FAMILY = "'MS PGothic','ＭＳ Ｐゴシック','BIZ UDPGothic',sans-serif";
  const FONT_CSS = "https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap";
  function ensureFont() {
    try {
      if (typeof document === "undefined" || document.querySelector('link[data-fla-font]')) return;
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = FONT_CSS; l.dataset.flaFont = "1";
      document.head.appendChild(l);
    } catch (_e) { /* 読めなくても既定のフォントで描く */ }
  }
  // PDF にする前に、使う文字のフォントを読み終えるまで待つ（最大4秒）
  async function fontsReady(text) {
    ensureFont();
    if (typeof document === "undefined" || !document.fonts || !document.fonts.load) return;
    const t = String(text || "").slice(0, 4000) || "請求書";
    const wait = Promise.all([
      document.fonts.load(`400 12px "BIZ UDPGothic"`, t),
      document.fonts.load(`700 12px "BIZ UDPGothic"`, t),
    ]).then(() => document.fonts.ready).catch(() => {});
    await Promise.race([wait, new Promise((r) => setTimeout(r, 4000))]);
  }
  // 罫線の強さ（重なったときに強い方を残す）：二重線＞太線＞細線、同じ太さなら実線＞破線＞点線
  function borderRank(b) {
    const m = /^(\d+)px (solid|dashed|dotted|double)/.exec(b || ""); if (!m) return 0;
    return (m[2] === "double" ? 100 : 0) + Number(m[1]) * 10 + ({ solid: 3, dashed: 2, dotted: 1, double: 3 })[m[2]];
  }
  const borderW = (b) => { const m = /^(\d+)px/.exec(b || ""); return m ? Number(m[1]) : 0; };
  // 縦書き：1文字ずつ縦に並べる（括弧は縦書き用の形に）
  const VERT_MAP = { "(": "︵", ")": "︶", "（": "︵", "）": "︶", "ー": "｜", "-": "｜", "「": "﹁", "」": "﹂" };
  const toVert = (t) => Array.from(String(t)).map((ch) => VERT_MAP[ch] || ch).join("\n");

  function render(layout, values, opts) {
    opts = opts || {};
    values = values || {};
    ensureFont();
    const nC = layout.cols.length, nR = layout.rows.length;
    const PT = 4 / 3; // 行の高さ pt → px
    const X = [0]; for (let c = 0; c < nC; c++) X.push(X[c] + layout.cols[c]);
    const Y = [0]; for (let r = 0; r < nR; r++) Y.push(Y[r] + layout.rows[r] * PT);
    const W = X[nC], H = Y[nR];
    const px = (n) => Math.round(n * 100) / 100 + "px";
    // 境目ごとの罫線：横線 hE["r,c"]＝r 行目の上の線（c 列ぶん）、縦線 vE["r,c"]＝c 列目の左の線（r 行ぶん）
    const hE = {}, vE = {};
    const put = (m, k, b) => { const ok = okBorder(b); if (ok && borderRank(ok) > borderRank(m[k])) m[k] = ok; };
    let cellsHtml = "";
    for (const cell of layout.cells) {
      const s = cell.s || {}, r0 = cell.r, c0 = cell.c, rs = cell.rs || 1, cs = cell.cs || 1;
      for (let c = c0; c < c0 + cs; c++) { put(hE, r0 + "," + c, s.bt); put(hE, (r0 + rs) + "," + c, s.bb); }
      for (let r = r0; r < r0 + rs; r++) { put(vE, r + "," + c0, s.bl); put(vE, r + "," + (c0 + cs), s.br); }
      const x = X[c0], y = Y[r0], w = X[c0 + cs] - x, h = Y[r0 + rs] - y;
      if (w <= 0 || h <= 0) continue;
      let text = cell.slot ? (values[cell.slot] ?? "") : (cell.text ?? "");
      let attr = "";
      if (opts.editable && cell.a) {
        if (cell.in && !(opts.locked && opts.locked.has(cell.a))) attr = ` data-a="${esc(cell.a)}" class="fla-in" contenteditable="true" spellcheck="false" inputmode="${cell.z ? "decimal" : "text"}"`;
        else if (cell.in) attr = ` data-a="${esc(cell.a)}" class="fla-lock"`;
        else if (cell.f) { attr = ` data-a="${esc(cell.a)}" class="fla-f"`; text = ""; }
      }
      const fs = Math.min(Math.max(+s.fs || 11, 5), 40);
      let size = fs;
      const st = [`left:${px(x)}`, `top:${px(y)}`, `width:${px(w)}`, `height:${px(h)}`];
      const hAlign = ["left", "center", "right", "justify"].includes(s.h) ? s.h : (cell.z && !s.vert ? "right" : "left");
      const vAlign = ["top", "middle", "bottom"].includes(s.v) ? s.v : "bottom";
      st.push(`align-items:${{ top: "flex-start", middle: "center", bottom: "flex-end" }[vAlign]}`);
      st.push(`justify-content:${{ left: "flex-start", justify: "flex-start", center: "center", right: "flex-end" }[hAlign]}`);
      st.push(`text-align:${hAlign}`);
      if (s.vert) {
        // 縦書き：高さに入る文字数を超えるときだけ小さく
        const n = Array.from(String(text)).length;
        const room = (h - 2) / (fs * PT * 1.05);
        if (n > room && n) size = Math.max(4, (fs * room) / n);
        text = toVert(text);
        st.push("white-space:pre;line-height:1.05;justify-content:center;text-align:center");
      } else {
        if (s.shrink && text) {
          const room = (w - 4) / (fs * PT);
          const n = Array.from(String(text)).reduce((a, ch) => a + (/[\x20-\x7e｡-ﾟ]/.test(ch) ? 0.55 : 1), 0);
          if (n > room) size = Math.max(5, (fs * room) / n);
        }
        st.push(s.wrap ? "white-space:pre-wrap;word-break:break-all" : "white-space:pre");
        // 行の高さいっぱいの文字が下の線にかからないよう、行間は詰め、下寄せは線から少し離す
        st.push("line-height:1.05");
        if (vAlign === "bottom") st.push("padding-bottom:1.5px");
      }
      st.push(`font-size:${size.toFixed(1)}pt`);
      if (s.b) st.push("font-weight:bold");
      if (s.u) st.push("text-decoration:underline");
      if (okColor(s.fc)) st.push(`color:${s.fc}`);
      if (okColor(s.bg) && !HINT_FILLS.has(s.bg.toLowerCase())) st.push(`background:${s.bg}`);
      // 見出しは Excel と同じく隣の空いたマスへはみ出してよい。差し込みのマスは枠の中に収める
      st.push(`overflow:${cell.slot || cell.in || cell.f ? "hidden" : "visible"}`);
      cellsHtml += `<div${attr} style="position:absolute;box-sizing:border-box;display:flex;padding:0 2px;${st.join(";")}">${esc(text)}</div>`;
    }
    // 線を引く（同じ種類が続くところは1本にまとめる）。角が欠けないよう、両端を線の太さの半分だけ伸ばす
    let lines = "";
    const maxVW = (r, c) => Math.max(borderW(vE[(r - 1) + "," + c]), borderW(vE[r + "," + c]));
    const maxHW = (r, c) => Math.max(borderW(hE[r + "," + (c - 1)]), borderW(hE[r + "," + c]));
    for (let r = 0; r <= nR; r++) {
      let c = 0;
      while (c < nC) {
        const b = hE[r + "," + c]; if (!b || layout.cols[c] === 0) { c++; continue; }
        let e = c + 1; while (e < nC && hE[r + "," + e] === b) e++;
        const bw = borderW(b), ext0 = maxVW(r, c) / 2, ext1 = maxVW(r, e) / 2;
        lines += `<div style="position:absolute;left:${px(X[c] - ext0)};top:${px(Y[r] - bw / 2)};width:${px(X[e] - X[c] + ext0 + ext1)};height:0;border-top:${b}"></div>`;
        c = e;
      }
    }
    for (let c = 0; c <= nC; c++) {
      let r = 0;
      while (r < nR) {
        const b = vE[r + "," + c]; if (!b || layout.rows[r] === 0) { r++; continue; }
        let e = r + 1; while (e < nR && vE[e + "," + c] === b) e++;
        const bw = borderW(b), ext0 = maxHW(r, c) / 2, ext1 = maxHW(e, c) / 2;
        lines += `<div style="position:absolute;left:${px(X[c] - bw / 2)};top:${px(Y[r] - ext0)};width:0;height:${px(Y[e] - Y[r] + ext0 + ext1)};border-left:${b}"></div>`;
        r = e;
      }
    }
    return `<div class="fla-inv" style="position:relative;width:${px(W + 2)};height:${px(H + 2)};font-family:${FONT_FAMILY};color:#000;background:#fff;-webkit-text-size-adjust:none;text-size-adjust:none">`
      + `<div style="position:absolute;left:1px;top:1px;width:${px(W)};height:${px(H)}">${cellsHtml}<div style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none">${lines}</div></div></div>`;
  }

  // ── 請求データ → 型の差し込み名ごとの文字（請求画面と運営の試し刷りで同じ処理を使う）──
  const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
  // 和暦（令和）の年。令和元年＝2019年
  const reiwa = (d) => d ? String(d.getFullYear() - 2018) : "";
  function ymd(v) { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; }
  // 請求データ → 型の差し込み名ごとの文字
  function values(layout, inv, plines, comp, st, subject) {
    const ex = inv.extra_fields || {};
    const disp = ex._display || {}; // 見た目だけの上書き（手直しの画面＝段C）
    const yen = (n) => (n === null || n === undefined || n === "") ? "" : fmt(n);
    const v = {};
    const issued = ymd(inv.issued_at) || new Date();
    v["date.wy"] = reiwa(issued); v["date.m"] = String(issued.getMonth() + 1); v["date.d"] = String(issued.getDate());
    v["prime.onchu"] = (inv.prime_contractors?.name ?? "") + "　御中";
    v["company.name"] = comp.name ?? ""; v["company.address"] = st.address ?? ""; v["company.rep"] = st.representative_name ?? "";
    v["company.phone"] = st.phone ?? ""; v["company.reg"] = st.registration_number ?? "";
    v["site.name"] = inv.sites?.name ?? "";
    v["extra.現場担当者"] = ex["現場担当者"] ?? "";
    const wf = ymd(ex["工期開始"]), wt = ymd(ex["工期終了"]);
    if (wf) { v["work.from.wy"] = reiwa(wf); v["work.from.m"] = String(wf.getMonth() + 1); v["work.from.d"] = String(wf.getDate()); }
    if (wt) { v["work.to.wy"] = reiwa(wt); v["work.to.m"] = String(wt.getMonth() + 1); v["work.to.d"] = String(wt.getDate()); }
    // 請求書の種類で切り替える（テクノ様式の「請負請求書／常用・請負外請求書」と同じ）。
    //   請負　　　　　＝見出し「注文番号」・上の注文金額（A）〜請求残額（E）に出来高を入れる
    //   常用・請負外＝見出し「工事番号」・上の請負の欄は空のまま（アフター工事は工事番号に「アフター」）
    const isUkeoi = inv.invoice_type ? inv.invoice_type === "ukeoi" : plines.some(l => l.mode === "A2_rate");
    const a2 = isUkeoi ? plines.find(l => l.mode === "A2_rate") : null;
    const labels = (layout.fields && layout.fields["kind.labels"]) || { ukeoi: "注文番号", joyo: "工事番号" };
    v["kind.label"] = isUkeoi ? labels.ukeoi : labels.joyo;
    v["kind.number"] = (isUkeoi ? (ex["注文番号"] ?? ex["工事番号"]) : (ex["工事番号"] ?? ex["注文番号"])) ?? "";
    if (a2 && a2.__contract) {
      const c = a2.__contract;
      const total = c.contract_amount ?? ((c.original_amount ?? 0) + (c.adjustment_amount ?? 0));
      v["contract.original"] = yen(c.original_amount); v["contract.change"] = yen(c.adjustment_amount ?? 0); v["contract.total"] = yen(total);
      const prev = a2.billed_before ?? 0, cum = a2.cumulative_amount ?? (prev + (a2.amount ?? 0));
      v["dekidaka.this"] = yen(a2.amount ?? 0); v["dekidaka.prev"] = yen(prev); v["dekidaka.cum"] = yen(cum);
      v["dekidaka.pct"] = total ? Math.round((cum / total) * 1000) / 10 + "%" : "";
      v["dekidaka.remain"] = yen(total - cum);
    }
    // 明細（型の行数まで。常用は終日・半日・材料費を別の行に）
    // tax_rate は 0.100 の形で入っている（10% なら 0.1）。非課税の請求は 0
    const rate = inv.tax_category && inv.tax_category !== "taxable" ? 0 : Number(inv.tax_rate ?? 0.1);
    const rows = [];
    const multiA1 = plines.filter(l => l.mode === "A1_unit").length > 1;
    for (const line of plines) {
      if (line.mode === "A1_unit") {
        const up = line.unit_price ?? 0, hp = line.half_price ?? Math.round(up / 2), nm = line.description ?? "常用";
        if ((line.jinku_full ?? 0) > 0) rows.push({ desc: nm + "（終日）", qty: line.jinku_full, unit: "人工", price: up, amount: line.jinku_full * up });
        if ((line.jinku_half ?? 0) > 0) rows.push({ desc: nm + "（半日）", qty: line.jinku_half, unit: "人工", price: hp, amount: line.jinku_half * hp });
        if ((line.material_amount ?? 0) > 0) rows.push({ desc: multiA1 ? nm + "　材料費" : "材料費", qty: 1, unit: "式", price: line.material_amount, amount: line.material_amount });
      } else {
        rows.push({ desc: line.description || subject || "一式", qty: 1, unit: "式", price: line.amount ?? 0, amount: line.amount ?? 0 });
      }
    }
    // その請求書の記載（表で直した内訳）：請負は行そのもの（合計＝今月請求額）、常用は名前と備考だけを重ねる
    const xrows = Array.isArray(ex._rows) ? ex._rows : null;
    if (xrows && isUkeoi) {
      rows.length = 0;
      for (const r of xrows) {
        const qty = Number(r.qty) || 0, price = Number(r.price) || 0;
        if (!String(r.desc || "").trim() && !price) continue; // 工事内容も金額も無い行は出さない（数量・単位だけ残った行）
        rows.push({ desc: r.desc || "", qty: r.qty ?? "", unit: r.unit || "", price, amount: qty * price, note: r.note || "" });
      }
    } else if (xrows) {
      xrows.forEach((r, i) => { if (!rows[i]) return; if (r.desc) rows[i].desc = r.desc; if (r.note) rows[i].note = r.note; });
    }
    const max = (layout.fields && layout.fields["lines.max"]) || 5;
    rows.slice(0, max).forEach((r, i) => {
      const tax = Math.round(r.amount * rate);
      v[`lines.${i}.desc`] = r.desc; v[`lines.${i}.qty`] = String(r.qty); v[`lines.${i}.unit`] = r.unit;
      v[`lines.${i}.note`] = r.note || "";
      v[`lines.${i}.price`] = yen(r.price); v[`lines.${i}.amount`] = yen(r.amount); v[`lines.${i}.tax`] = yen(tax); v[`lines.${i}.incl`] = yen(r.amount + tax);
    });
    v["total.subtotal"] = yen(inv.subtotal_amount ?? 0); v["total.tax"] = yen(inv.tax_amount ?? 0);
    v["total.incl"] = yen(inv.total_amount ?? 0); v["total.incl2"] = yen(inv.total_amount ?? 0);
    v["bank.name"] = st.bank_name ?? ""; v["bank.branch"] = st.bank_branch ?? "";
    v["bank.type"] = st.bank_account_type === "touza" ? "当座" : st.bank_account_type === "futsu" ? "普通" : "";
    v["bank.no"] = st.bank_account_no ?? ""; v["bank.holder"] = st.bank_account_name ?? ""; v["bank.kana"] = ex["口座名義カナ"] ?? "";
    // 見た目だけの上書き（備考・宛名の書き方など）を最後に重ねる
    for (const [k, val] of Object.entries(disp)) if (typeof val === "string") v[k] = val;
    return { values: v, overflow: rows.length > max };
  }

  // ── Excel の計算式を画面の中で計算する（様式で使われる範囲：四則演算・比較・&・SUM/IF/ROUND ほか）──
  const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const colName = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const splitA = (a) => { const d = /^([A-Z]+)(\d+)$/.exec(a); return d ? [colNum(d[1]), +d[2] - 1] : null; };
  const ERR = { err: true };
  function tokenize(src) {
    const t = []; let i = 0;
    while (i < src.length) {
      const ch = src[i], rest = src.slice(i);
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        let j = i + 1, v = "";
        while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { v += '"'; j += 2; continue; } break; } v += src[j++]; }
        t.push({ k: "str", v }); i = j + 1; continue;
      }
      let m = /^[A-Z][A-Z0-9.]*(?=\()/.exec(rest);
      if (m) { t.push({ k: "fn", v: m[0] }); i += m[0].length; continue; }
      m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/.exec(rest);
      if (m) { t.push(m[3] ? { k: "rng", a: [colNum(m[1]), +m[2] - 1], b: [colNum(m[3]), +m[4] - 1] } : { k: "ref", c: colNum(m[1]), r: +m[2] - 1 }); i += m[0].length; continue; }
      m = /^\d+(\.\d+)?%?/.exec(rest);
      if (m) { t.push({ k: "num", v: m[0].endsWith("%") ? parseFloat(m[0]) / 100 : parseFloat(m[0]) }); i += m[0].length; continue; }
      m = /^(<>|<=|>=|[-+*/&=<>(),^])/.exec(rest);
      if (m) { t.push({ k: "op", v: m[0] }); i += m[0].length; continue; }
      throw new Error("式を読めません: " + src);
    }
    return t;
  }
  function parse(src) {
    const t = tokenize(src); let p = 0;
    const isOp = (v) => t[p] && t[p].k === "op" && t[p].v === v;
    const CMP = ["=", "<>", "<", ">", "<=", ">="];
    function cmp() { let l = cat(); while (t[p] && t[p].k === "op" && CMP.includes(t[p].v)) { const o = t[p++].v; l = { o, l, r: cat() }; } return l; }
    function cat() { let l = add(); while (isOp("&")) { p++; l = { o: "&", l, r: add() }; } return l; }
    function add() { let l = mul(); while (isOp("+") || isOp("-")) { const o = t[p++].v; l = { o, l, r: mul() }; } return l; }
    function mul() { let l = pw(); while (isOp("*") || isOp("/")) { const o = t[p++].v; l = { o, l, r: pw() }; } return l; }
    function pw() { let l = un(); while (isOp("^")) { p++; l = { o: "^", l, r: un() }; } return l; }
    function un() { if (isOp("-")) { p++; return { o: "neg", l: un() }; } if (isOp("+")) { p++; return un(); } return prim(); }
    function prim() {
      const k = t[p]; if (!k) throw new Error("式が途中で終わっています");
      if (k.k === "num" || k.k === "str") { p++; return { lit: k.v }; }
      if (k.k === "ref") { p++; return { ref: [k.c, k.r] }; }
      if (k.k === "rng") { p++; return { rng: [k.a, k.b] }; }
      if (k.k === "fn") {
        p += 2; const args = [];
        if (!isOp(")")) { args.push(cmp()); while (isOp(",")) { p++; args.push(cmp()); } }
        if (!isOp(")")) throw new Error("括弧が閉じていません"); p++;
        return { fn: k.v, args };
      }
      if (isOp("(")) { p++; const e = cmp(); if (!isOp(")")) throw new Error("括弧が閉じていません"); p++; return e; }
      throw new Error("式を読めません");
    }
    const e = cmp(); if (p !== t.length) throw new Error("式の終わりが読めません"); return e;
  }
  const toNum = (v) => {
    if (v === ERR) return ERR;
    if (v === "" || v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    const n = +String(v).replace(/,/g, ""); return isNaN(n) ? ERR : n;
  };
  // Excel の ROUND は 0.5 を 0 から遠い方へ丸める
  const roundX = (n, d, mode) => {
    const f = Math.pow(10, d), x = n * f;
    const r = mode === "down" ? Math.trunc(x) : mode === "up" ? (x < 0 ? Math.floor(x) : Math.ceil(x)) : Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
    return r / f;
  };
  const truthy = (v) => v === true || (typeof v === "number" && v !== 0) || (typeof v === "string" && v !== "" && v.toUpperCase() === "TRUE");
  const FN = {
    SUM: (a) => a.flat().reduce((s, v) => s + (typeof v === "number" ? v : 0), 0),
    IF: (a) => truthy(a[0]) ? (a.length > 1 ? a[1] : true) : (a.length > 2 ? a[2] : false),
    ROUND: (a) => roundX(toNum(a[0]), toNum(a[1] ?? 0)),
    ROUNDDOWN: (a) => roundX(toNum(a[0]), toNum(a[1] ?? 0), "down"),
    ROUNDUP: (a) => roundX(toNum(a[0]), toNum(a[1] ?? 0), "up"),
    INT: (a) => Math.floor(toNum(a[0])), ABS: (a) => Math.abs(toNum(a[0])),
    MAX: (a) => { const n = a.flat().filter((v) => typeof v === "number"); return n.length ? Math.max(...n) : 0; },
    MIN: (a) => { const n = a.flat().filter((v) => typeof v === "number"); return n.length ? Math.min(...n) : 0; },
    AND: (a) => a.flat().every(truthy), OR: (a) => a.flat().some(truthy),
  };

  function mount(box, layout, values, opts) {
    opts = opts || {};
    values = values || {};
    const params = Object.assign({}, opts.params || {});
    const byA = {}, byRC = {};
    for (const c of layout.cells) if (c.a) { byA[c.a] = c; const rc = splitA(c.a); if (rc) byRC[rc[0] + "," + rc[1]] = c; }
    const ast = {};
    // 式の差し替え（opts.formulas：番地 → 式。例：消費税の合計を請求データと同じ「合計から切り捨て」にする）
    const fOver = opts.formulas || {};
    for (const c of layout.cells) if (c.f || fOver[c.a]) { try { ast[c.a] = parse(fOver[c.a] || c.f); } catch (e) { ast[c.a] = { lit: ERR }; console.warn("[FLA_LAYOUT]", c.a, e.message); } }
    const paramAt = Object.assign({}, layout.params || {});
    const parseIn = (txt) => { const t = String(txt ?? "").replace(/[,，¥￥円\s]/g, ""); return /^-?\d+(\.\d+)?$/.test(t) ? +t : String(txt ?? "").trim(); };
    // 入力マスの値：最初は values（slot の文字）から
    const inp = {};
    for (const c of layout.cells) if (c.in) inp[c.a] = c.slot ? String(values[c.slot] ?? "") : "";
    let memo = {};
    function cellVal(c, r) {
      const key = c + "," + r, cell = byRC[key], a = colName(c) + (r + 1);
      if (paramAt[a]) return params[paramAt[a]] ?? "";
      if (!cell) return "";
      if (cell.f) { if (key in memo) return memo[key]; memo[key] = ERR; const v = ev(ast[cell.a]); memo[key] = v; return v; }
      if (cell.in) return parseIn(inp[cell.a]);
      if (cell.slot) return parseIn(values[cell.slot]);
      return cell.text ?? "";
    }
    function ev(n) {
      if (!n) return ERR;
      if ("lit" in n) return n.lit;
      if (n.ref) return cellVal(n.ref[0], n.ref[1]);
      if (n.rng) {
        const out = [];
        for (let r = n.rng[0][1]; r <= n.rng[1][1]; r++) for (let c = n.rng[0][0]; c <= n.rng[1][0]; c++) if (byRC[c + "," + r]) out.push(cellVal(c, r));
        return out;
      }
      if (n.fn) {
        const f = FN[n.fn]; if (!f) return ERR;
        if (n.fn === "IF") { const cond = ev(n.args[0]); if (cond === ERR) return ERR; return truthy(cond) ? (n.args[1] ? ev(n.args[1]) : true) : (n.args[2] ? ev(n.args[2]) : false); }
        const args = n.args.map(ev); if (args.some((v) => v === ERR)) return ERR; return f(args);
      }
      if (n.o === "neg") { const v = toNum(ev(n.l)); return v === ERR ? ERR : -v; }
      const L = ev(n.l), R = ev(n.r);
      if (L === ERR || R === ERR) return ERR;
      if (n.o === "&") return String(L ?? "") + String(R ?? "");
      if (["=", "<>", "<", ">", "<=", ">="].includes(n.o)) {
        const num = typeof L === "number" && typeof R === "number";
        const a = num ? L : String(L ?? ""), b = num ? R : String(R ?? "");
        return n.o === "=" ? a === b : n.o === "<>" ? a !== b : n.o === "<" ? a < b : n.o === ">" ? a > b : n.o === "<=" ? a <= b : a >= b;
      }
      const a = toNum(L), b = toNum(R); if (a === ERR || b === ERR) return ERR;
      if (n.o === "+") return a + b; if (n.o === "-") return a - b; if (n.o === "*") return a * b; if (n.o === "^") return Math.pow(a, b);
      if (n.o === "/") return b === 0 ? ERR : a / b;
      return ERR;
    }
    function show(cell, v) {
      if (v === ERR || v === "" || v == null || v === false) return "";
      if (v === true) return "TRUE";
      if (typeof v === "number") {
        if (cell.z === "pct1") return (v * 100).toFixed(1) + "%";
        if (cell.z === "pct0") return Math.round(v * 100) + "%";
        if (cell.z === "num") return roundX(v, 0).toLocaleString("ja-JP");
        return String(roundX(v, 6));
      }
      return String(v);
    }
    const locked = opts.locked instanceof Set ? opts.locked : new Set(opts.locked || []);
    box.innerHTML = render(layout, values, { editable: true, locked });
    const tds = {};
    box.querySelectorAll("[data-a]").forEach((el) => { tds[el.dataset.a] = el; });
    function recalc() {
      memo = {};
      for (const c of layout.cells) if (c.f && tds[c.a]) { const rc = splitA(c.a); tds[c.a].textContent = show(c, cellVal(rc[0], rc[1])); }
      if (opts.onChange) opts.onChange();
    }
    for (const c of layout.cells) if (c.in && tds[c.a]) { const v = parseIn(inp[c.a]); tds[c.a].textContent = typeof v === "number" && c.z ? show(c, v) : inp[c.a]; }
    const inCell = (e) => e.target && e.target.closest ? e.target.closest(".fla-in") : null; // .fla-lock は対象外
    box.addEventListener("input", (e) => { const el = inCell(e); if (!el) return; inp[el.dataset.a] = el.textContent; recalc(); });
    box.addEventListener("keydown", (e) => { const el = inCell(e); if (el && e.key === "Enter") { e.preventDefault(); el.blur(); } });
    box.addEventListener("focusout", (e) => {
      const el = inCell(e); if (!el) return;
      const c = byA[el.dataset.a]; const v = parseIn(inp[c.a]);
      if (typeof v === "number" && c.z) el.textContent = show(c, v);
    });
    // 貼り付けは文字だけ（書式やリンクを持ち込まない）
    box.addEventListener("paste", (e) => {
      const el = inCell(e); if (!el) return; e.preventDefault();
      const txt = ((e.clipboardData || window.clipboardData).getData("text") || "").replace(/[\r\n]+/g, " ");
      document.execCommand("insertText", false, txt);
    });
    recalc();
    return {
      setParam(name, v) { params[name] = v; recalc(); },
      inputs() { return Object.assign({}, inp); },
      value(a) { const rc = splitA(a); memo = {}; return rc ? cellVal(rc[0], rc[1]) : undefined; },
      setInput(a, text) { if (!byA[a] || !byA[a].in) return; inp[a] = String(text); if (tds[a]) { const c = byA[a]; const v = parseIn(text); tds[a].textContent = typeof v === "number" && c.z ? show(c, v) : String(text); } recalc(); },
      // 入力マスの値を差し込み名（slot）ごとに返す（保存用）
      bySlot() { const o = {}; for (const c of layout.cells) if (c.in && c.slot) o[c.slot] = String(inp[c.a] ?? "").trim(); return o; },
      recalc,
    };
  }

  // ── PDF 用の画像を自前で描く（2026-10-31）────────────────────────────────
  // 画面の部品（html2canvas）は文字を数px下にずらして描くため、指定書式は「画面に並んだとおりの位置」に
  // 1文字ずつ・1本ずつ描き直す。el は画面に置いた .fla-inv（縮小していないもの）。
  function toCanvas(el, scale) {
    scale = scale || 2;
    const base = el.getBoundingClientRect();
    const W = Math.ceil(el.offsetWidth), H = Math.ceil(el.offsetHeight);
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(W * scale); cv.height = Math.ceil(H * scale);
    const ctx = cv.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    const rel = (r) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    const divs = Array.from(el.querySelectorAll("div"));
    // 1) 塗り
    for (const d of divs) {
      const bg = getComputedStyle(d).backgroundColor;
      if (!bg || bg === "transparent" || /rgba\(.*,\s*0\)$/.test(bg)) continue;
      const r = rel(d.getBoundingClientRect()); ctx.fillStyle = bg; ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // 2) 文字（1文字ずつ、画面の位置に）
    const ascentCache = {};
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue; if (!t || !t.trim()) continue;
      const host = node.parentElement, cs = getComputedStyle(host);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      ctx.font = font;
      if (!(font in ascentCache)) {
        const m = ctx.measureText("請Ag");
        ascentCache[font] = m.fontBoundingBoxAscent != null ? { a: m.fontBoundingBoxAscent, d: m.fontBoundingBoxDescent } : null;
      }
      const asc = ascentCache[font];
      ctx.fillStyle = cs.color || "#000";
      const under = /underline/.test(cs.textDecorationLine || cs.textDecoration || "");
      ctx.save();
      if (cs.overflow === "hidden") { const hr = rel(host.getBoundingClientRect()); ctx.beginPath(); ctx.rect(hr.x, hr.y, hr.w, hr.h); ctx.clip(); }
      const chars = Array.from(t); let i = 0;
      for (const ch of chars) {
        const len = ch.length;
        if (ch !== "\n" && (ch.trim() || under)) { // 下線は空白（字間）にも引く
          range.setStart(node, i); range.setEnd(node, i + len);
          const rr = Array.from(range.getClientRects()).find((q) => q.width > 0 || q.height > 0);
          if (rr) {
            const r = rel(rr);
            // 文字の箱（フォントの上端〜下端）の上端＋フォントの上の高さ＝文字の基準線
            const by = asc ? r.y + (r.h - (asc.a + asc.d)) / 2 + asc.a : r.y + r.h * 0.86;
            ctx.textBaseline = "alphabetic";
            if (ch.trim()) ctx.fillText(ch, r.x, by);
            if (under) ctx.fillRect(r.x, by + 1.5, r.w, 1);
          }
        }
        i += len;
      }
      ctx.restore();
    }
    // 3) 罫線（線のマスの上辺・左辺）
    for (const d of divs) {
      const cs = getComputedStyle(d);
      const r = rel(d.getBoundingClientRect());
      for (const side of ["Top", "Left"]) {
        const w = parseFloat(cs[`border${side}Width`]) || 0, style = cs[`border${side}Style`];
        if (!w || !style || style === "none" || style === "hidden") continue;
        ctx.fillStyle = cs[`border${side}Color`] || "#000";
        const horiz = side === "Top";
        const len = horiz ? r.w : r.h;
        const at = (pos, thick) => horiz ? ctx.fillRect(r.x, r.y + pos, len, thick) : ctx.fillRect(r.x + pos, r.y, thick, len);
        if (style === "double") { const t = Math.max(0.6, w / 3); at(0, t); at(w - t, t); continue; }
        if (style === "dotted" || style === "dashed") {
          const on = style === "dotted" ? Math.max(1, w) : Math.max(3, w * 3), off = style === "dotted" ? Math.max(1, w) * 1.2 : on * 0.7;
          for (let p = 0; p < len; p += on + off) {
            const seg = Math.min(on, len - p);
            if (horiz) ctx.fillRect(r.x + p, r.y, seg, w); else ctx.fillRect(r.x, r.y + p, w, seg);
          }
          continue;
        }
        at(0, w);
      }
    }
    return cv;
  }

  // slot の名前（正規表現）に合うマスの番地を返す（例：/^company\./ → 発行元のマス）
  function addrsBySlot(layout, re) { return layout.cells.filter((c) => c.a && c.slot && re.test(c.slot)).map((c) => c.a); }
  global.FLA_LAYOUT = { render, values, mount, addrsBySlot, fontsReady, toCanvas };
})(window);
