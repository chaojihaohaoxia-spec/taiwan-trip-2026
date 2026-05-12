-- Taiwan Trip 2026 Supabase schema
-- Safe to run multiple times in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.trip_members (
  trip_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.trip_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL DEFAULT 'taiwan2026',
  invite_code text UNIQUE NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '7 days'
);

CREATE TABLE IF NOT EXISTS public.trip_user_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL DEFAULT 'taiwan2026',
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  state_key text NOT NULL,
  state_value jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(trip_id, user_id, state_key)
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text DEFAULT 'taiwan2026',
  date date,
  day_id text,
  category text,
  description text,
  amount numeric,
  currency text DEFAULT 'HKD',
  amount_hkd numeric,
  paid_by text,
  split_with text[],
  receipt_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL DEFAULT 'taiwan2026',
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  day_id text,
  item_id text,
  location_name text,
  caption text,
  photo_url text,
  checked_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_trip_member(check_trip_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members
    WHERE trip_id = check_trip_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_editor(check_trip_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members
    WHERE trip_id = check_trip_id
      AND user_id = auth.uid()
      AND role = 'editor'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_empty(check_trip_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.trip_members
    WHERE trip_id = check_trip_id
  );
$$;

ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_user_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_members' AND policyname = 'members can read same trip members') THEN
    CREATE POLICY "members can read same trip members"
      ON public.trip_members FOR SELECT
      USING (public.is_trip_member(trip_members.trip_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_members' AND policyname = 'first user can bootstrap trip membership') THEN
    CREATE POLICY "first user can bootstrap trip membership"
      ON public.trip_members FOR INSERT
      WITH CHECK (
        user_id = auth.uid()
        AND public.is_trip_empty(trip_members.trip_id)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_members' AND policyname = 'users can join through active invite') THEN
    CREATE POLICY "users can join through active invite"
      ON public.trip_members FOR INSERT
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.trip_invites i
          WHERE i.trip_id = trip_members.trip_id
            AND i.expires_at > now()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_invites' AND policyname = 'active invites are readable for join') THEN
    CREATE POLICY "active invites are readable for join"
      ON public.trip_invites FOR SELECT
      USING (expires_at > now());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_invites' AND policyname = 'editors can create invites') THEN
    CREATE POLICY "editors can create invites"
      ON public.trip_invites FOR INSERT
      WITH CHECK (
        created_by = auth.uid()
        AND public.is_trip_editor(trip_invites.trip_id)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_user_state' AND policyname = 'members can read same trip state') THEN
    CREATE POLICY "members can read same trip state"
      ON public.trip_user_state FOR SELECT
      USING (public.is_trip_member(trip_user_state.trip_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_user_state' AND policyname = 'editors can insert same trip state') THEN
    CREATE POLICY "editors can insert same trip state"
      ON public.trip_user_state FOR INSERT
      WITH CHECK (
        user_id = auth.uid()
        AND public.is_trip_editor(trip_user_state.trip_id)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_user_state' AND policyname = 'editors can update same trip state') THEN
    CREATE POLICY "editors can update same trip state"
      ON public.trip_user_state FOR UPDATE
      USING (public.is_trip_editor(trip_user_state.trip_id))
      WITH CHECK (
        user_id = auth.uid()
        AND public.is_trip_editor(trip_user_state.trip_id)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'expenses' AND policyname = 'trip members can access expenses') THEN
    CREATE POLICY "trip members can access expenses"
      ON public.expenses FOR ALL
      USING (public.is_trip_member(expenses.trip_id))
      WITH CHECK (public.is_trip_member(expenses.trip_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkins' AND policyname = 'Anyone can read Taiwan trip checkins') THEN
    CREATE POLICY "Anyone can read Taiwan trip checkins"
      ON public.checkins FOR SELECT
      USING (trip_id = 'taiwan2026');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkins' AND policyname = 'Logged-in users can create their own Taiwan trip checkins') THEN
    CREATE POLICY "Logged-in users can create their own Taiwan trip checkins"
      ON public.checkins FOR INSERT
      TO authenticated
      WITH CHECK (trip_id = 'taiwan2026' AND auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkins' AND policyname = 'Users can update their own Taiwan trip checkins') THEN
    CREATE POLICY "Users can update their own Taiwan trip checkins"
      ON public.checkins FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkins' AND policyname = 'Users can delete their own Taiwan trip checkins') THEN
    CREATE POLICY "Users can delete their own Taiwan trip checkins"
      ON public.checkins FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('trip-photos', 'trip-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read trip photos') THEN
    CREATE POLICY "Public read trip photos"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'trip-photos');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Logged-in users upload to their own trip folder') THEN
    CREATE POLICY "Logged-in users upload to their own trip folder"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'trip-photos'
        AND (storage.foldername(name))[1] = 'taiwan2026'
        AND (
          (storage.foldername(name))[2] = auth.uid()::text
          OR (storage.foldername(name))[2] = 'spot-reviews'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can update their own trip photos') THEN
    CREATE POLICY "Users can update their own trip photos"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'trip-photos'
        AND (storage.foldername(name))[1] = 'taiwan2026'
        AND (
          (storage.foldername(name))[2] = auth.uid()::text
          OR (storage.foldername(name))[2] = 'spot-reviews'
        )
      )
      WITH CHECK (
        bucket_id = 'trip-photos'
        AND (storage.foldername(name))[1] = 'taiwan2026'
        AND (
          (storage.foldername(name))[2] = auth.uid()::text
          OR (storage.foldername(name))[2] = 'spot-reviews'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can delete their own trip photos') THEN
    CREATE POLICY "Users can delete their own trip photos"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'trip-photos'
        AND (storage.foldername(name))[1] = 'taiwan2026'
        AND (
          (storage.foldername(name))[2] = auth.uid()::text
          OR (storage.foldername(name))[2] = 'spot-reviews'
        )
      );
  END IF;
END $$;
