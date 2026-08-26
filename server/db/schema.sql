-- ===================================================================
-- HireTrack relational schema (SQLite)
-- ===================================================================
-- Tables:
--   users          - team members and clients (one login table)
--   jobs           - job vacancies
--   job_stages     - the ordered interview pipeline for each vacancy
--   applications   - a candidate applying to one vacancy (+ their CV)
--   interviews     - interviews scheduled against an application
--   feedback       - what an interviewer thought of a candidate at a stage
--   password_resets- one-time tokens for the "forgot password" flow
-- ===================================================================

PRAGMA foreign_keys = ON;

-- -------------------------------------------------------------------
-- users
-- There are two access levels:
--   STAFF  - developer / scrum_master / business_analyst / qa. These are
--            our four group members. The role is a LABEL only: all four
--            have exactly the SAME access, which is what we agreed.
--   CLIENT - anyone from outside who signs up to apply for a job. A
--            client only ever sees the open vacancies and their own
--            application, never anyone else's.
-- password_hash is NULL for accounts created through Google sign-in.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role          TEXT    NOT NULL DEFAULT 'developer'
                CHECK (role IN ('developer','scrum_master','business_analyst','qa','client')),
  google_id     TEXT    UNIQUE,
  avatar_url    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- -------------------------------------------------------------------
-- jobs (vacancies)
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
  status          TEXT    NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','CLOSED')),
  created_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

-- -------------------------------------------------------------------
-- job_stages - the pipeline, ordered by position (0,1,2,...)
-- Deleting a vacancy deletes its stages.
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
-- applications - one row per candidate per vacancy
-- current_stage is the stage NAME, outcome is tracked separately so a
-- candidate can be at "Interview" and "ON_HOLD" at the same time.
-- The CV is stored on disk; only its metadata lives in the database.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL REFERENCES jobs (id)  ON DELETE CASCADE,
  user_id        INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  full_name      TEXT    NOT NULL,
  email          TEXT    NOT NULL COLLATE NOCASE,
  phone          TEXT    NOT NULL DEFAULT '',
  source         TEXT    NOT NULL DEFAULT '',
  cover_note     TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  current_stage  TEXT    NOT NULL,
  outcome        TEXT    NOT NULL DEFAULT 'ACTIVE'
                 CHECK (outcome IN ('ACTIVE','ON_HOLD','HIRED','REJECTED')),
  -- Has the hiring team reviewed the CV yet? This is what the client
  -- sees while they wait ("under review" / "accepted" / "rejected").
  cv_status      TEXT    NOT NULL DEFAULT 'PENDING'
                 CHECK (cv_status IN ('PENDING','ACCEPTED','REJECTED')),
  cv_filename    TEXT,
  cv_stored_name TEXT,
  cv_mime        TEXT,
  cv_size        INTEGER,
  cv_uploaded_at TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  -- the same email cannot apply twice for the same vacancy
  UNIQUE (job_id, email)
);

CREATE INDEX IF NOT EXISTS idx_applications_job     ON applications (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_user    ON applications (user_id);
CREATE INDEX IF NOT EXISTS idx_applications_outcome ON applications (outcome);

-- -------------------------------------------------------------------
-- interviews
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interviews (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id    INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  stage             TEXT    NOT NULL,
  scheduled_at      TEXT    NOT NULL,
  interviewer_name  TEXT    NOT NULL DEFAULT '',
  interviewer_email TEXT    NOT NULL DEFAULT '',
  notes             TEXT    NOT NULL DEFAULT '',
  created_by        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interviews_application ON interviews (application_id, scheduled_at);

-- -------------------------------------------------------------------
-- feedback - an interviewer's verdict on one candidate at one stage.
-- One person can only leave one piece of feedback per stage, which is
-- what makes the side-by-side comparison fair.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  author_id      INTEGER          REFERENCES users (id) ON DELETE SET NULL,
  stage          TEXT    NOT NULL,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  recommendation TEXT    NOT NULL DEFAULT 'ADVANCE'
                 CHECK (recommendation IN ('ADVANCE','HOLD','REJECT')),
  strengths      TEXT    NOT NULL DEFAULT '',
  concerns       TEXT    NOT NULL DEFAULT '',
  comment        TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, stage, author_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_application ON feedback (application_id);

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
