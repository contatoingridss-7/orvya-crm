-- =====================================================================
-- Orvya — vendedor só altera contatos dos leads dele (SPEC 1, matriz).
-- Antes: qualquer membro da empresa podia alterar qualquer contato pela API.
-- Agora: gestor/admin alteram todos; vendedor altera o contato se tiver um lead
-- dele com esse contato, ou se o contato ainda não tem lead nenhum (cadastro novo).
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- security definer: precisa enxergar os leads de outros vendedores para decidir
-- (o RLS de leads esconderia esses leads e o "não tem lead" daria falso positivo).
create or replace function public.can_edit_contact(cid uuid, contact uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_company_manager(cid)
      or (public.has_company_access(cid) and (
            exists (select 1 from public.leads l where l.contact_id = contact and l.owner_id = (select auth.uid()))
         or not exists (select 1 from public.leads l where l.contact_id = contact)
      ));
$$;

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (public.can_edit_contact(company_id, id))
  with check (public.can_edit_contact(company_id, id));
