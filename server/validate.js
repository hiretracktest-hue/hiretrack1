import { httpError } from "./middleware.js";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function str(value, { field, required = false, max = 255, min = 0 } = {}) {
  const out = typeof value === "string" ? value.trim() : "";
  if (required && !out) throw httpError(400, `${field} is required.`);
  if (out.length > max) throw httpError(400, `${field} must be ${max} characters or fewer.`);
  if (out && out.length < min) throw httpError(400, `${field} must be at least ${min} characters.`);
  return out;
}

/**
 * An email address, with a message that says what is actually wrong
 * rather than just "invalid". Somebody who has mistyped their address
 * can fix it from the message without guessing.
 */
export function email(value, { field = "Email address", required = true } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    if (required) throw httpError(400, `${field} is required.`);
    return "";
  }
  if (raw.length > 160) throw httpError(400, `${field} is too long.`);

  if (/\s/.test(raw)) {
    throw httpError(400, `${field} cannot contain spaces.`);
  }
  if (!raw.includes("@")) {
    throw httpError(400, `${field} needs an @ - for example name@example.com`);
  }
  if (raw.split("@").length > 2) {
    throw httpError(400, `${field} can only contain one @.`);
  }

  const [local, domain] = raw.split("@");
  if (!local) throw httpError(400, `${field} is missing the part before the @.`);
  if (!domain) throw httpError(400, `${field} is missing the part after the @ - for example gmail.com`);
  if (!domain.includes(".")) {
    throw httpError(400, `${field} needs a domain ending - for example .com or .lk`);
  }
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    throw httpError(400, `${field} has a misplaced dot after the @.`);
  }

  const out = raw.toLowerCase();
  if (!EMAIL_RE.test(out)) throw httpError(400, `${field} is not a valid email address.`);
  return out;
}

/**
 * A date and time that has to be in the future - an interview slot.
 *
 * Three separate answers, because "invalid date" tells the person
 * nothing about which of the three things they did:
 *   nothing chosen, not a real date, or a date that has already passed.
 */
export function futureDateTime(value, { field = "Date and time", required = true } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    if (required) {
      throw httpError(400, `${field} is missing. Choose when the interview will take place.`);
    }
    return null;
  }

  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    throw httpError(400, `${field} is not a real date. Use the date picker to choose one.`);
  }

  // A minute of slack, so a slot chosen "now" is not refused by the
  // second or two it takes to press the button.
  if (when.getTime() < Date.now() - 60_000) {
    throw httpError(
      400,
      `That date is not available - ${when.toLocaleString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })} has already passed. Choose a future date and time.`
    );
  }

  // Guards against a typo like the year 20265 creating a row that sorts
  // to the end of every list forever.
  const tenYears = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
  if (when.getTime() > tenYears) {
    throw httpError(400, `${field} is too far in the future. Check the year.`);
  }

  return when;
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
