-- =====================================================================
-- Orvya — Personalização do perfil (pedido de 06/11/2026).
--
-- - profiles.avatar_path: foto da pessoa (bucket público "avatars", pasta = id do usuário).
--   Aparece redonda no topo de todas as telas.
-- - profiles.chat_wallpaper: papel de parede das conversas, escolhido por cada um.
-- Cada usuário só altera a própria foto e o próprio papel de parede.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists chat_wallpaper text;

alter table public.profiles drop constraint if exists profiles_chat_wallpaper_check;
alter table public.profiles add constraint profiles_chat_wallpaper_check
  check (chat_wallpaper is null or chat_wallpaper in ('vertices', 'topografia', 'pontos', 'aurora'));

-- Colunas que o próprio usuário pode alterar (além de nome e tema, já liberados na 0001).
grant update (avatar_path, chat_wallpaper) on public.profiles to authenticated;

-- Fotos de perfil: leitura pública (não são dados sensíveis), escrita só na própria pasta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
