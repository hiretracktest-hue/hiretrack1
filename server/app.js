import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";

import { attachUser, notFound, errorHandler } from "./middleware.js";
import authRoutes from "./routes/auth.routes.js";
import jobsRoutes from "./routes/jobs.routes.js";
import applicationsRoutes from "./routes/applications.routes.js";
import interviewsRoutes from "./routes/interviews.routes.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import teamRoutes from "./routes/team.routes.js";
import publicRoutes from "./routes/public.routes.js";
import { DB_PATH } from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express application. It is kept separate from index.js so
 * the automated tests can start the same app on a random port without
 * the console banner.
 */
export function createApp({ log = true } = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Every request gets req.user when a valid login cookie is present.
  app.use(attachUser);

  if (log) {
    app.use((req, _res, next) => {
      if (req.path.startsWith("/api")) {
        console.log(new Date().toISOString() + "  " + req.method + " " + req.originalUrl);
      }
      next();
    });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, database: path.basename(DB_PATH), time: new Date().toISOString() });
  });

  // No account needed - this is what a shared job link opens.
  app.use("/api/public", publicRoutes);

  app.use("/api/auth", authRoutes);
  app.use("/api/jobs", jobsRoutes);
  app.use("/api/applications", applicationsRoutes);
  app.use("/api/interviews", interviewsRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/team", teamRoutes);

  // Any other /api/... path is a mistake, not a React route.
  app.use("/api", notFound);

  // In production the React app is built into client/dist and served by
  // this same Express server, so there is only one thing to deploy.
  const clientDist = path.join(__dirname, "..", "client", "dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // Deep links such as /candidates/3 must still return index.html so
    // that React Router can render the right page.
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  } else {
    app.get("/", (_req, res) =>
      res.json({
        message:
          "HireTrack API is running. Start the React app with `npm run dev`, or build it with `npm run build`.",
      })
    );
  }

  app.use(errorHandler);
  return app;
}

export const hasClientBuild = () =>
  fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html"));
