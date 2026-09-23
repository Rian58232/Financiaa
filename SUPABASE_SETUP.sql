-- Configuração do Supabase para o Meu Controle Financeiro.
-- Pode ser executado novamente sem apagar os dados da tabela.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "meus dados" on public.app_state;
create policy "meus dados"
on public.app_state
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete
on public.app_state
to authenticated;
