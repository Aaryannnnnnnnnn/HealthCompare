from flask import Flask, render_template, request, jsonify, session, send_file
import sqlite3
import re
import random
from pathlib import Path
from datetime import datetime, date
from werkzeug.security import generate_password_hash, check_password_hash
from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors

BASE_DIR = Path(__file__).resolve().parent
DB = BASE_DIR / "healthcompare.db"

app = Flask(__name__)
app.config.update(
    SECRET_KEY="healthcompare-pro-demo-secret-change-me",
    JSON_SORT_KEYS=False,
)

SLOTS = {"10:00 AM", "12:00 PM", "03:00 PM", "05:00 PM"}
AMBULANCE_TYPES = {
    "Basic Life Support": 450,
    "Advanced Life Support": 850,
    "ICU Ambulance": 1500,
    "Neonatal Ambulance": 1200,
}

DOCTORS = [
    ("Dr. Ananya Sharma", "Cardiologist", "MBBS, MD", 12, 800, "Apollo Multispeciality Hospital"),
    ("Dr. Rajesh Kumar", "Orthopedic", "MBBS, MS", 15, 700, "Care Hospital"),
    ("Dr. Priya Das", "Dermatologist", "MBBS, MD", 9, 600, "Kalinga Health Centre"),
    ("Dr. Vikram Singh", "Neurologist", "MBBS, DM", 14, 1000, "LifeLine Hospital"),
    ("Dr. Sneha Patel", "General Physician", "MBBS, MD", 8, 500, "City Diagnostic Centre"),
    ("Dr. Amit Verma", "Dentist", "BDS, MDS", 10, 450, "Care Hospital"),
]

HOSPITALS = [
    {"name": "Apollo Multispeciality Hospital", "city": "Bhubaneswar", "rating": 4.6, "beds": 500, "emergency": "24x7", "starting_fee": 800, "ambulance": "Yes"},
    {"name": "Care Hospital", "city": "Bhubaneswar", "rating": 4.4, "beds": 350, "emergency": "24x7", "starting_fee": 700, "ambulance": "Yes"},
    {"name": "Kalinga Health Centre", "city": "Bhubaneswar", "rating": 4.2, "beds": 220, "emergency": "24x7", "starting_fee": 600, "ambulance": "Yes"},
    {"name": "LifeLine Hospital", "city": "Bhubaneswar", "rating": 4.1, "beds": 180, "emergency": "24x7", "starting_fee": 500, "ambulance": "No"},
]

LAB_TESTS = [
    {"id": 1, "name": "Complete Blood Count (CBC)", "category": "Blood Test", "price": 350, "turnaround": "Same day", "home_collection": "Available"},
    {"id": 2, "name": "Liver Function Test (LFT)", "category": "Blood Test", "price": 650, "turnaround": "Same day", "home_collection": "Available"},
    {"id": 3, "name": "Kidney Function Test (KFT)", "category": "Blood Test", "price": 600, "turnaround": "Same day", "home_collection": "Available"},
    {"id": 4, "name": "HbA1c", "category": "Diabetes", "price": 450, "turnaround": "24 hours", "home_collection": "Available"},
    {"id": 5, "name": "Thyroid Profile (T3, T4, TSH)", "category": "Hormones", "price": 700, "turnaround": "24 hours", "home_collection": "Available"},
    {"id": 6, "name": "Lipid Profile", "category": "Heart Health", "price": 550, "turnaround": "Same day", "home_collection": "Available"},
    {"id": 7, "name": "Vitamin D", "category": "Vitamins", "price": 900, "turnaround": "24 hours", "home_collection": "Available"},
    {"id": 8, "name": "Urine Routine Examination", "category": "Urine Test", "price": 250, "turnaround": "Same day", "home_collection": "Available"},
    {"id": 9, "name": "Chest X-Ray", "category": "Imaging", "price": 500, "turnaround": "Same day", "home_collection": "Not applicable"},
]


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'patient',
            created TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            specialization TEXT NOT NULL,
            qualification TEXT NOT NULL,
            experience INTEGER NOT NULL,
            fee INTEGER NOT NULL,
            hospital TEXT NOT NULL,
            rating REAL NOT NULL DEFAULT 4.5
        );

        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            patient TEXT NOT NULL,
            phone TEXT NOT NULL,
            doctor TEXT NOT NULL,
            hospital TEXT NOT NULL,
            appointment_date TEXT NOT NULL,
            slot TEXT NOT NULL,
            created TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT NOT NULL,
            target TEXT NOT NULL,
            name TEXT NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT NOT NULL,
            created TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS lab_bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            patient TEXT NOT NULL,
            phone TEXT NOT NULL,
            test_name TEXT NOT NULL,
            category TEXT NOT NULL,
            collection_mode TEXT NOT NULL,
            booking_date TEXT NOT NULL,
            address TEXT NOT NULL,
            price INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'Scheduled',
            created TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS ambulances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            patient TEXT NOT NULL,
            phone TEXT NOT NULL,
            pickup TEXT NOT NULL,
            destination TEXT NOT NULL,
            type TEXT NOT NULL,
            eta INTEGER NOT NULL,
            fare INTEGER NOT NULL,
            driver TEXT NOT NULL,
            vehicle TEXT NOT NULL,
            created TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );
    """)

    if conn.execute("SELECT COUNT(*) FROM doctors").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO doctors(name,specialization,qualification,experience,fee,hospital) VALUES (?,?,?,?,?,?)",
            DOCTORS,
        )

    # Demo accounts are created only when missing.
    for name, email, password, role in [
        ("Demo Patient", "patient@healthcompare.demo", "patient123", "patient"),
        ("Admin", "admin@healthcompare.demo", "admin123", "admin"),
    ]:
        exists = conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO users(name,email,password_hash,role,created) VALUES (?,?,?,?,?)",
                (name, email, generate_password_hash(password), role, datetime.now().strftime("%d %b %Y")),
            )
    conn.commit()
    conn.close()


def clean_phone(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def json_error(message, status=400):
    return jsonify(ok=False, message=message), status


def current_user():
    return session.get("user")


@app.route("/")
def home():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify(ok=True, service="HealthCompare Pro", status="running")


@app.get("/api/doctors")
def doctors():
    q = request.args.get("q", "").strip().lower()
    spec = request.args.get("spec", "").strip()
    conn = db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM doctors ORDER BY name").fetchall()]
    conn.close()
    return jsonify([
        r for r in rows
        if (not q or q in f"{r['name']} {r['hospital']} {r['specialization']}".lower())
        and (not spec or r["specialization"] == spec)
    ])


@app.get("/api/specs")
def specs():
    conn = db()
    values = [r[0] for r in conn.execute("SELECT DISTINCT specialization FROM doctors ORDER BY specialization")]
    conn.close()
    return jsonify(values)


@app.get("/api/doctors/<int:doctor_id>")
def doctor(doctor_id):
    conn = db()
    row = conn.execute("SELECT * FROM doctors WHERE id=?", (doctor_id,)).fetchone()
    conn.close()
    return jsonify(dict(row)) if row else json_error("Doctor not found.", 404)


@app.post("/api/register")
def register():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Please submit the registration form again.")

    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,79}", name):
        return json_error("Enter a valid full name.")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return json_error("Enter a valid email address.")
    if len(password) < 6:
        return json_error("Password must contain at least 6 characters.")

    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO users(name,email,password_hash,role,created) VALUES (?,?,?,?,?)",
            (name, email, generate_password_hash(password), "patient", datetime.now().strftime("%d %b %Y")),
        )
        conn.commit()
        user = {"id": cur.lastrowid, "name": name, "email": email, "role": "patient"}
        return jsonify(ok=True, message="Your patient account has been created successfully.", user=user), 201
    except sqlite3.IntegrityError:
        return json_error("An account with this email already exists. Please sign in instead.", 409)
    except sqlite3.Error:
        conn.rollback()
        app.logger.exception("Registration database error")
        return json_error("We couldn't create the account right now. Please try again.", 500)
    finally:
        conn.close()


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    conn = db()
    user = conn.execute("SELECT id,name,email,password_hash,role FROM users WHERE email=?", (email,)).fetchone()
    conn.close()
    if not user or not check_password_hash(user["password_hash"], password):
        return json_error("Invalid email or password.", 401)
    public_user = {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}
    session["user"] = public_user
    return jsonify(ok=True, user=public_user)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    return jsonify(user=current_user())


@app.post("/api/appointment")
def appointment():
    data = request.get_json(silent=True) or {}
    patient = str(data.get("patient", "")).strip()
    phone = clean_phone(data.get("phone"))
    slot = str(data.get("slot", "")).strip()
    appointment_date = str(data.get("appointment_date", "")).strip()
    try:
        doctor_id = int(data.get("doctor_id", 0))
    except (TypeError, ValueError):
        doctor_id = 0

    if not patient or len(patient) > 80:
        return json_error("Enter a valid patient name.")
    if len(phone) != 10:
        return json_error("Enter a valid 10-digit phone number.")
    if slot not in SLOTS:
        return json_error("Please select a valid appointment time.")
    try:
        selected = datetime.strptime(appointment_date, "%Y-%m-%d").date()
    except ValueError:
        return json_error("Please select a valid appointment date.")
    if selected < date.today():
        return json_error("Appointment date cannot be in the past.")

    conn = db()
    try:
        doctor_row = conn.execute("SELECT * FROM doctors WHERE id=?", (doctor_id,)).fetchone()
        if not doctor_row:
            return json_error("Selected doctor was not found.", 404)
        if conn.execute(
            "SELECT 1 FROM appointments WHERE doctor=? AND appointment_date=? AND slot=?",
            (doctor_row["name"], appointment_date, slot),
        ).fetchone():
            return json_error("That doctor is already booked for this date and time.")
        user = current_user()
        cur = conn.execute(
            "INSERT INTO appointments(user_id,patient,phone,doctor,hospital,appointment_date,slot,created) VALUES (?,?,?,?,?,?,?,?)",
            (user["id"] if user else None, patient, phone, doctor_row["name"], doctor_row["hospital"], appointment_date, slot, datetime.now().strftime("%d %b %Y, %I:%M %p")),
        )
        conn.commit()
        booking_id = cur.lastrowid
        session["last_appointment_id"] = booking_id
        return jsonify(ok=True, message="Appointment confirmed.", id=booking_id, doctor=doctor_row["name"], hospital=doctor_row["hospital"], appointment_date=appointment_date, slot=slot, confirmation_channel=f"Confirmation would be sent to +91******{phone[-4:]}", pdf_url=f"/api/appointment/{booking_id}/pdf")
    finally:
        conn.close()


@app.post("/api/review")
def review():
    data = request.get_json(silent=True) or {}
    review_type = str(data.get("type", "")).strip()
    target = str(data.get("target", "")).strip()
    name = str(data.get("name", "")).strip()
    comment = str(data.get("comment", "")).strip()
    try:
        rating = int(data.get("rating", 0))
    except (TypeError, ValueError):
        rating = 0
    if review_type not in {"doctor", "hospital"} or not target or not name or not comment:
        return json_error("Please complete all review fields.")
    if rating not in range(1, 6):
        return json_error("Rating must be between 1 and 5.")
    conn = db()
    user = current_user()
    conn.execute(
        "INSERT INTO reviews(user_id,type,target,name,rating,comment,created) VALUES (?,?,?,?,?,?,?)",
        (user["id"] if user else None, review_type, target, name, rating, comment, datetime.now().strftime("%d %b %Y")),
    )
    conn.commit()
    conn.close()
    return jsonify(ok=True, message="Your feedback has been posted.")


@app.get("/api/reviews")
def reviews():
    review_type = request.args.get("type", "").strip()
    target = request.args.get("target", "").strip()
    if review_type not in {"doctor", "hospital"} or not target:
        return json_error("Choose a review type and target.")
    conn = db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM reviews WHERE type=? AND lower(target)=lower(?) ORDER BY id DESC", (review_type, target)).fetchall()]
    avg = conn.execute("SELECT ROUND(AVG(rating),1) FROM reviews WHERE type=? AND lower(target)=lower(?)", (review_type, target)).fetchone()[0] or 0
    conn.close()
    return jsonify(reviews=rows, average=avg)


@app.post("/api/ambulance")
def ambulance():
    data = request.get_json(silent=True) or {}
    patient = str(data.get("patient", "")).strip()
    phone = clean_phone(data.get("phone"))
    pickup = str(data.get("pickup", "")).strip()
    destination = str(data.get("destination", "")).strip()
    ambulance_type = str(data.get("type", "")).strip()
    if not all([patient, pickup, destination]):
        return json_error("Complete patient, pickup and destination details.")
    if len(phone) != 10:
        return json_error("Enter a valid 10-digit phone number.")
    if ambulance_type not in AMBULANCE_TYPES:
        return json_error("Choose a valid ambulance type.")
    eta = random.randint(4, 12)
    fare = AMBULANCE_TYPES[ambulance_type]
    driver = random.choice(["Ramesh Kumar", "Sanjay Singh", "Ajay Das"])
    vehicle = f"AMB-{random.randint(1000,9999)}"
    user = current_user()
    conn = db()
    cur = conn.execute(
        "INSERT INTO ambulances(user_id,patient,phone,pickup,destination,type,eta,fare,driver,vehicle,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (user["id"] if user else None, patient, phone, pickup, destination, ambulance_type, eta, fare, driver, vehicle, datetime.now().strftime("%d %b %Y, %I:%M %p")),
    )
    conn.commit()
    conn.close()
    return jsonify(ok=True, id=cur.lastrowid, eta=eta, fare=fare, driver=driver, vehicle=vehicle)


@app.get("/api/dashboard")
def dashboard():
    user = current_user()
    if not user:
        return json_error("Login required.", 401)
    conn = db()
    if user["role"] == "admin":
        where = ""
        params = ()
    else:
        where = " WHERE user_id=?"
        params = (user["id"],)
    appointments = conn.execute("SELECT * FROM appointments" + where + " ORDER BY id DESC", params).fetchall()
    ambulances = conn.execute("SELECT * FROM ambulances" + where + " ORDER BY id DESC", params).fetchall()
    reviews = conn.execute("SELECT * FROM reviews" + where + " ORDER BY id DESC", params).fetchall()
    lab_bookings = conn.execute("SELECT * FROM lab_bookings" + where + " ORDER BY id DESC", params).fetchall()
    conn.close()
    return jsonify(appointments=[dict(x) for x in appointments], ambulances=[dict(x) for x in ambulances], reviews=[dict(x) for x in reviews], lab_bookings=[dict(x) for x in lab_bookings], role=user["role"])


@app.get("/api/lab-tests")
def lab_tests():
    q = request.args.get("q", "").strip().lower()
    category = request.args.get("category", "").strip().lower()
    tests = [t for t in LAB_TESTS if
             (not q or q in f"{t['name']} {t['category']}".lower()) and
             (not category or t["category"].lower() == category)]
    categories = sorted({t["category"] for t in LAB_TESTS})
    return jsonify(tests=tests, categories=categories)


@app.post("/api/lab-booking")
def lab_booking():
    data = request.get_json(silent=True) or {}
    patient = str(data.get("patient", "")).strip()
    phone = clean_phone(data.get("phone"))
    test_id = int(data.get("test_id", 0) or 0)
    mode = str(data.get("collection_mode", "")).strip()
    booking_date = str(data.get("booking_date", "")).strip()
    address = str(data.get("address", "")).strip()

    if not patient or len(patient) > 80:
        return json_error("Enter a valid patient name.")
    if len(phone) != 10:
        return json_error("Enter a valid 10-digit phone number.")
    test = next((t for t in LAB_TESTS if t["id"] == test_id), None)
    if not test:
        return json_error("Please select a valid lab test.")
    if mode not in {"Lab Visit", "Home Collection"}:
        return json_error("Choose a valid sample collection mode.")
    try:
        selected = datetime.strptime(booking_date, "%Y-%m-%d").date()
    except ValueError:
        return json_error("Please select a valid booking date.")
    if selected < date.today():
        return json_error("Lab booking date cannot be in the past.")
    if not address or len(address) > 250:
        return json_error("Enter a valid address or location.")

    user = current_user()
    conn = db()
    cur = conn.execute(
        "INSERT INTO lab_bookings(user_id,patient,phone,test_name,category,collection_mode,booking_date,address,price,status,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (user["id"] if user else None, patient, phone, test["name"], test["category"], mode, booking_date, address, test["price"], "Scheduled", datetime.now().strftime("%d %b %Y, %I:%M %p")),
    )
    conn.commit()
    conn.close()
    booking_id = cur.lastrowid
    session["last_lab_booking_id"] = booking_id
    return jsonify(ok=True, id=booking_id, test=test["name"], category=test["category"], collection_mode=mode, booking_date=booking_date, price=test["price"], status="Scheduled", confirmation_channel=f"Confirmation would be sent to +91******{phone[-4:]}", pdf_url=f"/api/lab-booking/{booking_id}/pdf")


def _pdf_response(title, lines, filename):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = height - 55
    pdf.setFillColor(colors.HexColor("#087f73"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(45, y, "HealthCompare Pro")
    y -= 26
    pdf.setFillColor(colors.HexColor("#172033"))
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(45, y, title)
    y -= 28
    pdf.setFont("Helvetica", 10.5)
    for line in lines:
        if y < 55:
            pdf.showPage(); y = height - 55; pdf.setFont("Helvetica", 10.5)
        pdf.drawString(45, y, str(line)[:110])
        y -= 19
    y -= 10
    pdf.setFillColor(colors.HexColor("#64748b"))
    pdf.setFont("Helvetica-Oblique", 8.5)
    pdf.drawString(45, y, "Educational portfolio demo - not a real medical order or emergency service.")
    pdf.save()
    buffer.seek(0)
    return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name=filename)


def _booking_allowed(row, kind):
    user = current_user()
    if user and (user["role"] == "admin" or row["user_id"] == user["id"]):
        return True
    key = "last_appointment_id" if kind == "appointment" else "last_lab_booking_id"
    return session.get(key) == row["id"]


@app.get("/api/appointment/<int:booking_id>/pdf")
def appointment_pdf(booking_id):
    conn = db(); row = conn.execute("SELECT * FROM appointments WHERE id=?", (booking_id,)).fetchone(); conn.close()
    if not row: return json_error("Appointment not found.", 404)
    if not _booking_allowed(row, "appointment"): return json_error("You do not have access to this confirmation.", 403)
    lines = [
        f"Booking ID: #{row['id']}", f"Patient: {row['patient']}", f"Doctor: {row['doctor']}",
        f"Hospital: {row['hospital']}", f"Date: {row['appointment_date']}", f"Time: {row['slot']}",
        f"Phone: +91******{row['phone'][-4:]}", f"Created: {row['created']}",
        "Confirmation channel: SMS/email simulation"
    ]
    return _pdf_response("Appointment Confirmation", lines, f"healthcompare-appointment-{booking_id}.pdf")


@app.get("/api/lab-booking/<int:booking_id>/pdf")
def lab_booking_pdf(booking_id):
    conn = db(); row = conn.execute("SELECT * FROM lab_bookings WHERE id=?", (booking_id,)).fetchone(); conn.close()
    if not row: return json_error("Lab booking not found.", 404)
    if not _booking_allowed(row, "lab"): return json_error("You do not have access to this confirmation.", 403)
    lines = [
        f"Booking ID: #{row['id']}", f"Patient: {row['patient']}", f"Test: {row['test_name']}",
        f"Category: {row['category']}", f"Collection: {row['collection_mode']}", f"Date: {row['booking_date']}",
        f"Estimated price: Rs. {row['price']}", f"Address/location: {row['address']}",
        f"Phone: +91******{row['phone'][-4:]}", f"Status: {row['status']}",
        "Confirmation channel: SMS/email simulation"
    ]
    return _pdf_response("Lab Booking Confirmation", lines, f"healthcompare-lab-{booking_id}.pdf")


@app.get("/api/hospital-comparison")
def hospital_comparison():
    city = request.args.get("city", "").strip().lower()
    result = [h for h in HOSPITALS if not city or city in h["city"].lower()]
    return jsonify(hospitals=result)


@app.get("/api/analytics")
def analytics():
    conn = db()
    data = {
        "appointments": conn.execute("SELECT COUNT(*) FROM appointments").fetchone()[0],
        "ambulances": conn.execute("SELECT COUNT(*) FROM ambulances").fetchone()[0],
        "reviews": conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0],
        "lab_bookings": conn.execute("SELECT COUNT(*) FROM lab_bookings").fetchone()[0],
        "specs": [dict(r) for r in conn.execute("SELECT specialization, COUNT(*) AS count FROM doctors GROUP BY specialization ORDER BY specialization")],
    }
    conn.close()
    return jsonify(data)


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return json_error("API endpoint not found.", 404)
    return render_template("index.html"), 404


@app.errorhandler(500)
def server_error(_):
    if request.path.startswith("/api/"):
        return json_error("Something went wrong on the server. Please try again.", 500)
    return "Internal server error", 500


with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
