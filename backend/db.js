const fs = require("fs-extra");
const path = require("path");

const DB_PATH = path.join(__dirname, "database.json");

if (!fs.existsSync(DB_PATH)) {
  fs.writeJsonSync(DB_PATH, {
    clients: {
      client1: { leads: [] },
      client2: { leads: [] },
      client3: { leads: [] }
    }
  }, { spaces: 2 });
}

function readDB() {
  return fs.readJsonSync(DB_PATH);
}

function writeDB(data) {
  fs.writeJsonSync(DB_PATH, data, { spaces: 2 });
}

function getClientLeads(clientId) {
  const db = readDB();
  return db.clients[clientId].leads;
}

function addClientLead(clientId, lead) {
  const db = readDB();
  db.clients[clientId].leads.push(lead);
  writeDB(db);
}

function updateClientData(clientId, leads) {
  const db = readDB();
  db.clients[clientId].leads = leads;
  writeDB(db);
}

module.exports = {
  getClientLeads,
  addClientLead,
  updateClientData
};