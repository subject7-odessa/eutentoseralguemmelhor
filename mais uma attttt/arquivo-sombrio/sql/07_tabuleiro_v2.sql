-- Arquivo Sombrio: tabuleiro v2 (desenho, régua em metros, névoa de guerra e token no formato da imagem)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Requer o tabuleiro.sql já executado.

-- Névoa de guerra: {"on": bool, "vis": casas de visão dos personagens, "r": [[x, y, raio], ...] áreas reveladas}
alter table public.scenes add column if not exists fog jsonb not null default '{"on":false,"vis":0,"r":[]}'::jsonb;

-- Token com a silhueta da própria imagem
alter table public.scene_tokens drop constraint if exists scene_tokens_shape_check;
alter table public.scene_tokens add constraint scene_tokens_shape_check check (shape in ('circle', 'square', 'image'));

-- Desenhos (lápis, linha, retângulo e círculo): todos da mesa desenham na cena ativa; cada um apaga os seus; o mestre apaga todos.
create table if not exists public.scene_drawings (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('pen', 'line', 'rect', 'circ')),
  color text not null default '#e0b84a',
  width real not null default 4 check (width > 0 and width <= 200),
  pts jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists scene_drawings_scene_idx on public.scene_drawings (scene_id);
alter table public.scene_drawings enable row level security;

drop policy if exists draw_select on public.scene_drawings;
create policy draw_select on public.scene_drawings for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and public.cena_ativa(scene_id)));
drop policy if exists draw_insert on public.scene_drawings;
create policy draw_insert on public.scene_drawings for insert to authenticated
  with check (author = auth.uid()
              and (public.is_master(campaign_id) or (public.is_member(campaign_id) and public.cena_ativa(scene_id)))
              and exists (select 1 from public.scenes s where s.id = scene_id and s.campaign_id = scene_drawings.campaign_id));
drop policy if exists draw_delete on public.scene_drawings;
create policy draw_delete on public.scene_drawings for delete to authenticated
  using (author = auth.uid() or public.is_master(campaign_id));

do $$ begin
  alter publication supabase_realtime add table public.scene_drawings;
exception when duplicate_object then null;
end $$;
