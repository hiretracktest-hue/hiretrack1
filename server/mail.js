import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

/**
 * Real email.
 *
 * Everything the system wants to say still gets written into the
 * notifications table first - that is the record of what was supposed to
 * go out, and it does not depend on a mail server being reachable. This
 * module is the delivery step on top of it.
 *
 * If no SMTP details are configured the system behaves exactly as it did
 * before: the message sits in the outbox for a person to send by hand.
 * Nothing pretends to have been delivered when it was not.
 */

let transport = null;

function getTransport() {
  if (!config.smtp.enabled) return null;
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transport;
}

/**
 * Send one message.
 *
 * Always resolves - a mail server being down must not fail the request
 * that triggered it. Booking an interview should still succeed when the
 * confirmation email cannot go out; the caller records what happened.
 */
/** True when there is any way at all to send email. */
export function mailEnabled() {
  return config.resend.enabled || config.smtp.enabled;
}

/** Which one is actually in use, for the startup banner. */
export function mailProvider() {
  if (config.resend.enabled) return "resend";
  if (config.smtp.enabled) return "smtp";
  return "none";
}

async function sendViaResend({ to, name, subject, text, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.resend.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.resend.from,
      // The bare address, with no display name. On a sandbox account
      // Resend compares this string against the address that owns the
      // account, and "Name <addr>" does not match even when addr does -
      // so a display name here silently breaks every send. The
      // recipient's name is in the body of the message anyway.
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (response.ok && body.id) return { sent: true, id: body.id };

  // Resend's own wording is better than anything we would invent, and
  // it is what HR needs to see - it names the address it will accept.
  return { sent: false, reason: body.message || "Resend returned " + response.status };
}

async function sendViaSmtp({ to, name, subject, text, html }) {
  try {
    const info = await getTransport().sendMail({
      from: config.smtp.from,
      to: name ? '"' + name.replace(/"/g, "") + '" <' + to + ">" : to,
      subject,
      text,
      html: html || undefined,
    });
    return { sent: true, id: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

export async function sendMail({ to, name, subject, text, html }) {
  if (!to) return { sent: false, reason: "no email address on file" };
  if (!mailEnabled()) {
    return { sent: false, reason: "no mail provider is configured" };
  }

  // Resend first when both are set - it is an HTTP call, so it works
  // from networks that block outbound SMTP ports.
  const send = config.resend.enabled ? sendViaResend : sendViaSmtp;

  try {
    const result = await send({ to, name, subject, text, html });
    if (!result.sent) {
      console.warn("[mail] refused for " + to + ": " + result.reason);
    }
    return result;
  } catch (err) {
    console.error("[mail] could not send to " + to + ": " + err.message);
    return { sent: false, reason: err.message };
  }
}

/** Checked once at startup so a broken password is obvious immediately. */
export async function verifyMail() {
  if (config.resend.enabled) return { ok: true, provider: "resend" };
  if (!config.smtp.enabled) return { ok: false, reason: "not configured" };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// --- the link in the email ------------------------------------------
//
// An interviewer reading their email is not signed in, and making them
// sign in before they can say "yes" is how invitations get ignored. So
// the link carries a signed token that authorises exactly one thing:
// viewing and answering ONE booking. It cannot be used to read anything
// else, and it expires.

const INVITE_PURPOSE = "interview-invite";

export function inviteToken(interview) {
  return jwt.sign(
    {
      purpose: INVITE_PURPOSE,
      interviewId: Number(interview.id),
      interviewerId: Number(interview.interviewer_id),
    },
    config.jwtSecret,
    { expiresIn: config.inviteExpiresIn }
  );
}

/** Returns the claims, or null if the token is not a valid invite. */
export function readInviteToken(token) {
  try {
    const claims = jwt.verify(String(token), config.jwtSecret);
    // A sign-in token must never work here, and vice versa.
    if (claims.purpose !== INVITE_PURPOSE) return null;
    if (!claims.interviewId || !claims.interviewerId) return null;
    return claims;
  } catch {
    return null;
  }
}

export function inviteUrl(interview) {
  return config.clientUrl + "/invite/" + inviteToken(interview);
}
