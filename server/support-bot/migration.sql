-- support-bot の会話記録（2026-11-01）。service role だけが読み書きする（RLS 有効・ルールなし）。
create table if not exists public.support_chats (
  id bigint generated always as identity primary key,
  line_user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  escalated boolean not null default false,  -- AI が担当へ回した返事
  reason text,                               -- 担当へ回した理由（運営向け）
  mode text,                                 -- そのときのモード draft / on / off
  sent boolean not null default false,       -- お客さんに実際に送ったか
  model text,
  usage jsonb,                               -- トークン数（費用の確認用）
  created_at timestamptz not null default now()
);
comment on table public.support_chats is 'FIELDLOG サポートの AI 一次対応（support-bot）の会話記録。90日で消える。';
create index if not exists support_chats_user_time on public.support_chats (line_user_id, created_at desc);
alter table public.support_chats enable row level security;

-- 2026-11-01 追加：どちらのアカウントでのやりとりか
alter table public.support_chats add column if not exists channel text not null default 'support';
comment on column public.support_chats.channel is 'main = 本体アカウント（@165bmpmn）／support = 運営アカウント（@556axvhf）';
