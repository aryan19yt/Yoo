-- ==============================================================================
-- StreamLounge: Add overlay_theme column to creator_profiles
-- File: docs/sql/add_overlay_theme.sql
-- Status: Idempotent Migration
-- ==============================================================================

-- 1. Add overlay_theme column if it does not exist
ALTER TABLE public.creator_profiles
ADD COLUMN IF NOT EXISTS overlay_theme text DEFAULT 'gold';

-- 2. Add check constraint for allowed themes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'creator_profiles_overlay_theme_check'
    ) THEN
        ALTER TABLE public.creator_profiles
        ADD CONSTRAINT creator_profiles_overlay_theme_check
        CHECK (overlay_theme IN ('emerald', 'crimson', 'violet', 'cyber-blue', 'gold', 'rose'));
    END IF;
END $$;
