-- ===================================================================
-- HireTrack relational schema (SQLite)
-- ===================================================================
-- Scenario 1 - Recruitment & hiring tracker.
--
-- This is an INTERNAL tool. The people who log in are HR / recruiters,
-- interviewers / hiring managers, and management (oversight). Job
-- candidates do NOT have accounts: HR adds them and uploads their CV,
-- exactly as the brief describes.
--
-- Tables:
--   users          - the staff who log in
--   jobs           - open positions
--   job_stages     - the interview stages configured for one position
--   candidates     - a person being considered for one position (+ CV)
--   interviews     - interviews scheduled against a candidate
--   feedback       - an interviewer's verdict at one stage
--   notifications  - how candidates and interviewers are told about an
--                    interview (in-app for staff, outbox for candidates)
--   password_resets- one-time tokens for the "forgot password" flow
-- ===================================================================

PRAGMA foreign_keys = ON;

-- -------------------------------------------------------------------
-- users - staff only. Roles carry different permissions:
--   hr             - opens positions, adds candidates, runs the process
--   hiring_manager - works with candidates and makes the hire decision
--   interviewer    - leaves feedback at their stage
--   management     - oversight: sees everything, changes nothing,
--                    exports reports
-- Accounts are created by HR. There is no public sign-up.
-- password_hash is NULL for accounts created through Google sign-in.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role          TEXT    NOT NULL DEFAULT 'interviewer'
                CHECK (role IN ('hr','hiring_manager','interviewer','management')),
  job_title     TEXT    NOT NULL DEFAULT '',
  google_id     TEXT    UNIQUE,
  avatar_url    TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- -------------------------------------------------------------------
-- jobs - the open positions
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  department      TEXT    NOT NULL DEFAULT '',
  location        TEXT    NOT NULL DEFAULT '',
  employment_type TEXT    NOT NULL DEFAULT 'Full-time'
                  CHECK (employment_type IN ('Full-time','Part-time','Contract','Internship')),
  description     TEXT    NOT NULL DEFAULT '',
  salary_range    TEXT    NOT NULL DEFAULT '',
  closing_date    TEXT,
  hiring_manager  INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  status          TEXT    NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','CLOSED')),
  created_by      INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

-- -------------------------------------------------------------------
-- job_stages - the interview process for ONE position, in order.
-- The brief asks whether stages should be the same for every position
-- or set per position; we set them per position, which is why this is
-- its own table rather than a column on jobs.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_stages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id   INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (job_id, name),
  UNIQUE (job_id, position)
);

CREATE INDEX IF NOT EXISTS idx_job_stages_job ON job_stages (job_id, position);

-- -------------------------------------------------------------------
-- candidates - one person against one position, added by HR.
-- current_stage is the stage NAME; outcome is tracked separately so a
-- candidate can be at "Interview" and ON_HOLD at the same time.
-- The CV is stored on disk; only its metadata lives here.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  full_name      TEXT    NOT NULL,
  email          TEXT    NOT NULL COLLATE NOCASE,
  phone          TEXT    NOT NULL DEFAULT '',
  source         TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  current_stage  TEXT    NOT NULL,
  outcome        TEXT    NOT NULL DEFAULT 'ACTIVE'
                 CHECK (outcome IN ('ACTIVE','ON_HOLD','HIRED','REJECTED')),
  -- Screening band. A single advert can return hundreds of CVs, so each
  -- one is banded once and the list is then filtered and sorted by it.
  cv_band        TEXT    NOT NULL DEFAULT 'UNRATED'
                 CHECK (cv_band IN ('UNRATED','HIGH','MEDIUM','LOW')),
  cv_band_note   TEXT    NOT NULL DEFAULT '',
  cv_banded_by   INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  cv_banded_at   TEXT,
  cv_filename    TEXT,
  cv_stored_name TEXT,
  cv_mime        TEXT,
  cv_size        INTEGER,
  cv_uploaded_at TEXT,
  added_by       INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  -- the same person cannot be added twice to one position
  UNIQUE (job_id, email)
);

CREATE INDEX IF NOT EXISTS idx_candidates_job     ON candidates (job_id);
CREATE INDEX IF NOT EXISTS idx_candidates_outcome ON candidates (outcome);
CREATE INDEX IF NOT EXISTS idx_candidates_band    ON candidates (job_id, cv_band);

-- -------------------------------------------------------------------
-- interviews - scheduled against a candidate at a stage, with the
-- interviewer who will run it.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interviews (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id      INTEGER NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  stage             TEXT    NOT NULL,
  scheduled_at      TEXT    NOT NULL,
  interviewer_id    INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  interviewer_name  TEXT    NOT NULL DEFAULT '',
  interviewer_email TEXT    NOT NULL DEFAULT '',
  location          TEXT    NOT NULL DEFAULT '',
  notes             TEXT    NOT NULL DEFAULT '',
  created_by        INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interviews_candidate   ON interviews (candidate_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_interviews_interviewer ON interviews (interviewer_id, scheduled_at);

-- -------------------------------------------------------------------
-- feedback - one interviewer's verdict on one candidate at one stage.
-- One person can only leave one score per stage, which is what makes
-- the side-by-side comparison fair.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id   INTEGER NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  author_id      INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  stage          TEXT    NOT NULL,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  recommendation TEXT    NOT NULL DEFAULT 'ADVANCE'
                 CHECK (recommendation IN ('ADVANCE','HOLD','REJECT')),
  strengths      TEXT    NOT NULL DEFAULT '',
  concerns       TEXT    NOT NULL DEFAULT '',
  comment        TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (candidate_id, stage, author_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_candidate ON feedback (candidate_id);

-- -------------------------------------------------------------------
-- notifications - the brief asks "how are candidates and interviewers
-- told about a scheduled interview?".
--   IN_APP - for an interviewer who has an account here.
--   EMAIL  - for a candidate, who does not. The message is written to
--            an outbox that HR can see and send; there is no mail
--            server in this project, so it is not sent automatically.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel         TEXT    NOT NULL CHECK (channel IN ('IN_APP','EMAIL')),
  user_id         INTEGER          REFERENCES users (id) ON DELETE CASCADE,
  recipient_email TEXT    NOT NULL DEFAULT '',
  recipient_name  TEXT    NOT NULL DEFAULT '',
  subject         TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  candidate_id    INTEGER          REFERENCES candidates (id) ON DELETE CASCADE,
  interview_id    INTEGER          REFERENCES interviews (id) ON DELETE CASCADE,
  read_at         TEXT,
  sent_at         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications (channel, sent_at);

-- -------------------------------------------------------------------
-- password_resets - we store a HASH of the token, never the token
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
