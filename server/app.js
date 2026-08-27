import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";

import { config } from "./config.js";
import { attachUser, notFound, errorHandler } from "./middleware.js";
import authRoutes from "./routes/auth.routes.js";
import jobsRoutes from "./routes/jobs.routes.js";
import candidatesRoutes from "./routes/candidates.routes.js";
import interviewsRoutes from "./routes/interviews.routes.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import teamRoutes from "./routes/team.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import invitesRoutes from "./routes/invites.routes.js";
import { ping } from "../database/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express application. It is kept separate from index.js so
 * the automated tests can start the same app on a random port without
 * the console banner.
 */
export function createApp({ log = true } = {}) {
  const app = express();

  app.disable("x-powered-by");

  // Behind a host's TLS proxy (Render, Railway, Fly), the connection to
  // this process is plain HTTP even though the visitor is on HTTPS.
  // Without this, Express reports req.protocol as "http" and treats the
  // request as insecure, which breaks the Secure session cookie.
  if (config.isProduction) app.set("trust proxy", 1);
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

  app.get("/api/health", async (_req, res) => {
    try {
      const info = await ping();
      res.json({
        ok: true,
        database: info.name,
        server: info.version.split(",")[0],
        time: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({ ok: false, error: "Cannot reach the database: " + err.message });
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/jobs", jobsRoutes);
  app.use("/api/candidates", candidatesRoutes);
  app.use("/api/interviews", interviewsRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/team", teamRoutes);
  // Answering an interview invitation from the email link. Not behind
  // requireAuth: the token in the URL is the authorisation.
  app.use("/api/invites", invitesRoutes);

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
          "Altrium API is running. Start the React app with `npm run dev`, or build it with `npm run build`.",
      })
    );
  }

  app.use(errorHandler);
  return app;
}

export const hasClientBuild = () =>
  fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html"));
