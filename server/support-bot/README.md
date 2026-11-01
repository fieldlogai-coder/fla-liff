# support-bot（FIELDLOG の LINE で、使い方の質問に AI が答える）

お客さんの質問は **FIELDLOG 本体のトーク（@165bmpmn）** で受け、使い方ガイド（manual.html）をもとに Claude が答えます。
運営アカウント「FIELDLOG サポート」（@556axvhf）は**運営専用**です。お客さんは案内しません。

## しくみ

```
お客さん ─▶ 本体 LINE ─▶ line-webhook（日報の操作中でない & 分からない文字）
                              │ POST {action:"main"}（service role キー）
                              ▼
                         support-bot ─▶ Claude API
                              │ 本体アカウントから返事 ／ 担当が必要なら運営アカウントで運営に知らせる
                              ▼
                         表 support_chats に記録（channel = main）
```

- 日報のボタン操作の途中には AI は出ません（line-webhook の「デフォルト」の分岐だけで呼ぶ）。
- support-bot が止まっていても、5秒で諦めて従来の案内（「報告する」と送ってください）を返します。
- 運営アカウントの Webhook も support-bot です。運営本人が送ると AI が答えます（試し打ち用）。運営以外から届いたものには答えず、運営に知らせるだけです。

## モード（Supabase の Secret `LINE_AI_MODE`）

| モード | お客さんへの返事 | 運営への知らせ |
|---|---|---|
| `draft`（初期値） | 従来の案内 | AI の下書きを運営の LINE に送る |
| `on` | AI が返す | 担当が必要なときだけ。その人には24時間 AI を止める（その間の発言は運営に転送） |
| `off` | 従来の案内 | なし |

運営（`OPS_LINE_USER_ID`）本人が本体トークで送ったときは、モードに関係なく AI が答えます。

## 置き場所

- support-bot：このフォルダ（`index.ts` / `knowledge.ts` / `migration.sql`）。Supabase の関数 `support-bot`
- line-webhook の変更：非公開リポジトリ `fieldlog-ai` のブランチ `claude/fla-automated-support-pfegow`
  - 本番で動いていた版（v71）を取り込み、22行（`askSupportAi` とその呼び出し）だけ足したもの
- 「困ったときは」ボタン：`fla-support.js`（問い合わせ先を本体 @165bmpmn に変更）

## Secret

`ANTHROPIC_API_KEY` / `LINE_CHANNEL_ACCESS_TOKEN`（本体）/ `OPS_CHANNEL_SECRET`・`OPS_CHANNEL_ACCESS_TOKEN`（運営）/ `OPS_LINE_USER_ID`
任意：`LINE_AI_MODE`、`SUPPORT_MODEL`（初期値 `claude-sonnet-5-5`）

## 費用の確認

```sql
select date_trunc('day', created_at) d, channel, count(*) replies,
  sum((usage->>'cache_creation_input_tokens')::int) cache_write, sum((usage->>'cache_read_input_tokens')::int) cache_read,
  sum((usage->>'output_tokens')::int) output
from support_chats where role = 'assistant' group by 1, 2 order by 1 desc;
```

1往復の目安は 2〜3 円（Sonnet 5.5）。

## ガイドを直したら

AI は本番の manual.html を1時間ごとに読み直します。予備の写しも更新するなら `node server/support-bot/knowledge-extract.mjs`。
