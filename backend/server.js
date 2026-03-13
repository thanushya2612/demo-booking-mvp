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
app.set("trust proxy", true);
app.use(express.json({ limit: "10kb" }));

// =======================
// HELPER FUNCTIONS
// =======================
function generateClientLink(clientId, clientKey) {
  const hash = crypto
    .createHmac("sha256", clientKey)
    .update(clientId)
    .digest("hex");

  const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

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

  if (req.path !== "/") {
    return next();
  }

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

// --------------------
// GET CLIENT IP (works on Render and localhost)
// --------------------
let ip = req.socket.remoteAddress || "";
if (req.headers["x-forwarded-for"]) {
  // Take the last IP in the x-forwarded-for list → real client IP
  const xff = req.headers["x-forwarded-for"];
  ip = xff.split(",").map(i => i.trim()).pop();
}

// --------------------
// IP LOCKING LOGIC
// --------------------
if (!client.activeLink) {
  // First-time access: store sig and client IP automatically
  client.activeLink = { sig, ip };
  clients[clientId] = client;
  fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
} else {
  if (client.activeLink.sig !== sig) {
    return res.status(401).send("Invalid signature");
  }

  // Only enforce IP check if NOT localhost/dev
  if (process.env.NODE_ENV === "production") {
    if (client.activeLink.ip && client.activeLink.ip !== ip) {
      return res.status(403).send("This link cannot be shared");
    }
  } else {
    // DEV / localhost → ignore IP mismatch
    client.activeLink.ip = null; // optional: allow reset for testing
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
// WEEKLY SCHEDULING DASHBOARD
// ===============================
app.get("/weekly-dashboard", (req, res) => {

const clientId = req.query.client;

if(!clientId) return res.send("Client missing");

const clients = JSON.parse(fs.readFileSync(clientsFile,"utf-8"));
const client = clients[clientId];

if(!client) return res.send("Client not found");

const today = new Date();
const day = today.getDay();
const mondayOffset = day === 0 ? -6 : 1-day;

const week=[];

for(let i=0;i<7;i++){

const d = new Date(today);
d.setDate(today.getDate()+mondayOffset+i);

const date = d.getDate();
const month = d.toLocaleString("en-US",{month:"short"});
const dayName = d.toLocaleString("en-US",{weekday:"long"});
const iso = d.toISOString().split("T")[0];

week.push({date,month,dayName,iso});

}

let rows="";

week.forEach(w=>{

rows+=`
<tr>
<td>${w.month}</td>
<td>${w.date}</td>
<td>${w.dayName}</td>
<td><input type="time" step="60" id="start-${w.iso}"></td>
<td><input type="time" step="60" id="end-${w.iso}"></td>
</tr>
`;

});

res.send(`

<html>
<head>

<style>

body{font-family:Arial;padding:30px;background:#f4f4f4}

table{border-collapse:collapse;width:100%;background:white}

th,td{border:1px solid #ccc;padding:10px;text-align:center}

th{background:#eee}

button{margin-top:20px;padding:10px}

</style>

</head>

<body>

<h2>Weekly Schedule</h2>

<table>

<tr>
<th>Month</th>
<th>Date</th>
<th>Day</th>
<th>Start Time</th>
<th>End Time</th>
</tr>

${rows}

</table>

<button onclick="save()">Save</button>

<script>

async function save(){

const schedule={}

for(let i=0;i<7;i++){

const row=document.querySelectorAll("table tr")[i+1]

const date=row.children[1].innerText
const day=row.children[2].innerText

const start=row.querySelector("input[id^='start']").value
const end=row.querySelector("input[id^='end']").value

if(!start||!end) continue

const today=new Date()

const selected=new Date(today)
selected.setDate(parseInt(date))

if(selected < today){
alert(day+" already finished. Cannot set time.")
return
}

if(start===end){
schedule[row.querySelector("input[id^='start']").id.replace("start-","")]={day,start,end}
continue
}

if(start > end){
alert(day+" start must be before end")
return
}

schedule[row.querySelector("input[id^='start']").id.replace("start-","")]={day,start,end}

}

await fetch("/save-schedule?client=${clientId}",{

method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify(schedule)

})

alert("Schedule saved")

}

</script>

</body>
</html>

`)

})

// ===============================
// SAVE WEEKLY SCHEDULE
// ===============================
app.post("/save-schedule",(req,res)=>{

const clientId=req.query.client;

const clients = JSON.parse(fs.readFileSync(clientsFile,"utf-8"));

if(!clients[clientId]) return res.send("client not found")

const today=new Date()
const day=today.getDay()
const mondayOffset=day===0?-6:1-day

const schedule=req.body

clients[clientId].weeklySchedule={}

for(const iso in schedule){
clients[clientId].weeklySchedule[iso] = schedule[iso]
}

fs.writeFileSync(clientsFile,JSON.stringify(clients,null,2))

res.json({message:"saved"})

})

// ===============================
// CUSTOMER FRONTEND
// ===============================
app.get("/", (req, res) => {
  const clientId = req.query.client;
  if (!clientId) {
    return res.status(400).send("Client ID missing");
  }

  res.sendFile(path.join(__dirname, "..", "src", "index.html"));
});

app.get("/static/index.js", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "src", "index.js"));
});

app.get("/demo-link", (req, res) => {
  const { client, email, contact } = req.query;

  if (!client || !email || !contact) {
    return res.status(400).send("Missing client or lead info");
  }

  const clients = JSON.parse(fs.readFileSync(clientsFile, "utf-8"));
  if (!clients[client] || !clients[client].active) {
    return res.status(404).send("Client not found or inactive");
  }

  // Redirect with proper client context
  const BASE_URL = process.env.BASE_URL || "https://your-render-app.onrender.com";
res.redirect(
  `${BASE_URL}/?mode=demo&client=${client}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contact)}`
);
});

app.get("/history", (req, res) => {
  const { email, contact, client } = req.query;

  if (!client || !email || !contact) return res.status(400).send("Invalid request.");

  const clients = JSON.parse(fs.readFileSync(clientsFile, "utf-8"));
  if (!clients[client] || !clients[client].active) return res.status(404).send("Client not found or inactive");

  const db = readDB();
  if (!db.clients[client]) return res.status(404).send("Client data not found");

  const clientLeads = db.clients[client].leads;
  const lead = clientLeads.find(l => l.email === email && l.contactNumber === contact);
  if (!lead) return res.send("No history found.");

  const rows = (lead.demo || []).map(d => `
    <tr>
      <td>${lead.name}</td>
      <td>${lead.email}</td>
      <td>${lead.contactNumber}</td>
      <td>${d.date}</td>
      <td>${d.time}</td>
      <td>
        <button onclick="deleteDemo('${lead.email}','${lead.contactNumber}','${d.date}','${d.time}','${client}')">
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
      async function deleteDemo(email, contactNumber, date, time, clientId) {
        if (!confirm("Are you sure you want to delete this demo?")) return;

        const res = await fetch("/demo?client=" + clientId, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, contactNumber, date, time })
        });

        const data = await res.json();
        if (data.error) alert(data.error);
        else location.reload();
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
    return res.status(400).json({ error: "Invalid request." });
}
const db = readDB();

if (!db.clients[clientId]) {
  return res.status(400).json({ error: "Invalid request."});
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
  const BASE_URL = process.env.BASE_URL || "https://your-render-app.onrender.com";
  return res.json({
    alreadyExists: true,
    message: "You have already submitted your details. So you can directly book a demo without giving lead details by using the demo link given below.",
    demoLink: `${BASE_URL}/demo-link?client=${clientId}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contactNumber)}`,
    historyLink: `${BASE_URL}/history?client=${clientId}&email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contactNumber)}`
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

// =======================
// SCHEDULE + GAP CHECK
// =======================

const GAP = 30 * 60 * 1000;

const clients = JSON.parse(fs.readFileSync(clientsFile,"utf-8"));

const schedule = clients[clientId].weeklySchedule || {};

const daySchedule = schedule[date];

if(!daySchedule){
return res.status(409).json({
error:"No demos scheduled for this day"
})
}

if(daySchedule.start === daySchedule.end){
return res.status(409).json({
error:"No demos available this day"
})
}

const startDateTime = new Date(`${date}T${daySchedule.start}:00`);
const endDateTime = new Date(`${date}T${daySchedule.end}:00`);

if(demoDateTime < startDateTime || demoDateTime > endDateTime){

return res.status(409).json({
error:"This slot is outside allowed demo time",
nextAvailableDateTime: `${date} ${daySchedule.start}`
})

}

const demos=[]

for(const l of clientLeads){
for(const d of l.demo){
if(d.date===date){
demos.push(new Date(`${d.date}T${d.time}:00`))
}
}
}

demos.sort((a,b)=>a-b)

let next=new Date(startDateTime)

for(const slot of demos){

if(Math.abs(slot-next)<GAP){
next=new Date(slot.getTime()+GAP)
}

}

if(demoDateTime < next){

const hh = next.getHours().toString().padStart(2,"0")
const mm = next.getMinutes().toString().padStart(2,"0")

return res.status(409).json({
error:"This slot is unavailable",
nextAvailableDateTime:`${date} ${hh}:${mm}`
})

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
  const clientId = req.params.clientId;
  const clients = JSON.parse(fs.readFileSync(clientsFile, "utf-8"));
  const client = clients[clientId];

  if (!client) return res.status(404).send("Client not found");
  if (!client.active) return res.status(403).send("Client inactive");

  // use client.key directly (no admin secret required)
  const link = generateClientLink(clientId, client.key);

// reset previous active link
client.activeLink = null;

clients[clientId] = client;
fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

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
app.listen(PORT, '0.0.0.0', () => 
  console.log(`Server running on port ${PORT}`));