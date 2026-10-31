/* fla-invoice-layout.js — 元請の指定書式（請求書の型 layout.json）を HTML に描く（④d-2・2026-10-31）
   型は EF invoice-layout から受け取る（その会社の請求の権限がある人だけ）。様式の元ファイルは扱わない。
   使い方:
     const html = FLA_LAYOUT.render(layout, values, { editable: false });
     values = { "company.name": "…", "lines.0.desc": "…", … }（型の slot 名 → 表示する文字）
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

  global.FLA_LAYOUT = { render };
})(window);
