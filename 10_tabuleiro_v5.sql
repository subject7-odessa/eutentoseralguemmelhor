-- Arquivo Sombrio: GIFs sem limite pequeno (guardados como arquivo) e iluminação dinâmica do tabuleiro
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run. É seguro rodar mais de uma vez.
-- Requer o tabuleiro.sql, o tabuleiro_v2.sql, o tabuleiro_v3.sql e o tabuleiro_v4.sql já executados.

-- 1) O bucket dos mapas passa a aceitar GIF, com arquivos de até 20 MB (o plano gratuito do Supabase tem 1 GB de espaço no total)
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
       file_size_limit = 20971520
 where id = 'mapas';

-- 2) Iluminação da cena: brilho e tema de cor do ambiente, luz dinâmica, paredes, portas e luzes
--    {"on":false,"amb":0.85,"vis":6,"bri":100,"cor":"#ffffff","forca":0,"tema":"","walls":[[x1,y1,x2,y2,tipo]],"lights":[[x,y,raio,"#cor"]]}
--    tipo da parede: 0 = parede, 1 = porta fechada, 2 = porta aberta
alter table public.scenes add column if not exists luz jsonb not null default '{"on":false,"amb":0.85,"vis":6,"walls":[],"lights":[],"bri":100,"cor":"#ffffff","forca":0,"tema":""}'::jsonb;

-- 3) Luz (tocha) e visão no escuro de cada token, em casas da grade
alter table public.scene_tokens add column if not exists luz real;
alter table public.scene_tokens add column if not exists visao real;
alter table public.scene_tokens drop constraint if exists scene_tokens_luz_check;
alter table public.scene_tokens add constraint scene_tokens_luz_check check (luz is null or (luz >= 0 and luz <= 60));
alter table public.scene_tokens drop constraint if exists scene_tokens_visao_check;
alter table public.scene_tokens add constraint scene_tokens_visao_check check (visao is null or (visao >= 0 and visao <= 60));

-- 4) Os modelos de token guardam luz e visão também
alter table public.token_modelos add column if not exists luz real;
alter table public.token_modelos add column if not exists visao real;
