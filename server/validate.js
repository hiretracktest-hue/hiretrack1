import { httpError } from "./middleware.js";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function str(value, { field, required = false, max = 255, min = 0 } = {}) {
  const out = typeof value === "string" ? value.trim() : "";
  if (required && !out) throw httpError(400, `${field} is required.`);
  if (out.length > max) throw httpError(400, `${field} must be ${max} characters or fewer.`);
  if (out && out.length < min) throw httpError(400, `${field} must be at least ${min} characters.`);
  return out;
}

export function email(value, { field = "Email", required = true } = {}) {
  const out = str(value, { field, required, max: 160 }).toLowerCase();
  if (out && !EMAIL_RE.test(out)) throw httpError(400, "Enter a valid email address.");
  return out;
}

export function password(value, { field = "Password" } = {}) {
  const out = typeof value === "string" ? value : "";
  if (out.length < 8) throw httpError(400, `${field} must be at least 8 characters long.`);
  if (out.length > 200) throw httpError(400, `${field} is too long.`);
  if (!/[A-Za-z]/.test(out) || !/[0-9]/.test(out)) {
    throw httpError(400, `${field} must contain at least one letter and one number.`);
  }
  return out;
}

export function oneOf(value, allowed, { field, fallback } = {}) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw httpError(400, `${field} is required.`);
  }
  if (!allowed.includes(value)) {
    throw httpError(400, `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

export function id(value, { field = "id" } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, `Invalid ${field}.`);
  return n;
}

// Turns the stage chips typed in the UI into a clean, ordered, unique list.
export function stageList(value, { fallback } = {}) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) throw httpError(400, "Interview stages must be a list.");

  const cleaned = [];
  for (const raw of value) {
    const name = str(raw, { field: "Stage name", max: 60 });
    if (!name) continue;
    if (cleaned.some((s) => s.toLowerCase() === name.toLowerCase())) continue;
    cleaned.push(name);
  }
  if (cleaned.length === 0) throw httpError(400, "A vacancy needs at least one interview stage.");
  if (cleaned.length > 12) throw httpError(400, "A vacancy can have at most 12 stages.");
  return cleaned;
}

/**
 * A link we are going to put in an email, as something the recipient
 * clicks.
 *
 * Only http and https. A "javascript:" or "data:" URL in a mail template
 * is a script waiting for somebody to run it, and some mail clients will
 * happily follow one. Anything else is refused rather than quietly
 * stripped, so HR finds out at the point they typed it.
 */
export function url(value, { field = "Link", required = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (required) {
      const err = new Error(field + " is required.");
      err.status = 400;
      err.expose = true;
      throw err;
    }
    return "";
  }

  // A bare "meet.google.com/abc" is what people actually paste.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    const err = new Error(field + " must be a web address starting with http:// or https://");
    err.status = 400;
    err.expose = true;
    throw err;
  }
  if (parsed.href.length > 500) {
    const err = new Error(field + " is too long.");
    err.status = 400;
    err.expose = true;
    throw err;
  }
  return parsed.href;
}
