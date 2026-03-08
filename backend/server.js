require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const dbFile = path.join(__dirname, "database.json");
function readDB() {
  if (!fs.existsSync(dbFile)) {
    return { clients: {} };
  }
  return JSON.parse(fs.readFileSync(dbFile, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}
const clientsFile = path.join(__dirname, "clients.json");
const usageLogFile = path.join(__dirname, "usage-log.json");

const app = express();
app.use(express.json({ limit: "10kb" }));

// =======================
// HELPER FUNCTIONS
// =======================
function generateClientLink(clientId, clientKey) {
  const hash = crypto
    .createHmac("sha256", clientKey)
    .update(clientId)
    .digest("hex");

  const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

return `${BASE_URL}/client-dashboard?client=${clientId}&sig=${hash}`;
}

function verifyClientLink(clientId, clientKey, sig) {
  const expectedSig = crypto
    .createHmac("sha256", clientKey)
    .update(clientId)
    .digest("hex");

  return sig === expectedSig;
}

function getNextAvailableTime(dbData, GAP = 30 * 60 * 1000) {
  const now = new Date();
  const futureSlots = [];

  for (const l of dbData.leads) {
    for (const d of (Array.isArray(l.demo) ? l.demo : [])) {
      const demoTime = new Date(`${d.date}T${d.time}:00`);
      futureSlots.push(demoTime);
    }
  }

  futureSlots.sort((a, b) => a - b);

  let next = now;
  for (const slot of futureSlots) {
    if (Math.abs(slot - next) < GAP) {
      next = new Date(slot.getTime() + GAP);
    }
  }

  const hh = next.getHours().toString().padStart(2, "0");
  const mm = next.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

// =======================
// CLIENT ACCESS MIDDLEWARE
// =======================
app.use("/client-dashboard", (req, res, next) => {

  const clientId = req.query.client;
  const sig = req.query.sig;

  if (!clientId || !sig) {
    return res.status(401).send("Client credentials missing");
  }

  const clients = JSON.parse(fs.readFileSync(clientsFile, "utf-8"));
  const client = clients[clientId];

  if (!client) {
    return res.status(401).send("Invalid client");
  }

  if (!client.active) {
    return res.status(403).send("Client inactive");
  }

  // 🔐 Recreate signature using stored key (NOT from URL)
  const expectedSig = crypto
    .createHmac("sha256", client.key)
    .update(clientId)
    .digest("hex");

  if (sig !== expectedSig) {
    return res.status(403).send("Invalid signature");
  }

  const ip = req.ip;

  // 🔒 IP Locking Logic
  if (!client.activeLink) {

    // First time access → store signature + IP
    client.activeLink = { sig, ip };
    clients[clientId] = client;

    fs.writeFileSync(
      clientsFile,
      JSON.stringify(clients, null, 2)
    );

  } else {

    if (client.activeLink.sig !== sig) {
      return res.status(401).send("Invalid signature");
    }

    if (client.activeLink.ip !== ip) {
      return res.status(403).send("This link cannot be shared");
    }
  }

  // 📊 Usage Logging
  let logs = [];

  if (fs.existsSync(usageLogFile)) {
    try {
      logs = JSON.parse(fs.readFileSync(usageLogFile, "utf-8"));
    } catch {
      logs = [];
    }
  }

  logs.push({
    client: clientId,
    ip,
    path: req.originalUrl,
    time: new Date().toISOString(),
  });

  fs.writeFileSync(
    usageLogFile,
    JSON.stringify(logs, null, 2)
  );

  req.client = clientId;

  next();
});

// ===============================
// CLIENT DASHBOARD
// ===============================
app.get("/client-dashboard", (req, res) => {
  const db = readDB();
  if (!db.clients[req.client]) {
  return res.send("Client not found");
}

const leads = db.clients[req.client].leads;
  

  let serial = 1;
  const rows = leads.flatMap(l =>
  l.demo.map(d => `
    <tr>
      <td>${serial++}</td>
      <td>${l.name}</td>
      <td>${l.email}</td>
      <td>${l.contactNumber}</td>
      <td>${l.createdAt}</td>
      <td>${d.date}</td>
      <td>${d.time}</td>
    </tr>
  `)
).join("");

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Client Dashboard</title>
        <style>
          body { font-family: Arial; padding: 20px; background: #f4f4f4; }
          table { width: 100%; border-collapse: collapse; background: #fff; }
          th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
          th { background: #eee; }
        </style>
      </head>
      <body>
        <h1>Client Dashboard</h1>
        <table>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Email</th>
            <th>Contact</th>
            <th>Lead Created At</th>
            <th>Demo Date</th>
            <th>Demo Time</th>
          </tr>
          ${rows || "<tr><td colspan='7'>No submissions yet</td></tr>"}
        </table>
      </body>
    </html>
  `);
});

// ===============================
// CUSTOMER FRONTEND
// ===============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "src", "index.html"));
});

app.get("/static/index.js", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "src", "index.js"));
});

app.get("/demo-link", (req, res) => {
  const { client, email, contact } = req.query;

  res.redirect(
    `/?mode=demo&client=${client}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contact)}`
  );
});

app.get("/history", (req, res) => {

  const { email, contact, client } = req.query;

  if (!client || !email || !contact) {
    return res.send("Invalid request.");
  }

  const db = readDB();

  if (!db.clients[client]) {
    return res.send("Invalid client.");
  }

  const clientLeads = db.clients[client].leads;

  const lead = clientLeads.find(
    l => l.email === email && l.contactNumber === contact
  );

  if (!lead) return res.send("No history found.");

  const rows = (lead.demo || []).map(d => `
  <tr>
    <td>${lead.name}</td>
    <td>${lead.email}</td>
    <td>${lead.contactNumber}</td>
    <td>${d.date}</td>
    <td>${d.time}</td>
    <td>
      <button onclick="deleteDemo('${lead.email}','${lead.contactNumber}','${d.date}','${d.time}')">
        Delete
      </button>
    </td>
  </tr>
  `).join("");

  res.send(`
  <h2>Your Demo History</h2>

  <table border="1" cellpadding="10">
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th>Contact</th>
      <th>Demo Date</th>
      <th>Demo Time</th>
      <th>Action</th>
    </tr>
    ${rows}
  </table>

  <script>
    async function deleteDemo(email, contactNumber, date, time) {
      if (!confirm("Are you sure you want to delete this demo?")) return;

      const res = await fetch("/demo?client=${client}", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, contactNumber, date, time })
      });

      const data = await res.json();

      if (data.error) {
        alert(data.error);
      } else {
        location.reload();
      }
    }
  </script>
  `);
});

// ===============================
// CHATBOT START
// ===============================
app.get("/chatbot/start", (req, res) => {
  res.json({
    message: `Welcome.

This platform helps businesses:
• Collect genuine leads
• Avoid duplicates
• Book demos without conflicts

You will submit your details and choose a demo slot
This takes less than 1 minute.

Do you want to continue?`
  });
});

// ===============================
// LEADS POST
// ===============================
app.post("/leads", (req, res) => {
  const clientId = req.query.client;
  if (!clientId) {
    return
  res.status(400).json({ error: "Invalid request." });
}
const db = readDB();

if (!db.clients[clientId]) {
  return
  res.status(400).json({ error: "Invalid request."});
}
  const { name, email, contactNumber } = req.body;

  if (!name || !/^[A-Za-z. ]+$/.test(name)) {
    return res.status(400).json({ error: "Invalid name. Only letters and dots allowed." });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  if (!contactNumber || !/^\d{10,15}$/.test(contactNumber)) {
    return res.status(400).json({ error: "Invalid contact number format." });
  }

  const clientLeads =
  db.clients[clientId].leads;

  const existingLead = clientLeads.find(
  l => l.email === email && l.contactNumber === contactNumber
);

if (existingLead) {
  return res.json({
    alreadyExists: true,
    message: "You have already submitted your details. So you can directly book a demo without giving lead details by using the demo link given below.",
    demoLink: `/demo-link?client=${clientId}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contactNumber)}`,
    historyLink: `/history?client=${clientId}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contactNumber)}`
  });
}

  const newLead = {
    name,
    email,
    contactNumber,
    createdAt: new Date().toISOString(),
    demo: []
  };

  db.clients[clientId].leads.push(newLead);
writeDB(db);

  res.json({ message: "Lead created successfully." });
});

// ===============================
// DEMO POST (FOR BOTH MAIN AND NEW LINKS)
app.post("/demo", (req, res) => {

  const clientId = req.query.client;

  if (!clientId) {
    return res.status(400).json({ error: "Invalid request." });
  }

  const db = readDB();

  if (!db.clients[clientId]) {
    return res.status(400).json({ error: "Invalid request." });
  }

  const { email, contactNumber, date, time } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format." });
  }

  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: "Invalid time format." });
  }

  const demoDateTime = new Date(`${date}T${time}:00`);
  if (isNaN(demoDateTime))
    return res.status(400).json({ error: "Invalid date or time." });

  if (demoDateTime < new Date())
    return res.status(400).json({ error: "Demo time must be in the future." });

  if (!email || !contactNumber)
    return res.status(400).json({ error: "Lead identifier missing." });

  const clientLeads = db.clients[clientId].leads;

  const leadIndex = clientLeads
    .map(l => l.email === email && l.contactNumber === contactNumber)
    .lastIndexOf(true);

  if (leadIndex === -1)
    return res.status(404).json({ error: "Lead not found." });

  const lead = clientLeads[leadIndex];

  const GAP = 30 * 60 * 1000;

  const demosOnDate = [];

  for (const l of clientLeads) {
    for (const d of (Array.isArray(l.demo) ? l.demo : [])) {
      if (d.date === date) {
        demosOnDate.push(new Date(`${d.date}T${d.time}:00`));
      }
    }
  }

  let latestDemoTime = null;

  if (demosOnDate.length > 0) {
    latestDemoTime = new Date(Math.max(...demosOnDate));
  }

  let nextAvailableTime = latestDemoTime
    ? new Date(latestDemoTime.getTime() + GAP)
    : new Date(`${date}T00:00:00`);

  if (demoDateTime < nextAvailableTime) {
    const hh = nextAvailableTime.getHours().toString().padStart(2, "0");
    const mm = nextAvailableTime.getMinutes().toString().padStart(2, "0");

    return res.status(409).json({
      error: `This demo slot is booked. Book after ${hh}:${mm}.`,
      nextAvailable: `${hh}:${mm}`
    });
  }

  lead.demo.push({
    date,
    time,
    createdAt: new Date().toISOString()
  });

  writeDB(db);

  res.json({ message: "Demo booked successfully." });
});

// ===============================
// DELETE DEMO
app.delete("/demo", (req, res) => {
  const clientId = req.query.client;

  if (!clientId) {
    return res.status(400).json({ error: "Invalid request." });
  }

  const db = readDB();

  if (!db.clients[clientId]) {
    return res.status(400).json({ error: "Invalid request." });
  }

  const { email, contactNumber, date, time } = req.body;

  if (!email || !contactNumber || !date || !time) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const clientLeads = db.clients[clientId].leads;

const lead = clientLeads.find(
  l => l.email === email && l.contactNumber === contactNumber
);

  if (!lead) {
    return res.status(404).json({ error: "Lead not found." });
  }

  const originalLength = lead.demo.length;

  lead.demo = lead.demo.filter(
    d => !(d.date === date && d.time === time)
  );

  if (lead.demo.length === originalLength) {
    return res.status(404).json({ error: "Demo not found." });
  }

  writeDB(db);

  res.json({ message: "Demo deleted successfully." });
});

// ===============================
// ADMIN LINK GENERATOR
app.get("/generate-link/:clientId", (req, res) => {
  const adminSecret = req.query.secret;
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const clientId = req.params.clientId;
  const clients = JSON.parse(fs.readFileSync(clientsFile, "utf-8"));
  const client = clients[clientId];

  if (!client) return res.status(404).send("Client not found");
  if (!client.active) return res.status(403).send("Client inactive");

  const link = generateClientLink(clientId, client.key);
  res.send(`<a href="${link}" target="_blank">${link}</a>`);
});

// ===============================
// SECURITY HARDENING
if (process.env.NODE_ENV === "production") {
  app.disable("x-powered-by");
}

// ===============================
// PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => 
  console.log(`Server running on port $ {PORT}`));