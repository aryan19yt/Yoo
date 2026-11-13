-- ==============================================================================
-- StreamLounge: Harden Creator Data Isolation (Priority 1, Step 2)
-- File: docs/sql/harden_creator_data_isolation.sql
-- Status: PREPARED FOR MANUAL REVIEW & EXECUTION IN SUPABASE SQL EDITOR
--
-- IMPORTANT:
-- 1. First run docs/sql/audit_rls_and_policies.sql to inspect existing policy
--    names on your tables.
-- 2. In PostgreSQL, permissive RLS policies are OR-ed together. Adding a strict
--    policy will NOT close a leak if an older permissive policy (e.g. USING (true))
--    still exists on the same table/command/role. Drop any overly permissive
--    policies identified by the audit script before or alongside this migration.
-- 3. Do NOT execute destructive statements blindly. Review each section below.
-- ==============================================================================

-- ==============================================================================
-- SECTION 1: soundboard_sounds (VERIFIED LEAK FIX)
-- Issue found in live audit:
--   Anonymous queries on soundboard_sounds currently return enabled=true rows
--   belonging to creators whose public_page_enabled is NOT true.
-- Fix:
--   - Ensure RLS is enabled on public.soundboard_sounds.
--   - Restrict anon SELECT to global presets (creator_id IS NULL AND enabled = true)
--     OR enabled sounds owned by a creator with public_page_enabled = true.
--   - Restrict authenticated SELECT to global presets, the creator's own sounds
--     (auth.uid() = creator_id, including disabled sounds in dashboard), or
--     enabled sounds of public creators.
--   - Restrict INSERT/UPDATE/DELETE strictly to auth.uid() = creator_id.
-- ==============================================================================

ALTER TABLE public.soundboard_sounds ENABLE ROW LEVEL SECURITY;

-- IMPORTANT: Replace or drop any existing overly permissive SELECT policy on
-- public.soundboard_sounds (check exact policyname via audit_rls_and_policies.sql).
-- Example (uncomment after verifying the existing policy name):
-- DROP POLICY IF EXISTS "<existing_permissive_select_policy>" ON public.soundboard_sounds;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'soundboard_sounds'
          AND policyname = 'soundboard_sounds_anon_public_select'
    ) THEN
        CREATE POLICY soundboard_sounds_anon_public_select
        ON public.soundboard_sounds
        FOR SELECT
        TO anon
        USING (
            enabled = true
            AND (
                creator_id IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM public.creator_profiles cp
                    WHERE cp.id = soundboard_sounds.creator_id
                      AND cp.public_page_enabled = true
                )
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'soundboard_sounds'
          AND policyname = 'soundboard_sounds_auth_select'
    ) THEN
        CREATE POLICY soundboard_sounds_auth_select
        ON public.soundboard_sounds
        FOR SELECT
        TO authenticated
        USING (
            auth.uid() = creator_id
            OR (
                enabled = true
                AND (
                    creator_id IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM public.creator_profiles cp
                        WHERE cp.id = soundboard_sounds.creator_id
                          AND cp.public_page_enabled = true
                    )
                )
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'soundboard_sounds'
          AND policyname = 'soundboard_sounds_owner_insert'
    ) THEN
        CREATE POLICY soundboard_sounds_owner_insert
        ON public.soundboard_sounds
        FOR INSERT
        TO authenticated
        WITH CHECK (
            creator_id IS NOT NULL
            AND auth.uid() = creator_id
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'soundboard_sounds'
          AND policyname = 'soundboard_sounds_owner_update'
    ) THEN
        CREATE POLICY soundboard_sounds_owner_update
        ON public.soundboard_sounds
        FOR UPDATE
        TO authenticated
        USING (auth.uid() = creator_id)
        WITH CHECK (auth.uid() = creator_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'soundboard_sounds'
          AND policyname = 'soundboard_sounds_owner_delete'
    ) THEN
        CREATE POLICY soundboard_sounds_owner_delete
        ON public.soundboard_sounds
        FOR DELETE
        TO authenticated
        USING (auth.uid() = creator_id);
    END IF;
END $$;

-- ==============================================================================
-- SECTION 2: creator_interactions (OWNER ISOLATION)
-- Public viewers read enabled interactions exclusively via the SECURITY DEFINER
-- RPC public.get_public_interactions(p_username).
-- Direct table access must be restricted to the owning creator only.
-- ==============================================================================

ALTER TABLE public.creator_interactions ENABLE ROW LEVEL SECURITY;

-- If audit_rls_and_policies.sql shows any permissive anon/public SELECT policy
-- on public.creator_interactions, drop it after verifying its exact name.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'creator_interactions'
          AND policyname = 'creator_interactions_owner_isolation'
    ) THEN
        CREATE POLICY creator_interactions_owner_isolation
        ON public.creator_interactions
        FOR ALL
        TO authenticated
        USING (auth.uid() = creator_id)
        WITH CHECK (auth.uid() = creator_id);
    END IF;
END $$;

-- ==============================================================================
-- SECTION 3: creator_profiles (AUTHENTICATED OWNER ISOLATION)
-- Preserves Step 1:
--   - public_creator_profiles view (security_invoker = true)
--   - anon column-level SELECT on approved public columns + RLS on public_page_enabled = true
-- Ensures authenticated users cannot read private profiles or modify another creator's row.
-- ==============================================================================

ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'creator_profiles'
          AND policyname = 'creator_profiles_owner_update'
    ) THEN
        CREATE POLICY creator_profiles_owner_update
        ON public.creator_profiles
        FOR UPDATE
        TO authenticated
        USING (auth.uid() = id)
        WITH CHECK (auth.uid() = id);
    END IF;
END $$;

-- Note: Check existing SELECT policies on creator_profiles for `authenticated`
-- via audit_rls_and_policies.sql. Ensure any authenticated SELECT policy restricts
-- reads to: (auth.uid() = id OR public_page_enabled = true). Because
-- public_creator_profiles uses security_invoker = true, authenticated users
-- visiting another creator's public page still evaluate creator_profiles RLS.
-- Also verify column-level privileges on creator_profiles.email for `authenticated`:
-- no dashboard code selects `email` from creator_profiles (it reads auth.getUser().email),
-- so revoking column-level SELECT on `email` from `authenticated` (or restricting
-- direct `creator_profiles` reads) prevents one authenticated creator from reading
-- another creator's email address.

-- ==============================================================================
-- SECTION 4: storage.objects (PREVENT ANON LISTING OF interaction-audio ROOT)
-- Issue found in live audit:
--   anon can currently call storage.from('interaction-audio').list('') and
--   enumerate top-level folder names (creator_id UUIDs).
-- Verify existing policies on storage.objects with audit_rls_and_policies.sql
-- and ensure anon does NOT have broad SELECT/list on bucket_id = 'interaction-audio'
-- unless strictly scoped, while preserving viewer uploads and signed URL playback.
-- ==============================================================================
