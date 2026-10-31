/* fla-invoice-layout.js — 元請の指定書式（請求書の型 layout.json）を HTML に描く（④d-2・2026-10-31）
   型は EF invoice-layout から受け取る（その会社の請求の権限がある人だけ）。様式の元ファイルは扱わない。
   使い方:
     const html = FLA_LAYOUT.render(layout, values, { editable: false });
     values = { "company.name": "…", "lines.0.desc": "…", … }（型の slot 名 → 表示する文字）
     FLA_LAYOUT.values(layout, inv, plines, comp, st, subject) で請求データから values を作れる
   editable: true のときは差し込みのマスに data-slot を付け、タップで直せるようにする（手直しの画面＝段C）。 */
(function (global) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 入力欄の目印（黄色）は、出来上がりの請求書には出さない
  const HINT_FILLS = new Set(["#ffffcc", "#ffff99"]);
  const okColor = (v) => /^#[0-9a-f]{6}$/i.test(v || "") ? v : null;
  const okBorder = (v) => /^\d+px (solid|dashed|dotted|double) #[0-9a-f]{6}$/i.test(v || "") ? v : null;

  function cellStyle(s) {
    const st = [];
    if (s.fs) st.push(`font-size:${Math.min(Math.max(+s.fs || 11, 5), 40)}pt`);
    if (s.b) st.push("font-weight:bold");
    if (s.u) st.push("text-decoration:underline");
    if (okColor(s.fc)) st.push(`color:${s.fc}`);
    if (s.h) st.push(`text-align:${["left", "center", "right", "justify"].includes(s.h) ? s.h : "left"}`);
    st.push(`vertical-align:${["top", "middle", "bottom"].includes(s.v) ? s.v : "bottom"}`);
    if (s.vert) st.push("writing-mode:vertical-rl;text-orientation:upright;white-space:pre-wrap;letter-spacing:2px");
    else if (s.wrap) st.push("white-space:pre-wrap"); else st.push("white-space:nowrap");
    if (okColor(s.bg) && !HINT_FILLS.has(s.bg.toLowerCase())) st.push(`background:${s.bg}`);
    for (const [k, side] of [["bl", "left"], ["br", "right"], ["bt", "top"], ["bb", "bottom"]]) {
      const b = okBorder(s[k]); if (b) st.push(`border-${side}:${b}`);
    }
    return st.join(";");
  }

  function render(layout, values, opts) {
    opts = opts || {};
    values = values || {};
    const nC = layout.cols.length, nR = layout.rows.length;
    const totalW = layout.cols.reduce((a, b) => a + b, 0);
    // 行×列の占有表（結合の右下を飛ばすため）
    const at = {};
    for (const c of layout.cells) at[c.r + "," + c.c] = c;
    const skip = new Set();
    for (const c of layout.cells) {
      for (let r = c.r; r < c.r + (c.rs || 1); r++) for (let k = c.c; k < c.c + (c.cs || 1); k++) if (r !== c.r || k !== c.c) skip.add(r + "," + k);
    }
    let h = `<table class="fla-inv" style="border-collapse:collapse;table-layout:fixed;width:${totalW}px;font-family:'MS PGothic','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;color:#000;background:#fff">`;
    h += "<colgroup>" + layout.cols.map((w) => `<col style="width:${w}px">`).join("") + "</colgroup>";
    for (let r = 0; r < nR; r++) {
      h += `<tr style="height:${layout.rows[r]}pt">`;
      for (let c = 0; c < nC; c++) {
        const k = r + "," + c;
        if (skip.has(k)) continue;
        const cell = at[k];
        if (!cell) { h += "<td></td>"; continue; }
        const span = (cell.rs > 1 ? ` rowspan="${cell.rs}"` : "") + (cell.cs > 1 ? ` colspan="${cell.cs}"` : "");
        let text = cell.slot ? (values[cell.slot] ?? "") : (cell.text ?? "");
        const slotAttr = cell.slot && opts.editable ? ` data-slot="${esc(cell.slot)}" class="fla-slot"` : "";
        // 縮小して全体を表示（Excel の「縮小して全体を表示」）は、長い文字だけ小さくする
        let st = cellStyle(cell.s || {});
        if (cell.s && cell.s.shrink && text) {
          const room = (layout.cols.slice(c, c + (cell.cs || 1)).reduce((a, b) => a + b, 0)) / ((+cell.s.fs || 11) * 1.33);
          if (String(text).length > room) st += `;font-size:${Math.max(5, ((+cell.s.fs || 11) * room) / String(text).length).toFixed(1)}pt`;
        }
        // 見出しは Excel と同じく隣の空いたマスへはみ出してよい。差し込みのマスは枠の中に収める
        const ov = cell.slot ? "hidden" : "visible";
        h += `<td${span}${slotAttr} style="${st};overflow:${ov};padding:0 2px;line-height:1.15">${esc(text)}</td>`;
      }
      h += "</tr>";
    }
    return h + "</table>";
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
    const max = (layout.fields && layout.fields["lines.max"]) || 5;
    rows.slice(0, max).forEach((r, i) => {
      const tax = Math.round(r.amount * rate);
      v[`lines.${i}.desc`] = r.desc; v[`lines.${i}.qty`] = String(r.qty); v[`lines.${i}.unit`] = r.unit;
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

  global.FLA_LAYOUT = { render, values };
})(window);
