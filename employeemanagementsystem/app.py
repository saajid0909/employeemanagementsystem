import os
import sqlite3
from datetime import date, datetime, timedelta
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "ems.db")

app = Flask(__name__)
app.secret_key = os.environ.get("EMS_SECRET_KEY", "ems-secure-session-key-change-in-prod")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def generate_unique_employee_id(conn):
    rows = conn.execute("SELECT employee_id FROM employees").fetchall()
    max_num = 1000
    for row in rows:
        emp_code = row["employee_id"] or ""
        if emp_code.startswith("EMP-"):
            suffix = emp_code[4:]
            if suffix.isdigit():
                max_num = max(max_num, int(suffix))
    candidate = f"EMP-{max_num + 1}"
    while conn.execute("SELECT 1 FROM employees WHERE employee_id = ?", (candidate,)).fetchone():
        max_num += 1
        candidate = f"EMP-{max_num + 1}"
    return candidate


def init_db():
    conn = get_db()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'employee')),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE NOT NULL,
                employee_id TEXT UNIQUE NOT NULL,
                full_name TEXT NOT NULL,
                phone TEXT DEFAULT '',
                address TEXT DEFAULT '',
                department TEXT NOT NULL,
                designation TEXT NOT NULL,
                salary REAL NOT NULL DEFAULT 0,
                joining_date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_ref_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('Present', 'Absent', 'Late', 'Half Day', 'On Leave')),
                check_in TEXT DEFAULT '',
                check_out TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                UNIQUE(employee_ref_id, date),
                FOREIGN KEY (employee_ref_id) REFERENCES employees(id) ON DELETE CASCADE
            );
            """
        )

        user_count = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()["cnt"]
        if user_count == 0:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # Default Admin account
            conn.execute(
                """
                INSERT INTO users (username, email, password_hash, role, is_active, created_at)
                VALUES (?, ?, ?, 'admin', 1, ?)
                """,
                ("admin", "admin@ems.com", generate_password_hash("admin123"), now_str),
            )

            # Seed sample employees for immediate demonstration
            sample_employees = [
                {
                    "username": "sarah.jenkins",
                    "email": "sarah.jenkins@ems.com",
                    "password": "emp123",
                    "full_name": "Sarah Jenkins",
                    "phone": "+1 (555) 234-8910",
                    "address": "420 Horizon Ave, Austin, TX",
                    "department": "Engineering",
                    "designation": "Senior Software Engineer",
                    "salary": 95000.00,
                    "joining_date": "2023-03-15",
                },
                {
                    "username": "marcus.chen",
                    "email": "marcus.chen@ems.com",
                    "password": "emp123",
                    "full_name": "Marcus Chen",
                    "phone": "+1 (555) 391-4420",
                    "address": "88 Pinecrest Blvd, Seattle, WA",
                    "department": "Product Design",
                    "designation": "UI/UX Lead",
                    "salary": 84000.00,
                    "joining_date": "2023-08-01",
                },
                {
                    "username": "priya.nair",
                    "email": "priya.nair@ems.com",
                    "password": "emp123",
                    "full_name": "Priya Nair",
                    "phone": "+1 (555) 612-7734",
                    "address": "15 Maplewood Dr, Boston, MA",
                    "department": "Human Resources",
                    "designation": "HR Specialist",
                    "salary": 68000.00,
                    "joining_date": "2024-01-10",
                },
            ]

            today = date.today()
            statuses = [
                ("Present", "09:02", "17:35", "On time"),
                ("Present", "08:57", "17:30", "On time"),
                ("Late", "09:28", "18:00", "Traffic delay"),
                ("Present", "09:00", "17:40", "On time"),
                ("On Leave", "", "", "Approved personal leave"),
            ]

            for idx, emp in enumerate(sample_employees):
                cur = conn.execute(
                    """
                    INSERT INTO users (username, email, password_hash, role, is_active, created_at)
                    VALUES (?, ?, ?, 'employee', 1, ?)
                    """,
                    (
                        emp["username"],
                        emp["email"],
                        generate_password_hash(emp["password"]),
                        now_str,
                    ),
                )
                uid = cur.lastrowid
                emp_code = generate_unique_employee_id(conn)
                emp_cur = conn.execute(
                    """
                    INSERT INTO employees (
                        user_id, employee_id, full_name, phone, address,
                        department, designation, salary, joining_date, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        uid,
                        emp_code,
                        emp["full_name"],
                        emp["phone"],
                        emp["address"],
                        emp["department"],
                        emp["designation"],
                        emp["salary"],
                        emp["joining_date"],
                        now_str,
                    ),
                )
                emp_ref_id = emp_cur.lastrowid
                for offset in range(5):
                    att_date = (today - timedelta(days=offset)).isoformat()
                    st, ci, co, note = statuses[(idx + offset) % len(statuses)]
                    conn.execute(
                        """
                        INSERT INTO attendance (employee_ref_id, date, status, check_in, check_out, notes)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (emp_ref_id, att_date, st, ci, co, note),
                    )

        conn.commit()
    finally:
        conn.close()


def get_current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    conn = get_db()
    try:
        user = conn.execute(
            "SELECT id, username, email, role, is_active FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user or not user["is_active"]:
            session.clear()
            return None
        return dict(user)
    finally:
        conn.close()


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"ok": False, "error": "Authentication required."}), 401
        if user["role"] != "admin":
            return jsonify({"ok": False, "error": "Admin access required."}), 403
        return fn(*args, **kwargs)

    return wrapper


def employee_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"ok": False, "error": "Authentication required."}), 401
        if user["role"] != "employee":
            return jsonify({"ok": False, "error": "Employee access required."}), 403
        return fn(*args, **kwargs)

    return wrapper


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


# -------------------- Page Routes --------------------

@app.route("/")
@app.route("/login")
def login_page():
    user = get_current_user()
    if user:
        if user["role"] == "admin":
            return redirect(url_for("admin_dashboard"))
        return redirect(url_for("employee_dashboard"))
    return render_template("index.html", view_mode="login", current_user=None)


@app.route("/admin")
def admin_dashboard():
    user = get_current_user()
    if not user:
        return redirect(url_for("login_page"))
    if user["role"] != "admin":
        return redirect(url_for("employee_dashboard"))
    return render_template("index.html", view_mode="admin", current_user=user)


@app.route("/employee")
def employee_dashboard():
    user = get_current_user()
    if not user:
        return redirect(url_for("login_page"))
    if user["role"] != "employee":
        return redirect(url_for("admin_dashboard"))
    return render_template("index.html", view_mode="employee", current_user=user)


# -------------------- Auth API --------------------

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    portal = (data.get("portal") or "").strip().lower()
    identifier = (data.get("identifier") or "").strip()
    password = data.get("password") or ""

    if portal not in ("admin", "employee"):
        return jsonify({"ok": False, "error": "Please select a valid login portal."}), 400
    if not identifier or not password:
        return jsonify({"ok": False, "error": "Username/Email and password are required."}), 400

    conn = get_db()
    try:
        user = conn.execute(
            """
            SELECT u.id, u.username, u.email, u.password_hash, u.role, u.is_active, e.employee_id
            FROM users u
            LEFT JOIN employees e ON e.user_id = u.id
            WHERE LOWER(u.username) = LOWER(?)
               OR LOWER(u.email) = LOWER(?)
               OR (e.employee_id IS NOT NULL AND LOWER(e.employee_id) = LOWER(?))
            """,
            (identifier, identifier, identifier),
        ).fetchone()

        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"ok": False, "error": "Invalid username/email or password."}), 401

        if user["role"] != portal:
            portal_label = "Admin Portal" if user["role"] == "admin" else "Employee Portal"
            return jsonify(
                {
                    "ok": False,
                    "error": f"This account belongs to the {portal_label}. Please switch portals to sign in.",
                }
            ), 403

        if not user["is_active"]:
            return jsonify(
                {
                    "ok": False,
                    "error": "Your account has been deactivated. Please contact an administrator.",
                }
            ), 403

        session.clear()
        session["user_id"] = user["id"]
        session["role"] = user["role"]
        session["username"] = user["username"]

        redirect_url = url_for("admin_dashboard") if user["role"] == "admin" else url_for("employee_dashboard")
        return jsonify(
            {
                "ok": True,
                "redirect_url": redirect_url,
                "user": {
                    "id": user["id"],
                    "username": user["username"],
                    "email": user["email"],
                    "role": user["role"],
                },
            }
        )
    finally:
        conn.close()


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True, "redirect_url": url_for("login_page")})


@app.route("/logout")
def logout_redirect():
    session.clear()
    return redirect(url_for("login_page"))


# -------------------- Admin API --------------------

@app.route("/api/admin/overview", methods=["GET"])
@admin_required
def admin_overview():
    conn = get_db()
    try:
        total_employees = conn.execute("SELECT COUNT(*) AS cnt FROM employees").fetchone()["cnt"]
        active_accounts = conn.execute(
            "SELECT COUNT(*) AS cnt FROM users WHERE role = 'employee' AND is_active = 1"
        ).fetchone()["cnt"]
        inactive_accounts = conn.execute(
            "SELECT COUNT(*) AS cnt FROM users WHERE role = 'employee' AND is_active = 0"
        ).fetchone()["cnt"]
        departments_count = conn.execute(
            "SELECT COUNT(DISTINCT department) AS cnt FROM employees"
        ).fetchone()["cnt"]

        today_str = date.today().isoformat()
        present_today = conn.execute(
            "SELECT COUNT(*) AS cnt FROM attendance WHERE date = ? AND status IN ('Present', 'Late')",
            (today_str,),
        ).fetchone()["cnt"]

        dept_rows = conn.execute(
            """
            SELECT department, COUNT(*) AS count
            FROM employees
            GROUP BY department
            ORDER BY count DESC, department ASC
            """
        ).fetchall()

        recent_rows = conn.execute(
            """
            SELECT e.id, e.employee_id, e.full_name, e.department, e.designation,
                   e.joining_date, u.email, u.is_active
            FROM employees e
            JOIN users u ON u.id = e.user_id
            ORDER BY e.id DESC
            LIMIT 5
            """
        ).fetchall()

        return jsonify(
            {
                "ok": True,
                "stats": {
                    "total_employees": total_employees,
                    "active_accounts": active_accounts,
                    "inactive_accounts": inactive_accounts,
                    "departments_count": departments_count,
                    "present_today": present_today,
                },
                "departments": [dict(r) for r in dept_rows],
                "recent_employees": [dict(r) for r in recent_rows],
            }
        )
    finally:
        conn.close()


@app.route("/api/admin/employees", methods=["GET"])
@admin_required
def admin_list_employees():
    q = (request.args.get("q") or "").strip()
    conn = get_db()
    try:
        base_sql = """
            SELECT e.id, e.user_id, e.employee_id, e.full_name, e.phone, e.address,
                   e.department, e.designation, e.salary, e.joining_date, e.created_at,
                   u.username, u.email, u.is_active
            FROM employees e
            JOIN users u ON u.id = e.user_id
        """
        if q:
            like = f"%{q}%"
            rows = conn.execute(
                base_sql
                + """
                WHERE e.employee_id LIKE ?
                   OR e.full_name LIKE ?
                   OR u.email LIKE ?
                   OR u.username LIKE ?
                   OR e.department LIKE ?
                   OR e.designation LIKE ?
                ORDER BY e.id DESC
                """,
                (like, like, like, like, like, like),
            ).fetchall()
        else:
            rows = conn.execute(base_sql + " ORDER BY e.id DESC").fetchall()

        return jsonify({"ok": True, "employees": [dict(r) for r in rows]})
    finally:
        conn.close()


@app.route("/api/admin/next-employee-id", methods=["GET"])
@admin_required
def admin_next_employee_id():
    conn = get_db()
    try:
        next_id = generate_unique_employee_id(conn)
        return jsonify({"ok": True, "next_employee_id": next_id})
    finally:
        conn.close()


@app.route("/api/admin/employees", methods=["POST"])
@admin_required
def admin_create_employee():
    data = request.get_json(silent=True) or {}

    full_name = (data.get("full_name") or "").strip()
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    phone = (data.get("phone") or "").strip()
    address = (data.get("address") or "").strip()
    department = (data.get("department") or "").strip()
    designation = (data.get("designation") or "").strip()
    joining_date = (data.get("joining_date") or "").strip() or date.today().isoformat()
    is_active = 1 if data.get("is_active", True) else 0

    # Sanitize and auto-derive username if not provided
    if username:
        username = username.replace(" ", ".").lower()
    elif email and "@" in email:
        username = email.split("@")[0].lower()
    elif full_name:
        username = full_name.lower().replace(" ", ".")

    raw_salary = str(data.get("salary", 0)).replace("$", "").replace(",", "").strip()
    try:
        salary = float(raw_salary) if raw_salary else 0.0
        if salary < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Salary must be a valid non-negative number."}), 400

    if not full_name:
        return jsonify({"ok": False, "error": "Full name is required."}), 400
    if not username:
        return jsonify({"ok": False, "error": "Username is required."}), 400
    if not email:
        return jsonify({"ok": False, "error": "Email address is required."}), 400
    if not password:
        return jsonify({"ok": False, "error": "Account password is required."}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "error": "Password must be at least 6 characters long."}), 400
    if not department:
        return jsonify({"ok": False, "error": "Department is required."}), 400
    if not designation:
        return jsonify({"ok": False, "error": "Designation is required."}), 400

    conn = get_db()
    try:
        existing_user = conn.execute(
            "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,)
        ).fetchone()
        if existing_user:
            return jsonify({"ok": False, "error": f"Username '{username}' is already in use. Please enter a different username."}), 409

        existing_email = conn.execute(
            "SELECT id FROM users WHERE LOWER(email) = LOWER(?)", (email,)
        ).fetchone()
        if existing_email:
            return jsonify({"ok": False, "error": f"Email address '{email}' is already registered."}), 409

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        user_cur = conn.execute(
            """
            INSERT INTO users (username, email, password_hash, role, is_active, created_at)
            VALUES (?, ?, ?, 'employee', ?, ?)
            """,
            (username, email, generate_password_hash(password), is_active, now_str),
        )
        user_id = user_cur.lastrowid
        employee_id = generate_unique_employee_id(conn)

        emp_cur = conn.execute(
            """
            INSERT INTO employees (
                user_id, employee_id, full_name, phone, address,
                department, designation, salary, joining_date, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                employee_id,
                full_name,
                phone,
                address,
                department,
                designation,
                salary,
                joining_date,
                now_str,
            ),
        )
        conn.commit()
        return jsonify(
            {
                "ok": True,
                "message": f"Employee {full_name} ({employee_id}) created successfully.",
                "id": emp_cur.lastrowid,
                "employee_id": employee_id,
            }
        ), 201
    finally:
        conn.close()


@app.route("/api/admin/employees/<int:emp_id>", methods=["PUT"])
@admin_required
def admin_update_employee(emp_id):
    data = request.get_json(silent=True) or {}

    full_name = (data.get("full_name") or "").strip()
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip()
    address = (data.get("address") or "").strip()
    department = (data.get("department") or "").strip()
    designation = (data.get("designation") or "").strip()
    joining_date = (data.get("joining_date") or "").strip()
    new_password = data.get("password") or ""
    is_active = 1 if data.get("is_active", True) else 0

    if username:
        username = username.replace(" ", ".").lower()

    raw_salary = str(data.get("salary", 0)).replace("$", "").replace(",", "").strip()
    try:
        salary = float(raw_salary) if raw_salary else 0.0
        if salary < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Salary must be a valid non-negative number."}), 400

    if not all([full_name, username, email, department, designation, joining_date]):
        return jsonify(
            {
                "ok": False,
                "error": "Full name, username, email, department, designation, and joining date are required.",
            }
        ), 400

    if new_password and len(new_password) < 6:
        return jsonify({"ok": False, "error": "New password must be at least 6 characters long."}), 400

    conn = get_db()
    try:
        emp = conn.execute("SELECT id, user_id, employee_id FROM employees WHERE id = ?", (emp_id,)).fetchone()
        if not emp:
            return jsonify({"ok": False, "error": "Employee not found."}), 404

        existing_user = conn.execute(
            "SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?",
            (username, emp["user_id"]),
        ).fetchone()
        if existing_user:
            return jsonify({"ok": False, "error": f"Username '{username}' is already in use by another account."}), 409

        existing_email = conn.execute(
            "SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?",
            (email, emp["user_id"]),
        ).fetchone()
        if existing_email:
            return jsonify({"ok": False, "error": f"Email address '{email}' is already registered to another account."}), 409

        if new_password:
            conn.execute(
                """
                UPDATE users
                SET username = ?, email = ?, is_active = ?, password_hash = ?
                WHERE id = ?
                """,
                (username, email, is_active, generate_password_hash(new_password), emp["user_id"]),
            )
        else:
            conn.execute(
                """
                UPDATE users
                SET username = ?, email = ?, is_active = ?
                WHERE id = ?
                """,
                (username, email, is_active, emp["user_id"]),
            )

        conn.execute(
            """
            UPDATE employees
            SET full_name = ?, phone = ?, address = ?, department = ?,
                designation = ?, salary = ?, joining_date = ?
            WHERE id = ?
            """,
            (full_name, phone, address, department, designation, salary, joining_date, emp_id),
        )
        conn.commit()
        return jsonify({"ok": True, "message": f"Updated {full_name} ({emp['employee_id']}) successfully."})
    finally:
        conn.close()


@app.route("/api/admin/employees/<int:emp_id>/account", methods=["PATCH"])
@admin_required
def admin_manage_account(emp_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    try:
        emp = conn.execute(
            """
            SELECT e.id, e.user_id, e.full_name, u.is_active
            FROM employees e
            JOIN users u ON u.id = e.user_id
            WHERE e.id = ?
            """,
            (emp_id,),
        ).fetchone()
        if not emp:
            return jsonify({"ok": False, "error": "Employee not found."}), 404

        if "is_active" in data:
            new_status = 1 if data["is_active"] else 0
            conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_status, emp["user_id"]))

        if data.get("new_password"):
            pwd = data["new_password"]
            if len(pwd) < 6:
                return jsonify({"ok": False, "error": "Password must be at least 6 characters long."}), 400
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (generate_password_hash(pwd), emp["user_id"]),
            )

        conn.commit()
        return jsonify({"ok": True, "message": f"Account updated for {emp['full_name']}."})
    finally:
        conn.close()


@app.route("/api/admin/employees/<int:emp_id>", methods=["DELETE"])
@admin_required
def admin_delete_employee(emp_id):
    conn = get_db()
    try:
        emp = conn.execute(
            "SELECT id, user_id, employee_id, full_name FROM employees WHERE id = ?",
            (emp_id,),
        ).fetchone()
        if not emp:
            return jsonify({"ok": False, "error": "Employee not found."}), 404

        # Deleting the user cascades to employee and attendance records
        conn.execute("DELETE FROM users WHERE id = ?", (emp["user_id"],))
        conn.commit()
        return jsonify(
            {
                "ok": True,
                "message": f"Deleted {emp['full_name']} ({emp['employee_id']}) and associated account.",
            }
        )
    finally:
        conn.close()


@app.route("/api/admin/attendance", methods=["GET"])
@admin_required
def admin_list_attendance():
    q = (request.args.get("q") or "").strip()
    date_filter = (request.args.get("date") or "").strip()
    emp_ref_filter = (request.args.get("employee_ref_id") or "").strip()

    conn = get_db()
    try:
        sql = """
            SELECT a.id, a.employee_ref_id, a.date, a.status, a.check_in, a.check_out, a.notes,
                   e.employee_id, e.full_name, e.department
            FROM attendance a
            JOIN employees e ON e.id = a.employee_ref_id
            WHERE 1=1
        """
        params = []
        if q:
            like = f"%{q}%"
            sql += " AND (e.full_name LIKE ? OR e.employee_id LIKE ? OR e.department LIKE ? OR a.status LIKE ?)"
            params.extend([like, like, like, like])
        if date_filter:
            sql += " AND a.date = ?"
            params.append(date_filter)
        if emp_ref_filter and emp_ref_filter.isdigit():
            sql += " AND a.employee_ref_id = ?"
            params.append(int(emp_ref_filter))

        sql += " ORDER BY a.date DESC, e.full_name ASC"
        rows = conn.execute(sql, params).fetchall()
        return jsonify({"ok": True, "records": [dict(r) for r in rows]})
    finally:
        conn.close()


@app.route("/api/admin/attendance", methods=["POST"])
@admin_required
def admin_upsert_attendance():
    data = request.get_json(silent=True) or {}
    employee_ref_id = data.get("employee_ref_id")
    att_date = (data.get("date") or "").strip()
    status = (data.get("status") or "").strip()
    check_in = (data.get("check_in") or "").strip()
    check_out = (data.get("check_out") or "").strip()
    notes = (data.get("notes") or "").strip()

    valid_statuses = ("Present", "Absent", "Late", "Half Day", "On Leave")
    if not employee_ref_id or not att_date or status not in valid_statuses:
        return jsonify({"ok": False, "error": "Valid employee, date, and status are required."}), 400

    conn = get_db()
    try:
        emp = conn.execute("SELECT id, full_name FROM employees WHERE id = ?", (employee_ref_id,)).fetchone()
        if not emp:
            return jsonify({"ok": False, "error": "Employee not found."}), 404

        conn.execute(
            """
            INSERT INTO attendance (employee_ref_id, date, status, check_in, check_out, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(employee_ref_id, date) DO UPDATE SET
                status = excluded.status,
                check_in = excluded.check_in,
                check_out = excluded.check_out,
                notes = excluded.notes
            """,
            (employee_ref_id, att_date, status, check_in, check_out, notes),
        )
        conn.commit()
        return jsonify({"ok": True, "message": f"Attendance saved for {emp['full_name']} on {att_date}."})
    finally:
        conn.close()


# -------------------- Employee API --------------------

@app.route("/api/employee/dashboard", methods=["GET"])
@employee_required
def employee_dashboard_data():
    user_id = session["user_id"]
    conn = get_db()
    try:
        profile = conn.execute(
            """
            SELECT e.id, e.employee_id, e.full_name, e.phone, e.address,
                   e.department, e.designation, e.salary, e.joining_date,
                   u.username, u.email, u.is_active
            FROM employees e
            JOIN users u ON u.id = e.user_id
            WHERE e.user_id = ?
            """,
            (user_id,),
        ).fetchone()

        if not profile:
            return jsonify({"ok": False, "error": "Employee profile not found."}), 404

        attendance_rows = conn.execute(
            """
            SELECT id, date, status, check_in, check_out, notes
            FROM attendance
            WHERE employee_ref_id = ?
            ORDER BY date DESC
            """,
            (profile["id"],),
        ).fetchall()

        records = [dict(r) for r in attendance_rows]
        summary = {
            "total": len(records),
            "present": sum(1 for r in records if r["status"] == "Present"),
            "late": sum(1 for r in records if r["status"] == "Late"),
            "absent": sum(1 for r in records if r["status"] == "Absent"),
            "leave": sum(1 for r in records if r["status"] in ("On Leave", "Half Day")),
        }

        return jsonify(
            {
                "ok": True,
                "profile": dict(profile),
                "attendance_summary": summary,
                "attendance": records,
            }
        )
    finally:
        conn.close()


@app.route("/api/employee/profile", methods=["PUT"])
@employee_required
def employee_update_profile():
    user_id = session["user_id"]
    data = request.get_json(silent=True) or {}

    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()
    address = (data.get("address") or "").strip()

    if not full_name or not email:
        return jsonify({"ok": False, "error": "Full name and email are required."}), 400

    conn = get_db()
    try:
        conflict = conn.execute(
            "SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?",
            (email, user_id),
        ).fetchone()
        if conflict:
            return jsonify({"ok": False, "error": "This email is already associated with another account."}), 409

        conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))
        conn.execute(
            """
            UPDATE employees
            SET full_name = ?, phone = ?, address = ?
            WHERE user_id = ?
            """,
            (full_name, phone, address, user_id),
        )
        conn.commit()
        return jsonify({"ok": True, "message": "Personal information updated successfully."})
    finally:
        conn.close()


@app.route("/api/employee/change-password", methods=["POST"])
@employee_required
def employee_change_password():
    user_id = session["user_id"]
    data = request.get_json(silent=True) or {}

    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""
    confirm_password = data.get("confirm_password") or ""

    if not current_password or not new_password or not confirm_password:
        return jsonify({"ok": False, "error": "All password fields are required."}), 400
    if len(new_password) < 6:
        return jsonify({"ok": False, "error": "New password must be at least 6 characters long."}), 400
    if new_password != confirm_password:
        return jsonify({"ok": False, "error": "New password and confirmation do not match."}), 400

    conn = get_db()
    try:
        user = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user or not check_password_hash(user["password_hash"], current_password):
            return jsonify({"ok": False, "error": "Current password is incorrect."}), 401

        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(new_password), user_id),
        )
        conn.commit()
        return jsonify({"ok": True, "message": "Password changed successfully."})
    finally:
        conn.close()


init_db()

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)

