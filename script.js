// Data structure:
// data = { people: { id: { id, name, year, bio, gender, marriedCity, parents[], spouses[], children[], photo, deceased } } }

let data = { people: {} };
let isAdmin = false;
let _pendingPhotoDataURL = null;
let currentFileHandle = null;

// --- API Endpoints ---
const API_BASE_URL = '/api';

// --- Utility functions (keep these at the top, they don't interact with DOM directly) ---
function exists(id, d = data) { /* ... */ }
function escapeHtml(s) { /* ... */ }
function getInitials(name) { /* ... */ }

// --- Normalization (keep this here) ---
function normalizeData(d) { /* ... */ }

// --- Storage (now using API) functions (keep these here) ---
async function loadData() { /* ... */ }
async function saveData() { /* ... */ }

// --- Tree rendering functions (keep these here) ---
function renderTree() { /* ... */ }
function buildNode(person) { /* ... */ }

// --- Modal (view person) functions (keep these here) ---
function openPerson(id) { /* ... */ }
function closePersonModal() { /* ... */ }

// --- Edit / add person functions (keep these here) ---
function fillSelects() { /* ... */ }
function editPerson(id) { /* ... */ }
async function uploadPhoto(photoDataURL) { /* ... */ }
async function savePerson(id, isNew) { /* ... */ }
async function deletePerson(id) { /* ... */ }
function addParent(childId) { /* ... */ }
function removeParent(childId, parentId) { /* ... */ }
function addSpouse(personId) { /* ... */ }
function removeSpouse(personId, spouseId) { /* ... */ }

// --- Relationship Checker functions (keep these here) ---
function findRelationship(idA, idB) { /* ... */ }

// --- Admin functions (keep these here) ---
async function checkAdminStatus() { /* ... */ }
function renderAdminButtons() { /* ... */ }


// --- IMPORTANT: ALL DOM-INTERACTING CODE GOES HERE ---
document.addEventListener("DOMContentLoaded", async () => {
  // Now, all HTML elements are guaranteed to be loaded and parsed.

  // Attach event listeners
  document.getElementById("searchInput").addEventListener("input", function (event) {
    const query = event.target.value.toLowerCase();
    const resultsDiv = document.getElementById("searchResults");
    resultsDiv.innerHTML = "";
    if (query.length < 2) return;

    const matches = Object.values(data.people).filter(p =>
      (p.name || "").toLowerCase().includes(query) ||
      (p.bio || "").toLowerCase().includes(query)
    );

    matches.forEach(p => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = p.name;
      pill.onclick = () => openPerson(p.id);
      resultsDiv.appendChild(pill);
    });

    if (!matches.length) {
      resultsDiv.innerHTML = '<div class="hint">No matches found.</div>';
    }
  });

  document.getElementById("relCheckBtn").addEventListener("click", function () {
    const personAId = document.getElementById("relPersonA").value;
    const personBId = document.getElementById("relPersonB").value;
    const resultDiv = document.getElementById("relResult");

    if (!personAId || !personBId || personAId === personBId) {
      resultDiv.textContent = "Please select two different people.";
      return;
    }

    const relation = findRelationship(personAId, personBId);
    resultDiv.textContent = relation || "No direct relationship found.";
  });

  document.getElementById("adminLoginBtn").addEventListener("click", async function () {
    if (isAdmin) {
      isAdmin = false;
      localStorage.removeItem('adminKey');
      this.textContent = "Login"; // This line will correctly update the button text
      alert("Logged out as admin.");
    } else {
      const password = prompt("Enter admin password:");
      if (!password) return;

      try {
        const response = await fetch(`${API_BASE_URL}/admin-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password: password }),
        });

        if (response.ok) {
          const result = await response.json();
          isAdmin = result.success;
          if (isAdmin) {
            localStorage.setItem('adminKey', password);
            this.textContent = "Logout"; // This line will correctly update the button text
            alert("Logged in as admin!");
          } else {
            alert("Incorrect password.");
          }
        } else {
          throw new Error(`Login failed: ${response.statusText}`);
        }
      } catch (e) {
        console.error("Admin login error:", e);
        alert("Error during admin login: " + e.message);
      }
    }
    renderAdminButtons();
    renderTree(); // Rerender to show/hide edit buttons
  });

  document.getElementById("addPersonBtn").addEventListener("click", () => editPerson(null)); // Moved inside DOMContentLoaded

  document.getElementById("exportBtn").addEventListener("click", () => {
    if (!isAdmin) { alert("Admin access required."); return; }
    document.getElementById("jsonExport").value = JSON.stringify(data, null, 2);
  });

  document.getElementById("importBtn").addEventListener("click", async () => {
    if (!isAdmin) { alert("Admin access required."); return; }
    const json = document.getElementById("jsonExport").value;
    if (!json) {
      alert("Please paste JSON data into the text area.");
      return;
    }
    try {
      const importedData = JSON.parse(json);
      if (importedData && importedData.people) {
        data = importedData;
        normalizeData(data);
        await saveData();
        alert("Data imported and saved remotely!");
      } else {
        alert("Invalid JSON structure. Expected an object with a 'people' property.");
      }
    } catch (e) {
      console.error("Import error:", e);
      alert("Failed to parse JSON data: " + e.message);
    }
  });

  // Local File Operations (Optional, keep or remove)
  document.getElementById('chooseFileBtn').addEventListener('click', async () => { /* ... */ });
  document.getElementById('saveToFileBtn').addEventListener('click', async () => { /* ... */ });
  document.getElementById('loadFromFileBtn').addEventListener('click', async () => { /* ... */ });

  // Initial setup calls (these can stay inside DOMContentLoaded)
  await checkAdminStatus();
  await loadData();
});
