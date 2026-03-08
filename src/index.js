const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const paramEmail = params.get("email");
const paramContact = params.get("contact");
const clientId = params.get("client");

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
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;
  const email = document.getElementById("email").value;
  const contactNumber = document.getElementById("contactNumber").value;

  if (!email || !contactNumber) {
    alert("Please submit your lead details first.");
    return;
  }

  const res = await fetch(`/demo?client=${clientId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, time, email, contactNumber })
  });

  const data = await res.json();
  const demoMsg = document.getElementById("demoMessage");

  demoMsg.innerText = data.error || data.message;
  demoMsg.style.color = data.error ? "red" : "green";

  if (!data.error) {
    document.getElementById("submitDemo").disabled = true;
  }

  if (data.nextAvailable) {
    demoMsg.innerText += ` Next available: ${data.nextAvailable}`;
  }
};

// ================== New Demo Link Form ==================
if (document.getElementById("submitNewDemo")) {
  document.getElementById("submitNewDemo").onclick = async () => {
    const date = document.getElementById("newDate").value;
    const time = document.getElementById("newTime").value;
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

    if (data.nextAvailable) {
      msg.innerText += ` Next available: ${data.nextAvailable}`;
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