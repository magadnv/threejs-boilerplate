-- Fäden · Supabase einrichten
-- Im Supabase-Dashboard: SQL Editor → New query → alles einfügen → Run.

create table public.faeden (
  id bigint generated always as identity primary key,
  wort text not null check (char_length(wort) between 1 and 24),
  name text check (name is null or char_length(name) <= 20),
  versteckt boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.faeden enable row level security;

-- Alle dürfen sichtbare Fäden lesen und neue spinnen, aber nichts ändern oder löschen.
create policy "lesen" on public.faeden for select to anon using (not versteckt);
create policy "spinnen" on public.faeden for insert to anon with check (not versteckt);

-- Bremse gegen Spam: höchstens 30 neue Fäden pro Minute, für alle zusammen.
create function public.faeden_bremse() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.faeden where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Zu viele Fäden auf einmal';
  end if;
  return new;
end $$;

create trigger bremse before insert on public.faeden
for each row execute function public.faeden_bremse();

-- Live-Updates für Wand und Handys.
alter publication supabase_realtime add table public.faeden;

-- Moderation: Im Table Editor bei einem Faden "versteckt" auf true setzen.
-- Die Wand nimmt ihn beim nächsten Abgleich (alle 2 Minuten) heraus.
