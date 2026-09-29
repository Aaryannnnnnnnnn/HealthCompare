const THEME_KEY = "healthcompare-theme";
let doctorCache = [];
let citySuggestTimer = null;

function showToast(message, type="success") {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${type === "error" ? "!" : type === "info" ? "i" : "✓"}</span><span>${escapeHTML(message)}</span><button aria-label="Close notification" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 220); }, 4200);
}

function stars(value, max=5) {
  const n = Math.max(0, Math.min(max, Number(value) || 0));
  let out = "";
  for (let i=1;i<=max;i++) out += `<span class="star ${i <= Math.round(n) ? "filled" : ""}">★</span>`;
  return `<span class="stars" aria-label="${n.toFixed(1)} out of ${max}">${out}<small>${n.toFixed(1)}</small></span>`;
}

function maskPhone(phone) { const p = String(phone || ""); return p.length === 10 ? `+91******${p.slice(-4)}` : "your registered number"; }

function toggleTheme() {
  const dark = document.body.classList.toggle("dark-mode");
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  const btn = document.querySelector(".theme-toggle");
  if (btn) btn.textContent = dark ? "☀️" : "🌙";
}

function initTheme() {
  const dark = localStorage.getItem(THEME_KEY) === "dark";
  document.body.classList.toggle("dark-mode", dark);
  const btn = document.querySelector(".theme-toggle");
  if (btn) btn.textContent = dark ? "☀️" : "🌙";
}

function skeletonCards(count=6) {
  return Array.from({length:count}, () => `<div class="card skeleton-card"><div class="sk sk-icon"></div><div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div><div class="sk sk-button"></div></div>`).join("");
}

function setSkeleton(id, count=6) { const el=$(id); if (el) el.innerHTML=skeletonCards(count); }

async function doctorSuggestions() {
  const input=$("dq"), box=$("doctorSuggestions");
  const q=input.value.trim().toLowerCase();
  if (!q) { box.innerHTML=""; box.classList.remove("show"); loadDoctors(); return; }
  try {
    if (!doctorCache.length) doctorCache = await api("/api/doctors");
    const matches=doctorCache.filter(d => `${d.name} ${d.specialization} ${d.hospital}`.toLowerCase().includes(q)).slice(0,6);
    box.innerHTML=matches.map(d=>`<button type="button" onclick="pickDoctorSuggestion(${d.id})"><b>${escapeHTML(d.name)}</b><small>${escapeHTML(d.specialization)} · ${escapeHTML(d.hospital)}</small></button>`).join("");
    box.classList.toggle("show", matches.length>0);
  } catch {}
  clearTimeout(window.doctorSearchTimer); window.doctorSearchTimer=setTimeout(loadDoctors,180);
}
function pickDoctorSuggestion(id) {
  const d=doctorCache.find(x=>x.id===id); if (!d) return;
  $("dq").value=d.name; $("doctorSuggestions").classList.remove("show"); loadDoctors();
}

function citySuggestions() {
  const q=$("city").value.trim(); const box=$("citySuggestions");
  clearTimeout(citySuggestTimer);
  if (q.length<2) { box.innerHTML=""; box.classList.remove("show"); return; }
  citySuggestTimer=setTimeout(async()=>{
    try {
      const r=await fetch("https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&addressdetails=1&limit=5&q="+encodeURIComponent(q+", India"));
      if(!r.ok) return; const d=await r.json();
      box.innerHTML=d.map(x=>`<button type="button" onclick="pickCitySuggestion(decodeURIComponent('${encodeURIComponent(x.display_name)}'),${Number(x.lat)},${Number(x.lon)})">📍 ${escapeHTML(x.display_name)}</button>`).join("");
      box.classList.toggle("show",d.length>0);
    } catch {}
  },280);
}
function pickCitySuggestion(label,lat,lon) { $("city").value=label.split(",")[0]; $("citySuggestions").classList.remove("show"); loadHosp(lat,lon,label); go("nearby"); }

let sel = null;
let chart = null;
const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? {"Content-Type": "application/json"} : {}),
        ...(options.headers || {})
      }
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; }
    catch {
      console.error("Non-JSON server response:", raw);
      throw new Error(`Server returned an unexpected response (${response.status}). Check the terminal for the Flask error.`);
    }
    if (!response.ok) throw new Error(data?.message || `Request failed (${response.status}).`);
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Unable to connect to HealthCompare Pro. Make sure python3 app.py is running.");
    }
    throw error;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function go(id) {
  document.querySelectorAll("main section").forEach(x => x.classList.add("hide"));
  const target = $(id);
  if (!target) return;
  target.classList.remove("hide");
  document.getElementById("navLinks")?.classList.remove("open");
  if (id === "doctors") loadDoctors();
  if (id === "appointment") loadAppointmentDoctors();
  if (id === "labs") loadLabs();
  if (id === "reviews") { loadReviewTargets(); loadViewTargets(); }
  if (id === "analytics") analytics();
  window.scrollTo({top: 68, behavior: "smooth"});
}

function toggleMenu() {
  $("navLinks").classList.toggle("open");
}

function setStatus(id, message, isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#b42318" : "#64748b";
}

async function findNearby() {
  setStatus("hstatus", "Getting location...");
  if (!navigator.geolocation) {
    setStatus("hstatus", "Location is not supported. Search a city instead.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    p => loadHosp(p.coords.latitude, p.coords.longitude, "your location"),
    () => setStatus("hstatus", "Location permission was denied. Search a city instead.", true),
    {enableHighAccuracy:false, timeout:10000, maximumAge:300000}
  );
  go("nearby");
}

async function searchCity() {
  const city = $("city").value.trim();
  if (!city) { setStatus("hstatus", "Please enter a city name.", true); return; }
  setStatus("hstatus", "Finding city...");
  try {
    const r = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&addressdetails=1&q=" +
      encodeURIComponent(city + ", India") + "&limit=1"
    );
    if (!r.ok) throw new Error();
    const d = await r.json();
    if (d.length) loadHosp(d[0].lat, d[0].lon, d[0].display_name || city);
    else setStatus("hstatus", "City not found. Try a major Indian city.", true);
  } catch {
    setStatus("hstatus", "Unable to search the city. Check your internet connection.", true);
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2-lat1)*rad, dLon = (lon2-lon1)*rad;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function loadHosp(lat, lon, label = "your location") {
  setStatus("hstatus", "Loading hospitals...");
  setSkeleton("hospitals", 6);
  const q = `[out:json];(node["amenity"="hospital"](around:10000,${lat},${lon});way["amenity"="hospital"](around:10000,${lat},${lon}););out center tags;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {method:"POST", body:q});
    if (!r.ok) throw new Error();
    const d = await r.json();
    const a = d.elements.map(x => {
      const la = x.lat ?? x.center?.lat, lo = x.lon ?? x.center?.lon;
      return {...x, la, lo, km: (la && lo) ? distanceKm(lat, lon, la, lo) : 9999};
    }).filter(x => x.la && x.lo).sort((x,y)=>x.km-y.km).slice(0,25);

    setStatus("hstatus", `Found ${a.length} hospitals near ${label}.`);
    $("hospitals").innerHTML = a.length ? a.map(x => {
      const n = escapeHTML(x.tags?.name || "Unnamed Hospital");
      const street = escapeHTML(x.tags?.["addr:street"] || x.tags?.["addr:full"] || "Address details unavailable");
      return `<div class="card">
        <h3>🏥 ${n}</h3>
        <p>${street}</p>
        <div class="meta"><span>📍 ${x.km.toFixed(1)} km</span><span>Hospital</span></div>
        <a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/dir/?api=1&destination=${x.la},${x.lo}">Open Directions →</a>
      </div>`;
    }).join("") : `<div class="empty">No hospitals found within 10 km. Try another city.</div>`;
  } catch {
    setStatus("hstatus", "Hospital service is temporarily unavailable. Try again.", true);
  }
}

async function specs() {
  try {
    const s = await api("/api/specs");
    $("spec").innerHTML = '<option value="">All Specializations</option>' +
      s.map(x => `<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join("");
  } catch { setStatus("doctorStatus", "Unable to load specializations.", true); }
}

async function loadDoctors() {
  setSkeleton("doctorlist", 6);
  try {
    if (!doctorCache.length) doctorCache = await api("/api/doctors");
    const q = $("dq").value || "", spec = $("spec").value || "";
    const d = await api("/api/doctors?q=" + encodeURIComponent(q) + "&spec=" + encodeURIComponent(spec));
    setStatus("doctorStatus", `${d.length} doctor${d.length === 1 ? "" : "s"} found.`);
    $("doctorlist").innerHTML = d.length ? d.map(x => `
      <div class="card">
        <h3>👨‍⚕️ ${escapeHTML(x.name)}</h3>
        <p>${escapeHTML(x.specialization)}</p>
        <div class="meta"><span>${stars(x.rating)}</span><span>${x.experience} yrs</span></div>
        <p><b>${escapeHTML(x.hospital)}</b><br>Consultation fee: ₹${Number(x.fee).toLocaleString("en-IN")}</p>
        <button type="button" class="primary" onclick="openProfile(${x.id})">View Profile</button>
      </div>`).join("") : '<div class="empty">No doctors matched your search.</div>';
  } catch { setStatus("doctorStatus", "Unable to load doctors.", true); }
}

async function openProfile(id) {
  try {
    sel = await api("/api/doctors/" + id);
    $("profilePageContent").innerHTML = `
      <div class="profile-details-card">
        <div class="doctor-avatar">👨‍⚕️</div>
        <div>
          <h2>${escapeHTML(sel.name)}</h2>
          <p><b>${escapeHTML(sel.specialization)}</b> • ${stars(sel.rating)}</p>
          <p><b>Qualification:</b> ${escapeHTML(sel.qualification)}</p>
          <p><b>Experience:</b> ${sel.experience} Years</p>
          <p><b>Hospital:</b> ${escapeHTML(sel.hospital)}</p>
          <p><b>Consultation Fee:</b> ₹${Number(sel.fee).toLocaleString("en-IN")}</p>
          <div class="profile-actions">
            <button type="button" class="primary" onclick="selectDoctorForAppointment(${sel.id})">📅 Book Appointment</button>
            <button type="button" onclick="go('doctors')">← Back to Doctors</button>
          </div>
        </div>
      </div>`;
    go("profilePage");
  } catch {
    alert("Unable to load doctor profile. Please try again.");
  }
}

async function loadAppointmentDoctors() {
  try {
    const doctors = await api("/api/doctors");
    const select = $("appointmentDoctor");
    const current = select.value;
    select.innerHTML = '<option value="">Select a doctor</option>' + doctors.map(d =>
      `<option value="${d.id}" data-hospital="${escapeHTML(d.hospital)}">${escapeHTML(d.name)} — ${escapeHTML(d.specialization)}</option>`
    ).join("");
    if (current) select.value = current;
    syncAppointmentDoctor();
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset()*60000).toISOString().split("T")[0];
    $("appointmentDate").min = localDate;
    if (!$("appointmentDate").value) $("appointmentDate").value = localDate;
  } catch {}
}

function syncAppointmentDoctor() {
  const option = $("appointmentDoctor").selectedOptions[0];
  $("appointmentHospital").value = option?.dataset?.hospital || "";
}

async function selectDoctorForAppointment(id) {
  go("appointment");
  await loadAppointmentDoctors();
  $("appointmentDoctor").value = String(id);
  syncAppointmentDoctor();
  $("appointmentPatient").focus();
}

async function confirmInlineAppointment() {
  const doctorId = Number($("appointmentDoctor").value || 0);
  const patient = $("appointmentPatient").value.trim();
  const phone = $("appointmentPhone").value.trim();
  const slot = $("appointmentSlot").value;
  const appointmentDate = $("appointmentDate").value;

  if (!doctorId) { alert("Please select a doctor."); return; }
  if (!patient) { alert("Please enter patient name."); return; }
  if (!/^\d{10}$/.test(phone)) { alert("Please enter a valid 10-digit phone number."); return; }
  if (!appointmentDate) { alert("Please select an appointment date."); return; }

  const button = document.querySelector("#appointment .primary");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "Confirming...";

  try {
    const d = await api("/api/appointment", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({patient, phone, doctor_id:doctorId, slot, appointment_date:appointmentDate})
    });
    const niceDate = new Date(appointmentDate + "T00:00:00").toLocaleDateString("en-IN", {day:"2-digit",month:"short",year:"numeric"});
    $("appointmentResult").innerHTML =
      `<div class="result success"><h3>✅ Appointment Confirmed</h3>
       <p><b>Booking ID:</b> #${d.id}<br><b>Doctor:</b> ${escapeHTML(d.doctor)}<br><b>Hospital:</b> ${escapeHTML(d.hospital)}<br><b>Date:</b> ${niceDate}<br><b>Time:</b> ${escapeHTML(d.slot)}</p>
       <p class="sim-note">📲 ${escapeHTML(d.confirmation_channel)}</p><a class="download-btn" href="${d.pdf_url}" target="_blank">⬇ Download Confirmation PDF</a></div>`;
    $("appointmentPatient").value = "";
    $("appointmentPhone").value = "";
    analytics();
  } catch (e) {
    showToast(e.message || "Appointment booking failed.", "error");
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

async function loadLabs() {
  setSkeleton("labList", 6);
  try {
    setStatus("labStatus", "Loading diagnostic tests...");
    const q = encodeURIComponent($("labSearch").value.trim());
    const category = encodeURIComponent($("labCategory").value);
    const d = await api(`/api/lab-tests?q=${q}&category=${category}`);

    const categorySelect = $("labCategory");
    const currentCategory = categorySelect.value;
    categorySelect.innerHTML = '<option value="">All Categories</option>' +
      d.categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
    categorySelect.value = currentCategory;

    const testSelect = $("labTest");
    testSelect.innerHTML = '<option value="">Select a test</option>' +
      d.tests.map(t => `<option value="${t.id}" data-price="${t.price}">${escapeHTML(t.name)} — ₹${t.price}</option>`).join("");

    $("labList").innerHTML = d.tests.length ? d.tests.map(t => `
      <div class="card lab-card">
        <div class="lab-icon">🧪</div>
        <span class="pill">${escapeHTML(t.category)}</span>
        <h3>${escapeHTML(t.name)}</h3>
        <div class="meta"><span>⏱ ${escapeHTML(t.turnaround)}</span><strong>₹${t.price}</strong></div>
        <p>🏠 Home collection: ${escapeHTML(t.home_collection)}</p>
        <button class="primary" onclick="chooseLabTest(${t.id})">Book this test</button>
      </div>`).join("") : '<div class="empty">No diagnostic tests match your search.</div>';

    setStatus("labStatus", `${d.tests.length} diagnostic test${d.tests.length === 1 ? "" : "s"} available.`);
    syncLabTest();
  } catch (e) {
    setStatus("labStatus", e.message || "Unable to load lab tests.", true);
    $("labList").innerHTML = '<div class="empty">Unable to load the lab catalogue. Please try again.</div>';
  }
}

async function chooseLabTest(id) {
  go("labs");
  await loadLabs();
  $("labTest").value = String(id);
  syncLabTest();
  document.querySelector(".lab-booking-card")?.scrollIntoView({behavior:"smooth", block:"center"});
}

function syncLabTest() {
  const option = $("labTest")?.selectedOptions?.[0];
  if (!option || !option.value) {
    $("labPrice").textContent = "Select a test to see the estimated price.";
    return;
  }
  const price = option.dataset.price;
  $("labPrice").innerHTML = `<span>Estimated test price</span><strong>₹${escapeHTML(price)}</strong>`;
}

async function bookLabTest() {
  const testId = Number($("labTest").value || 0);
  const patient = $("labPatient").value.trim();
  const phone = $("labPhone").value.trim();
  const mode = $("labMode").value;
  const bookingDate = $("labDate").value;
  const address = $("labAddress").value.trim();
  const result = $("labBookingResult");

  result.innerHTML = "";
  if (!testId) { result.innerHTML = '<div class="auth-status error-status">Please select a diagnostic test.</div>'; return; }
  if (patient.length < 2) { result.innerHTML = '<div class="auth-status error-status">Please enter the patient name.</div>'; return; }
  if (!/^\d{10}$/.test(phone)) { result.innerHTML = '<div class="auth-status error-status">Please enter a valid 10-digit phone number.</div>'; return; }
  if (!bookingDate) { result.innerHTML = '<div class="auth-status error-status">Please select a preferred date.</div>'; return; }
  if (!address) { result.innerHTML = '<div class="auth-status error-status">Please enter an address or lab location.</div>'; return; }

  const button = document.querySelector("#labs .lab-booking-card button.primary");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "Scheduling...";
  try {
    const d = await api("/api/lab-booking", {
      method:"POST",
      body:JSON.stringify({test_id:testId, patient, phone, collection_mode:mode, booking_date:bookingDate, address})
    });
    const niceDate = new Date(bookingDate + "T00:00:00").toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"});
    result.innerHTML = `<div class="result success"><h3>✅ Lab Test Scheduled</h3>
      <p><b>Booking ID:</b> #${d.id}<br><b>Test:</b> ${escapeHTML(d.test)}<br>
      <b>Collection:</b> ${escapeHTML(d.collection_mode)}<br><b>Date:</b> ${niceDate}<br>
      <b>Estimated Price:</b> ₹${d.price}</p>
      <p class="sim-note">📲 ${escapeHTML(d.confirmation_channel)}</p>
      <a class="download-btn" href="${d.pdf_url}" target="_blank">⬇ Download Booking PDF</a>
      <small>This is a portfolio demonstration; no real lab order has been placed.</small></div>`;
    $("labPatient").value = "";
    $("labPhone").value = "";
    $("labAddress").value = "";
    analytics();
    refreshAccount();
  } catch (e) {
    result.innerHTML = `<div class="auth-status error-status">${escapeHTML(e.message || "Unable to schedule the test.")}</div>`;
    showToast(e.message || "Unable to schedule the test.", "error");
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

async function getReviewTargets(type) {
  const doctors = await api("/api/doctors");
  if (type === "doctor") return doctors.map(x => x.name);
  return [...new Set(doctors.map(x => x.hospital))].sort();
}

async function populateSelect(selectId, values) {
  const select = $(selectId);
  select.innerHTML = values.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("");
  if (!values.length) select.innerHTML = '<option value="">No targets available</option>';
}

async function loadReviewTargets() {
  try { await populateSelect("rtarget", await getReviewTargets($("rtype").value)); } catch {}
}

async function loadViewTargets() {
  try { await populateSelect("vtarget", await getReviewTargets($("vtype").value)); } catch {}
}

async function postReview() {
  try {
    const d = await api("/api/review", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        type:$("rtype").value, target:$("rtarget").value, name:$("rname").value.trim(),
        rating:$("rrating").value, comment:$("rcomment").value.trim()
      })
    });
    showToast(d.message);
    $("rcomment").value = "";
    $("rname").value = "";
    await viewReviews();
    analytics();
  } catch (e) { alert(e.message || "Unable to post review."); }
}

async function viewReviews() {
  try {
    const target = $("vtarget").value;
    if (!target) return;
    const d = await api("/api/reviews?type=" + encodeURIComponent($("vtype").value) + "&target=" + encodeURIComponent(target));
    $("reviewlist").innerHTML =
      `<h3>Average Rating: ${stars(d.average)}</h3>` +
      (d.reviews.length
        ? d.reviews.map(x => `<div class="review"><b>${stars(x.rating)} — ${escapeHTML(x.name)}</b><p>${escapeHTML(x.comment)}</p><small>${escapeHTML(x.created)}</small></div>`).join("")
        : "<p>No reviews yet.</p>");
  } catch { $("reviewlist").innerHTML = "<p>Unable to load reviews.</p>"; }
}

async function bookAmb() {
  try {
    const d = await api("/api/ambulance", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        patient:$("ap").value.trim(), phone:$("aph").value.trim(),
        pickup:$("pick").value.trim(), destination:$("dest").value.trim(), type:$("atype").value
      })
    });
    $("ambresult").innerHTML =
      `<div class="result"><h2>🚑 Demo Request Created</h2>
       <p><b>Booking:</b> #${d.id}<br><b>Driver:</b> ${escapeHTML(d.driver)}<br>
       <b>Vehicle:</b> ${escapeHTML(d.vehicle)}<br><b>Simulated ETA:</b> ${d.eta} min • <b>Demo Fare:</b> ₹${d.fare}</p>
       <small>This is a portfolio simulation, not a real dispatch.</small></div>`;
    analytics();
    showToast("Demo ambulance request created successfully.");
  } catch (e) { showToast(e.message || "Ambulance request failed.", "error"); }
}

async function analytics() {
  try {
    const d = await api("/api/analytics");
    $("ac").textContent = d.appointments;
    $("bc").textContent = d.ambulances;
    $("rc").textContent = d.reviews;
    if ($("lc")) $("lc").textContent = d.lab_bookings;
    if (chart) chart.destroy();
    chart = new Chart($("chart"), {
      type:"bar",
      data:{labels:d.specs.map(x=>x.specialization),datasets:[{label:"Doctors",data:d.specs.map(x=>x.count)}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true}}}
    });
  } catch {}
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  await specs();
  await loadDoctors();
  await loadAppointmentDoctors();
  await loadLabs();
  await loadReviewTargets();
  await loadViewTargets();
});

async function login() {
  try {
    const d = await api("/api/login", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email:$("loginEmail").value.trim(), password:$("loginPassword").value})
    });
    showToast("Welcome back, " + d.user.name + "!");
    await refreshAccount();
    go("account");
  } catch(e) { alert(e.message); }
}

async function register() {
  const status = $("authStatus");
  const name = $("regName").value.trim();
  const email = $("regEmail").value.trim();
  const password = $("regPassword").value;

  status.className = "auth-status";
  status.textContent = "Creating your account...";

  if (name.length < 2) { status.className = "auth-status error-status"; status.textContent = "Please enter your full name."; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { status.className = "auth-status error-status"; status.textContent = "Please enter a valid email address."; return; }
  if (password.length < 6) { status.className = "auth-status error-status"; status.textContent = "Password must contain at least 6 characters."; return; }

  const button = document.querySelector(".register-card button");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "Creating account...";

  try {
    const d = await api("/api/register", {
      method:"POST",
      body:JSON.stringify({name, email, password})
    });
    status.className = "auth-status success-status";
    status.innerHTML = `<strong>✓ Account created successfully.</strong><br><span>Welcome, ${escapeHTML(d.user.name)}. You can now sign in with your email and password.</span>`;
    $("loginEmail").value = email;
    $("loginPassword").value = password;
    $("regPassword").value = "";
  } catch(e) {
    status.className = "auth-status error-status";
    status.textContent = e.message || "Unable to create the account.";
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}
async function logout() {
  await api("/api/logout", {method:"POST"});
  showToast("You have been signed out.", "info");
  refreshAccount();
}

function appointmentHistoryHTML(items) {
  if (!items.length) return '<div class="empty">No appointments yet. Your confirmed visits will appear here.</div>';
  const today = new Date(); today.setHours(0,0,0,0);
  const sorted=[...items].sort((a,b)=>new Date(`${b.appointment_date}T00:00:00`)-new Date(`${a.appointment_date}T00:00:00`));
  const upcoming=sorted.filter(a=>new Date(`${a.appointment_date}T00:00:00`)>=today);
  const past=sorted.filter(a=>new Date(`${a.appointment_date}T00:00:00`)<today);
  const row=a=>`<tr><td><b>#${a.id}</b></td><td>${escapeHTML(a.doctor)}<small>${escapeHTML(a.hospital)}</small></td><td>${escapeHTML(a.appointment_date)}</td><td>${escapeHTML(a.slot)}</td><td><span class="status-chip ${new Date(`${a.appointment_date}T00:00:00`)>=today?'upcoming':'past'}">${new Date(`${a.appointment_date}T00:00:00`)>=today?'Upcoming':'Past'}</span></td><td><a class="download-btn small" href="/api/appointment/${a.id}/pdf" target="_blank">PDF</a></td></tr>`;
  return `<div class="history-section"><h4>Upcoming <span>${upcoming.length}</span></h4>${upcoming.length?`<div class="table-wrap"><table class="history-table"><thead><tr><th>ID</th><th>Doctor</th><th>Date</th><th>Time</th><th>Status</th><th></th></tr></thead><tbody>${upcoming.map(row).join('')}</tbody></table></div>`:'<p class="muted">No upcoming appointments.</p>'}</div><div class="history-section"><h4>Past <span>${past.length}</span></h4>${past.length?`<div class="table-wrap"><table class="history-table"><thead><tr><th>ID</th><th>Doctor</th><th>Date</th><th>Time</th><th>Status</th><th></th></tr></thead><tbody>${past.map(row).join('')}</tbody></table></div>`:'<p class="muted">No past appointments.</p>'}</div>`;
}
function labHistoryHTML(items) {
  if (!items.length) return '<p class="muted">No lab bookings yet.</p>';
  return `<div class="table-wrap"><table class="history-table"><thead><tr><th>ID</th><th>Test</th><th>Collection</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>${items.map(x=>`<tr><td><b>#${x.id}</b></td><td>${escapeHTML(x.test_name)}<small>₹${x.price}</small></td><td>${escapeHTML(x.collection_mode)}</td><td>${escapeHTML(x.booking_date)}</td><td><span class="status-chip upcoming">${escapeHTML(x.status)}</span></td><td><a class="download-btn small" href="/api/lab-booking/${x.id}/pdf" target="_blank">PDF</a></td></tr>`).join('')}</tbody></table></div>`;
}

async function refreshAccount() {
  try {
    const me = await api("/api/me");
    if (!me.user) {
      $("accountArea").innerHTML = `
        <div class="form"><h3>🔐 Login required</h3>
        <p>Use the login/register panel below to access your dashboard.</p>
        <button class="primary" onclick="document.getElementById('authPanel').scrollIntoView({behavior:'smooth'})">Open Login</button></div>`;
      return;
    }
    const d = await api("/api/dashboard");
    $("accountArea").innerHTML = `
      <div class="dashboard-grid">
        <div class="dashboard-card"><span>Logged in as</span><b>${escapeHTML(me.user.name)}</b><small>${escapeHTML(me.user.email)}</small></div>
        <div class="dashboard-card"><span>Appointments</span><b>${d.appointments.length}</b></div>
        <div class="dashboard-card"><span>Ambulance Requests</span><b>${d.ambulances.length}</b></div>
        <div class="dashboard-card"><span>Reviews</span><b>${d.reviews.length}</b></div>
        <div class="dashboard-card"><span>Lab Bookings</span><b>${d.lab_bookings.length}</b></div>
      </div>
      <div class="form dashboard-history" style="margin-top:20px">
        <div class="history-head"><div><span class="auth-label">BOOKING HISTORY</span><h3>My Appointments</h3></div><button onclick="logout()">Sign out</button></div>
        ${appointmentHistoryHTML(d.appointments)}
        <h3 class="history-subtitle">Lab Bookings</h3>
        ${labHistoryHTML(d.lab_bookings)}
      </div>`;
  } catch(e) {
    $("accountArea").innerHTML = `<div class="form"><p>${escapeHTML(e.message)}</p></div>`;
  }
}

async function loadComparison() {
  try {
    const city = $("compareCity").value.trim();
    const d = await api("/api/hospital-comparison?city=" + encodeURIComponent(city));
    $("comparisonTable").innerHTML = d.hospitals.length ? `
      <table><thead><tr><th>Hospital</th><th>City</th><th>Rating</th><th>Beds</th><th>Emergency</th><th>Starting Fee</th><th>Ambulance</th></tr></thead>
      <tbody>${d.hospitals.map(h => `<tr>
        <td><b>${escapeHTML(h.name)}</b></td><td>${escapeHTML(h.city)}</td><td>⭐ ${h.rating}</td>
        <td>${h.beds}</td><td>${escapeHTML(h.emergency)}</td><td>₹${h.starting_fee}</td><td>${escapeHTML(h.ambulance)}</td>
      </tr>`).join("")}</tbody></table>` :
      '<div class="empty">No comparison data found for this city.</div>';
  } catch(e) { alert(e.message); }
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAccount();
});
