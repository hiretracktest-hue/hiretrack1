# HireTrack

A recruitment and candidate tracking web application built for our second year,
second semester group project.

Recruiters post **vacancies**, applicants **apply**, and the team moves each
candidate through a configurable **interview pipeline**, uploads and updates
their **CV**, records an **outcome**, and schedules **interviews**.

| Layer | Technology |
| --- | --- |
| Front end | React 18 (JSX), React Router, plain CSS, built with Vite |
| Back end | Node.js + Express (REST API) |
| Database | SQLite (SQL) accessed with `better-sqlite3` |
| Auth | Email + password (bcrypt hashing) with a JWT in an httpOnly cookie, plus optional "Sign in with Google" |
| Tests | Node's built-in test runner (`node:test`) — 26 API tests |

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

Sign in with any of the four demo accounts:

| Email | Role | Password |
| --- | --- | --- |
| `ahmed.asmi369@gmail.com` | Developer | `Password123` |
| `scrum.master@example.com` | Scrum Master | `Password123` |
| `business.analyst@example.com` | Business Analyst | `Password123` |
| `qa.engineer@example.com` | QA Engineer | `Password123` |

> Change these names, emails and the password in `server/seed.js` before you
> hand the project in.

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

## 2. What the app does

### Accounts

- **Sign up** with a name, email (a Gmail address works fine) and password.
- **Sign in / sign out.**
- **Forgot password** — creates a one-time reset link that expires after an
  hour. The project has no mail server, so in development the link is shown on
  screen and printed in the API console. Only a SHA-256 *hash* of the token is
  stored in the database.
- **Change password** from your profile page.
- **Sign in with Google** (optional, see section 6).

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
  - **Schedule and cancel interviews**,
  - edit their details and internal notes.

### Team (`/team`)

Our group is four people — Developer, Scrum Master, Business Analyst and QA.
The role is stored on the user record as a **label only**: the API checks that a
request comes from a signed-in user but never checks *which* role, so all four
of us have exactly the same access, which is what we agreed.

---

## 3. Project structure

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

## 4. The database

Six tables, defined in [`server/db/schema.sql`](server/db/schema.sql):

```
users ──────< jobs ──────< job_stages
  │             │
  │             └─────< applications >───── interviews
  │                          
  └─────< password_resets
```

| Table | Holds |
| --- | --- |
| `users` | Team members and applicants. `role` is a label; `password_hash` is `NULL` for Google-only accounts. |
| `jobs` | The vacancies. `status` is `ACTIVE` or `CLOSED`. |
| `job_stages` | The ordered pipeline for one vacancy (`position` 0, 1, 2 …). |
| `applications` | One candidate applying to one vacancy, plus their CV details. `UNIQUE (job_id, email)` stops duplicate applications. |
| `interviews` | Interviews booked against an application. |
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

## 5. API reference

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
| `POST` | `/:id/advance` | Move to the next stage |
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

### Team — `/api/team`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | The four team members and their roles |
| `PATCH` | `/me` | Update your own name and role |
| `GET` | `/stats` | Dashboard numbers |

---

## 6. Optional: "Sign in with Google"

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

## 7. Testing

```bash
npm test
```

26 tests run against a temporary throw-away database, covering sign up and sign
in, password rules, the one-time reset token, permission checks, the stage
pipeline, duplicate applications, CV upload and download (including rejecting a
`.txt` file), interview scheduling, and that every team role can reach the same
endpoints.

Manual test cases can be written against the same list for the QA
documentation.

---

## 8. Security notes

What is already done:

- Passwords hashed with **bcrypt** (10 salt rounds); the hash never leaves the
  server.
- Session held in an **httpOnly** cookie, so page JavaScript — and therefore an
  XSS attack — cannot read the token. `SameSite=Lax` limits CSRF, and the
  `Secure` flag is added automatically in production.
- **Every SQL query is parameterised.**
- Sign-in and forgot-password give the **same answer** whether or not an email
  exists, so the forms cannot be used to harvest registered addresses.
- Uploaded CVs are checked by **type and size**, stored under a **random
  generated filename** (never the user's own), and served through an
  authenticated route.
- Google sign-in uses a **state cookie** to block replayed callbacks.

Before this ever handled real candidate data you would also want: a real
`JWT_SECRET` in `.env` (never committed), rate limiting on the auth routes,
HTTPS, virus scanning of uploads, and role-based permissions if the four roles
should stop being equal.

---

## 9. Publishing to GitHub

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
