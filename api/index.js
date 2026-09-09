/**
 * The entry point Vercel calls. Local development does not use this
 * file at all - `npm run dev` still runs server/index.js.
 *
 * Vercel does not run a server that stays up. It runs a function per
 * request, so there is nobody to call app.listen(). Express apps are
 * already (req, res) handlers, so the app itself is the function.
 *
 * Every /api/... request is sent here by the "routes" entry in
 * vercel.json, which keeps the original URL on the request - that is
 * the whole reason it uses `routes` and not `rewrites`. Express then
 * matches /api/auth/signin and the rest exactly as it does locally.
 *
 * The first attempt at this named the file api/[...path].js, on the
 * assumption that Vercel treats it as a catch-all. It does not - that
 * is Next.js syntax. Vercel read it as ONE dynamic segment, so
 * /api/health worked and /api/auth/signin returned a Vercel 404.
 *
 * The checks server/index.js makes at start-up - reaching the database,
 * creating the CV bucket - are deliberately not repeated here. They
 * would run on every cold start and slow down the first request, and
 * the API answers with a real error if either is wrong. /api/health
 * reports the database either way.
 */
import { createApp } from "../server/app.js";

// Built once per instance and reused while that instance stays warm.
const app = createApp({ log: false });

export default app;
