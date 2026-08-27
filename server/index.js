import { config } from "./config.js";
import { ensureBucket } from "./storage.js";
import { mailProvider } from "./mail.js";
import { ping } from "../database/index.js";
import { createApp, hasClientBuild } from "./app.js";

const app = createApp();

// Fail loudly at startup rather than on the first request, so a wrong
// DATABASE_URL is obvious immediately.
try {
  const info = await ping();
  console.log("");
  console.log("  Connected to " + info.version.split(",")[0]);
} catch (err) {
  console.error("");
  console.error("  Could not connect to the database.");
  console.error("  " + err.message);
  console.error("");
  console.error("  Check DATABASE_URL in your .env file.");
  console.error("  Setup walkthrough: database/README.md");
  console.error("");
  process.exit(1);
}

// Same reasoning for the CV bucket: a wrong service role key or a
// bucket left public should surface now, not the first time somebody
// uploads a CV.
let cvStorageLine = "server/uploads (set SUPABASE_URL to use a bucket)";
if (config.storage.enabled) {
  const bucket = await ensureBucket();
  cvStorageLine = bucket.ok
    ? "Supabase bucket '" + config.storage.bucket + "'" +
      (bucket.created ? "  (created just now)" : "")
    : "server/uploads  - SUPABASE UNUSABLE: " + bucket.reason;
}

app.listen(config.port, () => {
  const built = hasClientBuild();
  console.log("");
  console.log("  Altrium API    ->  http://localhost:" + config.port);
  console.log("  Database       ->  Supabase PostgreSQL");
  console.log("  CV storage     ->  " + cvStorageLine);
  const provider = mailProvider();
  console.log(
    "  Email          ->  " +
      (provider === "resend"
        ? "Resend, from " + config.resend.from
        : provider === "smtp"
          ? "SMTP via " + config.smtp.host
          : "not configured (messages wait in the Outbox)")
  );
  console.log(
    "  Google sign-in ->  " +
      (config.google.enabled ? "enabled" : "disabled (email + password only)")
  );
  console.log(
    "  React app      ->  " +
      (built
        ? "http://localhost:" + config.port + "  (built files)"
        : "http://localhost:5173  (run `npm run dev`)")
  );
  console.log("");
});
