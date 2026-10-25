-- Arquivo Sombrio: modelos de token (tokens genéricos e versões de personagem)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Requer o tabuleiro.sql e o tabuleiro_v2.sql já executados.
-- Só o mestre vê e mexe nos modelos (para não vazar imagem de criatura aos jogadores).

create table if not exists public.token_modelos (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null default 'Modelo',
  kind text not null default 'generic' check (kind in ('generic', 'char')),
  char_id uuid references public.characters(id) on delete cascade,   -- só nas versões de personagem
  image text,                                                          -- imagem pequena (data URL)
  shape text not null default 'circle' check (shape in ('circle', 'square', 'image')),
  size real not null default 1 check (size > 0 and size <= 20),
  created_at timestamptz not null default now()
);
create index if not exists token_modelos_campaign_idx on public.token_modelos (campaign_id);
alter table public.token_modelos enable row level security;

drop policy if exists modelos_all on public.token_modelos;
create policy modelos_all on public.token_modelos for all to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));
