-- Só para quem JÁ rodou o schema.sql da versão anterior.
-- Cole no SQL Editor e clique em RUN. Não apaga nada.
alter table characters add column if not exists created_at timestamptz default now();
alter table threats add column if not exists data jsonb not null default '{}';
