import express from "express";
import { one, run } from "../../database/index.js";
import { asyncHandler, httpError } from "../middleware.js";
import * as v from "../validate.js";
import { readInviteToken } from "../mail.js";
import { notifyInterviewResponse } from "../notify.js";

/**
 * Answering an interview invitation from the link in the email.
 *
 * These two routes are deliberately NOT behind requireAuth. An
 * interviewer reading their email is not signed in, and making them sign
 * in before they can say "yes" is how invitations end up ignored.
 *
 * The token in the URL is the authorisation, and it is narrow on
 * purpose:
 *
 *   - it is signed with the server's secret, so it cannot be forged
 *   - it carries its own purpose, so a sign-in cookie's token will not
 *     work here and this one will not work as a login
 *   - it names ONE interview and ONE interviewer, so it grants nothing
 *     else - no candidate list, no other booking
 *   - it expires (INVITE_EXPIRES_IN, 30 days by default)
 *
 * Following the link does not answer anything by itself. It shows the
 * booking and asks; a POST is what records the reply. A link opened by
 * accident, or prefetched by a mail client, commits nobody to anything.
 */
const router = express.Router();

async function loadFromToken(token) {
  const claims = readInviteToken(token);
  if (!claims) {
    throw httpError(400, "This invitation link is not valid, or it has expired.");
  }

  const interview = await one("SELECT * FROM interviews WHERE id = $1", [claims.interviewId]);
  if (!interview) {
    throw httpError(404, "This interview is no longer in the system. It may have been cancelled.");
  }
  // The token names the interviewer it was issued for. If the booking
  // has since been handed to somebody else, the old link stops working.
  if (Number(interview.interviewer_id) !== Number(claims.interviewerId)) {
    throw httpError(403, "This booking is no longer assigned to you.");
  }

  const candidate = await one("SELECT * FROM candidates WHERE id = $1", [interview.candidate_id]);
  const job = candidate ? await one("SELECT * FROM jobs WHERE id = $1", [candidate.job_id]) : null;
  const interviewer = await one("SELECT id, name, email FROM users WHERE id = $1", [
    interview.interviewer_id,
  ]);

  return { interview, candidate, job, interviewer };
}

function toJson({ interview, candidate, job, interviewer }) {
  return {
    id: Number(interview.id),
    stage: interview.stage,
    scheduledAt: interview.scheduled_at,
    location: interview.location,
    notes: interview.notes,
    response: interview.response,
    responseNote: interview.response_note,
    respondedAt: interview.responded_at,
    interviewerName: interviewer?.name || interview.interviewer_name,
    // Enough to decide whether you can take the interview, and no more.
    // The token does not entitle anyone to the candidate's contact
    // details or their CV - that is what signing in is for.
    candidateName: candidate?.full_name || "",
    jobTitle: job?.title || "",
  };
}

// --- What am I being asked? --------------------------------------------
router.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const loaded = await loadFromToken(req.params.token);
    res.json({ invite: toJson(loaded) });
  })
);

// --- Yes or no ----------------------------------------------------------
router.post(
  "/:token/respond",
  asyncHandler(async (req, res) => {
    const loaded = await loadFromToken(req.params.token);
    const { interview, candidate, job, interviewer } = loaded;

    const response = v.oneOf(req.body.response, ["ACCEPTED", "DECLINED"], { field: "Response" });
    const note = v.str(req.body.note, { field: "Note", max: 300 });

    if (interview.response === response) {
      throw httpError(400, "You have already " + response.toLowerCase() + " this interview.");
    }

    await run(
      "UPDATE interviews SET response = $1, response_note = $2, responded_at = NOW() WHERE id = $3",
      [response, note, interview.id]
    );

    const updated = await one("SELECT * FROM interviews WHERE id = $1", [interview.id]);

    // Same fan-out as answering from inside the app: HR hears back, the
    // hiring manager is told, the candidate's letter is written. Where
    // the answer was given from makes no difference to who needs it.
    await notifyInterviewResponse({
      interview: updated,
      candidate,
      job,
      responder: interviewer,
      accepted: response === "ACCEPTED",
    });

    res.json({ invite: toJson({ ...loaded, interview: updated }) });
  })
);

export default router;
