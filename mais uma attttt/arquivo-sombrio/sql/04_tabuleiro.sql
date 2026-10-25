-- Arquivo Sombrio: tabuleiro virtual (cenas, mapas e tokens)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Requer o schema.sql já executado (usa is_member, is_master, campaigns e characters).
-- Isto também cria o armazenamento dos mapas (bucket privado "mapas"): você não precisa criar nada no painel.

-- ---------------------------------------------------------------- armazenamento dos mapas
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mapas', 'mapas', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Os arquivos ficam em "<id da campanha>/<id da cena>/arquivo". Esta função lê o id da campanha do caminho.
create or replace function public.mapas_campanha(p_path text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_path, '/', 1)::uuid;
exception when others then
  return null;
end $$;

drop policy if exists mapas_select on storage.objects;
create policy mapas_select on storage.objects for select to authenticated
  using (bucket_id = 'mapas' and public.is_member(public.mapas_campanha(name)));

drop policy if exists mapas_insert on storage.objects;
create policy mapas_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)));

drop policy if exists mapas_update on storage.objects;
create policy mapas_update on storage.objects for update to authenticated
  using (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)))
  with check (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)));

drop policy if exists mapas_delete on storage.objects;
create policy mapas_delete on storage.objects for delete to authenticated
  using (bucket_id = 'mapas' and public.is_master(public.mapas_campanha(name)));

-- ---------------------------------------------------------------- cenas
create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null default 'Nova cena',
  map_path text,                                   -- caminho do arquivo no bucket "mapas"
  map_w integer not null default 3000,             -- largura do mapa em pixels
  map_h integer not null default 2000,             -- altura do mapa em pixels
  grid jsonb not null default '{"show":true,"size":70,"ox":0,"oy":0,"opacity":0.35,"color":"#ffffff","snap":true}'::jsonb,
  active boolean not null default false,           -- a cena que os jogadores veem
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scenes_campaign_idx on public.scenes (campaign_id);
create unique index if not exists scenes_one_active on public.scenes (campaign_id) where active;

-- ---------------------------------------------------------------- tokens
create table if not exists public.scene_tokens (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null default 'Token',
  kind text not null default 'generic' check (kind in ('char', 'threat', 'generic')),
  char_id uuid references public.characters(id) on delete set null,  -- ficha vinculada (personagens)
  combat_ref text,                                 -- id do item no combate (ameaças)
  image text,                                      -- imagem pequena (data URL); personagens usam a foto da ficha
  x double precision not null default 0,           -- centro do token, em pixels do mapa
  y double precision not null default 0,
  size real not null default 1 check (size > 0 and size <= 20),      -- em casas da grade
  shape text not null default 'circle' check (shape in ('circle', 'square')),
  hidden boolean not null default false,           -- oculto: nunca é enviado aos jogadores
  owner_id uuid references auth.users(id) on delete set null,        -- quem pode mover (dono da ficha)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scene_tokens_scene_idx on public.scene_tokens (scene_id);
create index if not exists scene_tokens_campaign_idx on public.scene_tokens (campaign_id);

create or replace function public.cena_ativa(p_scene uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.scenes s where s.id = p_scene and s.active)
$$;

alter table public.scenes enable row level security;
alter table public.scene_tokens enable row level security;

-- Cenas: o mestre vê todas; os jogadores só veem a cena ativa.
drop policy if exists scenes_select on public.scenes;
create policy scenes_select on public.scenes for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and active));
drop policy if exists scenes_insert on public.scenes;
create policy scenes_insert on public.scenes for insert to authenticated
  with check (public.is_master(campaign_id));
drop policy if exists scenes_update on public.scenes;
create policy scenes_update on public.scenes for update to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));
drop policy if exists scenes_delete on public.scenes;
create policy scenes_delete on public.scenes for delete to authenticated
  using (public.is_master(campaign_id));

-- Tokens: o mestre vê todos; os jogadores só os não ocultos da cena ativa. Só o mestre grava direto.
drop policy if exists tokens_select on public.scene_tokens;
create policy tokens_select on public.scene_tokens for select to authenticated
  using (public.is_master(campaign_id)
         or (public.is_member(campaign_id) and not hidden and public.cena_ativa(scene_id)));
drop policy if exists tokens_insert on public.scene_tokens;
create policy tokens_insert on public.scene_tokens for insert to authenticated
  with check (public.is_master(campaign_id)
              and exists (select 1 from public.scenes s where s.id = scene_id and s.campaign_id = scene_tokens.campaign_id));
drop policy if exists tokens_update on public.scene_tokens;
create policy tokens_update on public.scene_tokens for update to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));
drop policy if exists tokens_delete on public.scene_tokens;
create policy tokens_delete on public.scene_tokens for delete to authenticated
  using (public.is_master(campaign_id));

-- ---------------------------------------------------------------- funções
-- O mestre escolhe a cena que os jogadores veem (só uma fica ativa por vez).
create or replace function public.ativar_cena(p_scene uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select campaign_id into cid from public.scenes where id = p_scene;
  if cid is null then raise exception 'Cena não encontrada'; end if;
  if not public.is_master(cid) then raise exception 'Só o mestre ativa cenas'; end if;
  update public.scenes set active = false, updated_at = now() where campaign_id = cid and active and id <> p_scene;
  update public.scenes set active = true, updated_at = now() where id = p_scene;
end $$;

-- O jogador move só o token do próprio personagem (o mestre move qualquer um).
create or replace function public.mover_token(p_token uuid, p_x double precision, p_y double precision) returns void
language plpgsql security definer set search_path = public as $$
declare t public.scene_tokens%rowtype;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar'; end if;
  select * into t from public.scene_tokens where id = p_token;
  if not found then raise exception 'Token não encontrado'; end if;
  if not public.is_member(t.campaign_id) then raise exception 'Você não faz parte desta campanha'; end if;
  if not public.is_master(t.campaign_id) then
    if t.hidden then raise exception 'Token indisponível'; end if;
    if not public.cena_ativa(t.scene_id) then raise exception 'Esta cena não está ativa'; end if;
    if t.owner_id is distinct from auth.uid() then raise exception 'Este token não é seu'; end if;
  end if;
  if p_x not between -100000 and 100000 or p_y not between -100000 and 100000 then
    raise exception 'Posição inválida';
  end if;
  update public.scene_tokens set x = p_x, y = p_y, updated_at = now() where id = p_token;
end $$;

revoke all on function public.ativar_cena(uuid) from public;
grant execute on function public.ativar_cena(uuid) to authenticated;
revoke all on function public.mover_token(uuid, double precision, double precision) from public;
grant execute on function public.mover_token(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------- tempo real
do $$ begin
  alter publication supabase_realtime add table public.scenes;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.scene_tokens;
exception when duplicate_object then null;
end $$;
