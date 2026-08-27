import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// UPLOAD_DIR can be overridden so the automated tests write into a
// temporary folder instead of the real uploads directory.
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// The file is held in memory, not written straight to disk, because
// storage.js decides afterwards whether it belongs in a Supabase bucket
// or in the uploads folder. Safe at this size - uploads are capped at
// config.upload.maxBytes and one file per request.
const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  // Every file type is accepted - see config.upload for why. Size is
  // still capped (multer limits, below), and an empty upload is not a
  // file at all.
  if (!file.originalname) {
    const err = new Error("That file has no name, so it cannot be stored.");
    err.status = 400;
    err.expose = true;
    return cb(err);
  }
  cb(null, true);
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
