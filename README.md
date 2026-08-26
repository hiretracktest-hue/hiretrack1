# HireTrack

Our answer to **Scenario 1 — Recruitment & hiring tracker** from the COMP50074
project scenarios, built for our second year, second semester group project.

> *"Open positions, add candidates, and move them through a configurable
> interview process to a hire decision."*

The hiring team posts **vacancies**, clients **apply and upload a CV**, the team
**accepts or rejects each CV**, moves candidates through a configurable
**interview pipeline**, leaves **interview feedback** at each stage, **compares
candidates side by side**, and records the final **outcome**.

| Layer | Technology |
| --- | --- |
| Front end | React 18 (JSX), React Router, plain CSS, built with Vite |
| Back end | Node.js + Express (REST API) |
| Database | SQLite (SQL) accessed with `better-sqlite3` |
| Auth | Email + password (bcrypt hashing) with a JWT in an httpOnly cookie, plus optional "Sign in with Google" |
| Tests | Node's built-in test runner (`node:test`) — 41 API tests |

---

## 1. Quick start

You need [Node.js](https://nodejs.org) 18.18 or newer (`node -v` to check).

```bash
npm run setup
```

That one command installs the back end packages, installs the front end
packages, and fills the database with demo data. Then:

```bash
npm run dev
```

- React app → <http://localhost:5173>
- Express API → <http://localhost:4000>

Sign in with any of these demo accounts:

**The hiring team** — all four have exactly the same, full access:

| Name | Role | Email | Password |
| --- | --- | --- | --- |
| Isuru | Developer | `isuru@gmail.com` | `123` |
| Fazl | Scrum Master | `fazl@gmail.com` | `123` |
| Thariq | Business Analyst | `thariq@gmail.com` | `123` |
| Ahmed | QA Engineer | `ahmed@gmail.com` | `123` |

**Clients** — people from outside who apply for a job. They only ever see the
open vacancies and their own application:

| Name | Email | Password |
| --- | --- | --- |
| Maya Fernando | `maya.fernando@gmail.com` | `123` |
| Dinuka Perera | `dinuka.perera@gmail.com` | `123` |
| Nimasha Silva | `nimasha.silva@gmail.com` | `123` |
| Rashmi Jayawardena | `rashmi.jayawardena@gmail.com` | `123` |

> `123` is a demo password so it is quick to type in the presentation. These
> rows are written straight into the database by the seed script, so they skip
> the sign-up rules — anyone registering through the **sign-up form** still
> needs 8+ characters with a letter and a number. Edit `server/seed.js` and run
> `npm run seed:reset` to change them.

### Running it as one server (for a demo or deployment)

```bash
npm run build
npm start
```

Express then serves the built React app as well, so everything is on
<http://localhost:4000>.

### All the commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Install everything and seed the database |
| `npm run dev` | Run the API and the React dev server together |
| `npm run build` | Build the React app into `client/dist` |
| `npm start` | Run the API, serving the built React app too |
| `npm test` | Run the automated API tests |
| `npm run seed` | Add any missing demo data (safe to re-run) |
| `npm run seed:reset` | Empty every table, then seed from scratch |

---

## 2. How this matches Scenario 1

| Scenario 1 asks for | Where it is in our app |
| --- | --- |
| HR opens positions with a job description | `/jobs/new` — title, department, location, type, salary, closing date, description |
| Sets the interview stages **for each position** | Stage chips on the vacancy form; stored in the `job_stages` table, one row per stage with its `position` |
| Adds candidates | "Add candidate" on a vacancy, or the client applies themselves |
| Tracks every candidate to hired / rejected / on hold | Outcome on the candidate page, kept separate from the pipeline stage |
| Interviewers log in to leave feedback **at their stage** | "Interview feedback" on the candidate page — score out of 5, advance/hold/reject, strengths, concerns |
| Candidates compared **fairly, side by side** | "Compare candidates" on a vacancy — average score per stage, ranked, one score per interviewer per stage |
| Candidates and interviewers told about a scheduled interview | Interview scheduling with date, interviewer and notes (email sending is out of scope — see section 10) |
| **Who logs in, and what can each role see and do?** | Two access levels — see below |

### Who logs in

| | Hiring team (Developer, Scrum Master, BA, QA) | Client |
| --- | --- | --- |
| Browse open vacancies | ✅ | ✅ |
| Apply for a job | ✅ (for anyone) | ✅ (as themselves only) |
| Upload / replace their CV | ✅ (any candidate) | ✅ (their own only) |
| See whether their CV was accepted | ✅ | ✅ |
| See **other** candidates | ✅ | ❌ |
| Create, edit, close, delete vacancies | ✅ | ❌ |
| Move candidates through the pipeline | ✅ | ❌ |
| Accept or reject a CV | ✅ | ❌ |
| Leave interview feedback, compare candidates | ✅ | ❌ |
| Schedule interviews | ✅ | ❌ |
| See the team list and the dashboard | ✅ | ❌ |

All four of us have **identical** permissions — the API checks *staff versus
client*, never which of the four roles you are. The role is a label that says
who did what on the coursework.

### What a client actually experiences

1. Signs up (or signs in with Google), lands on **Open vacancies**.
2. Opens a job, presses **Apply for this job** — name and email come from their
   account, so nobody can apply as somebody else.
3. Uploads their CV (PDF/DOC/DOCX, max 5 MB) and sees **"Under review"**.
4. Waits. When a team member presses **Accept CV** or **Reject CV** on the
   candidate page, the client's own page changes to **"CV accepted"** or
   **"Not successful"** with a short explanation.
5. Replacing the CV puts them back to "Under review" automatically.

---

## 3. What the app does

### Accounts

- **Sign up** with a name, email (a Gmail address works fine) and password.
- **Sign in / sign out.**
- **Forgot password** — creates a one-time reset link that expires after an
  hour. The project has no mail server, so in development the link is shown on
  screen and printed in the API console. Only a SHA-256 *hash* of the token is
  stored in the database.
- **Change password** from your profile page.
- **Sign in with Google** (optional, see section 7).

### Vacancies (`/jobs`)

- Create, edit, close, reopen and delete a vacancy.
- Each vacancy has its **own ordered interview pipeline** — add, remove and
  reorder stages such as `Applied → Screening → Technical Interview → Offer`.
- The vacancy page lists **everyone who has applied** to it, with their stage,
  outcome and CV.

### Candidates (`/candidates`)

- Apply to a vacancy from the vacancy page; the candidate starts on the first
  stage of that vacancy's pipeline.
- Search by name or email, and filter by vacancy or outcome.
- On a candidate's page you can:
  - **Move them to the next stage** in the pipeline,
  - **Record an outcome** (Active / On hold / Hired / Rejected) — kept separate
    from the stage, so someone can be at "Interview" *and* on hold,
  - **Upload, replace, download or remove their CV** (PDF, DOC, DOCX, max 5 MB),
  - **Accept or reject the CV** — this is the decision the client is waiting on,
  - **Leave interview feedback** — a score out of 5, an advance/hold/reject
    recommendation, strengths and concerns, one per interviewer per stage,
  - **Schedule and cancel interviews**,
  - edit their details and internal notes.

### Comparing candidates (`/jobs/:id/compare`)

Every candidate for one vacancy in a single table: their average score overall
and at each stage, how many advance / hold / reject recommendations they have,
their CV status and their outcome — ranked best first.

### Team (`/team`)

Our group is four people:

| Name | Role | Responsibility |
| --- | --- | --- |
| Isuru | Developer | Builds the React front end and the Express/SQL back end |
| Fazl | Scrum Master | Runs the sprints, stand-ups and the sprint board |
| Thariq | Business Analyst | Gathers requirements and writes the user stories |
| Ahmed | QA Engineer | Writes the test cases and verifies each story before it is done |

The role is stored on the user record as a **label only**: the API checks that a
request comes from a signed-in user but never checks *which* role, so all four
of us have exactly the same access, which is what we agreed.

---

## 4. Project structure

```
our web/
├── package.json            back end dependencies + all the npm scripts
├── .env.example            copy to .env for your own settings
│
├── server/                 Express REST API
│   ├── index.js            starts the server
│   ├── app.js              builds the Express app (kept separate so tests can use it)
│   ├── config.js           reads .env, holds the settings and the role list
│   ├── auth.js             password hashing, JWT, cookies, reset tokens
│   ├── middleware.js       attach user / require login / error handling
│   ├── validate.js         input validation helpers
│   ├── upload.js           CV upload rules (type, size, safe filenames)
│   ├── seed.js             demo data
│   ├── db/
│   │   ├── schema.sql      the SQL schema (all six tables)
│   │   ├── index.js        opens the SQLite database and applies the schema
│   │   └── app.db          created on first run - not committed to Git
│   ├── uploads/            uploaded CV files - not committed to Git
│   ├── routes/
│   │   ├── auth.routes.js          sign up / in / out, forgot + reset, Google
│   │   ├── jobs.routes.js          vacancies and their stages
│   │   ├── applications.routes.js  candidates, CVs, stage progression
│   │   ├── interviews.routes.js    scheduling
│   │   └── team.routes.js          team list, profile, dashboard stats
│   └── tests/api.test.js   26 automated tests
│
└── client/                 React front end
    ├── index.html          the HTML page React renders into
    ├── vite.config.js      dev server + /api proxy to Express
    └── src/
        ├── main.jsx        entry point
        ├── App.jsx         all the routes, and the "must be signed in" guard
        ├── api.js          one wrapper around fetch() for the whole app
        ├── AuthContext.jsx keeps the signed-in user in React state
        ├── styles.css      the whole stylesheet
        ├── components/     Layout (nav bar) + small shared UI pieces
        └── pages/          one file per screen
```

---

## 5. The database

Seven tables, defined in [`server/db/schema.sql`](server/db/schema.sql):

```
users ──────< jobs ──────< job_stages
  │             │
  │             └─────< applications >───── interviews
  │                          
  └─────< password_resets
```

| Table | Holds |
| --- | --- |
| `users` | The hiring team and the clients. `role` is `developer` / `scrum_master` / `business_analyst` / `qa` (staff) or `client`; `password_hash` is `NULL` for Google-only accounts. |
| `jobs` | The vacancies. `status` is `ACTIVE` or `CLOSED`. |
| `job_stages` | The ordered pipeline for one vacancy (`position` 0, 1, 2 …). |
| `applications` | One candidate applying to one vacancy, plus their CV details and `cv_status` (`PENDING` / `ACCEPTED` / `REJECTED`). `UNIQUE (job_id, email)` stops duplicate applications. |
| `interviews` | Interviews booked against an application. |
| `feedback` | One interviewer's score (1-5), recommendation, strengths and concerns for one candidate at one stage. `UNIQUE (application_id, stage, author_id)` means nobody can vote twice. |
| `password_resets` | One-time reset tokens (hashed) with an expiry. |

Points worth mentioning in the report:

- **Foreign keys are enforced** (`PRAGMA foreign_keys = ON`), with
  `ON DELETE CASCADE` so deleting a vacancy cleans up its stages and
  applications.
- **`CHECK` constraints** keep `status`, `outcome`, `role` and
  `employment_type` valid at the database level, not only in the code.
- **Every query is parameterised** (`?` placeholders), so SQL injection is not
  possible.
- **Stage changes are validated** against that vacancy's own pipeline, and a
  stage that candidates are still sitting on cannot be deleted.

---

## 6. API reference

All responses are JSON. Everything except the public vacancy list needs the
login cookie, which the browser sends automatically.

### Auth — `/api/auth`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/config` | Which sign-in options are enabled |
| `POST` | `/signup` | Create an account |
| `POST` | `/signin` | Sign in |
| `POST` | `/signout` | Sign out |
| `GET` | `/me` | The signed-in user, or `null` |
| `POST` | `/change-password` | Change your own password |
| `POST` | `/forgot-password` | Create a reset link |
| `POST` | `/reset-password` | Use a reset token |
| `GET` | `/google` · `/google/callback` | Google sign-in (if configured) |

### Vacancies — `/api/jobs`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | List vacancies (`?q=` search, `?status=ACTIVE`) |
| `GET` | `/:id` | One vacancy with its stages |
| `POST` | `/` | Create |
| `PATCH` | `/:id` | Edit, reorder stages, close or reopen |
| `DELETE` | `/:id` | Delete (blocked once it has applications) |

### Candidates — `/api/applications`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | List (`?job=`, `?outcome=`, `?q=`, `?mine=1`) |
| `GET` | `/:id` | One candidate, their pipeline and interviews |
| `POST` | `/` | Apply to a vacancy |
| `PATCH` | `/:id` | Edit details, stage or outcome |
| `POST` | `/:id/advance` | Move to the next stage (team only) |
| `POST` | `/:id/cv-review` | Accept or reject the CV (team only) |
| `POST` | `/:id/cv` | Upload or replace the CV |
| `GET` | `/:id/cv` | Download the CV |
| `DELETE` | `/:id/cv` | Remove the CV |
| `DELETE` | `/:id` | Delete the application |

### Interviews — `/api/interviews`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | List (`?application=`, `?upcoming=1`) |
| `POST` | `/` | Schedule |
| `DELETE` | `/:id` | Cancel |

### Feedback and comparison — `/api/feedback` (team only)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | List feedback (`?application=`, `?mine=1`) |
| `POST` | `/` | Leave or update my score for one stage |
| `DELETE` | `/:id` | Delete feedback I wrote |
| `GET` | `/compare/:jobId` | Every candidate for a vacancy, scored side by side |

### Team — `/api/team`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | The four team members and their roles |
| `PATCH` | `/me` | Update your own name and role |
| `GET` | `/stats` | Dashboard numbers |

---

## 7. Optional: "Sign in with Google"

Email and password sign-in works with any address, including Gmail. If you also
want the **Continue with Google** button:

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create an **OAuth 2.0 Client ID** → *Web application*.
3. Add the authorised redirect URI:
   `http://localhost:4000/api/auth/google/callback`
4. Copy `.env.example` to `.env` and paste in your client ID and secret.
5. Restart the server — the button appears on the sign-in and sign-up pages.

Without those two values the button is hidden and nothing else changes.

---

## 8. Testing

```bash
npm test
```

41 tests run against a temporary throw-away database, covering:

- sign up and sign in, password rules, the one-time reset token
- the stage pipeline, duplicate applications, invalid ids
- CV upload and download, including rejecting a `.txt` file
- interview scheduling and invalid dates
- **interviewer feedback** — rating limits, one score per person per stage, and
  the comparison ranking
- **client isolation** — a client cannot create a vacancy, read the team list,
  open somebody else's application, download another CV, move themselves along
  the pipeline, or accept their own CV, and applies as themselves even if they
  type a different name and email
- **equal team access** — a QA account can do everything a Developer account can

Manual test cases can be written against the same list for the QA
documentation.

---

## 9. Security notes

What is already done:

- Passwords hashed with **bcrypt** (10 salt rounds); the hash never leaves the
  server.
- Session held in an **httpOnly** cookie, so page JavaScript — and therefore an
  XSS attack — cannot read the token. `SameSite=Lax` limits CSRF, and the
  `Secure` flag is added automatically in production.
- **Every SQL query is parameterised.**
- Sign-in and forgot-password give the **same answer** whether or not an email
  exists, so the forms cannot be used to harvest registered addresses.
- A client asking for somebody else's application gets **404, not 403**, so they
  cannot even confirm that the record exists.
- The React app hides the pages a client may not use, but the **API enforces it
  independently** — hiding a button is not security.
- Uploaded CVs are checked by **type and size**, stored under a **random
  generated filename** (never the user's own), and served through an
  authenticated route.
- Google sign-in uses a **state cookie** to block replayed callbacks.

Before this ever handled real candidate data you would also want: a real
`JWT_SECRET` in `.env` (never committed), a proper password for the demo
accounts instead of `123`, rate limiting on the auth routes, HTTPS, and virus
scanning of uploads.

---

## 10. Deliberately out of scope

Scenario 1 lists these as "things to think about". We answered them in the
design but did not build them, so they are honest gaps to mention in the report:

- **Email notifications** to candidates and interviewers about a scheduled
  interview — the app records the interview and shows it on both the candidate
  page and the Interviews list, but sends no email (there is no mail server).
- **Blocking a candidate from advancing until the current stage's feedback is
  in** — the comparison page shows how many reviews each candidate has, but the
  "Move to next stage" button does not enforce it.
- **Management reports and CSV/PDF export** — the dashboard has live counts, but
  nothing exports.
- **Anonymous feedback** — feedback shows who wrote it, which suits a four
  person team.

---

## 11. Publishing to GitHub

`.gitignore` already excludes `node_modules/`, the database file, uploaded CVs
and `.env`, so no personal data or secrets get committed.

```bash
git add .
git commit -m "HireTrack: React + Express + SQLite recruitment tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Anyone cloning it then runs `npm run setup` followed by `npm run dev`.
