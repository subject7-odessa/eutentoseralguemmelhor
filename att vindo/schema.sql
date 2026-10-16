-- ARQUIVO SOMBRIO — esquema do Supabase
-- Cole tudo no SQL Editor do Supabase e clique em RUN (uma vez só).

create table profiles(
  id uuid primary key references auth.users on delete cascade,
  name text not null default 'Jogador'
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,name)
  values(new.id, coalesce(nullif(new.raw_user_meta_data->>'name',''),'Jogador'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create table campaigns(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  master uuid not null references auth.users on delete cascade,
  code text unique not null default substr(md5(gen_random_uuid()::text),1,6),
  created_at timestamptz default now()
);

create table members(
  campaign_id uuid references campaigns on delete cascade,
  user_id uuid references auth.users on delete cascade,
  primary key(campaign_id,user_id)
);

create table characters(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns on delete cascade,
  owner uuid not null references auth.users on delete cascade,
  name text not null default 'Novo Investigador',
  data jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table rolls(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  who text not null,
  label text not null,
  data jsonb not null default '{}',
  created_at timestamptz default now()
);

create table threats(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns on delete cascade,
  name text not null default 'Nova ameaça',
  text text not null default '',
  data jsonb not null default '{}'
);

-- funções auxiliares (evitam recursão nas regras)
create function is_member(cid uuid) returns boolean
language sql security definer stable set search_path=public as $$
  select exists(select 1 from members where campaign_id=cid and user_id=auth.uid()) $$;
create function is_master(cid uuid) returns boolean
language sql security definer stable set search_path=public as $$
  select exists(select 1 from campaigns where id=cid and master=auth.uid()) $$;

-- criar campanha e entrar por código
create function create_campaign(p_name text) returns uuid
language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  insert into campaigns(name,master) values(p_name,auth.uid()) returning id into cid;
  insert into members values(cid,auth.uid());
  return cid;
end $$;
create function join_campaign(p_code text) returns uuid
language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  select id into cid from campaigns where code=lower(trim(p_code));
  if cid is null then raise exception 'Código inválido'; end if;
  insert into members values(cid,auth.uid()) on conflict do nothing;
  return cid;
end $$;

-- permissões (RLS)
alter table profiles enable row level security;
alter table campaigns enable row level security;
alter table members enable row level security;
alter table characters enable row level security;
alter table rolls enable row level security;
alter table threats enable row level security;

create policy p_prof_sel on profiles for select to authenticated using (true);
create policy p_prof_upd on profiles for update to authenticated using (id=auth.uid());

create policy p_camp_sel on campaigns for select to authenticated using (is_member(id));
create policy p_camp_upd on campaigns for update to authenticated using (master=auth.uid());
create policy p_camp_del on campaigns for delete to authenticated using (master=auth.uid());

create policy p_mem_sel on members for select to authenticated using (is_member(campaign_id));
create policy p_mem_del on members for delete to authenticated using (user_id=auth.uid() or is_master(campaign_id));

-- ficha: todos da mesa veem; só o dono e o mestre editam
create policy p_ch_sel on characters for select to authenticated using (is_member(campaign_id));
create policy p_ch_ins on characters for insert to authenticated with check (is_member(campaign_id) and owner=auth.uid());
create policy p_ch_upd on characters for update to authenticated using (owner=auth.uid() or is_master(campaign_id));
create policy p_ch_del on characters for delete to authenticated using (owner=auth.uid() or is_master(campaign_id));

-- dados: todos da mesa veem; cada um só grava como si mesmo
create policy p_ro_sel on rolls for select to authenticated using (is_member(campaign_id));
create policy p_ro_ins on rolls for insert to authenticated with check (is_member(campaign_id) and user_id=auth.uid());

-- ameaças: só o mestre (para não vazar spoiler)
create policy p_th_all on threats for all to authenticated using (is_master(campaign_id)) with check (is_master(campaign_id));

-- tempo real
alter publication supabase_realtime add table characters, rolls, threats;
alter table characters replica identity full;
