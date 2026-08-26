-- ===================================================================
-- Altrium - PostgreSQL schema (Supabase)
-- ===================================================================
-- Scenario 1 - Recruitment & hiring tracker.
--
-- This is an INTERNAL system. The people who log in are HR / recruiters,
-- interviewers / hiring managers, and management (oversight). Job
-- candidates do NOT have accounts: HR adds them and uploads their CV.
--
-- Run this once against your Supabase project, either by pasting it into
-- the SQL Editor or with:   npm run db:migrate
--
-- It is safe to run again: everything is dropped and recreated, so the
-- script always produces the same result.
-- ===================================================================

-- CITEXT gives us case-insensitive text, so HR@HireTrack.test and
-- hr@hiretrack.test are the same address. Supabase has this available.
CREATE EXTENSION IF NOT EXISTS citext;

-- Drop in reverse dependency order so re-running is clean.
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS interviews CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;
DROP TABLE IF EXISTS job_stages CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS password_resets CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS job_status CASCADE;
DROP TYPE IF EXISTS employment_type CASCADE;
DROP TYPE IF EXISTS candidate_outcome CASCADE;
DROP TYPE IF EXISTS cv_band CASCADE;
DROP TYPE IF EXISTS feedback_recommendation CASCADE;
DROP TYPE IF EXISTS notification_channel CASCADE;
DROP TYPE IF EXISTS interview_response CASCADE;

-- -------------------------------------------------------------------
-- Enumerated types. In SQLite these were CHECK constraints; PostgreSQL
-- has real ENUM types, so an invalid value cannot even be written.
-- -------------------------------------------------------------------
CREATE TYPE user_role               AS ENUM ('hr', 'hiring_manager', 'interviewer', 'management');
CREATE TYPE job_status              AS ENUM ('ACTIVE', 'CLOSED');
CREATE TYPE employment_type         AS ENUM ('Full-time', 'Part-time', 'Contract', 'Internship');
CREATE TYPE candidate_outcome       AS ENUM ('ACTIVE', 'ON_HOLD', 'HIRED', 'REJECTED');
CREATE TYPE cv_band                 AS ENUM ('UNRATED', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE feedback_recommendation AS ENUM ('ADVANCE', 'HOLD', 'REJECT');
CREATE TYPE notification_channel    AS ENUM ('IN_APP', 'EMAIL');
-- An interviewer answers the booking rather than silently ignoring it.
CREATE TYPE interview_response      AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- -------------------------------------------------------------------
-- users - the staff who log in.
--   hr             - opens positions, adds candidates, runs the process
--   hiring_manager - works with candidates and makes the hire decision
--   interviewer    - leaves feedback at their stage
--   management     - oversight: sees everything, changes nothing
-- Accounts are created by HR. There is no public sign-up.
-- password_hash is NULL for accounts linked to Google sign-in.
-- -------------------------------------------------------------------
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         CITEXT      NOT NULL UNIQUE,
  password_hash TEXT,
  role          user_role   NOT NULL DEFAULT 'interviewer',
  job_title     TEXT        NOT NULL DEFAULT '',
  google_id     TEXT        UNIQUE,
  avatar_url    TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role ON users (role) WHERE is_active;

-- -------------------------------------------------------------------
-- jobs - the open positions
-- -------------------------------------------------------------------
CREATE TABLE jobs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title           TEXT            NOT NULL,
  department      TEXT            NOT NULL DEFAULT '',
  location        TEXT            NOT NULL DEFAULT '',
  employment_type employment_type NOT NULL DEFAULT 'Full-time',
  description     TEXT            NOT NULL DEFAULT '',
  salary_range    TEXT            NOT NULL DEFAULT '',
  closing_date    DATE,
  hiring_manager  BIGINT          REFERENCES users (id) ON DELETE SET NULL,
  status          job_status      NOT NULL DEFAULT 'ACTIVE',
  created_by      BIGINT          REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_status ON jobs (status);

-- -------------------------------------------------------------------
-- job_stages - the interview process for ONE position, in order.
-- Stages are set per position, which is why this is its own table
-- rather than a column on jobs.
-- -------------------------------------------------------------------
CREATE TABLE job_stages (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id   BIGINT  NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (job_id, name),
  UNIQUE (job_id, position)
);

CREATE INDEX idx_job_stages_job ON job_stages (job_id, position);

-- -------------------------------------------------------------------
-- candidates - one person against one position, added by HR.
-- current_stage is the stage NAME; outcome is tracked separately so a
-- candidate can be at "Interview" and ON_HOLD at the same time.
-- The CV file lives on disk; only its metadata is stored here.
-- -------------------------------------------------------------------
CREATE TABLE candidates (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id         BIGINT            NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  full_name      TEXT              NOT NULL,
  email          CITEXT            NOT NULL,
  phone          TEXT              NOT NULL DEFAULT '',
  source         TEXT              NOT NULL DEFAULT '',
  notes          TEXT              NOT NULL DEFAULT '',
  current_stage  TEXT              NOT NULL,
  outcome        candidate_outcome NOT NULL DEFAULT 'ACTIVE',
  -- Screening band. One advert can return hundreds of CVs, so each is
  -- banded once and the list is then filtered instead of re-read.
  cv_band        cv_band           NOT NULL DEFAULT 'UNRATED',
  cv_band_note   TEXT              NOT NULL DEFAULT '',
  cv_banded_by   BIGINT            REFERENCES users (id) ON DELETE SET NULL,
  cv_banded_at   TIMESTAMPTZ,
  cv_filename    TEXT,
  cv_stored_name TEXT,
  cv_mime        TEXT,
  cv_size        BIGINT,
  cv_uploaded_at TIMESTAMPTZ,
  added_by       BIGINT            REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  -- the same person cannot be added twice to one position
  UNIQUE (job_id, email)
);

CREATE INDEX idx_candidates_job     ON candidates (job_id);
CREATE INDEX idx_candidates_outcome ON candidates (outcome);
CREATE INDEX idx_candidates_band    ON candidates (job_id, cv_band);

-- -------------------------------------------------------------------
-- interviews - booked against a candidate at a stage
-- -------------------------------------------------------------------
CREATE TABLE interviews (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id      BIGINT      NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  stage             TEXT        NOT NULL,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  interviewer_id    BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  interviewer_name  TEXT        NOT NULL DEFAULT '',
  interviewer_email TEXT        NOT NULL DEFAULT '',
  location          TEXT        NOT NULL DEFAULT '',
  notes             TEXT        NOT NULL DEFAULT '',
  -- Has the interviewer said yes? An unanswered booking is the thing
  -- that quietly derails a hiring process, so it is tracked explicitly
  -- rather than assumed.
  response          interview_response NOT NULL DEFAULT 'PENDING',
  response_note     TEXT        NOT NULL DEFAULT '',
  responded_at      TIMESTAMPTZ,
  created_by        BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interviews_candidate   ON interviews (candidate_id, scheduled_at);
CREATE INDEX idx_interviews_interviewer ON interviews (interviewer_id, scheduled_at);

-- -------------------------------------------------------------------
-- feedback - one interviewer's verdict on one candidate at one stage.
-- The UNIQUE constraint is what makes the side-by-side comparison fair:
-- nobody can weight the result by scoring the same stage twice.
-- -------------------------------------------------------------------
CREATE TABLE feedback (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id   BIGINT                  NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  author_id      BIGINT                  REFERENCES users (id) ON DELETE SET NULL,
  stage          TEXT                    NOT NULL,
  rating         SMALLINT                NOT NULL CHECK (rating BETWEEN 1 AND 5),
  recommendation feedback_recommendation NOT NULL DEFAULT 'ADVANCE',
  strengths      TEXT                    NOT NULL DEFAULT '',
  concerns       TEXT                    NOT NULL DEFAULT '',
  comment        TEXT                    NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_id, stage, author_id)
);

CREATE INDEX idx_feedback_candidate ON feedback (candidate_id);

-- -------------------------------------------------------------------
-- notifications - how candidates and interviewers are told about an
-- interview.
--   IN_APP - for an interviewer, who has an account here.
--   EMAIL  - for a candidate, who does not. The message is written to
--            an outbox that HR sends and marks off. There is no mail
--            server in this project, so nothing is sent automatically.
-- -------------------------------------------------------------------
CREATE TABLE notifications (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel         notification_channel NOT NULL,
  -- What happened, so a role's notifications can be told apart and
  -- filtered. Free text rather than an ENUM: adding an event should not
  -- need a migration.
  kind            TEXT        NOT NULL DEFAULT 'general',
  user_id         BIGINT      REFERENCES users (id) ON DELETE CASCADE,
  recipient_email TEXT        NOT NULL DEFAULT '',
  recipient_name  TEXT        NOT NULL DEFAULT '',
  subject         TEXT        NOT NULL,
  body            TEXT        NOT NULL,
  candidate_id    BIGINT      REFERENCES candidates (id) ON DELETE CASCADE,
  interview_id    BIGINT      REFERENCES interviews (id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user    ON notifications (user_id, read_at);
CREATE INDEX idx_notifications_channel ON notifications (channel, sent_at);

-- -------------------------------------------------------------------
-- password_resets - we store a HASH of the token, never the token
-- -------------------------------------------------------------------
CREATE TABLE password_resets (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_resets_user ON password_resets (user_id);

-- -------------------------------------------------------------------
-- updated_at is maintained by the database with a trigger, so no query
-- can forget to set it. This is something SQLite could not do for us.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at      BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jobs_updated_at       BEFORE UPDATE ON jobs       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER candidates_updated_at BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
