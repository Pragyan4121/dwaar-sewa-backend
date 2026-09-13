-- Fix: the app's status vocabulary is inconsistent between the admin panel
-- ("verified") and the rest of the backend / provider app ("approved").
-- The original CHECK constraint only allowed 'verified', which caused every
-- Verify / Reactivate action to fail with a 500 error whenever the running
-- code attempted to write "approved" instead.
--
-- This migration widens the constraint to accept both values so neither
-- code path breaks. It does not change any existing data.

BEGIN;

ALTER TABLE provider_profiles
    DROP CONSTRAINT IF EXISTS chk_provider_profiles_verification_status;

ALTER TABLE provider_profiles
    ADD CONSTRAINT chk_provider_profiles_verification_status
        CHECK (
            verification_status IN (
                'pending',
                'verified',
                'approved',
                'rejected',
                'suspended'
            )
        );

COMMIT;
