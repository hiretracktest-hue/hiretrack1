# Database — Supabase (PostgreSQL)

Everything to do with the database lives in this folder.

| File | What it is |
| --- | --- |
| `schema.sql` | The PostgreSQL schema — all 8 tables, types, indexes and triggers |
| `index.js` | The connection pool and the `one` / `many` / `run` / `transaction` helpers |
| `migrate.js` | Applies `schema.sql` to your Supabase database (`npm run db:migrate`) |
| `seed.js` | Fills the database with demo data (`npm run seed`) |

**Supabase is hosted PostgreSQL.** It is a real PostgreSQL 15+ server that
Supabase runs for you, so everything here is ordinary PostgreSQL — the same SQL
you would write against a server installed on your own machine. We connect with
`pg` (node-postgres), the official PostgreSQL driver for Node.js.

---

## Setting it up (about five minutes, once)

### 1. Create the Supabase project

1. Go to <https://supabase.com> and sign in with GitHub or an email address.
2. **New project**.
3. Name it `hiretrack`.
4. **Set a database password and save it somewhere** — you cannot see it again,
   only reset it.
5. Choose the region closest to you (Singapore or Mumbai from Sri Lanka).
6. Create the project and wait a minute or two while it starts.

### 2. Copy the connection string

1. In your project: **Project Settings** (the gear) → **Database**.
2. Find **Connection string** and choose the **URI** tab.
3. Tick **Use connection pooling** — this matters, see the note below.
4. Copy it. It looks like this:

```
postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

5. Replace `[YOUR-PASSWORD]` with the password you set in step 1.

> **Use the pooler host** (`...pooler.supabase.com`). The other one,
> `db.<ref>.supabase.co`, is IPv6-only and will not connect from most home or
> university networks — you would get `ENETUNREACH` and think the project was
> broken.
>
> If your password contains `@`, `#`, `/` or `:`, percent-encode it
> (`@` → `%40`) or it will break the URL. Easiest is to reset it to letters and
> numbers only.

### 3. Put it in `.env`

In the `our web` folder:

```bash
copy .env.example .env
```

Open `.env` and paste your connection string in:

```
DATABASE_URL=postgresql://postgres.abc...:yourpassword@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

`.env` is in `.gitignore` — **never commit it**. Your password would be public.

### 4. Create the tables and the demo data

```bash
npm run db:migrate
```

```bash
npm run seed
```

`db:migrate` reads `schema.sql` and builds every table. It refuses to run
against a database that already has users unless you add `-- --force`, so
nobody wipes the group's work by accident.

### 5. Start the app

```bash
npm run dev
```

---

## Sharing it with the group

Only **one** of you creates the Supabase project and runs `db:migrate`. The
other three copy the same `DATABASE_URL` into their own `.env` and go straight
to `npm run dev` — everyone then sees the same live data, which demos well.

Send the connection string over WhatsApp or a private message, **not** in the
GitHub repository.

---

## Looking at the data

Supabase has a built-in table browser, which is what you want for report
screenshots:

- **Table Editor** — click through the rows like a spreadsheet.
- **SQL Editor** — write your own SQL. Try:

```sql
SELECT j.title, c.full_name, c.current_stage, c.cv_band, c.outcome
FROM candidates c
JOIN jobs j ON j.id = c.job_id
ORDER BY j.title, c.full_name;
```

- **Database → Schema Visualizer** — an automatically drawn ER diagram of your
  tables. That is a good screenshot for the design section of the report.

---

## What changed moving from SQLite

Worth knowing if you are asked why the code looks the way it does:

| SQLite | PostgreSQL |
| --- | --- |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT GENERATED ALWAYS AS IDENTITY` |
| `?` placeholders | `$1`, `$2`, … numbered placeholders |
| `datetime('now')` | `NOW()` |
| `CHECK (x IN (…))` | real `ENUM` types |
| `COLLATE NOCASE` | the `citext` extension |
| Synchronous calls | Every query is `async` / `await` |
| `lastInsertRowid` | `INSERT … RETURNING id` |
| `LIKE` (case-insensitive by default) | `ILIKE` |
| Booleans stored as `0` / `1` | a real `BOOLEAN` type |
| `updated_at` set by hand in every query | a database **trigger** does it |

The last one is a genuine improvement: no query can now forget to set
`updated_at`, because the database sets it.

---

## If something goes wrong

**`DATABASE_URL is not set`** — you have not created `.env`, or it is in the
wrong folder. It belongs in `our web/.env`, next to `package.json`.

**`ENETUNREACH` or `connect ETIMEDOUT`** — you used the direct
`db.<ref>.supabase.co` host. Switch to the pooler string (step 2).

**`password authentication failed`** — the password in the URL is wrong, or it
contains a character that needs percent-encoding. Reset it in
Project Settings → Database.

**`self-signed certificate in certificate chain`** — `DATABASE_SSL` has been set
to `false`. Supabase always needs TLS; set it back to `true`.

**`relation "users" does not exist`** — you have not run `npm run db:migrate`.

**The project is paused** — Supabase pauses free projects after a week of no
activity. Open the dashboard and press **Restore**; it takes about a minute.
Worth checking the morning of your demo.
