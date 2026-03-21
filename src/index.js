const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const paramEmail = params.get("email");
const paramContact = params.get("contact");
const clientId = params.get("client");

let selectedDate = null;
let selectedTime = null;

// ================== Chatbot Start ==================
async function start() {
  const res = await fetch("/chatbot/start");
  const data = await res.json();
  document.getElementById("message").innerText = data.message;
}

document.getElementById("yesBtn").onclick = () => {
  document.getElementById("chat").style.display = "none";
  document.getElementById("form").style.display = "block";
};

document.getElementById("noBtn").onclick = () => {
  document.body.innerHTML = `
    <h2>Sorry</h2>
    <p>This platform is designed only for business inquiries.</p>
  `;
};

// ================== Main Lead Form ==================
document.getElementById("submitLead").onclick = async () => {
  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const contactNumber = document.getElementById("contactNumber").value;

  const res = await fetch(`/leads?client=${clientId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, contactNumber })
  });

  const data = await res.json();
  document.getElementById("leadMessage").innerText = data.error || data.message;

  if (data.error) return;

  const customerLinks = document.getElementById("customerLinks");
  customerLinks.style.display = "block";

  const demoLink =
  data.demoLink ||
  `/demo-link?client=${clientId}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contactNumber)}`;

const historyLink =
  data.historyLink ||
  `/history?client=${clientId}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contactNumber)}`;

  customerLinks.innerHTML = `
    <p>
      Please save these links carefully.<br><br>
      Use the <b>Demo Booking Link</b> to book future demos.<br>
      Use the <b>History Link</b> to view all demos you have booked.<br>
      You can directly book a demo without entering lead details again with the demo link.
    </p>
    <a href="${demoLink}" target="_blank">Book Demo</a><br><br>
    <a href="${historyLink}" target="_blank">View History</a>
  `;
};

// ================== Main Demo Form ==================
document.getElementById("submitDemo").onclick = async () => {

  if (!selectedDate || !selectedTime) {
    alert("Select a slot first");
    return;
  }

  const email = document.getElementById("email").value;
  const contactNumber = document.getElementById("contactNumber").value;

  const res = await fetch(`/demo?client=${clientId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: selectedDate,
      time: selectedTime,
      email,
      contactNumber
    })
  });

  const data = await res.json();
  document.getElementById("demoMessage").innerText = data.message || data.error;

  loadSlots(); // refresh slots
};

// ================== New Demo Link Form ==================
if (document.getElementById("submitNewDemo")) {
  document.getElementById("submitNewDemo").onclick = async () => {
    const email = document.getElementById("newEmail").value;
    const contactNumber = document.getElementById("newContactNumber").value;

    const res = await fetch(`/demo?client=${clientId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, time, email, contactNumber })
    });

    const data = await res.json();
    const msg = document.getElementById("newDemoMessage");

    msg.innerText = data.error || data.message;
    msg.style.color = data.error ? "red" : "green";

    if (data.todaySlots || data.tomorrowSlots) {

  let html = "";

  html += "<h3>Today</h3>";

  if (data.todaySlots.length === 0) {
    html += "<p>No slots available today</p>";
  } else {
    data.todaySlots.forEach(t => {
      html += `<button onclick="selectTime('${t}')">${t}</button> `;
    });
  }

  const todayDay = new Date().getDay();

  if (todayDay !== 0) { // hide tomorrow on Sunday
    html += "<h3>Tomorrow</h3>";

    if (data.tomorrowSlots.length === 0) {
      html += "<p>No slots available tomorrow</p>";
    } else {
      data.tomorrowSlots.forEach(t => {
        html += `<button onclick="selectTime('${t}')">${t}</button> `;
      });
    }
  }

  demoMsg.innerHTML += html;
}
  };
}

// ================== Demo Link Mode ==================
if (mode === "demo") {
  document.getElementById("chat").style.display = "none";
  document.getElementById("form").style.display = "none";
  document.getElementById("newDemoForm").style.display = "block";

  document.getElementById("newEmail").value = paramEmail || "";
  document.getElementById("newContactNumber").value = paramContact || "";

  document.getElementById("newEmail").readOnly = true;
  document.getElementById("newContactNumber").readOnly = true;
}

start();
loadSlots();

function selectSlot(date, time) {
  selectedDate = date;
  selectedTime = time;
}

function renderSlots(data, containerId) {

  const div = document.getElementById(containerId);
  div.innerHTML = "";

  const todayDay = new Date().getDay();

  // TODAY
  div.innerHTML += "<h3>Today</h3>";

  if (!data.todaySlots.length) {
    div.innerHTML += "<p>No slots available today</p>";
  } else {
    data.todaySlots.forEach(t => {
      div.innerHTML += `<button onclick="selectSlot('${data.todayISO}','${t}')">${t}</button>`;
    });
  }

  // TOMORROW (hide Sunday)
  if (todayDay !== 0) {

    div.innerHTML += "<h3>Tomorrow</h3>";

    if (!data.tomorrowSlots.length) {
      div.innerHTML += "<p>No slots available tomorrow. Please try tomorrow for day after tomorrow.</p>";
    } else {
      data.tomorrowSlots.forEach(t => {
        div.innerHTML += `<button onclick="selectSlot('${data.tomorrowISO}','${t}')">${t}</button>`;
      });
    }
  }
}

async function loadSlots() {
  const res = await fetch(`/available-slots?client=${clientId}`);
  const data = await res.json();

  renderSlots(data, "slots");
  renderSlots(data, "newSlots");
}