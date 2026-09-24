-- ============================================================================
-- 常用提示詞：雲端同步用的資料庫結構（Supabase / Postgres）
--
-- 每個帳號一列，整本筆記本（書籤、資料夾、提示詞）存成一份 JSON。
-- 提示詞頂多幾百則，一份 JSON 幾十 KB，整份存整份拿最單純，也不會有對不上的問題。
--
-- 安全：網頁版和外掛裡的公開金鑰（publishable / anon key）任何人都拿得到，
-- 所以資料安全完全靠下面的「列層級權限」（RLS）：每個人只能讀寫自己的那一列。
--
-- 這份可以重複執行（已經建過的會略過或覆蓋成最新版）。
-- ============================================================================

create table if not exists public.notebooks (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  doc        jsonb       not null,
  version    bigint      not null default 1,          -- 每存一次 +1，用來發現「別台先改過了」
  updated_at timestamptz not null default now(),
  -- 防止有人塞超大資料進來（正常一本筆記本只有幾十 KB）
  constraint notebooks_doc_size check (pg_column_size(doc) < 5000000)
);

alter table public.notebooks enable row level security;

drop policy if exists "notebooks: 只能讀自己的" on public.notebooks;
create policy "notebooks: 只能讀自己的" on public.notebooks
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "notebooks: 只能建自己的" on public.notebooks;
create policy "notebooks: 只能建自己的" on public.notebooks
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "notebooks: 只能改自己的" on public.notebooks;
create policy "notebooks: 只能改自己的" on public.notebooks
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "notebooks: 只能刪自己的" on public.notebooks;
create policy "notebooks: 只能刪自己的" on public.notebooks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 沒登入的人一律碰不到
revoke all on public.notebooks from anon;
grant select, insert, update, delete on public.notebooks to authenticated;

-- ----------------------------------------------------------------------------
-- 存檔：只有在「雲端版本 = 我上次拿到的版本」時才寫入。
-- 否則代表別台先改過了，把雲端最新的內容回傳，由程式合併後再存一次（見 sync.js）。
--   回傳 saved=true  → new_version 是存完的新版本
--   回傳 saved=false → new_version / cloud_doc 是雲端目前的版本和內容
-- security invoker：用呼叫者自己的身分執行，上面的權限規則照樣有效。
-- ----------------------------------------------------------------------------
create or replace function public.gpn_save(p_doc jsonb, p_base bigint)
returns table (saved boolean, new_version bigint, cloud_doc jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur public.notebooks%rowtype;
begin
  if uid is null then
    raise exception '請先登入' using errcode = '28000';
  end if;

  select * into cur from public.notebooks n where n.user_id = uid for update;

  if not found then
    -- 第一次存。兩台同時第一次存時，後到的那台會拿到「衝突」，合併後再存
    insert into public.notebooks (user_id, doc, version) values (uid, p_doc, 1)
      on conflict (user_id) do nothing;
    if found then
      return query select true, 1::bigint, null::jsonb;
    else
      select * into cur from public.notebooks n where n.user_id = uid;
      return query select false, cur.version, cur.doc;
    end if;
  elsif cur.version = p_base then
    update public.notebooks n
       set doc = p_doc, version = cur.version + 1, updated_at = now()
     where n.user_id = uid;
    return query select true, cur.version + 1, null::jsonb;
  else
    return query select false, cur.version, cur.doc;
  end if;
end;
$$;

revoke all on function public.gpn_save(jsonb, bigint) from public, anon;
grant execute on function public.gpn_save(jsonb, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 刪除我的帳號：使用者在「帳號與同步」自己按的（按兩次）。
-- 刪掉登入帳號；雲端上的筆記本因為 on delete cascade 會一起刪掉。
-- 一般使用者碰不到 auth.users，所以這個函式用 security definer（以擁有者身分執行），
-- 但只會刪「呼叫的人自己」那一個帳號（auth.uid()），刪不到別人。
-- Supabase 的安全檢查（Advisors）會對這個函式出一個黃色警告，是刻意的，不用處理。
-- ----------------------------------------------------------------------------
create or replace function public.gpn_delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '請先登入' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.gpn_delete_my_account() from public, anon;
grant execute on function public.gpn_delete_my_account() to authenticated;
