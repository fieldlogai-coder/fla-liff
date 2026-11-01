# support-bot（FIELDLOG サポートの AI 一次対応）

LINE 公式アカウント「FIELDLOG サポート」（@556axvhf）に届いたメッセージに、使い方ガイド（manual.html）をもとに Claude が答える Supabase Edge Function です。

- デプロイ先：Supabase プロジェクト `qxeqaqnzbsuykmzwkvhx` の関数 `support-bot`（verify_jwt=false。LINE の署名で確かめる）
- 会話の記録：表 `support_chats`（`migration.sql`。90日で消える。service role だけが読み書きする）
- ガイド：本番の manual.html を1時間ごとに読み直す。読めないときは `knowledge.ts`（予備の写し）を使う
  - ガイドを直したら `node server/support-bot/knowledge-extract.mjs` で `knowledge.ts` を作り直す

## モード（secret `SUPPORT_BOT_MODE`）

| モード | お客さんへの返事 | 運営への知らせ |
|---|---|---|
| `draft`（初期値） | 送らない | AI の下書きを運営の LINE に送る |
| `on` | AI が返す | 担当が必要なときだけ。その人には24時間 AI を止める |
| `off` | 送らない | なし（記録だけ） |

- 運営（`OPS_LINE_USER_ID`）が自分でこのアカウントに送ると、モードに関係なく AI が直接返します（試し打ち用）。
- お金・契約・解約・発行済み請求の間違い・データ消失・苦情・「人と話したい」は、AI は答えずに必ず担当へ回します。

## 動かすまでの手順

1. **Claude の API キー**：Claude Console（platform.claude.com）でキーを作り、Supabase の Edge Functions → Secrets に `ANTHROPIC_API_KEY` として入れる
2. **サポート用チャネルの鍵**：LINE Developers の「FIELDLOG サポート」チャネルで
   - チャネルシークレット → Secret `OPS_CHANNEL_SECRET`
   - チャネルアクセストークン → Secret `OPS_CHANNEL_ACCESS_TOKEN`（ops-digest などで使っているもの。未設定なら入れる）
   - `OPS_LINE_USER_ID` は設定済み（運営あての知らせに使っているもの）
3. **Webhook**：同じチャネルの Messaging API 設定で
   - Webhook URL：`https://qxeqaqnzbsuykmzwkvhx.supabase.co/functions/v1/support-bot`
   - 「Webhook の利用」を ON →「検証」で成功を確認
4. **応答設定**（LINE Official Account Manager → 設定 → 応答設定）
   - チャット：ON（運営が手で返せるように）
   - Webhook：ON
   - 応答メッセージ：OFF（自動の定型文と二重にならないように）
5. **試す**：運営のスマホから「FIELDLOG サポート」に「日報を直したい」などと送る → AI が返す
6. しばらく `draft` で下書きの質を見る → よければ Secret `SUPPORT_BOT_MODE` を `on` にする

設定の確認：ブラウザで上の Webhook URL を開くと、モードと設定の有無（true/false だけ）が出ます。

## モデルと費用

- 初期値は `claude-sonnet-5-5`（費用の見積もりに合わせた）。Secret `SUPPORT_MODEL` で変えられる（例：`claude-opus-5-5` は約2倍の費用で、答えの質が上がる）
- 1往復の目安：約2円（ガイド部分はキャッシュが効く）
- 実際の使用量は `support_chats.usage` に残る：

```sql
select date_trunc('day', created_at) d, count(*) replies,
  sum((usage->>'input_tokens')::int) input, sum((usage->>'cache_read_input_tokens')::int) cache_read,
  sum((usage->>'output_tokens')::int) output
from support_chats where role = 'assistant' group by 1 order by 1 desc;
```

## 知っておくこと

- LINE の ID はプロバイダーごとに違います。サポート用と本体（@165bmpmn）が同じプロバイダーなら、相手の会社名・名前が分かります。違うときは「会社不明」になります（返事はできます）。
- 返信の鍵が切れたとき（1分ほど）は push で送ります。push と運営への知らせは、LINE の月の無料通数に数えられます。
