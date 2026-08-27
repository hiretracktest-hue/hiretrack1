import { config } from "./config.js";

/**
 * The HTML for the emails we actually send.
 *
 * Email clients are twenty years behind browsers: no external
 * stylesheet, no flexbox worth trusting, so this is a table layout with
 * inline styles. Every message also carries a plain-text version,
 * because some people read mail as text and a blank email is worse than
 * a plain one.
 *
 * Colours are Altrium's, matching the app. The amber carries near-black
 * text - white on #fbb401 is unreadable.
 */

const AMBER = "#fbb401";
const INK = "#1e2228";
const BODY = "#60697b";
const LINE = "#edf0f5";
const CANVAS = "#f6f7f9";

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function shell(heading, inner) {
  return `<div style="margin:0;padding:24px 12px;background:${CANVAS};font-family:Cabin,'Segoe UI',system-ui,sans-serif;color:${BODY};line-height:1.55;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">
    <tr><td style="padding:22px 26px 0 26px;">
      <span style="display:inline-block;background:${AMBER};color:${INK};font-weight:700;font-size:13px;padding:5px 10px;border-radius:8px;">AL</span>
      <span style="font-weight:700;color:${INK};font-size:16px;margin-left:8px;">${esc(config.companyName)}</span>
    </td></tr>
    <tr><td style="padding:16px 26px 0 26px;">
      <h1 style="margin:0;font-size:20px;line-height:1.3;color:${INK};font-weight:700;">${esc(heading)}</h1>
    </td></tr>
    <tr><td style="padding:12px 26px 24px 26px;font-size:14px;">${inner}</td></tr>
    <tr><td style="padding:14px 26px;border-top:1px solid ${LINE};font-size:12px;color:#aab0bc;">
      Sent by ${esc(config.companyName)} Recruitment. If this is not meant for you, please ignore it.
    </td></tr>
  </table>
</div>`;
}

function detailRows(rows) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:14px 0;background:${CANVAS};border-radius:10px;">
    ${rows
      .filter(([, value]) => value)
      .map(
        ([label, value]) =>
          `<tr>
            <td style="padding:7px 14px;font-size:13px;color:#aab0bc;width:38%;">${esc(label)}</td>
            <td style="padding:7px 14px;font-size:13px;color:${INK};font-weight:600;">${esc(value)}</td>
          </tr>`
      )
      .join("")}
  </table>`;
}

function button(href, label, filled = true) {
  const style = filled
    ? `background:${AMBER};color:${INK};border:1px solid ${AMBER};`
    : `background:#ffffff;color:${BODY};border:1px solid ${LINE};`;
  return `<a href="${esc(href)}" style="${style}display:inline-block;padding:11px 22px;border-radius:999px;font-weight:700;font-size:14px;text-decoration:none;margin:0 6px 8px 0;">${esc(label)}</a>`;
}

/**
 * "You have been booked to interview someone - can you make it?"
 *
 * The two buttons are the point of this email. They go to a page in the
 * app that shows the full booking and asks them to confirm, so a link
 * followed by accident does not silently commit anybody to anything.
 */
export function interviewInviteEmail({ interview, candidate, job, bookedBy, when, url }) {
  const rows = [
    ["Candidate", candidate.full_name],
    ["Position", job.title],
    ["Stage", interview.stage],
    ["Date and time", when],
    ["Location", interview.location || "To be confirmed"],
    ["Booked by", bookedBy?.name || "HR"],
    ["Notes", interview.notes],
  ];

  const html = shell(
    "Can you take this interview?",
    `<p style="margin:0 0 4px 0;">
      You have been asked to interview <strong style="color:${INK};">${esc(candidate.full_name)}</strong>
      for ${esc(job.title)}.
    </p>
    ${detailRows(rows)}
    <p style="margin:0 0 14px 0;">Please let us know either way, so HR knows where they stand.</p>
    ${button(url + "?reply=accept", "Accept")}${button(url + "?reply=decline", "Decline", false)}
    <p style="margin:14px 0 0 0;font-size:12px;color:#aab0bc;">
      Both buttons open the booking in ${esc(config.companyName)} Recruitment, where you confirm.
      Nothing is recorded until you do.
    </p>`
  );

  const text = [
    "You have been asked to interview " + candidate.full_name + " for " + job.title + ".",
    "",
    ...rows.filter(([, v]) => v).map(([label, value]) => label + ": " + value),
    "",
    "Accept or decline here:",
    url,
    "",
    "Please let us know either way, so HR knows where they stand.",
  ].join("\n");

  return {
    subject: "Can you interview " + candidate.full_name + "? - " + job.title,
    text,
    html,
  };
}

/** Sent to the interviewer once they have answered, as their record. */
export function interviewAnswerEmail({ interview, candidate, job, when, accepted }) {
  const rows = [
    ["Candidate", candidate.full_name],
    ["Position", job.title],
    ["Stage", interview.stage],
    ["Date and time", when],
    ["Location", interview.location || "To be confirmed"],
  ];

  const heading = accepted ? "You are confirmed for this interview" : "You declined this interview";
  const lead = accepted
    ? "Thank you - it is in your schedule. Your feedback is due once the interview has taken place."
    : "That is noted, and HR has been told so they can arrange somebody else. There is nothing further for you to do.";

  return {
    subject: (accepted ? "Confirmed: " : "Declined: ") + candidate.full_name + " - " + job.title,
    text: [heading + ".", "", ...rows.map(([l, v]) => l + ": " + v), "", lead].join("\n"),
    html: shell(
      heading,
      `${detailRows(rows)}<p style="margin:0;">${esc(lead)}</p>`
    ),
  };
}

/** A candidate-facing message, sent from the outbox by HR. */
export function plainEmail({ subject, body }) {
  return {
    subject,
    text: body,
    html: shell(
      subject,
      `<div style="white-space:pre-wrap;font-size:14px;">${esc(body)}</div>`
    ),
  };
}

/**
 * "Altrium has invited you to apply."
 *
 * The first thing a candidate ever hears from us. They have no account
 * and did not fill in a form — HR picked them out and put them into the
 * process — so this has to explain who we are, what it is about, and
 * what happens next, without asking them to sign up for anything.
 */
export function candidateInviteEmail({ candidate, job, addedBy }) {
  const when = candidate.invite_at
    ? new Date(candidate.invite_at).toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const rows = [
    ["Position", job.title],
    ["Department", job.department],
    ["Location", job.location],
    ["Type", job.employment_type],
    ["When", when],
  ];

  const link = candidate.invite_link || "";

  const html = shell(
    config.companyName + " has invited you to apply",
    `<p style="margin:0 0 4px 0;">Hello ${esc(candidate.full_name)},</p>
    <p style="margin:10px 0 0 0;">
      <strong style="color:${INK};">${esc(config.companyName)}</strong> would like to
      consider you for the role below. Your details are now with our hiring team.
    </p>
    ${detailRows(rows)}
    ${
      job.description
        ? `<p style="margin:0 0 14px 0;color:${BODY};">${esc(
            String(job.description).slice(0, 400)
          )}</p>`
        : ""
    }
    ${
      link
        ? `<p style="margin:0 0 10px 0;"><strong style="color:${INK};">${
            when ? "Join us at the time above" : "Somewhere to start"
          }</strong></p>${button(link, when ? "Join" : "Open the link")}
           <p style="margin:6px 0 16px 0;font-size:12px;color:#aab0bc;word-break:break-all;">
             If the button does not work, paste this into your browser:<br />${esc(link)}
           </p>`
        : ""
    }
    <p style="margin:0 0 6px 0;"><strong style="color:${INK};">What happens next</strong></p>
    <p style="margin:0 0 14px 0;">
      ${
        when
          ? "Please keep the time above free. If it does not suit you, reply to this email and we will find another."
          : "We are reviewing your application now. If we would like to take it further we will email you again to arrange an interview, with the date, the time and who you will be meeting."
      }
      There is nothing else for you to do, and no account to create — we will come to you.
    </p>
    <p style="margin:0;color:${BODY};font-size:13px;">
      If you would rather not be considered, just reply to this email and we will remove
      your details.
    </p>
    <p style="margin:16px 0 0 0;">Kind regards,<br />
      <strong style="color:${INK};">${esc(addedBy?.name || "The hiring team")}</strong><br />
      ${esc(config.companyName)}
    </p>`
  );

  const text = [
    "Hello " + candidate.full_name + ",",
    "",
    config.companyName + " would like to consider you for the role below.",
    "",
    ...rows.filter(([, v]) => v).map(([label, value]) => label + ": " + value),
    "",
    ...(link ? ["Link: " + link, ""] : []),
    "WHAT HAPPENS NEXT",
    when
      ? "Please keep the time above free. If it does not suit you, reply to this email"
      : "We are reviewing your application now. If we would like to take it further we",
    when
      ? "and we will find another. There is no account to create - we will come to you."
      : "will email you again to arrange an interview. There is no account to create.",
    "",
    "If you would rather not be considered, just reply and we will remove your details.",
    "",
    "Kind regards,",
    addedBy?.name || "The hiring team",
    config.companyName,
  ].join("\n");

  return {
    subject: config.companyName + " has invited you to apply - " + job.title,
    text,
    html,
  };
}
