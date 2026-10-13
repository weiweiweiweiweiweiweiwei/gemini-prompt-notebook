-- 罐頭P 的分身（supabase/functions/gpn-clone）。放在和 flowstudy 共用的專案裡，名稱都加 gpn_ 開頭。
-- 提示詞不存在這裡（在建立的人的 Google 雲端硬碟），這裡只記「代號的雜湊 → 哪個檔案」和建立的人加密過的 refresh token。
-- 兩張表都開 RLS、而且沒有任何 policy：只有 service role（也就是 gpn-clone 函式）讀寫得到，網頁拿公開金鑰碰不到。

create table if not exists public.gpn_clone_owners (
  sub         text primary key,                 -- Google 帳號代號
  email       text not null default '',
  rt_enc      text not null,                    -- refresh token，AES-GCM 加密（金鑰在函式的密鑰裡）
  updated_at  timestamptz not null default now()
);

create table if not exists public.gpn_clones (
  id_hash     text primary key,                 -- 分身代號的 SHA-256（代號本身不存）
  owner_sub   text not null references public.gpn_clone_owners(sub) on delete cascade,
  file_id     text not null,                    -- 建立的人雲端硬碟裡的分身檔案
  label       text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null              -- 建立滿一年
);
create index if not exists gpn_clones_owner_idx on public.gpn_clones (owner_sub);

alter table public.gpn_clone_owners enable row level security;
alter table public.gpn_clones enable row level security;
revoke all on public.gpn_clone_owners from anon, authenticated;
revoke all on public.gpn_clones from anon, authenticated;
