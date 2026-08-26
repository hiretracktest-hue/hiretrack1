import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Never trust the uploaded name for the name on disk - a crafted
    // filename could otherwise write outside this folder.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + "-" + crypto.randomBytes(8).toString("hex") + ext);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const typeOk = config.upload.allowedMime.includes(file.mimetype);
  const extOk = config.upload.allowedExt.includes(ext);

  if (!typeOk || !extOk) {
    const err = new Error("Only PDF, DOC or DOCX files are accepted.");
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

export function deleteStoredFile(storedName) {
  if (!storedName) return;
  // path.basename strips any directory part, so we can only ever delete
  // inside the uploads folder.
  const target = path.join(UPLOAD_DIR, path.basename(storedName));
  fs.promises.unlink(target).catch(() => {});
}

// Content-Disposition breaks if the filename contains quotes or newlines.
export function safeFilename(name) {
  return String(name || "cv")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(0, 120);
}
