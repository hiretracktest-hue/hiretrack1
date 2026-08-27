import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { UPLOAD_DIR } from "./upload.js";

/**
 * Where a candidate's CV actually lives.
 *
 * Two backings, chosen once at startup:
 *
 *   SUPABASE  a private Storage bucket, when SUPABASE_URL and
 *             SUPABASE_SERVICE_ROLE_KEY are set. The file leaves this
 *             machine, so it survives a redeploy and is not sitting in
 *             the project folder.
 *   LOCAL     the server/uploads folder, exactly as before. This is what
 *             the automated tests use, and what you get with no Supabase
 *             keys configured.
 *
 * Which one was used is recorded per candidate (candidates.cv_storage),
 * so a database that already has locally-stored CVs keeps working after
 * the bucket is switched on. Nothing has to be migrated.
 *
 * The service role key bypasses row-level security completely. It is
 * only ever read here, on the server. It is never sent to the browser,
 * and the bucket is private - downloads go out as short-lived signed
 * URLs, so a CV cannot be reached by guessing a path.
 */

export const SUPABASE = "supabase";
export const LOCAL = "local";

let client = null;

function supabase() {
  if (!config.storage.enabled) return null;
  if (!client) {
    client = createClient(config.storage.url, config.storage.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

/** Which backing new uploads go to. */
export function activeBackend() {
  return config.storage.enabled ? SUPABASE : LOCAL;
}

/** A name that cannot collide and cannot escape its folder. */
function objectName(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  return (
    new Date().toISOString().slice(0, 10) +
    "/" +
    Date.now() +
    "-" +
    crypto.randomBytes(8).toString("hex") +
    ext
  );
}

/**
 * Store one uploaded CV.
 *
 * Returns { storedName, storage }. `storedName` is a key inside the
 * bucket, or a filename in the uploads folder - the caller does not need
 * to know which, and writes both values to the candidate row.
 */
export async function putCv(file) {
  const backend = activeBackend();

  if (backend === LOCAL) {
    const name = objectName(file.originalname).replace(/\//g, "-");
    await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
    return { storedName: name, storage: LOCAL };
  }

  const key = objectName(file.originalname);
  const { error } = await supabase()
    .storage.from(config.storage.bucket)
    .upload(key, file.buffer, {
      contentType: file.mimetype,
      // A CV is replaced by uploading a new one, which gets a new key,
      // so overwriting an existing key should never happen. If it does,
      // something is wrong and we want to hear about it.
      upsert: false,
    });

  if (error) {
    const err = new Error("The CV could not be stored: " + error.message);
    err.status = 502;
    err.expose = true;
    throw err;
  }
  return { storedName: key, storage: SUPABASE };
}

/**
 * Get one CV back.
 *
 * For the bucket this is a signed URL that expires in a minute - long
 * enough to follow a redirect, not long enough to be worth sharing. For
 * local files it is a path on disk. The caller decides how to serve it.
 */
export async function getCv(storedName, storage, downloadAs) {
  if (!storedName) return null;

  if (storage !== SUPABASE) {
    return { kind: LOCAL, path: path.join(UPLOAD_DIR, path.basename(storedName)) };
  }

  const { data, error } = await supabase()
    .storage.from(config.storage.bucket)
    // `download` makes Supabase serve it as an attachment rather than
    // rendering it. Any file type is accepted, so this matters: an
    // .html CV rendered in a browser would run its own scripts.
    .createSignedUrl(storedName, 60, { download: downloadAs || true });

  if (error || !data?.signedUrl) {
    const err = new Error(
      "The stored CV could not be fetched: " + (error?.message || "no URL returned")
    );
    err.status = 502;
    err.expose = true;
    throw err;
  }
  return { kind: SUPABASE, url: data.signedUrl };
}

/** Remove a CV. Never throws - an orphaned file is not worth a 500. */
export async function removeCv(storedName, storage) {
  if (!storedName) return;

  if (storage !== SUPABASE) {
    const target = path.join(UPLOAD_DIR, path.basename(storedName));
    await fs.promises.unlink(target).catch(() => {});
    return;
  }

  try {
    await supabase().storage.from(config.storage.bucket).remove([storedName]);
  } catch (err) {
    console.warn("[storage] could not delete " + storedName + ": " + err.message);
  }
}

/**
 * Make sure the bucket exists and is private. Run once at startup so a
 * wrong key or a missing bucket is obvious immediately, rather than the
 * first time somebody uploads a CV.
 */
export async function ensureBucket() {
  if (!config.storage.enabled) return { ok: false, reason: "not configured" };

  try {
    const { data, error } = await supabase().storage.getBucket(config.storage.bucket);
    if (data && !error) {
      if (data.public) {
        return {
          ok: false,
          reason:
            "the bucket '" +
            config.storage.bucket +
            "' is PUBLIC. CVs are personal data - make it private in the Supabase dashboard.",
        };
      }
      return { ok: true, created: false };
    }

    // No allowedMimeTypes: every file type is accepted, and the bucket
    // must not be stricter than the app.
    const created = await supabase().storage.createBucket(config.storage.bucket, {
      public: false,
      fileSizeLimit: config.upload.maxBytes,
    });
    if (created.error) return { ok: false, reason: created.error.message };
    return { ok: true, created: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
