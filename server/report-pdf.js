import PDFDocument from "pdfkit";
import { config } from "./config.js";

/**
 * RPT-02 - the same reports as PDF.
 *
 * "As a Hiring Manager, I want pipeline reports exportable in CSV and
 *  PDF, so that hiring performance data can be shared outside the
 *  system when needed."
 *
 * CSV is for somebody who is going to carry on working with the numbers.
 * PDF is for somebody who is going to read them - a leadership meeting,
 * an attachment on an email - where a spreadsheet that opens differently
 * on every machine is worse than a page that looks the same everywhere.
 *
 * Built from the same buildReport() data as the CSV, so the two exports
 * can never disagree about what the figures are.
 *
 * Only the fonts PDF readers already have (Helvetica) are used, so
 * nothing has to be bundled and the file works on any reader.
 */

const AMBER = "#c08400";
const INK = "#1e2228";
const SLATE = "#343f52";
const BODY = "#60697b";
const LINE = "#d8dce3";
const CANVAS = "#f3f4f7";

const MARGIN = 44;

function header(doc, title, subtitle) {
  // The brand bar, so a printed page is identifiably ours.
  doc.rect(0, 0, doc.page.width, 6).fill(AMBER);

  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(config.companyName + " Recruitment", MARGIN, 30);

  doc.fillColor(SLATE).font("Helvetica-Bold").fontSize(13).text(title, MARGIN, doc.y + 6);

  doc
    .fillColor(BODY)
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      subtitle +
        "  ·  generated " +
        new Date().toLocaleString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      MARGIN,
      doc.y + 3
    );

  doc.moveDown(0.8);
  const y = doc.y;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(0.7).stroke(LINE);
  doc.moveDown(0.6);
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);

    // Writing inside the bottom margin makes pdfkit think the text does
    // not fit and start a fresh page - which is how an empty last page
    // carrying nothing but its own footer appeared. Dropping the bottom
    // margin for the width of this one call stops it paginating.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .fillColor("#aab0bc")
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        config.companyName + " Recruitment  ·  page " + (i + 1) + " of " + range.count,
        MARGIN,
        doc.page.height - 30,
        { width: doc.page.width - MARGIN * 2, align: "center", lineBreak: false }
      );

    doc.page.margins.bottom = bottom;
  }
}

/**
 * One table.
 *
 * Column widths are given as weights rather than points, so a table
 * fills the page whatever the paper size, and a long name wraps instead
 * of running under the next column.
 */
function table(doc, headers, rows, weights) {
  const usable = doc.page.width - MARGIN * 2;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalWeight) * usable);
  // Running left edge of each column. Written as a plain loop because
  // the clever reduce that was here was off by one, which put two
  // columns at the same x and printed them on top of each other.
  const xs = [];
  let cursor = MARGIN;
  for (const w of widths) {
    xs.push(cursor);
    cursor += w;
  }

  const rowHeight = (cells, font, size) => {
    doc.font(font).fontSize(size);
    return (
      Math.max(
        ...cells.map((c, i) => doc.heightOfString(String(c ?? ""), { width: widths[i] - 8 }))
      ) + 8
    );
  };

  const drawRow = (cells, { bold = false, fill = null } = {}) => {
    const font = bold ? "Helvetica-Bold" : "Helvetica";
    const size = bold ? 8.5 : 8.5;
    const h = rowHeight(cells, font, size);

    // Start a new page before drawing, never halfway through a row.
    if (doc.y + h > doc.page.height - 52) {
      doc.addPage();
      drawRow(headers, { bold: true, fill: CANVAS });
    }

    const y = doc.y;
    if (fill) doc.rect(MARGIN, y - 2, usable, h).fill(fill);

    doc.fillColor(bold ? INK : BODY).font(font).fontSize(size);
    cells.forEach((cell, i) => {
      doc.text(String(cell ?? ""), xs[i] + 4, y + 2, { width: widths[i] - 8 });
    });

    doc.y = y + h;
    doc
      .moveTo(MARGIN, doc.y - 2)
      .lineTo(doc.page.width - MARGIN, doc.y - 2)
      .lineWidth(0.4)
      .stroke(LINE);
  };

  drawRow(headers, { bold: true, fill: CANVAS });
  if (!rows.length) {
    doc.fillColor(BODY).font("Helvetica-Oblique").fontSize(8.5);
    doc.text("Nothing to report yet.", MARGIN + 4, doc.y + 4);
    doc.moveDown();
    return;
  }
  rows.forEach((r) => drawRow(r));
  doc.moveDown(0.8);
}

/** The headline figures, as a row of boxes. */
function summaryBoxes(doc, pairs) {
  const usable = doc.page.width - MARGIN * 2;
  const perRow = 4;
  const gap = 8;
  const w = (usable - gap * (perRow - 1)) / perRow;
  let x = MARGIN;
  let y = doc.y;

  pairs.forEach((pair, i) => {
    if (i > 0 && i % perRow === 0) {
      x = MARGIN;
      y += 44;
    }
    doc.roundedRect(x, y, w, 38, 5).fill(CANVAS);
    doc
      .fillColor(BODY)
      .font("Helvetica")
      .fontSize(6.8)
      .text(String(pair[0]).toUpperCase(), x + 7, y + 6, { width: w - 14 });
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(String(pair[1]), x + 7, y + 16, { width: w - 14 });
    x += w + gap;
  });

  doc.y = y + 52;
}

/**
 * Build one report as a PDF and pipe it to the response.
 *
 * `which` matches the CSV export exactly, so the two stay in step.
 */
export function streamReportPdf(res, which, report, candidateRows) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: 52, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: config.companyName + " Recruitment - " + which,
      Author: config.companyName,
    },
  });

  doc.pipe(res);

  if (which === "candidates") {
    header(doc, "Candidates", "Every candidate, with their stage and outcome");
    table(
      doc,
      ["Name", "Position", "Stage", "Outcome", "Band", "Score"],
      candidateRows.map((r) => [
        r.full_name,
        r.job_title,
        r.current_stage,
        r.outcome,
        r.cv_band,
        r.average_rating ?? "-",
      ]),
      [2.4, 2.4, 1.6, 1.3, 1.1, 0.9]
    );
  } else if (which === "stages") {
    header(doc, "Pipeline by stage", "Where candidates still in the running are sitting");
    table(
      doc,
      ["Position", "Stage", "Candidates"],
      report.byStage.map((r) => [r.jobTitle, r.stage, r.total]),
      [3, 2.4, 1.2]
    );
  } else if (which === "interviewers") {
    header(doc, "Interviewer activity", "Whether feedback is keeping up with interviews");
    table(
      doc,
      ["Interviewer", "Role", "Interviews", "Feedback", "Outstanding", "Average"],
      report.interviewerActivity.map((r) => [
        r.name,
        r.role,
        r.interviews,
        r.feedback,
        r.outstanding,
        r.averageScore ?? "-",
      ]),
      [2.4, 1.7, 1.2, 1.2, 1.4, 1.1]
    );
  } else {
    header(doc, "Recruitment summary", "Open vacancies and how each one is filling");

    const s = report.summary;
    summaryBoxes(doc, [
      ["Open vacancies", s.openPositions],
      ["Candidates", s.totalCandidates],
      ["In progress", s.activeCandidates],
      ["Hired", s.hired],
      ["Rejected", s.rejected],
      ["On hold", s.onHold],
      ["CVs to screen", s.awaitingScreening],
      ["Avg days to decide", s.averageDaysToDecision ?? "-"],
    ]);

    table(
      doc,
      ["Vacancy", "Department", "Status", "Candidates", "Hired", "Rejected"],
      report.vacancies.map((r) => [
        r.title,
        r.department,
        r.status,
        r.candidates,
        r.hired,
        r.rejected,
      ]),
      [2.6, 2, 1.2, 1.4, 0.9, 1.1]
    );
  }

  footer(doc);
  doc.end();
}
