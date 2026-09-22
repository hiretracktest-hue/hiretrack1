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
