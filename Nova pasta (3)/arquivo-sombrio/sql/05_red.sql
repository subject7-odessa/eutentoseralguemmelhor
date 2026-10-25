-- Arquivo Sombrio: suporte a mais de um sistema de jogo (Supernatural e Cyberpunk RED).
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Campanhas que já existem continuam sendo Supernatural.

alter table public.campaigns add column if not exists system text not null default 'supernatural';
alter table public.campaigns drop constraint if exists campaigns_system_check;
alter table public.campaigns add constraint campaigns_system_check check (system in ('supernatural', 'red'));

-- Substitui a função antiga (que só recebia o nome) por uma que também recebe o sistema.
drop function if exists public.create_campaign(text);
create or replace function public.create_campaign(p_name text, p_system text default 'supernatural') returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar'; end if;
  if p_system not in ('supernatural', 'red') then raise exception 'Sistema inválido'; end if;
  insert into campaigns(name, master, system) values (p_name, auth.uid(), p_system) returning id into cid;
  insert into members values (cid, auth.uid());
  return cid;
end $$;

revoke all on function public.create_campaign(text, text) from public;
grant execute on function public.create_campaign(text, text) to authenticated;
