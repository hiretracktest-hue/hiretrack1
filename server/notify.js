import { one, run, many } from "../database/index.js";
import { config } from "./config.js";
import { sendMail, mailEnabled, inviteUrl } from "./mail.js";
import { interviewInviteEmail, interviewAnswerEmail, plainEmail } from "./mail-templates.js";

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

const INSERT =
  "INSERT INTO notifications (channel, kind, user_id, recipient_email, recipient_name, subject, " +
  "body, candidate_id, interview_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)";

/** One in-app notification for one person. */
function toUser(kind, user, subject, body, candidateId = null, interviewId = null) {
  return run(INSERT, [
    "IN_APP",
    kind,
    user.id,
    user.email || "",
    user.name || "",
    subject,
    body,
    candidateId,
    interviewId,
  ]);
}

/**
 * A message for a candidate.
 *
 * Candidates have no account here, so this is the only way to reach
 * them. The row is written first and always: it is the record of what
 * the system decided to say, and it does not depend on a mail server
 * being up.
 *
 * Then, if SMTP is configured, it really goes out and the row is marked
 * sent. If it is not configured - or the send fails - the row stays
 * pending and HR sends it by hand from the Outbox. Nothing is ever
 * marked sent unless a mail server accepted it.
 */
async function toOutbox(kind, to, subject, body, candidateId = null, interviewId = null) {
  const row = await one(
    INSERT + " RETURNING id",
    ["EMAIL", kind, null, to.email, to.name, subject, body, candidateId, interviewId]
  );

  if (!mailEnabled() || !to.email) return row;

  const result = await sendMail({
    to: to.email,
    name: to.name,
    ...plainEmail({ subject, body }),
  });

  if (result.sent) {
    await run("UPDATE notifications SET sent_at = NOW(), send_error = NULL WHERE id = $1", [row.id]);
  } else {
    // Keep the reason on the row. A refused email that just sits in the
    // outbox looking unsent is indistinguishable from one nobody tried
    // to send, and HR cannot fix what they cannot see.
    await run("UPDATE notifications SET send_error = $1 WHERE id = $2", [result.reason, row.id]);
  }
  return row;
}

/**
 * Notify everyone holding one of these roles.
 *
 * This is what makes each role's list its own: HR is told when an
 * interviewer answers a booking, the hiring manager is told when a
 * verdict lands on one of their positions, management is told when
 * somebody is actually hired. Nobody gets the whole firehose.
 *
 * `except` keeps a person from being notified about their own action -
 * being told what you just did yourself is noise.
 */
async function toRoles(roles, { kind, subject, body, candidateId = null, interviewId = null, except = null }) {
  const people = await many(
    "SELECT id, name, email FROM users WHERE is_active AND role = ANY($1::user_role[])",
    [roles]
  );
  for (const person of people) {
    if (except && Number(person.id) === Number(except)) continue;
    await toUser(kind, person, subject, body, candidateId, interviewId);
  }
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** HR books an interview -> the interviewer is asked to confirm it. */
export async function notifyInterviewScheduled({ interview, candidate, job, bookedBy }) {
  const when = formatWhen(interview.scheduled_at);
  const where = interview.location || "To be confirmed";

  // 1. The interviewer, in the app. They are ASKED, not just told - an
  //    unanswered booking is what quietly derails a hiring process.
  if (interview.interviewer_id) {
    await toUser(
      "interview.booked",
      {
        id: interview.interviewer_id,
        name: interview.interviewer_name,
        email: interview.interviewer_email,
      },
      "Please confirm: you are interviewing " + candidate.full_name,
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
        ". Open Interviews and accept or decline, so HR knows where they stand.",
      candidate.id,
      interview.id
    );
  }

  // 2. The interviewer's real inbox, with Accept and Decline in it.
  //    They are not signed in when they read their email, and making
  //    them sign in first is how invitations get ignored - so the links
  //    carry a signed token good for this one booking only.
  if (interview.interviewer_id && interview.interviewer_email) {
    const mail = interviewInviteEmail({
      interview,
      candidate,
      job,
      bookedBy,
      when,
      url: inviteUrl(interview),
    });
    const result = await sendMail({
      to: interview.interviewer_email,
      name: interview.interviewer_name,
      ...mail,
    });
    if (!result.sent) {
      // No mail server, or it refused us. The in-app notification above
      // still stands, so the booking is not lost - but say so plainly
      // rather than letting it look delivered.
      console.warn(
        "[notify] interview invite not emailed to " +
          interview.interviewer_email +
          ": " +
          result.reason
      );
    }
  }

  // 3. The candidate, by email - written to the outbox for HR to send.
  await toOutbox(
    "interview.invitation",
    { email: candidate.email, name: candidate.full_name },
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

/**
 * The interviewer answers the booking.
 *
 * Accepting is not just a flag on a row. The interviewer gets their own
 * confirmation, the person who booked it hears back, the hiring manager
 * for the position is told it is moving, and the candidate's
 * confirmation letter is written. Declining goes only to HR, because HR
 * is the one who has to find somebody else.
 */
export async function notifyInterviewResponse({ interview, candidate, job, responder, accepted }) {
  const when = formatWhen(interview.scheduled_at);
  const who = responder?.name || interview.interviewer_name || "The interviewer";
  const note = interview.response_note;

  // Their own copy, so the answer exists somewhere they can find it
  // again without signing in.
  const to = interview.interviewer_email || responder?.email;
  if (to) {
    await sendMail({
      to,
      name: who,
      ...interviewAnswerEmail({ interview, candidate, job, when, accepted }),
    });
  }

  if (!accepted) {
    // Declined. Only HR needs this, and it has to read as an action.
    if (interview.created_by) {
      await toUser(
        "interview.declined",
        { id: interview.created_by, name: "", email: "" },
        "Action needed: " + who + " declined the interview with " + candidate.full_name,
        who +
          " cannot take the " +
          interview.stage +
          " stage with " +
          candidate.full_name +
          " for " +
          job.title +
          " on " +
          when +
          "." +
          (note ? " Reason given: " + note : " No reason was given.") +
          " Book somebody else, or move the time. The candidate has not been told anything.",
        candidate.id,
        interview.id
      );
    }
    return;
  }

  // The interviewer's own confirmation, so they have it in writing.
  await toUser(
    "interview.accepted",
    { id: responder.id, name: responder.name, email: responder.email },
    "You accepted the interview with " + candidate.full_name,
    "You have accepted the " +
      interview.stage +
      " stage with " +
      candidate.full_name +
      " for " +
      job.title +
      ". It is on " +
      when +
      ", at " +
      (interview.location || "a location still to be confirmed") +
      ". Your feedback is due once it has taken place.",
    candidate.id,
    interview.id
  );

  // HR booked it, so HR hears back.
  if (interview.created_by && Number(interview.created_by) !== Number(responder?.id)) {
    await toUser(
      "interview.accepted",
      { id: interview.created_by, name: "", email: "" },
      who + " accepted the interview with " + candidate.full_name,
      who +
        " has confirmed the " +
        interview.stage +
        " stage with " +
        candidate.full_name +
        " for " +
        job.title +
        " on " +
        when +
        "." +
        (note ? " They added: " + note : "") +
        " The candidate's confirmation is waiting in the outbox.",
      candidate.id,
      interview.id
    );
  }

  // The hiring manager owns the position and wants to know it is moving.
  await toRoles(["hiring_manager"], {
    kind: "interview.accepted",
    subject: "Interview confirmed - " + candidate.full_name,
    body:
      who +
      " will interview " +
      candidate.full_name +
      " for " +
      job.title +
      " (" +
      interview.stage +
      ") on " +
      when +
      ".",
    candidateId: candidate.id,
    interviewId: interview.id,
    except: responder?.id,
  });

  // And the candidate is told it is definitely going ahead.
  await toOutbox(
    "interview.confirmed",
    { email: candidate.email, name: candidate.full_name },
    "Interview confirmed - " + job.title,
    "Dear " +
      candidate.full_name +
      ",\n\n" +
      "Your " +
      interview.stage +
      " interview for the " +
      job.title +
      " position at " +
      config.companyName +
      " is now confirmed.\n\n" +
      "Date and time: " +
      when +
      "\n" +
      "Location: " +
      (interview.location || "To be confirmed") +
      "\n" +
      "Interviewer: " +
      who +
      "\n\n" +
      "We look forward to meeting you. If anything changes, please let us know as soon as you can.\n\n" +
      "Kind regards,\n" +
      config.companyName,
    candidate.id,
    interview.id
  );
}

/** HR cancels an interview. */
export async function notifyInterviewCancelled({ interview, candidate, job, cancelledBy }) {
  const when = formatWhen(interview.scheduled_at);

  if (interview.interviewer_id) {
    await toUser(
      "interview.cancelled",
      {
        id: interview.interviewer_id,
        name: interview.interviewer_name,
        email: interview.interviewer_email,
      },
      "Interview cancelled - " + candidate.full_name,
      "The " +
        interview.stage +
        " stage with " +
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

  await toOutbox(
    "interview.cancelled",
    { email: candidate.email, name: candidate.full_name },
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

/**
 * Feedback lands. HR is running the process and the hiring manager makes
 * the call, so both hear about it - an interviewer's verdict sitting
 * unread is exactly what stops a candidate from moving.
 */
export async function notifyFeedbackSubmitted({ candidate, job, stage, author, rating, recommendation }) {
  await toRoles(["hr", "hiring_manager"], {
    kind: "feedback.submitted",
    subject: "Feedback in for " + candidate.full_name + " (" + stage + ")",
    body:
      (author?.name || "Someone") +
      " scored " +
      candidate.full_name +
      " " +
      rating +
      "/5 at " +
      stage +
      " for " +
      job.title +
      " and recommends " +
      String(recommendation).toLowerCase() +
      ". " +
      candidate.full_name +
      " can now be moved on.",
    candidateId: candidate.id,
    except: author?.id,
  });
}

/** A candidate reaches a final outcome. */
export async function notifyOutcome({ candidate, job, outcome, decidedBy }) {
  if (outcome !== "HIRED" && outcome !== "REJECTED") return;
  const hired = outcome === "HIRED";

  // Management is oversight, and a hire is the number they actually watch.
  await toRoles(["management", "hr"], {
    kind: hired ? "candidate.hired" : "candidate.rejected",
    subject: (hired ? "Hired: " : "Rejected: ") + candidate.full_name + " - " + job.title,
    body:
      (decidedBy?.name || "Someone") +
      " recorded " +
      candidate.full_name +
      " as " +
      (hired ? "hired" : "rejected") +
      " for " +
      job.title +
      ". The letter to the candidate is waiting in the outbox.",
    candidateId: candidate.id,
    except: decidedBy?.id,
  });

  await toOutbox(
    hired ? "candidate.hired" : "candidate.rejected",
    { email: candidate.email, name: candidate.full_name },
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
