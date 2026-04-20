"""
Budget PWA - Flask Backend
Run: python server.py
"""
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import sqlite3, os, io
from datetime import datetime, date
import calendar
from flask import abort

app = Flask(__name__, static_folder=".")
CORS(app)
DB_PATH = os.environ.get("DB_PATH", "/data/budget.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT    NOT NULL UNIQUE,
            pin  TEXT    DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS expenses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            amount      REAL    NOT NULL,
            type        TEXT    NOT NULL DEFAULT 'expense',
            category    TEXT    DEFAULT 'Uncategorized',
            description TEXT    DEFAULT '',
            date        TEXT    NOT NULL,
            created_at  TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    # Migration for existing DBs
    try:
        cur.execute("ALTER TABLE expenses ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'")
    except Exception:
        pass
    conn.commit()
    conn.close()

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def static_files(path):
    if path.startswith("api/"):
        abort(404)  # DON'T serve HTML for API routes
    return send_from_directory(".", path)

@app.route("/api/users", methods=["GET"])
def get_users():
    conn = get_db()
    users = conn.execute("SELECT id, name FROM users ORDER BY name").fetchall()
    conn.close()
    return jsonify([dict(u) for u in users])

@app.route("/api/users", methods=["POST"])
def create_user():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    pin  = data.get("pin", None)
    if not name:
        return jsonify({"error": "Name is required"}), 400
    conn = get_db()
    try:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count >= 5:
            return jsonify({"error": "Maximum 5 users allowed"}), 400
        cur = conn.execute("INSERT INTO users (name, pin) VALUES (?, ?)", (name, pin))
        conn.commit()
        uid = cur.lastrowid
        conn.close()
        return jsonify({"id": uid, "name": name}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Username already exists"}), 409

@app.route("/api/users/login", methods=["POST"])
def login_user():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    pin  = data.get("pin", None)
    conn = get_db()
    user = conn.execute("SELECT id, name, pin FROM users WHERE name = ?", (name,)).fetchone()
    conn.close()
    if not user:
        return jsonify({"error": "User not found"}), 404
    if user["pin"] and user["pin"] != str(pin):
        return jsonify({"error": "Incorrect PIN"}), 401
    return jsonify({"id": user["id"], "name": user["name"]})

@app.route("/api/health")
def health():
    import os
    return jsonify({
        "db_path": DB_PATH,
        "db_exists": os.path.exists(DB_PATH),
        "data_dir_exists": os.path.exists("/data"),
        "data_dir_writable": os.access("/data", os.W_OK)
    })


@app.route("/api/expenses/<int:user_id>", methods=["GET"])
def get_expenses(user_id):
    conn = get_db()
    date_from = request.args.get('date_from')
    date_to   = request.args.get('date_to')

    date_clause = ""
    date_params = [user_id]
    if date_from:
        date_clause += " AND date >= ?"
        date_params.append(date_from)
    if date_to:
        date_clause += " AND date <= ?"
        date_params.append(date_to)

    rows = conn.execute(
        f"""SELECT id, amount, type, category, description, date
           FROM expenses WHERE user_id = ?{date_clause}
           ORDER BY date DESC, id DESC""", date_params
    ).fetchall()
    summary = conn.execute(
        f"""SELECT
             SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) as total_income,
             SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as total_expense
           FROM expenses WHERE user_id = ?{date_clause}""", date_params
    ).fetchone()
    cat_rows = conn.execute(
        f"""SELECT DISTINCT category FROM expenses
           WHERE user_id = ?{date_clause} ORDER BY category""", date_params
    ).fetchall()
    conn.close()

    items         = [dict(r) for r in rows]
    total_income  = round(float(summary["total_income"]  or 0), 2)
    total_expense = round(float(summary["total_expense"] or 0), 2)
    balance       = round(total_income - total_expense, 2)
    used_cats     = [r["category"] for r in cat_rows if r["category"]]

    groups = {}
    for exp in items:
        cat = exp["category"] or "Uncategorized"
        is_income = exp["type"] == "income"
        if cat not in groups:
            groups[cat] = {"category": cat, "net": 0.0, "expenses": []}
        # Net = income adds, expense subtracts
        if is_income:
            groups[cat]["net"] = round(groups[cat]["net"] + exp["amount"], 2)
        else:
            groups[cat]["net"] = round(groups[cat]["net"] - exp["amount"], 2)
        groups[cat]["expenses"].append(exp)

    for g in groups.values():
        g["total"] = abs(g["net"])
        g["_is_income"] = g["net"] >= 0

    income_groups  = sorted([g for g in groups.values() if g["_is_income"]],  key=lambda g: g["net"], reverse=True)
    expense_groups = sorted([g for g in groups.values() if not g["_is_income"]], key=lambda g: g["net"])
    sorted_groups  = income_groups + expense_groups

    return jsonify({
        "groups": sorted_groups,
        "total_income": total_income,
        "total_expense": total_expense,
        "balance": balance,
        "used_categories": used_cats
    })

@app.route("/api/expenses", methods=["POST"])
def add_expense():
    data = request.get_json()
    user_id     = data.get("user_id")
    amount      = data.get("amount")
    entry_type  = data.get("type", "expense")
    category    = (data.get("category") or "Uncategorized").strip()
    description = (data.get("description") or "").strip()
    date        = data.get("date") or datetime.now().strftime("%Y-%m-%d")

    if not user_id or not amount:
        return jsonify({"error": "user_id and amount are required"}), 400
    if entry_type not in ("expense", "income"):
        return jsonify({"error": "type must be expense or income"}), 400
    try:
        amount = float(amount)
        if amount <= 0: raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "Amount must be a positive number"}), 400

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO expenses (user_id, amount, type, category, description, date) VALUES (?,?,?,?,?,?)",
        (user_id, amount, entry_type, category, description, date)
    )
    conn.commit()
    eid = cur.lastrowid
    conn.close()
    return jsonify({"id": eid, "user_id": user_id, "amount": amount,
                    "type": entry_type, "category": category,
                    "description": description, "date": date}), 201

@app.route("/api/expenses/<int:expense_id>", methods=["PUT"])
def update_expense(expense_id):
    data = request.get_json()
    fields, values = [], []
    if "amount" in data:
        try:
            amt = float(data["amount"])
            if amt <= 0: raise ValueError
        except: return jsonify({"error": "Amount must be positive"}), 400
        fields.append("amount = ?"); values.append(amt)
    if "type" in data:
        if data["type"] not in ("expense","income"):
            return jsonify({"error": "Invalid type"}), 400
        fields.append("type = ?"); values.append(data["type"])
    if "category" in data:
        fields.append("category = ?"); values.append((data["category"] or "Uncategorized").strip())
    if "description" in data:
        fields.append("description = ?"); values.append((data["description"] or "").strip())
    if "date" in data:
        fields.append("date = ?"); values.append(data["date"])
    if not fields:
        return jsonify({"error": "Nothing to update"}), 400
    values.append(expense_id)
    conn = get_db()
    conn.execute(f"UPDATE expenses SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
def delete_expense(expense_id):
    conn = get_db()
    conn.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/expenses/<int:user_id>/summary", methods=["GET"])
def get_summary(user_id):
    conn = get_db()
    rows = conn.execute(
        """SELECT date, SUM(amount) as total FROM expenses
           WHERE user_id = ? AND type = 'expense' AND date >= date('now', '-6 days')
           GROUP BY date ORDER BY date ASC""", (user_id,)
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/export/pdf", methods=["GET"])
def export_pdf():
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, HRFlowable, KeepTogether)
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

    user_id  = request.args.get("user_id", type=int)
    mode     = request.args.get("mode", "month")   # "month" | "range"
    detailed = request.args.get("detailed", "false").lower() == "true"

    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    conn = get_db()
    user = conn.execute("SELECT name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "User not found"}), 404
    user_name = user["name"]

    # ── Date range ──────────────────────────────────────────────
    if mode == "month":
        month = request.args.get("month", type=int, default=date.today().month)
        year  = request.args.get("year",  type=int, default=date.today().year)
        last_day = calendar.monthrange(year, month)[1]
        date_from = f"{year:04d}-{month:02d}-01"
        date_to   = f"{year:04d}-{month:02d}-{last_day:02d}"
        period_label = date(year, month, 1).strftime("%B %Y")
    else:
        date_from = request.args.get("date_from", "")
        date_to   = request.args.get("date_to",   "")
        if not date_from or not date_to:
            conn.close()
            return jsonify({"error": "date_from and date_to required for range mode"}), 400
        def fmt_label(d):
            try: return datetime.strptime(d, "%Y-%m-%d").strftime("%d %b %Y")
            except: return d
        period_label = f"{fmt_label(date_from)}  to  {fmt_label(date_to)}"

    rows = conn.execute(
        """SELECT e.id, e.amount, e.type, e.category, e.description, e.date
           FROM expenses e WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?
           ORDER BY e.date ASC, e.id ASC""", (user_id, date_from, date_to)
    ).fetchall()
    conn.close()

    items = [dict(r) for r in rows]
    total_income  = round(sum(e["amount"] for e in items if e["type"] == "income"),  2)
    total_expense = round(sum(e["amount"] for e in items if e["type"] == "expense"), 2)
    balance       = round(total_income - total_expense, 2)

    # Group by category
    groups = {}
    for e in items:
        cat = e["category"] or "Uncategorized"
        if cat not in groups:
            groups[cat] = {"expenses": [], "net": 0.0, "is_income": e["type"] == "income"}
        groups[cat]["net"] += e["amount"] if e["type"] == "income" else -e["amount"]
        groups[cat]["expenses"].append(e)
    for g in groups.values():
        g["net"] = round(g["net"], 2)
        g["is_income"] = g["net"] >= 0

    # ── Colours & Styles ────────────────────────────────────────
    BG        = colors.HexColor("#ffffff")
    CARD      = colors.HexColor("#ececec")
    GOLD      = colors.HexColor("#e8c547")
    GREEN     = colors.HexColor("#5cc98d")
    RED       = colors.HexColor("#e05c5c")
    TEXT      = colors.HexColor("#000000")
    MUTED     = colors.HexColor("#7a7880")
    BORDER    = colors.HexColor("#2a2a34")
    SOFT      = colors.HexColor("#232329")

    def style(name, **kw):
        base = dict(fontName="Helvetica", fontSize=10, textColor=TEXT,
                    leading=14, backColor=None)
        base.update(kw)
        return ParagraphStyle(name, **base)

    S_APPNAME   = style("appname",   fontName="Helvetica-Bold", fontSize=22,
                        textColor=GOLD,   leading=26, alignment=TA_LEFT)
    S_PERIOD    = style("period",    fontName="Helvetica",      fontSize=11,
                        textColor=MUTED,  leading=15, alignment=TA_LEFT)
    S_USER      = style("user",      fontName="Helvetica-Bold", fontSize=13,
                        textColor=TEXT,   leading=17, alignment=TA_LEFT)
    S_META      = style("meta",      fontName="Helvetica",      fontSize=8,
                        textColor=MUTED,  leading=11, alignment=TA_RIGHT)
    S_SEC       = style("section",   fontName="Helvetica-Bold", fontSize=8,
                        textColor=MUTED,  leading=11, spaceAfter=4,
                        letterSpacing=1.2)
    S_CAT       = style("cat",       fontName="Helvetica-Bold", fontSize=10,
                        textColor=TEXT,   leading=14)
    S_ITEM_DESC = style("idesc",     fontName="Helvetica",      fontSize=9,
                        textColor=TEXT,   leading=12)
    S_ITEM_DATE = style("idate",     fontName="Helvetica",      fontSize=8,
                        textColor=MUTED,  leading=11)
    S_AMT_G     = style("amtg",      fontName="Helvetica-Bold", fontSize=10,
                        textColor=GREEN,  leading=14, alignment=TA_RIGHT)
    S_AMT_R     = style("amtr",      fontName="Helvetica-Bold", fontSize=10,
                        textColor=RED,    leading=14, alignment=TA_RIGHT)
    S_AMT_M     = style("amtm",      fontName="Helvetica",      fontSize=9,
                        textColor=MUTED,  leading=12, alignment=TA_RIGHT)
    S_FOOT      = style("foot",      fontName="Helvetica",      fontSize=7,
                        textColor=MUTED,  leading=10, alignment=TA_CENTER)

    # ── Build document ──────────────────────────────────────────
    buf = io.BytesIO()
    W, H = A4
    M = 18*mm

    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=M, rightMargin=M,
                            topMargin=M,  bottomMargin=M)

    def draw_page_bg(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(BG)
        canvas.rect(0, 0, W, H, fill=1, stroke=0)
        canvas.restoreState()

    story = []
    CW = W - 2*M   # content width

    # ── Header block ────────────────────────────────────────────
    exported_on = datetime.now().strftime("%d %b %Y, %I:%M %p")
    header_data = [
        [Paragraph("Sekra", S_APPNAME),
         Paragraph(f"Exported on {exported_on}", S_META)],
        [Paragraph(f"Budget Report  —  {period_label}", S_PERIOD), ""],
        [Paragraph(user_name, S_USER), ""],
    ]
    header_tbl = Table(header_data, colWidths=[CW*0.68, CW*0.32])
    header_tbl.setStyle(TableStyle([
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
        ("BOTTOMPADDING",(0,0),(-1,-1), 2),
        ("TOPPADDING",  (0,0),(-1,-1), 2),
        ("SPAN",        (0,1), (1,1)),
        ("SPAN",        (0,2), (1,2)),
    ]))
    story.append(header_tbl)
    story.append(Spacer(1, 4*mm))
    story.append(HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=5*mm))

    # ── Summary cards ────────────────────────────────────────────
    def money(n, prefix=""):
        sign = "-" if n < 0 else ""
        return f"{prefix}{sign}Rs.{abs(n):,.2f}"

    bal_color = GREEN if balance >= 0 else RED
    bal_style = style("bals", fontName="Helvetica-Bold", fontSize=13,
                      textColor=bal_color, leading=17, alignment=TA_CENTER)
    inc_style  = style("incs", fontName="Helvetica-Bold", fontSize=11,
                       textColor=GREEN, leading=15, alignment=TA_CENTER)
    exp_style  = style("exps", fontName="Helvetica-Bold", fontSize=11,
                       textColor=RED,   leading=15, alignment=TA_CENTER)
    lbl_style  = style("lbls", fontName="Helvetica",      fontSize=7,
                       textColor=MUTED, leading=10, alignment=TA_CENTER,
                       letterSpacing=0.8)

    CARD_PAD = 8
    summary_data = [[
        Paragraph("INCOME",              lbl_style),
        Paragraph("EXPENSES",            lbl_style),
        Paragraph("BALANCE",             lbl_style),
    ],[
        Paragraph(money(total_income),   inc_style),
        Paragraph(money(total_expense),  exp_style),
        Paragraph(money(balance),        bal_style),
    ]]
    cw3 = CW / 3 - 2*mm
    sum_tbl = Table(summary_data, colWidths=[cw3, cw3, cw3],
                    rowHeights=[10*mm, 12*mm])
    sum_tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0,0), (-1,-1), CARD),
        ("ROUNDEDCORNERS",(0,0),(-1,-1), [6,6,6,6]),
        ("TOPPADDING",   (0,0), (-1,-1), CARD_PAD),
        ("BOTTOMPADDING",(0,0), (-1,-1), CARD_PAD),
        ("LEFTPADDING",  (0,0), (-1,-1), CARD_PAD),
        ("RIGHTPADDING", (0,0), (-1,-1), CARD_PAD),
        ("LINEBELOW",    (0,0), (-1,0),  0.5, BORDER),
        ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
        ("LINEBEFORE",   (1,0), (2,-1),  0.5, BORDER),
    ]))
    story.append(sum_tbl)
    story.append(Spacer(1, 6*mm))

    # ── Transactions section label ───────────────────────────────
    story.append(Paragraph("TRANSACTIONS BY CATEGORY", S_SEC))
    story.append(HRFlowable(width="100%", thickness=0.5, color=SOFT, spaceAfter=3*mm))

    if not items:
        story.append(Paragraph("No transactions found for this period.",
                               style("empty", textColor=MUTED, alignment=TA_CENTER,
                                     fontSize=10, leading=14)))
    else:
        income_groups  = sorted([g for g in groups.values() if g["is_income"]],
                                key=lambda g: g["net"], reverse=True)
        expense_groups = sorted([g for g in groups.values() if not g["is_income"]],
                                key=lambda g: g["net"])

        for g in income_groups + expense_groups:
            cat_name = next(k for k,v in groups.items() if v is g)
            net      = g["net"]
            is_inc   = g["is_income"]
            amt_s    = S_AMT_G if is_inc else S_AMT_R
            sign     = "+" if is_inc else "-"
            n_items  = len(g["expenses"])

            cat_rows = []

            # Category header row
            cat_rows.append([
                Paragraph(f"{cat_name}", S_CAT),
                Paragraph(f"{sign}Rs.{abs(net):,.2f}", amt_s),
            ])

            # Individual items (if detailed)
            if detailed:
                for e in g["expenses"]:
                    is_e_inc = e["type"] == "income"
                    e_sign   = "+" if is_e_inc else "-"
                    e_col    = GREEN if is_e_inc else RED
                    e_amt_s  = style(f"ea{e['id']}", fontName="Helvetica", fontSize=9,
                                     textColor=e_col, leading=12, alignment=TA_RIGHT)
                    desc = e["description"] or "—"
                    try:
                        d_fmt = datetime.strptime(e["date"], "%Y-%m-%d").strftime("%d %b")
                    except:
                        d_fmt = e["date"]
                    left = Paragraph(
                        f'<font color="#f0ede8">{desc}</font>   '
                        f'<font color="#4e4c56" size="8">{d_fmt}</font>',
                        S_ITEM_DESC)
                    cat_rows.append([left,
                                     Paragraph(f"{e_sign}Rs.{e['amount']:,.2f}", e_amt_s)])

            # Build cat table
            col_w = [CW * 0.72, CW * 0.28]
            n_rows = len(cat_rows)
            row_h  = [11*mm] + [8*mm] * (n_rows - 1) if n_rows > 1 else [11*mm]

            ts = [
                ("BACKGROUND",    (0,0), (-1,-1),  CARD),
                ("TOPPADDING",    (0,0), (-1,-1),  6),
                ("BOTTOMPADDING", (0,0), (-1,-1),  6),
                ("LEFTPADDING",   (0,0), (-1,-1),  10),
                ("RIGHTPADDING",  (0,0), (-1,-1),  10),
                ("VALIGN",        (0,0), (-1,-1),  "MIDDLE"),
                # header row accent border left
                ("LINEBEFORE",    (0,0), (0,0),    3, GOLD if is_inc else RED),
            ]
            if detailed and n_rows > 1:
                # divider between header and items
                ts.append(("LINEBELOW",  (0,0), (-1,0),  0.4, BORDER))
                for i in range(1, n_rows - 1):
                    ts.append(("LINEBELOW", (0,i), (-1,i), 0.3, SOFT))
                # indent detail rows
                ts.append(("LEFTPADDING", (0,1), (-1,-1), 22))

            cat_tbl = Table(cat_rows, colWidths=col_w)
            cat_tbl.setStyle(TableStyle(ts))

            count_str = f"{n_items} item{'s' if n_items != 1 else ''}"
            label_tbl = Table(
                [[Paragraph(count_str, style("cnt", fontName="Helvetica",
                            fontSize=7, textColor=MUTED, leading=10)), ""]],
                colWidths=col_w
            )
            label_tbl.setStyle(TableStyle([
                ("TOPPADDING",   (0,0), (-1,-1), 1),
                ("BOTTOMPADDING",(0,0), (-1,-1), 1),
                ("LEFTPADDING",  (0,0), (-1,-1), 10),
            ]))

            story.append(KeepTogether([cat_tbl, label_tbl, Spacer(1, 3*mm)]))

    # ── Footer ───────────────────────────────────────────────────
    story.append(Spacer(1, 4*mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=SOFT, spaceAfter=2*mm))
    story.append(Paragraph(
        f"Generated by Sekra Budget Tracker  •  {exported_on}  •  {user_name}",
        S_FOOT))

    doc.build(story, onFirstPage=draw_page_bg, onLaterPages=draw_page_bg)
    buf.seek(0)

    safe_period = period_label.replace(" ", "_").replace(",", "").replace("  to  ", "_to_")
    filename = f"Sekra_{user_name}_{safe_period}.pdf"
    return send_file(buf, mimetype="application/pdf",
                     as_attachment=True, download_name=filename)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "reset":
        confirm = input("⚠️  This will DELETE all users and expenses. Type YES to confirm: ")
        if confirm.strip() == "YES":
            conn = get_db()
            conn.execute("DELETE FROM expenses")
            conn.execute("DELETE FROM users")
            conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('expenses','users')")
            conn.commit()
            conn.close()
            print("✅ Database reset. All users and expenses deleted.")
            print("")
            print("⚠️  Custom categories are stored in the browser (localStorage).")
            print("   To clear them, open the app in your browser and run this in the console:")
            print("")
            print("   localStorage.removeItem('sekra_custom_cats')")
            print("   localStorage.removeItem('sekra_user')")
            print("")
            print("   Or: DevTools → Application → Local Storage → select the site → delete the keys.")
        else:
            print("Aborted.")
        sys.exit(0)
    init_db()
    print("Sekra Budget Tracker running at http://localhost:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
