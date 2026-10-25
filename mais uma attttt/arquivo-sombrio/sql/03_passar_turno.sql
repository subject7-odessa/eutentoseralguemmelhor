-- Arquivo Sombrio: jogador passa o próprio turno no combate.
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
--
-- O jogador só consegue passar o turno quando o personagem da vez é dele (o mestre passa qualquer turno).
-- A função faz a mesma conta do botão "Próximo turno": ordena por iniciativa (maior primeiro, empate pela
-- ordem em que entraram), vai para o próximo e, ao voltar ao primeiro, soma uma rodada.

create or replace function public.passar_turno(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.session_items%rowtype;
  d jsonb;
  arr jsonb;
  n int;
  i int;
  nxt int;
  rnd int;
  cur_item jsonb;
  dono uuid;
  eh_mestre boolean;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar';
  end if;

  eh_mestre := exists (select 1 from public.campaigns c where c.id = p_campaign and c.master = auth.uid());
  if not eh_mestre and not exists (
    select 1 from public.members m where m.campaign_id = p_campaign and m.user_id = auth.uid()
  ) then
    raise exception 'Você não faz parte desta campanha';
  end if;

  select * into r from public.session_items
   where campaign_id = p_campaign and kind = 'combate'
   order by created_at
   limit 1
   for update;
  if not found then
    raise exception 'Nenhum combate em andamento';
  end if;

  d := r.data;
  if coalesce((d->>'iniciado')::boolean, false) is not true then
    raise exception 'O combate ainda não começou';
  end if;

  select coalesce(
           jsonb_agg(e.v order by coalesce(nullif(e.v->>'ini', '')::numeric, 0) desc, e.ord),
           '[]'::jsonb)
    into arr
    from jsonb_array_elements(coalesce(d->'itens', '[]'::jsonb)) with ordinality as e(v, ord);

  n := jsonb_array_length(arr);
  if n = 0 then
    raise exception 'O combate não tem participantes';
  end if;

  select (t.ord - 1)::int into i
    from jsonb_array_elements(arr) with ordinality as t(v, ord)
   where t.v->>'id' = d->>'atual';
  if i is null then
    raise exception 'Turno atual inválido';
  end if;

  cur_item := arr -> i;
  if not eh_mestre then
    if cur_item->>'tipo' is distinct from 'agente' then
      raise exception 'Só o mestre passa o turno de uma ameaça';
    end if;
    select ch.owner into dono from public.characters ch where ch.id = (cur_item->>'ref')::uuid;
    if dono is distinct from auth.uid() then
      raise exception 'Não é o turno de um personagem seu';
    end if;
  end if;

  nxt := i + 1;
  rnd := coalesce((d->>'round')::int, 1);
  if nxt >= n then
    nxt := 0;
    rnd := rnd + 1;
  end if;

  d := jsonb_set(d, '{atual}', to_jsonb((arr -> nxt) ->> 'id'));
  d := jsonb_set(d, '{round}', to_jsonb(rnd));

  update public.session_items set data = d, updated_at = now() where id = r.id;
  return d;
end $$;

revoke all on function public.passar_turno(uuid) from public;
grant execute on function public.passar_turno(uuid) to authenticated;
