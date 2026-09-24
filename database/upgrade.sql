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

-- -------------------------------------------------------------------
-- 2026-09: user_photos - the picture each person chose for their account
--
-- Kept out of the users table so that listing people never drags the
-- image bytes along; users.avatar_url points at the route that serves
-- it. Stored in the database rather than on disk because the live site
-- runs on servers that keep no files between requests.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_photos (
  user_id    BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  mime       TEXT        NOT NULL,
  data       BYTEA       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------------
-- 2026-09: users.contact_email - each person's real inbox
--
-- Staff sign in on the company domain, which has no mailboxes. This is
-- the address their email should really go to: password reset links,
-- interview invitations. Empty means the sign-in address is used, or
-- the company inbox for a staff address.
-- -------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email CITEXT;
