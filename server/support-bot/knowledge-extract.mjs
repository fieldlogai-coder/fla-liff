// 使い方ガイド（manual.html）を、AI に読ませる文字だけに直す。
// support-bot/index.ts も同じ手順を使う（ここを直したら index.ts の htmlToText も合わせる）。
// 使い方: node server/support-bot/knowledge-extract.mjs  → knowledge.ts（予備の写し）を作り直す
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function htmlToText(html) {
  return html
    .replace(/<(style|script|svg|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|p|div|tr|section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n")
    .replace(/\n(## |### )/g, "\n\n$1");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const text = htmlToText(readFileSync(path.join(here, "../../manual.html"), "utf8"));
  writeFileSync(
    path.join(here, "knowledge.ts"),
    "// 自動生成（knowledge-extract.mjs）。manual.html が取れないときの予備の写し。手で直さない。\n" +
      `export const MANUAL_SNAPSHOT = ${JSON.stringify(text)};\n`,
  );
  console.log(`knowledge.ts: ${text.length} 文字`);
}
