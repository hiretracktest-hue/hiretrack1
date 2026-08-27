# Altrium Recruitment

**Scenario 1 — Recruitment & hiring tracker, built for Altrium.** A place where HR opens positions
(with a job description), adds candidates, sets the interview stages for each
position, and tracks every candidate through to **hired, rejected or on hold** —
while interviewers log in to leave feedback at their stage, and candidates can be
compared fairly.

Built for our second year, second semester group project.

| Layer | Technology |
| --- | --- |
| Front end | React 18 (JSX), React Router, plain CSS, built with Vite |
| Visual design | Our client's own palette and typeface, taken from [altrium.io](https://www.altrium.io/) |
| Back end | Node.js + Express (REST API) |
| Database | **PostgreSQL on Supabase**, accessed with `pg` (node-postgres) — 8 tables |
| Auth | Email + password (bcrypt), JWT in an httpOnly cookie, optional Google sign-in |
| Tests | Node's built-in test runner — 71 API tests |

> **This is an internal system.** The people who log in are HR, hiring managers,
> interviewers and management. **Job candidates do not have accounts** — HR adds
> them and uploads their CV, exactly as the brief describes.

---

## 1. Quick start

You need [Node.js](https://nodejs.org) 18.18 or newer (`node -v` to check).

**First set up the database.** It takes about five minutes and you only do it
once — the full walkthrough is in **[database/README.md](database/README.md)**:
create a free Supabase project, copy the connection string, and paste it into
`.env` as `DATABASE_URL`.

Then:

```bash
npm run setup
```

That installs the back end and the front end, creates every table in Supabase
and fills it with demo data. Then:

```bash
npm run dev
```

- React app → <http://localhost:5173>
- Express API → <http://localhost:4000>

### Demo accounts

`npm run seed` creates one account per role. Each has its own password, so the
four access levels are genuinely four separate logins. On the sign-in screen
each row has a **Use** button that fills the form for you.

| Email | Password | Role | What they can do |
| --- | --- | --- | --- |
| `hr@hiretrack.test` | `hr12345` | HR Recruiter | Everything: open positions, add candidates, screen CVs, run the process |
| `hiringmanager@hiretrack.test` | `hm12345` | Hiring Manager | Candidates, comparison, the hire decision. **Cannot** open or close a position |
| `int@hiretrack.test` | `int12345` | Interviewer | Sees candidates, leaves feedback at their stage. **Cannot** move anyone forward |
| `manag@hiretrack.test` | `manag12345` | Management | Oversight: sees everything, changes nothing, exports reports |

The names behind them are the four personas from the project plan — Nimali
Wijesinghe (HR), Chathura Rajapaksha (Hiring Manager), Sanduni Ekanayake
(Interviewer) and Mahesh Gunawardena (Management).

> These are demo passwords, short on purpose so they are quick to type in the
> sprint review. They are written straight into the database by `seed.js`.
> An account created through the **Team** page still has to meet the real rule:
> 8+ characters with a letter and a number.

> Already seeded the old accounts? Run `npm run seed:reset` to empty the tables
> and start again with these four.

### All the commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Install everything, create the tables and seed the database |
| `npm run db:migrate` | Create/recreate the tables in Supabase from `database/schema.sql` |
| `npm run dev` | Run the API and the React dev server together |
| `npm run build` | Build the React app into `client/dist` |
| `npm start` | Run the API, serving the built React app too |
| `npm test` | Run the 71 automated API tests |
| `npm run seed` | Add any missing demo data (safe to re-run) |
| `npm run seed:reset` | Empty every table, then seed from scratch |

---

## 1b. Visual design

The system is built for Altrium, so it is styled to look like something
Altrium would run rather than a generic template. The palette and typeface are
taken from [altrium.io](https://www.altrium.io/):

| Token | Value | Where it is used |
| --- | --- | --- |
| Accent | `#fbb401` | Primary buttons, the current pipeline stage, unread counts |
| Text on accent | `#1e2228` | Never white — see the note below |
| Headings | `#1e2228` | |
| Body text | `#60697b` | |
| Page background | `#f6f7f9` | |
| Surface / cards | `#ffffff` | |
| Borders | `#edf0f5` | |
| Dark accent | `#8a6300` | The accent when it has to be *text* rather than a fill |
| Typeface | Cabin | |

Buttons are full pills at weight 700, which is how altrium.io draws them.

**Why the accent never carries white text.** White on `#fbb401` has a contrast
ratio of 1.8:1, far below the 4.5:1 WCAG AA needs — it is close to unreadable.
Altrium themselves put black on the amber, and so do we: `#1e2228` on `#fbb401`
gives 8.9:1. For the same reason the accent is never used as text at full
strength; `#8a6300` is used instead, which reaches 5.4:1 on white.

### Responsive, and how it moves

One stylesheet, four breakpoints, tested at each width rather than assumed:

| Width | What changes |
| --- | --- |
| 1024px | Tighter bar and page padding |
| 820px | The seven nav links collapse behind a menu button; the name beside the avatar goes; stat tiles drop to two across; tables scroll sideways instead of crushing their columns |
| 560px | Stat tiles go to one; buttons in a row go full width and stack, so they stay tappable |
| `pointer: coarse` | Small buttons and nav links get bigger targets on a touch screen |

Checked at 375px, 768px and 1440px with no horizontal overflow at any of them —
a page that scrolls sideways on a phone is the usual giveaway that "responsive"
was only ever claimed.

Movement is used to explain a change, never for decoration: a screen rises into
place, stat tiles arrive one after another because the row really is being
filled in, buttons go down when pressed, and the notification panel grows out of
the bell that opened it.

**All of it is switched off under `prefers-reduced-motion`.** That is not
politeness — for people with vestibular disorders, motion they did not ask for
causes real nausea. Focus outlines are visible for keyboard users too.

### Where CVs are stored

HR uploads a CV; the hiring manager, the interviewer and management can open
and download it but cannot replace it. Candidates have no account at all — the
system begins after HR has added them.

**Any file type is accepted.** A CV arrives as whatever the candidate happened
to send: a PDF, a Word file, an ODT, a phone photo of a printout, a zip of a
portfolio. Making HR convert it first is a made-up obstacle. The cap is size
(15 MB), not format.

That is only safe because of how a CV is served back. An `.html` or `.svg` CV
would run its own scripts if a browser rendered it, and rendering one on this
origin would be XSS straight through the app. So a CV always comes back as an
**attachment**, with `X-Content-Type-Options: nosniff` and a locked-down CSP —
it is saved, never executed. There is a test that uploads a file containing a
`<script>` tag and checks it comes back as a download.

Files go to a **private Supabase Storage bucket** when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are set, and to `server/uploads` when they are not.
Which one was used is recorded per candidate, so switching the bucket on does
not strand CVs that were already uploaded — nothing has to be migrated.

The bucket is private. Downloads are handed out as signed URLs that expire after
a minute, so a CV cannot be reached by guessing a path, and the link is not
worth passing on. The service role key bypasses row-level security, so it is
read on the server only and never reaches the browser. At startup the app checks
the bucket exists and **refuses to use it if it is public** — CVs are personal
data.

## 2. How the brief is answered

The scenario ends with six questions. Each one is answered by something you can
click on:

### "Should the interview stages be the same for every position, or set per position?"

**Per position.** Stages live in their own `job_stages` table with an order, not
as a column on the position, so *Junior Software Engineer* can run
`Applied → Screening → Technical Interview → Final Interview → Offer` while
*QA Engineer* runs `Applied → Screening → Test Task → Interview → Offer`.

A stage cannot be deleted while candidates are still standing on it.

### "Should a candidate be blocked from advancing until the current stage's feedback is in?"

**Yes.** `POST /api/candidates/:id/advance` refuses with a message naming the
stage. The first stage is exempt — nobody has interviewed a candidate who has
only just been added. Set `REQUIRE_FEEDBACK_TO_ADVANCE=false` in `.env` to lift
the rule.

### "How do interviewers give feedback so candidates can be compared fairly?"

Everyone uses the same form: a score out of 5, an **advance / hold / reject**
recommendation, plus strengths, concerns and a comment. A `UNIQUE` constraint
means one person leaves **one** score per stage, so nobody can weight the result
by writing twice.

**Compare candidates** then ranks everyone for a position by average score, with
a column per stage and the recommendation split.

### "How are candidates and interviewers told about a scheduled interview?"

Being told is not the same as agreeing to come, so the interviewer is **asked**,
not informed. A booking starts at `PENDING`; the interviewer opens Interviews
and clicks **Accept** or **Decline**. A booking nobody answered is the thing
that quietly derails a hiring process, so it is tracked rather than assumed.

Only the person actually booked can answer — HR accepting on their behalf would
defeat the point, and the API returns 403 if they try.

**Every role has a bell in the top bar, and every role sees a different list in
it.** The same event produces different messages for different people:

| What happened | Interviewer | HR | Hiring manager | Management | Candidate |
| --- | :-: | :-: | :-: | :-: | :-: |
| Interview booked | asked to confirm | — | — | — | invitation |
| Interviewer **accepts** | own confirmation | who accepted, and when | position is moving | — | confirmation |
| Interviewer **declines** | — | **action needed**, with the reason | — | — | — |
| Interview cancelled | told | — | — | — | apology |
| Feedback submitted | — | verdict is in | verdict is in | — | — |
| Hired / rejected | — | told | — | told | offer / regret letter |

Two things that table is doing deliberately:

- **A decline goes only to HR.** They are the one who has to find somebody else
  or move the time. It is not the hiring manager's problem yet, and the
  candidate has not been told anything, so the message says so.
- **Nobody is notified about their own action.** Being told what you just did
  yourself is noise, so the person who caused an event is skipped.

### Real email, and the Accept link in it

The interviewer's message is not only an in-app notification — it is sent to
their **actual inbox**, with **Accept** and **Decline** in the body. Clicking one
opens the booking inside Altrium, shows the full details and asks them to
confirm.

They are not signed in when they read their email, and making them sign in
first is how invitations end up ignored. So the link carries a signed token,
kept deliberately narrow:

- **signed** with the server secret, so it cannot be forged
- **purpose-scoped** — a sign-in token will not work as an invitation and an
  invitation will not work as a login. Both are signed with the same secret, so
  the purpose claim is the only thing keeping them apart. There is a test for it.
- **one interview, one interviewer.** It grants nothing else: no candidate list,
  no other booking, and not even the candidate's email address or CV. Only
  enough to decide whether you can take it.
- **expiring** (`INVITE_EXPIRES_IN`, 30 days by default)
- **dead if the booking is reassigned** to somebody else

Following the link does not answer anything by itself. It shows what is being
asked and waits for a click, so a link opened by accident — or prefetched by a
mail client — commits nobody to anything.

Answering from the email produces exactly the same fan-out as answering inside
the app. Where the reply came from makes no difference to who needs to know.

**Setting it up** is optional. Leave `SMTP_HOST` blank and nothing is sent —
every message still lands in the outbox, which is how the project worked before
mail existed. To switch it on, put your SMTP details in `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-16-character-app-password
MAIL_FROM="Altrium Recruitment" <you@gmail.com>
```

For Gmail you need 2-Step Verification on, then an
[App Password](https://myaccount.google.com/apppasswords) — your normal Gmail
password will not work.

**Nothing is ever marked sent unless a mail server accepted it.** With SMTP
configured, HR can send an outbox message with one click. Without it, that
button refuses and explains why, rather than quietly setting a "sent" flag on a
message nobody delivered.

Candidates still have no account, so everything addressed to them is written
into the **Outbox** — invitation, confirmation, apology, offer, regret letter.
HR reads it, sends it, and marks it sent. There is no mail server in this
project; the outbox records exactly what would go out rather than pretending it
was delivered.

### "Who logs in, and what can each role see and do?"

Four roles with genuinely different permissions, all defined in one place
(`server/config.js`) and enforced by the API on every request:

| Action | HR | Hiring Manager | Interviewer | Management |
| --- | :-: | :-: | :-: | :-: |
| Open / edit / close / delete a position | ✅ | — | — | — |
| See every candidate | ✅ | ✅ | ✅ | ✅ |
| Add a candidate, upload their CV | ✅ | — | — | — |
| Band a CV High / Medium / Low | ✅ | ✅ | — | — |
| Move a candidate to the next stage | ✅ | ✅ | — | — |
| Record hired / rejected / on hold | ✅ | ✅ | — | — |
| Leave interview feedback | ✅ | ✅ | ✅ | — |
| Compare candidates side by side | ✅ | ✅ | — | ✅ |
| Schedule an interview | ✅ | ✅ | — | — |
| Candidate email outbox | ✅ | ✅ | — | — |
| View reports | ✅ | ✅ | — | ✅ |
| Export CSV | ✅ | — | — | ✅ |
| Create accounts, set roles | ✅ | — | — | — |

The **Team** page renders this table live from the API, so the documentation
cannot drift away from the rules.

There is **no public sign-up**: HR creates every account. Hiding a button is
convenience — the server checks the same rule again on every request.

### "What reports would management want to export?"

The **Reports** page shows open positions, pipeline volume, where candidates are
sitting (the drop-off view), CV screening progress, average days to a decision,
and whether interviewers are keeping up with their feedback. Four CSV exports:
positions, candidates, pipeline by stage, and interviewer activity.

---

## 3. Screening a large pile of CVs

One advert can return hundreds of CVs, and nobody opens every file twice. Each
CV is skimmed once and banded **High / Medium / Low**; the candidate list then
filters by band, shows a running count of what is left to screen, sorts by
"best screened first" or "highest interview score", and can band many at once
from the checkboxes.

---

## 4. Project structure

```
our web/
├── package.json            back end dependencies + every npm script
├── .env.example            copy to .env and add your Supabase connection string
│
├── database/               everything to do with the database
│   ├── schema.sql          the PostgreSQL schema (8 tables, types, triggers)
│   ├── index.js            connection pool + query helpers
│   ├── migrate.js          creates the tables in Supabase
│   ├── seed.js             demo data
│   └── README.md           step-by-step Supabase setup
│
├── server/                 Express REST API
│   ├── index.js            starts the server
│   ├── app.js              builds the Express app (so tests can reuse it)
│   ├── config.js           settings, the four roles and the permission map
│   ├── auth.js             password hashing, JWT, cookies, reset tokens
│   ├── middleware.js       attach user / require permission / error handling
│   ├── validate.js         input validation helpers
│   ├── upload.js           CV upload rules (type, size, safe filenames)
│   ├── notify.js           in-app + outbox messages for interviews
│   ├── uploads/            uploaded CV files - not committed
│   ├── routes/
│   │   ├── auth.routes.js          sign in / out, forgot + reset, Google
│   │   ├── jobs.routes.js          positions and their stages
│   │   ├── candidates.routes.js    candidates, CVs, bands, progression
│   │   ├── interviews.routes.js    scheduling (and the notifications)
│   │   ├── feedback.routes.js      feedback + the comparison table
│   │   ├── notifications.routes.js in-app notifications + candidate outbox
│   │   ├── reports.routes.js       management reports + CSV export
│   │   └── team.routes.js          who logs in, roles, dashboard counts
│   └── tests/api.test.js   71 automated tests
│
└── client/                 React front end
    ├── index.html
    ├── vite.config.js      dev server + /api proxy to Express
    └── src/
        ├── main.jsx        entry point
        ├── App.jsx         routes and the permission guards
        ├── api.js          one wrapper around fetch() for the whole app
        ├── AuthContext.jsx keeps the signed-in user in React state
        ├── styles.css      the whole stylesheet
        ├── components/     Layout (nav bar) + small shared UI pieces
        └── pages/          one file per screen
```

---

## 5. The database

Eight tables, defined in [`database/schema.sql`](database/schema.sql):

```
users ──< jobs ──< job_stages
  │        │
  │        └──< candidates ──< interviews ──< notifications
  │                   │
  │                   └──< feedback
  └──< password_resets
```

Worth mentioning in the report:

- **Foreign keys** with `ON DELETE CASCADE`, so deleting a position cleans up
  its stages, candidates, interviews and feedback.
- **`ENUM` types** for `role`, `status`, `outcome`, `cv_band` and
  `employment_type` — an invalid value cannot even be written to the table.
- **A `CHECK` constraint** keeps a feedback rating between 1 and 5.
- **A trigger** maintains `updated_at`, so no query can forget to set it.
- **`UNIQUE (candidate_id, stage, author_id)`** on feedback is what makes the
  comparison fair.
- **Every query is parameterised**, so SQL injection is not possible.
- Report figures use **separate subqueries** rather than one big join — joining
  candidates to feedback would count a candidate once per review and silently
  inflate every total.
- **`citext`** makes email comparison case-insensitive, so `Maya@gmail.com` and
  `maya@gmail.com` are one person.

---

## 6. API reference

All responses are JSON. Everything needs the login cookie, which the browser
sends automatically.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/signin` · `/signout` · `GET /me` · `POST /forgot-password` · `/reset-password` · `/change-password` · `GET /google` |
| Positions | `GET /api/jobs` · `GET /:id` · `POST /` · `PATCH /:id` · `DELETE /:id` |
| Candidates | `GET /api/candidates` (`?job=` `?cvBand=` `?outcome=` `?q=` `?sort=` `?mine=1`) · `GET /:id` · `POST /` · `PATCH /:id` · `POST /:id/advance` · `POST /:id/band` · `POST /band/bulk` · `POST /:id/cv` · `GET /:id/cv` · `DELETE /:id/cv` · `DELETE /:id` |
| Interviews | `GET /api/interviews` (`?mine=1` `?upcoming=1`) · `POST /` · `DELETE /:id` |
| Feedback | `GET /api/feedback` · `POST /` · `DELETE /:id` · `GET /compare/:jobId` |
| Notifications | `GET /api/notifications` · `POST /:id/read` · `POST /read-all` · `GET /outbox` · `POST /outbox/:id/sent` |
| Reports | `GET /api/reports` · `GET /reports/export.csv?report=positions\|candidates\|stages\|interviewers` |
| Team | `GET /api/team` · `GET /interviewers` · `GET /stats` · `PATCH /me` · `POST /members` · `PATCH /members/:id` |

---

## 7. Optional: "Sign in with Google"

Email and password works with any address. To also allow Google:

1. <https://console.cloud.google.com/apis/credentials> → **OAuth 2.0 Client ID** → *Web application*
2. Authorised redirect URI: `http://localhost:4000/api/auth/google/callback`
3. Copy `.env.example` to `.env` and paste in your client ID and secret.

Google sign-in **links to an existing account only** — an unknown Google account
is turned away, because HR controls who gets in.

---

## 8. Testing

```bash
npm test
```

Tests run against the real PostgreSQL database but inside their own throw-away
schema, which is created at the start and dropped at the end — your real tables
are never touched. They are grouped by the questions in
the brief: per-position stages, the feedback gate before advancing, fair
comparison, interview notifications, the four roles, CV screening, and the
reports (including a test that the totals are not double-counted).

---

## 9. Security notes

- Passwords hashed with **bcrypt**; the hash never leaves the server.
- Session in an **httpOnly** cookie, so page JavaScript — and therefore XSS —
  cannot read the token. `SameSite=Lax`, `Secure` in production.
- **Every SQL query is parameterised.**
- Sign-in and forgot-password give the **same answer** whether or not an email
  exists, so neither form can be used to harvest addresses.
- CVs are checked by **type and size**, stored under a **generated random
  filename**, and served through an authenticated route.
- **No public sign-up and no self-promotion**: HR creates accounts and sets
  roles, and the last HR account cannot demote or deactivate itself.

Before this handled real candidate data you would also want: a real
`JWT_SECRET` in `.env`, rate limiting on the auth routes, HTTPS, virus scanning
of uploads, and an audit log.

---

## 10. Publishing to GitHub

`.gitignore` already excludes `node_modules/`, the database file, uploaded CVs
and `.env`, so no personal data or secrets get committed.

```bash
git add .
git commit -m "HireTrack: recruitment and hiring tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Anyone cloning it runs `npm run setup` then `npm run dev`.
