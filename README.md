# HealthCompare Pro — MCA Final Project

A Flask + SQLite educational healthcare comparison platform.

## Features
- Nearby hospital search using OpenStreetMap / Overpass
- Doctor directory and profiles
- Appointment booking workflow
- **Diagnostic Lab Tests catalogue** with search and category filters
- **Lab test booking** for lab visit or demo home collection
- Hospital comparison
- Reviews and ratings
- Ambulance workflow marked as a simulation
- Patient registration/login and dashboard
- Analytics dashboard

## Lab module
The Lab Tests section includes common demo tests such as CBC, LFT, KFT, HbA1c, Thyroid Profile, Lipid Profile, Vitamin D, Urine Routine Examination and Chest X-Ray. Prices are sample/demo values and are not live provider prices.

## Run on Mac
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
```
Open `http://127.0.0.1:5000`.

Demo patient: `patient@healthcompare.demo` / `patient123`

## Important
This is an educational portfolio project. Lab bookings, hospital data and ambulance requests are demonstrations and do not place real medical orders, appointments, or emergency dispatches.


## UX and portfolio polish
- Animated skeleton loaders for hospital, doctor and lab results.
- Floating toast notifications for confirmations and errors.
- Persistent light/dark mode toggle.
- Visual 5-star rating bars.
- Doctor and city type-ahead suggestions.
- Patient dashboard with upcoming/past appointment history and lab booking history.
- PDF confirmation downloads for appointments and lab bookings using ReportLab.
- SMS/email confirmation simulation with masked phone numbers.

The PDF and messaging features are demonstrations only; no real medical order, SMS or email is sent.
