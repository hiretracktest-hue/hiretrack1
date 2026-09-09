/**
 * The entry point Vercel calls. Local development does not use this
 * file at all - `npm run dev` still runs server/index.js.
 *
 * Vercel does not run a server that stays up. It runs a function per
 * request, so there is nobody to call app.listen(). Express apps are
 * already (req, res) handlers, so the app itself is the function.
 *
 * The filename is a catch-all on purpose: `[...path].js` inside api/
 * means every /api/... request lands here with its original URL
 * intact, which is what the routes in server/app.js expect. A plain
 * api/index.js would only answer /api and nothing underneath it.
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
