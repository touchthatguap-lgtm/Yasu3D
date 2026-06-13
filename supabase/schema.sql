-- Yasu3D leaderboard schema
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 1 and 20),
  time_ms    integer not null check (time_ms > 0),
  created_at timestamptz not null default now()
);

-- Index so "fastest times" queries stay quick.
create index if not exists scores_time_idx on public.scores (time_ms asc);

-- Row Level Security: the anon (public) key can only do what we allow below.
alter table public.scores enable row level security;

-- Anyone may read the leaderboard.
drop policy if exists "public read scores" on public.scores;
create policy "public read scores"
  on public.scores for select
  to anon, authenticated
  using (true);

-- Anyone may submit a score (insert only -- no update/delete from the browser).
drop policy if exists "public insert scores" on public.scores;
create policy "public insert scores"
  on public.scores for insert
  to anon, authenticated
  with check (true);
