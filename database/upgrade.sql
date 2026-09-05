-- ===================================================================
-- Additive upgrades - safe to run on a database that already has data.
-- ===================================================================
--   npm run db:upgrade
--
-- Unlike schema.sql (which drops and recreates everything, and is only
-- for a brand new database), every statement here is written so that
-- running it twice changes nothing the second time. That is what makes
-- it safe against the live Supabase project.
-- ===================================================================

-- -------------------------------------------------------------------
-- 2026-09: assign an interviewer to a candidate.
--
-- Booking an interview already records who is running that one slot.
-- This is different: it is the person who owns the candidate through
-- the whole process, set once by HR, so an interviewer can open
-- "Candidates" and filter to the people who are actually theirs before
-- any interview has been booked.
-- -------------------------------------------------------------------
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS assigned_interviewer_id BIGINT
    REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS assigned_by BIGINT
    REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_assigned
  ON candidates (assigned_interviewer_id);
