-- ==============================================================================
-- StreamLounge: Create creator_youtube_tokens Table & Security Policies
-- File: docs/sql/create_creator_youtube_tokens.sql
-- Status: Idempotent Migration
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.creator_youtube_tokens (
    creator_id uuid PRIMARY KEY REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
    access_token text,
    refresh_token text,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.creator_youtube_tokens ENABLE ROW LEVEL SECURITY;

-- Creators can only access their own tokens
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'creator_youtube_tokens' AND policyname = 'creator_tokens_isolation'
    ) THEN
        CREATE POLICY creator_tokens_isolation
        ON public.creator_youtube_tokens
        FOR ALL
        TO authenticated
        USING (auth.uid() = creator_id)
        WITH CHECK (auth.uid() = creator_id);
    END IF;
END $$;
