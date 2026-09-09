import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// UPLOAD_DIR can be overridden so the automated tests write into a
// temporary folder instead of the real uploads directory.
//
// On a serverless host the project folder is READ ONLY and only /tmp
// can be written to, so the default moves there. That storage is wiped
// between requests, which is exactly why SUPABASE_URL has to be set in
// production - see the deploy section of the README. This only keeps
// the module from throwing as it loads; it is not somewhere to keep a
// CV.
const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : onServerless
    ? path.join(os.tmpdir(), "altrium-uploads")
    : path.join(__dirname, "uploads");

// A read-only filesystem must not stop the API from starting. Uploads
// go to the bucket there anyway; if they somehow do not, the upload
// itself fails with a real message instead of the whole app refusing
// to boot.
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  console.warn("[upload] cannot create " + UPLOAD_DIR + ": " + err.message);
}

// The file is held in memory, not written straight to disk, because
// storage.js decides afterwards whether it belongs in a Supabase bucket
// or in the uploads folder. Safe at this size - uploads are capped at
// config.upload.maxBytes and one file per request.
const storage = multer.memoryStorage();

/** A 400 the client is allowed to see the message of. */
function badFormat(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function fileFilter(_req, file, cb) {
  if (!file.originalname) {
    return cb(badFormat("That file has no name, so it cannot be stored."));
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!config.upload.allowedExt.includes(ext)) {
    return cb(
      badFormat(
        "Invalid format: " +
          (ext || "a file with no extension") +
          " is not accepted. A CV has to be a " +
          config.upload.allowedLabel +
          " file."
      )
    );
  }

  cb(null, true);
}

/**
 * The name said .pdf or .docx - this checks the file actually is one.
 *
 * A PDF starts with "%PDF-". A .docx is a zip, so it starts with the
 * zip signature "PK". Renaming notes.txt to notes.pdf gets
 * past the extension check and stops here, which is what keeps
 * "invalid format" honest and keeps an .html file - which a browser
 * would happily run - out of the CV store.
 */
export function assertRealCv(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const head = file.buffer;

  const isPdf = head.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZip =
    head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;

  if (ext === ".pdf" && !isPdf) {
    throw badFormat("Invalid format: that file is named .pdf but is not a PDF.");
  }
  if (ext === ".docx" && !isZip) {
    throw badFormat("Invalid format: that file is named .docx but is not a Word document.");
  }
}

export const uploadCv = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxBytes, files: 1 },
}).single("cv");

// Content-Disposition breaks if the filename contains quotes or newlines.
export function safeFilename(name) {
  return String(name || "cv")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(0, 120);
}
