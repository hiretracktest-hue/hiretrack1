"""Generates the Sprint 1 design artifacts as PNG images (ERD, use case
diagram, activity diagram, wireframes and the burndown chart)."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))

INK = (27, 24, 48)
MUTED = (111, 107, 133)
LINE = (200, 196, 220)
PURPLE = (124, 58, 237)
PURPLE_LT = (237, 233, 254)
GREEN = (15, 122, 69)
GREEN_LT = (231, 247, 238)
AMBER_LT = (254, 243, 215)
RED = (180, 35, 24)
RED_LT = (253, 234, 234)
WHITE = (255, 255, 255)
CANVAS = (250, 249, 253)


def font(size, bold=False):
    for name in (("segoeuib.ttf", "arialbd.ttf") if bold else ("segoeui.ttf", "arial.ttf")):
        try:
            return ImageFont.truetype(r"C:\Windows\Fonts\\" + name, size)
        except Exception:
            continue
    return ImageFont.load_default()


F_TITLE = font(30, True)
F_H = font(19, True)
F = font(16)
F_SM = font(14)
F_XS = font(12)


def new(w, h):
    img = Image.new("RGB", (w, h), CANVAS)
    return img, ImageDraw.Draw(img)


def text_w(d, s, f):
    return d.textbbox((0, 0), s, font=f)[2]


def centered(d, s, f, cx, y, fill=INK):
    d.text((cx - text_w(d, s, f) / 2, y), s, font=f, fill=fill)


def box(d, x, y, w, h, fill=WHITE, outline=LINE, width=2, radius=10):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=outline, width=width)


def arrow(d, p1, p2, color=MUTED, width=2, head=9):
    d.line([p1, p2], fill=color, width=width)
    import math

    ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    for s in (0.5, -0.5):
        d.line(
            [p2, (p2[0] - head * math.cos(ang + s), p2[1] - head * math.sin(ang + s))],
            fill=color,
            width=width,
        )


# =====================================================================
# 1. ERD
# =====================================================================
def erd():
    img, d = new(1700, 1180)
    centered(d, "HireTrack - Entity Relationship Diagram (SQLite)", F_TITLE, 850, 26)
    centered(d, "PK = primary key,  FK = foreign key.  1 : N reads as one row on the left, many rows on the right.", F_SM, 850, 66, MUTED)

    tables = {
        "users": (60, 130, 340, [
            ("PK", "id"), ("", "name"), ("", "email  UNIQUE"), ("", "password_hash"),
            ("", "role  (4 staff roles | client)"), ("", "google_id  UNIQUE"),
            ("", "avatar_url"), ("", "created_at / updated_at"),
        ]),
        "jobs  (vacancies)": (660, 130, 360, [
            ("PK", "id"), ("", "title"), ("", "department / location"),
            ("", "employment_type"), ("", "description / salary_range"),
            ("", "closing_date"), ("", "status  ACTIVE | CLOSED"),
            ("FK", "created_by -> users.id"), ("", "created_at / updated_at"),
        ]),
        "job_stages": (1280, 130, 360, [
            ("PK", "id"), ("FK", "job_id -> jobs.id"), ("", "name"),
            ("", "position  (0,1,2 ... order)"),
            ("", "UNIQUE (job_id, name)"), ("", "UNIQUE (job_id, position)"),
        ]),
        "applications": (660, 500, 360, [
            ("PK", "id"), ("FK", "job_id -> jobs.id"), ("FK", "user_id -> users.id"),
            ("", "full_name / email / phone"), ("", "source / cover_note / notes"),
            ("", "current_stage"), ("", "outcome  ACTIVE|ON_HOLD|HIRED|REJECTED"),
            ("", "cv_status  PENDING|ACCEPTED|REJECTED"),
            ("", "cv_filename / cv_stored_name / cv_size"),
            ("", "UNIQUE (job_id, email)"),
        ]),
        "interviews": (1280, 500, 360, [
            ("PK", "id"), ("FK", "application_id -> applications.id"),
            ("", "stage"), ("", "scheduled_at"),
            ("", "interviewer_name / _email"), ("", "notes"),
            ("FK", "created_by -> users.id"),
        ]),
        "feedback": (1280, 830, 360, [
            ("PK", "id"), ("FK", "application_id -> applications.id"),
            ("FK", "author_id -> users.id"), ("", "stage"),
            ("", "rating  CHECK 1..5"),
            ("", "recommendation  ADVANCE|HOLD|REJECT"),
            ("", "strengths / concerns / comment"),
            ("", "UNIQUE (application_id, stage, author_id)"),
        ]),
        "password_resets": (60, 620, 340, [
            ("PK", "id"), ("FK", "user_id -> users.id"),
            ("", "token_hash  (SHA-256, UNIQUE)"),
            ("", "expires_at"), ("", "used_at"),
        ]),
    }

    coords = {}
    for name, (x, y, w, rows) in tables.items():
        h = 46 + len(rows) * 26 + 12
        coords[name] = (x, y, w, h)
        box(d, x, y, w, h, radius=12)
        d.rounded_rectangle([x, y, x + w, y + 40], radius=12, fill=PURPLE)
        d.rectangle([x, y + 28, x + w, y + 40], fill=PURPLE)
        d.text((x + 14, y + 10), name, font=F_H, fill=WHITE)
        yy = y + 52
        for tag, col in rows:
            if tag:
                d.text((x + 14, yy), tag, font=F_XS, fill=PURPLE)
            d.text((x + 52, yy - 2), col, font=F_SM, fill=INK if tag == "PK" else MUTED)
            yy += 26

    def edge(a, b, label, side="right"):
        ax, ay, aw, ah = coords[a]
        bx, by, bw, bh = coords[b]
        if side == "right":
            p1 = (ax + aw, ay + ah / 2)
            p2 = (bx, by + bh / 2)
        else:
            p1 = (ax + aw / 2, ay + ah)
            p2 = (bx + bw / 2, by)
        d.line([p1, p2], fill=PURPLE, width=2)
        mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
        tw = text_w(d, label, F_XS)
        d.rectangle([mx - tw / 2 - 6, my - 11, mx + tw / 2 + 6, my + 11], fill=CANVAS)
        centered(d, label, F_XS, mx, my - 8, PURPLE)

    edge("users", "jobs  (vacancies)", "1 : N  posts")
    edge("jobs  (vacancies)", "job_stages", "1 : N  has stages")
    edge("jobs  (vacancies)", "applications", "1 : N  receives", "down")
    edge("applications", "interviews", "1 : N")
    edge("applications", "feedback", "1 : N  is reviewed in")
    edge("users", "password_resets", "1 : N", "down")

    d.line([(400, 300), (500, 300), (500, 640), (660, 640)], fill=PURPLE, width=2)
    d.text((406, 500), "1 : N  applies as", font=F_XS, fill=PURPLE)
    d.line([(400, 360), (560, 360), (560, 1050), (1280, 1050)], fill=PURPLE, width=2)
    d.text((575, 1025), "1 : N  writes feedback", font=F_XS, fill=PURPLE)

    d.text((60, 1105), "ON DELETE CASCADE: deleting a vacancy removes its stages, applications, interviews and feedback.", font=F_SM, fill=MUTED)
    d.text((60, 1135), "ON DELETE SET NULL: deleting a user leaves their vacancies and feedback in place, unattributed.", font=F_SM, fill=MUTED)
    img.save(os.path.join(OUT, "erd.png"))


# =====================================================================
# 2. Use case diagram
# =====================================================================
def stick(d, cx, cy, label, sub):
    d.ellipse([cx - 17, cy - 46, cx + 17, cy - 12], outline=INK, width=3)
    d.line([(cx, cy - 12), (cx, cy + 34)], fill=INK, width=3)
    d.line([(cx - 26, cy + 6), (cx + 26, cy + 6)], fill=INK, width=3)
    d.line([(cx, cy + 34), (cx - 22, cy + 72)], fill=INK, width=3)
    d.line([(cx, cy + 34), (cx + 22, cy + 72)], fill=INK, width=3)
    centered(d, label, F_H, cx, cy + 84)
    centered(d, sub, F_XS, cx, cy + 108, MUTED)


def usecase():
    img, d = new(1700, 1080)
    centered(d, "HireTrack - Use Case Diagram (Sprint 1)", F_TITLE, 850, 26)

    d.rounded_rectangle([330, 100, 1370, 1000], radius=16, outline=LINE, width=3, fill=WHITE)
    centered(d, "HireTrack system", F_H, 850, 118, MUTED)

    stick(d, 160, 400, "Client", "applies for a job")
    stick(d, 1550, 400, "Hiring team", "Isuru / Fazl /")
    centered(d, "Thariq / Ahmed", F_XS, 1550, 522, MUTED)

    shared = [("Sign up / Sign in / Sign out", 850, 190), ("Reset a forgotten password", 850, 268)]
    client_cases = [
        ("Browse open vacancies", 600, 370),
        ("Apply for a vacancy", 600, 448),
        ("Upload / replace CV", 600, 526),
        ("Track my application status", 600, 604),
        ("Withdraw my application", 600, 682),
    ]
    staff_cases = [
        ("Create / edit / close a vacancy", 1110, 370),
        ("Configure interview stages", 1110, 448),
        ("Accept or reject a CV", 1110, 526),
        ("Move candidate to next stage", 1110, 604),
        ("Record outcome", 1110, 682),
        ("Leave interview feedback", 1110, 760),
        ("Compare candidates", 1110, 838),
        ("Schedule an interview", 1110, 916),
    ]

    def oval(cx, cy, label, fill):
        w = max(330, text_w(d, label, F) + 60)
        d.ellipse([cx - w / 2, cy - 32, cx + w / 2, cy + 32], fill=fill, outline=PURPLE, width=2)
        centered(d, label, F, cx, cy - 10)
        return w

    for label, cx, cy in shared:
        w = oval(cx, cy, label, AMBER_LT)
        d.line([(200, 360), (cx - w / 2, cy + 10)], fill=LINE, width=2)
        d.line([(1510, 360), (cx + w / 2, cy + 10)], fill=LINE, width=2)

    for label, cx, cy in client_cases:
        w = oval(cx, cy, label, PURPLE_LT)
        d.line([(200, 400), (cx - w / 2, cy)], fill=LINE, width=2)

    for label, cx, cy in staff_cases:
        w = oval(cx, cy, label, GREEN_LT)
        d.line([(1510, 400), (cx + w / 2, cy)], fill=LINE, width=2)

    d.text((360, 1015), "Amber = available to both actors    Purple = client only    Green = hiring team only", font=F_SM, fill=MUTED)
    d.text((360, 1045), "All four hiring team roles share one permission set - the role is a label, not an access level.", font=F_SM, fill=MUTED)
    img.save(os.path.join(OUT, "usecase.png"))


# =====================================================================
# 3. Activity diagram
# =====================================================================
def activity():
    img, d = new(1300, 1420)
    centered(d, "Activity Diagram - Apply for a vacancy and get the CV reviewed", F_TITLE, 650, 26)

    d.line([(120, 96), (1180, 96)], fill=LINE, width=2)
    centered(d, "CLIENT", F_H, 380, 70, PURPLE)
    centered(d, "HIRING TEAM", F_H, 920, 70, GREEN)
    d.line([(650, 96), (650, 1400)], fill=LINE, width=2)

    def node(cx, cy, label, fill=WHITE, w=380, h=64):
        box(d, cx - w / 2, cy - h / 2, w, h, fill=fill)
        centered(d, label, F, cx, cy - 10)
        return (cx, cy - h / 2), (cx, cy + h / 2)

    def diamond(cx, cy, label, w=300, h=110):
        d.polygon([(cx, cy - h / 2), (cx + w / 2, cy), (cx, cy + h / 2), (cx - w / 2, cy)],
                  fill=AMBER_LT, outline=PURPLE, width=2)
        centered(d, label, F_SM, cx, cy - 9)

    d.ellipse([355, 120, 405, 170], fill=INK)
    arrow(d, (380, 170), (380, 200))
    node(380, 232, "Sign in / sign up as a client")
    arrow(d, (380, 264), (380, 296))
    node(380, 328, "Browse the open vacancies")
    arrow(d, (380, 360), (380, 392))
    node(380, 424, "Open a vacancy and press Apply", PURPLE_LT)
    arrow(d, (380, 456), (380, 488))
    node(380, 520, "Upload CV (PDF / DOC / DOCX, max 5 MB)", PURPLE_LT, w=440)
    arrow(d, (380, 552), (380, 584))
    node(380, 616, 'Status shows "Under review"', AMBER_LT)

    arrow(d, (600, 616), (760, 616), PURPLE)
    node(920, 616, "Open the candidate and read the CV", w=400)
    arrow(d, (920, 648), (920, 700))
    diamond(920, 760, "Is the CV good enough?")

    arrow(d, (1070, 760), (1150, 760), GREEN)
    d.text((1080, 730), "yes", font=F_SM, fill=GREEN)
    d.text((855, 830), "no", font=F_SM, fill=RED)
    arrow(d, (920, 815), (920, 862), RED)

    node(920, 900, "Reject CV  ->  outcome REJECTED", RED_LT, w=400)
    box(d, 950, 990, 300, 64, fill=GREEN_LT)
    centered(d, "Accept CV", F, 1100, 1008)
    d.line([(1150, 760), (1150, 990)], fill=GREEN, width=2)
    arrow(d, (1150, 985), (1150, 990), GREEN)

    arrow(d, (1100, 1054), (1100, 1096), GREEN)
    node(1010, 1128, "Schedule interview / leave feedback", GREEN_LT, w=420)
    arrow(d, (1010, 1160), (1010, 1200), GREEN)
    node(1010, 1232, "Move to the next stage  ->  outcome HIRED", GREEN_LT, w=460)

    arrow(d, (720, 900), (600, 900), RED)
    node(380, 900, 'Client sees "Not successful"', RED_LT, w=380)
    arrow(d, (790, 1128), (600, 1128), GREEN)
    node(380, 1128, 'Client sees "CV accepted"', GREEN_LT, w=380)

    d.ellipse([355, 1230, 405, 1280], outline=INK, width=3)
    d.ellipse([365, 1240, 395, 1270], fill=INK)
    arrow(d, (380, 1160), (380, 1228))
    # Rejected path runs down the far left straight to the end node.
    d.line([(380, 932), (180, 932), (180, 1255), (348, 1255)], fill=RED, width=2)
    arrow(d, (340, 1255), (352, 1255), RED)

    d.text((120, 1330), "Replacing the CV at any point resets cv_status to PENDING, so it goes back to 'Under review'.", font=F_SM, fill=MUTED)
    d.text((120, 1360), "The client never sees the pipeline stage, the internal notes or the interviewer feedback.", font=F_SM, fill=MUTED)
    img.save(os.path.join(OUT, "activity.png"))


# =====================================================================
# 4. Wireframes
# =====================================================================
def wireframes():
    img, d = new(1700, 1150)
    centered(d, "Sprint 1 Wireframes", F_TITLE, 850, 26)

    def screen(x, y, w, h, title, rows, note):
        box(d, x, y, w, h, fill=WHITE, width=3)
        d.rectangle([x + 1, y + 1, x + w - 1, y + 46], fill=(243, 242, 249))
        d.text((x + 16, y + 14), title, font=F_H, fill=INK)
        yy = y + 66
        for kind, label in rows:
            if kind == "input":
                box(d, x + 20, yy, w - 40, 44, fill=(252, 252, 255), outline=LINE, width=2, radius=8)
                d.text((x + 32, yy + 12), label, font=F_SM, fill=MUTED)
                yy += 56
            elif kind == "btn":
                box(d, x + 20, yy, w - 40, 46, fill=PURPLE, outline=PURPLE, radius=8)
                centered(d, label, F, x + w / 2, yy + 12, WHITE)
                yy += 58
            elif kind == "card":
                box(d, x + 20, yy, w - 40, 70, fill=(252, 252, 255), outline=LINE, width=2, radius=8)
                d.text((x + 32, yy + 10), label, font=F_SM, fill=INK)
                d.text((x + 32, yy + 38), "status badge  ·  detail line", font=F_XS, fill=MUTED)
                yy += 82
            elif kind == "row":
                d.line([(x + 20, yy + 34), (x + w - 20, yy + 34)], fill=LINE, width=1)
                d.text((x + 26, yy + 8), label, font=F_SM, fill=INK)
                yy += 44
            elif kind == "label":
                d.text((x + 22, yy), label, font=F_XS, fill=MUTED)
                yy += 26
        d.text((x, y + h + 12), note, font=F_XS, fill=MUTED)

    screen(60, 90, 380, 470, "Sign in", [
        ("label", "EMAIL ADDRESS"), ("input", "you@gmail.com"),
        ("label", "PASSWORD"), ("input", "••••••••          Show"),
        ("row", "Forgot your password?"),
        ("btn", "Sign in"),
        ("row", "Don't have an account?  Create one"),
    ], "WF-1  /signin")

    screen(500, 90, 460, 470, "Open vacancies  (client)", [
        ("input", "Search by title, department…"),
        ("card", "Junior Software Engineer"),
        ("card", "QA Engineer"),
        ("card", "Business Analyst Intern"),
    ], "WF-2  /jobs  - card list, no admin controls")

    screen(1020, 90, 620, 470, "Vacancies  (hiring team)", [
        ("row", "TITLE            DEPT       APPLICANTS   STATUS"),
        ("row", "Junior Software Engineer   Eng      2      Open"),
        ("row", "QA Engineer                QA       1      Open"),
        ("row", "Business Analyst Intern    Product  1      Open"),
        ("btn", "+ New vacancy"),
    ], "WF-3  /jobs  - management table with counts")

    screen(60, 630, 460, 460, "My application  (client)", [
        ("label", "STATUS BANNER"),
        ("card", "Under review"),
        ("label", "MY CV"),
        ("input", "Choose file… (PDF / DOC / DOCX)"),
        ("btn", "Upload CV"),
    ], "WF-4  /my-applications/:id")

    screen(580, 630, 500, 460, "Candidate  (hiring team)", [
        ("row", "Pipeline:  Applied > Screening > Interview"),
        ("btn", "Move to next stage"),
        ("label", "CV"),
        ("row", "maya-cv.pdf        Accept CV | Reject CV"),
        ("label", "INTERVIEW FEEDBACK"),
        ("card", "Isuru · Screening · 4/5 · Advance"),
    ], "WF-5  /candidates/:id")

    screen(1140, 630, 500, 460, "Compare candidates", [
        ("row", "NAME          OVERALL   SCREENING   OFFER"),
        ("row", "Maya Fernando   4.5/5     4.5/5       -"),
        ("row", "Dinuka Perera   -         -           -"),
        ("label", "RECOMMENDATIONS  advance / hold / reject"),
        ("row", "Ranked best first"),
    ], "WF-6  /jobs/:id/compare")

    img.save(os.path.join(OUT, "wireframes.png"))


# =====================================================================
# 5. Burndown chart
# =====================================================================
def burndown(remaining):
    img, d = new(1300, 760)
    centered(d, "Sprint 1 Burndown Chart", F_TITLE, 650, 24)

    x0, y0, x1, y1 = 130, 110, 1220, 620
    total = remaining[0]
    days = len(remaining) - 1

    d.line([(x0, y0), (x0, y1)], fill=INK, width=2)
    d.line([(x0, y1), (x1, y1)], fill=INK, width=2)

    for i in range(0, total + 1, 10):
        yy = y1 - (i / total) * (y1 - y0)
        d.line([(x0 - 6, yy), (x1, yy)], fill=(238, 236, 246), width=1)
        d.text((x0 - 46, yy - 10), str(i), font=F_SM, fill=MUTED)

    for i in range(days + 1):
        xx = x0 + (i / days) * (x1 - x0)
        d.line([(xx, y1), (xx, y1 + 6)], fill=MUTED, width=2)
        centered(d, "D" + str(i), F_SM, xx, y1 + 14, MUTED)

    def pt(i, value):
        return (x0 + (i / days) * (x1 - x0), y1 - (value / total) * (y1 - y0))

    ideal = [pt(i, total - (total / days) * i) for i in range(days + 1)]
    for a, b in zip(ideal, ideal[1:]):
        d.line([a, b], fill=LINE, width=3)

    actual = [pt(i, v) for i, v in enumerate(remaining)]
    for a, b in zip(actual, actual[1:]):
        d.line([a, b], fill=PURPLE, width=4)
    for i, p in enumerate(actual):
        d.ellipse([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6], fill=PURPLE)
        centered(d, str(remaining[i]), F_XS, p[0], p[1] - 30, PURPLE)

    d.line([(x0 + 40, 660), (x0 + 100, 660)], fill=LINE, width=3)
    d.text((x0 + 112, 650), "Ideal burndown", font=F_SM, fill=MUTED)
    d.line([(x0 + 300, 660), (x0 + 360, 660)], fill=PURPLE, width=4)
    d.text((x0 + 372, 650), "Actual remaining story points", font=F_SM, fill=MUTED)

    d.text((x0, 700), "Y axis = story points remaining.   X axis = sprint day.", font=F_SM, fill=MUTED)
    img.save(os.path.join(OUT, "burndown.png"))


if __name__ == "__main__":
    erd()
    usecase()
    activity()
    wireframes()
    burndown([63, 63, 57, 50, 44, 44, 35, 27, 20, 9, 0])
    print("diagrams written to", OUT)
