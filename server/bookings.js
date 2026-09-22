import { many } from "../database/index.js";

/**
 * Who is booked to interview this candidate at this stage.
 *
 * Shared by the two rules that depend on it, so they can never disagree
 * about who "the interviewer" is:
 *
 *   - only a booked interviewer can give feedback for that stage
 *     (feedback.routes.js)
 *   - a candidate cannot move on until every booked interviewer has
 *     (candidates.routes.js, /advance)
 *
 * A DECLINED booking is left out. That interviewer said they are not
 * doing it, so it is not theirs to score - and counting them would
 * block the candidate for good, waiting on feedback that will never
 * come. A cancelled booking is already gone: cancelling deletes the row.
 */
export async function bookedInterviewers(candidateId, stage) {
  const rows = await many(
    "SELECT DISTINCT i.interviewer_id AS id, COALESCE(u.name, i.interviewer_name) AS name " +
      "FROM interviews i LEFT JOIN users u ON u.id = i.interviewer_id " +
      "WHERE i.candidate_id = $1 AND i.stage = $2 " +
      "AND i.interviewer_id IS NOT NULL AND i.response <> 'DECLINED'",
    [candidateId, stage]
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name || "the booked interviewer" }));
}

/**
 * Who may give feedback on this candidate at this stage.
 *
 * Review item 4: "hiring manager can give feedback for another one's
 * assigned interviews - make it cannot." Guarding only the booked stage
 * was not enough: the feedback form has a stage dropdown, so a hiring
 * manager could simply pick a stage nobody was booked for and score a
 * candidate assigned to somebody else. The owner is decided in order:
 *
 *   1. somebody is BOOKED to interview them at this stage
 *      -> only the booked interviewer(s)
 *   2. nobody is booked, but the candidate is ASSIGNED to somebody
 *      -> only that assigned interviewer
 *   3. neither -> anyone whose role may write feedback
 *
 * It is about whose interview it is, not about the role: a hiring
 * manager booked for a stage, or assigned the candidate, can score it.
 *
 * Returns { allowed, owners, reason } for `userId`.
 */
export async function feedbackOwnership(candidate, stage, userId) {
  const booked = await bookedInterviewers(Number(candidate.id), stage);
  if (booked.length) {
    const allowed = booked.some((b) => b.id === Number(userId));
    return {
      allowed,
      owners: booked.map((b) => b.name),
      reason: allowed
        ? null
        : 'The "' + stage + '" interview is booked with ' +
          booked.map((b) => b.name).join(" and ") +
          ", so only they can give its feedback.",
    };
  }

  const assignedId = candidate.assigned_interviewer_id ?? candidate.assignedInterviewerId;
  if (assignedId) {
    const allowed = Number(assignedId) === Number(userId);
    // Name the person. "Only their interviewer can" tells nobody who to
    // ask; "only Sara Salgadu can" does.
    let name = candidate.assigned_interviewer_name ?? candidate.assignedInterviewerName;
    if (!name) {
      const person = await many("SELECT name FROM users WHERE id = $1", [assignedId]);
      name = person[0]?.name || "their assigned interviewer";
    }
    return {
      allowed,
      owners: [name],
      reason: allowed
        ? null
        : candidate.full_name + " is assigned to " + name + ", so only " + name +
          " can give their feedback.",
    };
  }

  return { allowed: true, owners: [], reason: null };
}

/** Of those booked, who has not yet given this stage's feedback. */
export async function awaitingFeedback(candidateId, stage) {
  const booked = await bookedInterviewers(candidateId, stage);
  if (!booked.length) return { booked, missing: [] };

  const given = await many(
    "SELECT author_id FROM feedback WHERE candidate_id = $1 AND stage = $2",
    [candidateId, stage]
  );
  const authors = new Set(given.map((g) => Number(g.author_id)));
  return { booked, missing: booked.filter((b) => !authors.has(b.id)) };
}
