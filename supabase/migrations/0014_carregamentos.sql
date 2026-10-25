-- =====================================================================
-- Orvya — registro dos carregamentos do catálogo.
--
-- Cada importação (Net Use ou planilha) grava quem fez, quando, quais arquivos e o
-- resultado. A tela mostra o último carregamento até o próximo; os produtos e o
-- histórico de vendas já ficam no banco e não dependem de deploy.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.catalog_imports (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  files          jsonb not null default '[]',   -- [{ name, label, detail }]
  inserted       int not null default 0,
  updated        int not null default 0,
  deactivated    int not null default 0,
  sales_periods  int not null default 0
);
create index if not exists catalog_imports_company_idx on public.catalog_imports (company_id, created_at desc);

alter table public.catalog_imports enable row level security;

-- A equipe vê quando o catálogo foi carregado; só gestor e admin registram.
drop policy if exists catalog_imports_select on public.catalog_imports;
create policy catalog_imports_select on public.catalog_imports for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists catalog_imports_insert on public.catalog_imports;
create policy catalog_imports_insert on public.catalog_imports for insert to authenticated
  with check (public.is_company_manager(company_id));

-- Carregamentos feitos antes deste registro: um marco com a data dos produtos importados.
insert into public.catalog_imports (company_id, created_by, created_at, inserted)
select p.company_id, null, max(p.updated_at), count(*)
from public.products p
where p.source in ('netuse', 'planilha')
  and not exists (select 1 from public.catalog_imports i where i.company_id = p.company_id)
group by p.company_id;
