-- Arquivo Sombrio: ferramentas de sessão (combate, pistas e notas)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Pressupõe as tabelas já usadas pelo site: campaigns (id, master) e members (campaign_id, user_id).

create table if not exists public.session_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind text not null check (kind in ('combate','pista','nota')),
  data jsonb not null default '{}'::jsonb,
  revealed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists session_items_campaign_idx on public.session_items (campaign_id, kind);
alter table public.session_items enable row level security;

create or replace function public.as_is_master(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaigns c where c.id = cid and c.master = auth.uid())
$$;

create or replace function public.as_is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.as_is_master(cid)
      or exists (select 1 from public.members m where m.campaign_id = cid and m.user_id = auth.uid())
$$;

-- Mestre vê tudo. Jogadores só veem o que o mestre revelou (revealed = true).
drop policy if exists session_select on public.session_items;
create policy session_select on public.session_items for select
  using (public.as_is_master(campaign_id) or (revealed and public.as_is_member(campaign_id)));

drop policy if exists session_insert on public.session_items;
create policy session_insert on public.session_items for insert
  with check (public.as_is_master(campaign_id));

drop policy if exists session_update on public.session_items;
create policy session_update on public.session_items for update
  using (public.as_is_master(campaign_id)) with check (public.as_is_master(campaign_id));

drop policy if exists session_delete on public.session_items;
create policy session_delete on public.session_items for delete
  using (public.as_is_master(campaign_id));

-- Atualização em tempo real para a mesa toda.
do $$ begin
  alter publication supabase_realtime add table public.session_items;
exception when duplicate_object then null;
end $$;
