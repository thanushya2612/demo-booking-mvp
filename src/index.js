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

document.getElementById("submitLead").onclick = async () => {
  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const contactNumber = document.getElementById("contactNumber").value;

  const res = await fetch("/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, contactNumber })
  });

  const data = await res.json();
  document.getElementById("leadMessage").innerText = data.error || data.message;
};

document.getElementById("submitDemo").onclick = async () => {
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;

  // reuse lead details already entered
  const email = document.getElementById("email").value;
  const contactNumber = document.getElementById("contactNumber").value;

  const res = await fetch("/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date,
      time,
      email,
      contactNumber
    })
  });

  const data = await res.json();
const demoMsg = document.getElementById("demoMessage");

demoMsg.innerText = data.error || data.message;

if (data.error) {
  demoMsg.style.color = "red";
} else {
  demoMsg.style.color = "green";
}

};

start();