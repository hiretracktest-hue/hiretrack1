import { db } from "./db/index.js";
import { config } from "./config.js";

/**
 * "How are candidates and interviewers told about a scheduled interview?"
 *
 * Two channels, because the two audiences are different:
 *
 *   IN_APP - the interviewer has an account here, so the notification
 *            appears on their own Interviews page the next time they
 *            sign in. Nothing to configure, nothing to go wrong.
 *   EMAIL  - the candidate does NOT have an account (HR adds them), so
 *            the message is written into an outbox. HR opens the outbox,
 *            reads the message and sends it. There is no mail server in
 *            this project, so nothing is sent automatically - the entry
 *            records exactly what would go out, and HR marks it sent.
 */

const insert = db.prepare(
  "INSERT INTO notifications (channel, user_id, recipient_email, recipient_name, subject, body, " +
    "candidate_id, interview_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Called whenever an interview is booked. */
export function notifyInterviewScheduled({ interview, candidate, job, bookedBy }) {
  const when = formatWhen(interview.scheduled_at);
  const where = interview.location || "To be confirmed";

  // 1. The interviewer, in the app.
  if (interview.interviewer_id) {
    insert.run(
      "IN_APP",
      interview.interviewer_id,
      interview.interviewer_email || "",
      interview.interviewer_name || "",
      "You are interviewing " + candidate.full_name,
      "You have been booked to interview " +
        candidate.full_name +
        " for " +
        job.title +
        " (" +
        interview.stage +
        ") on " +
        when +
        ". Location: " +
        where +
        "." +
        (interview.notes ? " Notes: " + interview.notes : "") +
        " Booked by " +
        (bookedBy?.name || "HR") +
        ".",
      candidate.id,
      interview.id
    );
  }

  // 2. The candidate, by email - written to the outbox for HR to send.
  insert.run(
    "EMAIL",
    null,
    candidate.email,
    candidate.full_name,
    "Interview invitation - " + job.title,
    "Dear " +
      candidate.full_name +
      ",\n\n" +
      "Thank you for your interest in the " +
      job.title +
      " position at " +
      config.companyName +
      ".\n\n" +
      "We would like to invite you to the " +
      interview.stage +
      " stage of our interview process.\n\n" +
      "Date and time: " +
      when +
      "\n" +
      "Location: " +
      where +
      "\n" +
      "Interviewer: " +
      (interview.interviewer_name || "To be confirmed") +
      "\n\n" +
      (interview.notes ? interview.notes + "\n\n" : "") +
      "Please reply to this email to confirm that you can attend.\n\n" +
      "Kind regards,\n" +
      (bookedBy?.name || "The hiring team") +
      "\n" +
      config.companyName,
    candidate.id,
    interview.id
  );
}

/** Called when an interview is cancelled. */
export function notifyInterviewCancelled({ interview, candidate, job, cancelledBy }) {
  const when = formatWhen(interview.scheduled_at);

  if (interview.interviewer_id) {
    insert.run(
      "IN_APP",
      interview.interviewer_id,
      interview.interviewer_email || "",
      interview.interviewer_name || "",
      "Interview cancelled - " + candidate.full_name,
      "The " +
        interview.stage +
        " interview with " +
        candidate.full_name +
        " for " +
        job.title +
        " on " +
        when +
        " has been cancelled by " +
        (cancelledBy?.name || "HR") +
        ".",
      candidate.id,
      null
    );
  }

  insert.run(
    "EMAIL",
    null,
    candidate.email,
    candidate.full_name,
    "Interview rescheduling - " + job.title,
    "Dear " +
      candidate.full_name +
      ",\n\n" +
      "Unfortunately we need to cancel the " +
      interview.stage +
      " interview arranged for " +
      when +
      ". We are sorry for the inconvenience and will be in touch shortly with a new time.\n\n" +
      "Kind regards,\n" +
      (cancelledBy?.name || "The hiring team") +
      "\n" +
      config.companyName,
    candidate.id,
    null
  );
}

/** Called when a candidate reaches a final outcome. */
export function notifyOutcome({ candidate, job, outcome, decidedBy }) {
  if (outcome !== "HIRED" && outcome !== "REJECTED") return;

  const hired = outcome === "HIRED";
  insert.run(
    "EMAIL",
    null,
    candidate.email,
    candidate.full_name,
    (hired ? "Offer - " : "Your application - ") + job.title,
    "Dear " +
      candidate.full_name +
      ",\n\n" +
      (hired
        ? "We are delighted to offer you the " +
          job.title +
          " position at " +
          config.companyName +
          ". A member of the team will contact you shortly with the details."
        : "Thank you for taking the time to apply for the " +
          job.title +
          " position at " +
          config.companyName +
          ". On this occasion we will not be taking your application further. We wish you every success.") +
      "\n\nKind regards,\n" +
      (decidedBy?.name || "The hiring team") +
      "\n" +
      config.companyName,
    candidate.id,
    null
  );
}
