-- Arquivo Sombrio: conteúdo privado do mestre (capítulos do Livro que não devem chegar aos jogadores).
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Depois, entre no site como mestre, abra a aba Livro e use "Importar conteúdo do mestre" com o arquivo mestre.json.
-- O conteúdo fica ligado à SUA conta: só você consegue ler, em qualquer campanha em que você seja o mestre.

create table if not exists public.conteudo_mestre (
  owner uuid not null references auth.users(id) on delete cascade,
  chave text not null,
  dados jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, chave)
);
alter table public.conteudo_mestre enable row level security;

drop policy if exists conteudo_select on public.conteudo_mestre;
create policy conteudo_select on public.conteudo_mestre for select to authenticated using (owner = auth.uid());
drop policy if exists conteudo_insert on public.conteudo_mestre;
create policy conteudo_insert on public.conteudo_mestre for insert to authenticated with check (owner = auth.uid());
drop policy if exists conteudo_update on public.conteudo_mestre;
create policy conteudo_update on public.conteudo_mestre for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists conteudo_delete on public.conteudo_mestre;
create policy conteudo_delete on public.conteudo_mestre for delete to authenticated using (owner = auth.uid());
