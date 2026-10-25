-- Arquivo Sombrio: cor da borda dos tokens e versões para qualquer token (genéricos e ameaças)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Requer o tabuleiro.sql, o tabuleiro_v2.sql e o tabuleiro_v3.sql já executados.

-- Cor da borda de cada token (nula = cor padrão do tipo)
alter table public.scene_tokens add column if not exists cor text;
alter table public.scene_tokens drop constraint if exists scene_tokens_cor_check;
alter table public.scene_tokens add constraint scene_tokens_cor_check check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$');

-- Modelos: nome da criatura (grupo das versões), cor e tipo "ameaça"
alter table public.token_modelos add column if not exists grupo text;
alter table public.token_modelos add column if not exists cor text;
alter table public.token_modelos drop constraint if exists token_modelos_cor_check;
alter table public.token_modelos add constraint token_modelos_cor_check check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$');
alter table public.token_modelos drop constraint if exists token_modelos_kind_check;
alter table public.token_modelos add constraint token_modelos_kind_check check (kind in ('generic', 'char', 'threat'));
