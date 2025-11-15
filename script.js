// Data structure:
// data = { people: { id: { id, name, year, bio, gender, marriedCity, parents[], spouses[], children[], photo, deceased } } }

let data = { people: {} };
let isAdmin = false;
let _pendingPhotoDataURL = null;
let currentFileHandle = null; // For local file system access
let activeTab = 'tree'; // To manage which section is visible

// --- API Endpoints ---
const API_BASE_URL = '/api';

// --- Utility ---

function exists(id, d = data) {
  return d.people && d.people[id];
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// --- Normalization ---

function normalizeData(d) {
  if (!d.people) d.people = {};
  Object.values(d.people).forEach(p => {
    p.children = [];
    p.parents = Array.from(new Set(p.parents || [])).filter(id => exists(id, d));
    p.spouses = Array.from(new Set(p.spouses || [])).filter(id => exists(id, d));
  });

  Object.values(d.people).forEach(child => {
    (child.parents || []).forEach(pid => {
      if (exists(pid, d)) {
        const parent = d.people[pid];
        parent.children = parent.children || [];
        parent.children.push(child.id);
      }
    });
  });

  Object.values(d.people).forEach(p => {
    p.children = Array.from(new Set(p.children || [])).filter(id => exists(id, d));
  });

  Object.values(d.people).forEach(p => {
    (p.spouses || []).forEach(sid => {
      if (!exists(sid, d)) return;
      const sp = d.people[sid];
      sp.spouses = sp.spouses || [];
      if (!sp.spouses.includes(p.id)) sp.spouses.push(p.id);
    });
  });
}

// --- Storage (now using API) ---

async function loadData() {
  try {
    const response = await fetch(`${API_BASE_URL}/data`);
    if (!response.ok) {
      if (response.status === 404) {
        console.warn("No remote data found, starting with empty tree.");
        data = { people: {} };
      } else {
        throw new Error(`Failed to load data: ${response.statusText}`);
      }
    } else {
      const remoteData = await response.json();
      data = remoteData;
      normalizeData(data);
    }
  } catch (e) {
    console.error("Error loading data from API:", e);
    alert("Failed to load family tree data from server. Please check your connection or try again later.");
    data = { people: {} }; // Fallback to empty data on error
  } finally {
    renderTree();
    fillSelects();
  }
}

async function saveData() {
  if (!isAdmin) {
    alert("You must be logged in as an administrator to save changes.");
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': localStorage.getItem('adminKey') || '',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to save data: ${errorData.error || response.statusText}`);
    }
    console.log("Data saved remotely.");
  } catch (e) {
    console.error("Error saving data to API:", e);
    alert("Failed to save family tree data to server. " + e.message);
  } finally {
    renderTree();
    fillSelects();
  }
}

// --- Tree rendering ---

function renderTree() {
  const container = document.getElementById("treeContainer");
  if (!container) return; // Safeguard if element not found

  container.innerHTML = "";

  const people = Object.values(data.people);
  if (!people.length) {
    container.innerHTML = '<div class="empty-message">No people yet. Log in as admin and add your first person.</div>';
    return;
  }

  const rawRoots = people.filter(p => !(p.parents && p.parents.length));
  const seenPairs = new Set();
  const roots = [];
  for (const r of rawRoots) {
    const s = (r.spouses || []).find(id => exists(id, data) && !(data.people[id].parents || []).length);
    if (s) {
      const key = [r.id, s].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
    }
    roots.push(r);
  }

  if (!roots.length) {
    const wrapper = document.createElement("div");
    wrapper.className = "node";
    people.forEach(p => {
      wrapper.appendChild(buildNode(p));
    });
    container.appendChild(wrapper);
    return;
  }

  roots.forEach(r => {
    container.appendChild(buildNode(r));
  });
}

function buildNode(person) {
  const wrapper = document.createElement("div");
  wrapper.className = "node";

  const card = document.createElement("div");
  card.className = `person ${person.gender || ''}`; // Add gender class for styling
  card.onclick = () => openPerson(person.id);

  const genderChip = document.createElement('div');
  genderChip.className = 'gender-chip';
  genderChip.textContent = person.gender ? person.gender[0].toUpperCase() : ''; // M or F
  card.appendChild(genderChip);

  const avatar = document.createElement("div");
  if (person.photo) {
    const img = document.createElement('img');
    img.src = person.photo;
    img.alt = person.name;
    img.className = "avatar";
    avatar.appendChild(img);
  } else {
    avatar.className = "avatar initials";
    avatar.textContent = getInitials(person.name);
  }

  const info = document.createElement("div");
  info.className = "info";

  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = person.name || "(Unnamed)";
  if (person.deceased) nameEl.classList.add("deceased");

  const secondary = document.createElement("div");
  secondary.className = "subname"; // New class for subname
  const year = person.year ? String(person.year) : "";
  const spouseId = (person.spouses || [])[0];
  let spouseName = "";
  if (spouseId && exists(spouseId)) {
    spouseName = data.people[spouseId].name || "";
  }

  if (spouseName && year) {
    secondary.textContent = `${year} · ${spouseName}`;
  } else if (year) {
    secondary.textContent = year;
  } else if (spouseName) {
    secondary.textContent = spouseName;
  }

  info.appendChild(nameEl);
  if (secondary.textContent) info.appendChild(secondary);

  card.appendChild(avatar);
  card.appendChild(info);
  wrapper.appendChild(card);

  const childrenIds = person.children || [];
  if (childrenIds.length) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "children";
    childrenIds.forEach(cid => {
      if (!exists(cid)) return;
      childrenContainer.appendChild(buildNode(data.people[cid]));
    });
    wrapper.appendChild(childrenContainer);
  } else {
    wrapper.classList.add('no-children'); // For styling connectors
  }

  return wrapper;
}

// --- Modals ---

// For viewing person details
function openPerson(id) {
  if (!exists(id)) return;
  const p = data.people[id];

  const modal = document.getElementById("personModal");
  const detailsDiv = document.getElementById("personDetails");
  if (!modal || !detailsDiv) return;

  modal.setAttribute("aria-hidden", "false");
  modal.style.display = "block"; // Show the modal

  let html = "";
  if (p.photo) {
    html += `<img src="${p.photo}" alt="${escapeHtml(p.name)}" class="person-photo" />`;
  }
  html += `<h2 class="modal-title${p.deceased ? " name deceased" : ""}">${escapeHtml(p.name || "(Unnamed)")}</h2>`;
  if (p.year) html += `<p><strong>Year:</strong> ${escapeHtml(p.year)}</p>`;
  if (p.marriedCity) html += `<p><strong>Married city:</strong> ${escapeHtml(p.marriedCity)}</p>`;
  const parents = (p.parents || []).filter(exists).map(pid => data.people[pid].name);
  if (parents.length) html += `<p><strong>Parents:</strong> ${parents.map(escapeHtml).join(", ")}</p>`;
  const spouses = (p.spouses || []).filter(exists).map(sid => data.people[sid].name);
  if (spouses.length) html += `<p><strong>Spouses:</strong> ${spouses.map(escapeHtml).join(", ")}</p>`;
  const kids = (p.children || []).filter(exists).map(cid => data.people[cid].name);
  if (kids.length) html += `<p><strong>Children:</strong> ${kids.map(escapeHtml).join(", ")}</p>`;
  if (p.bio) html += `<p class="modal-bio">${escapeHtml(p.bio)}</p>`;

  if (isAdmin) {
    html += `<div class="row" style="justify-content:flex-end; margin-top:1rem;">
      <button class="btn" onclick="openEdit('${id}')">Edit</button>
      <button class="btn danger" onclick="deletePerson('${id}')">Delete</button>
    </div>`;
  }
  detailsDiv.innerHTML = html;
}

function closePerson() {
  const modal = document.getElementById("personModal");
  if (modal) {
    modal.setAttribute("aria-hidden", "true");
    modal.style.display = "none"; // Hide the modal
  }
}

// For editing/adding person
function openEdit(id) {
  if (!isAdmin) {
    alert("You must be admin to edit.");
    return;
  }
  closePerson(); // Close view modal if open

  const isNew = !id || !exists(id);
  const p = isNew
    ? { id: String(Date.now()), name: "", year: "", bio: "", gender: "", marriedCity: "", parents: [], spouses: [], children: [], photo: "", deceased: false }
    : { ...data.people[id] };

  const editModal = document.getElementById("editModal");
  const editTitle = document.getElementById("editTitle");
  const editForm = document.getElementById("editForm");
  if (!editModal || !editTitle || !editForm) return;

  editTitle.textContent = isNew ? "Add Person" : `Edit ${p.name || "(Unnamed)"}`;
  editModal.setAttribute("aria-hidden", "false");
  editModal.style.display = "block"; // Show the modal

  let html = `<div class="field">
    <label>Name</label>
    <input type="text" id="editName" value="${escapeHtml(p.name || "")}" />
  </div>
  <div class="field">
    <label>Year</label>
    <input type="text" id="editYear" value="${escapeHtml(p.year || "")}" />
  </div>
  <div class="field">
    <label>Gender</label>
    <select id="editGender">
      <option value=""></option>
      <option value="male"${p.gender === "male" ? " selected" : ""}>Male</option>
      <option value="female"${p.gender === "female" ? " selected" : ""}>Female</option>
      <option value="other"${p.gender === "other" ? " selected" : ""}>Other</option>
    </select>
  </div>
  <div class="field">
    <label>Married City</label>
    <input type="text" id="editMarriedCity" value="${escapeHtml(p.marriedCity || "")}" />
  </div>
  <div class="field">
    <label>Bio</label>
    <textarea id="editBio">${escapeHtml(p.bio || "")}</textarea>
  </div>

  <div class="field">
    <label>Photo (URL or upload)</label>
    <input type="text" id="editPhotoUrl" value="${escapeHtml(p.photo || "")}" placeholder="Paste image URL or upload below" />
    <input type="file" id="editPhotoUpload" accept="image/*" style="margin-top:0.3rem;" />
    ${p.photo ? `<img src="${p.photo}" style="max-width:100%; max-height:100px; object-fit:cover; margin-top:0.5rem; border-radius:0.5rem;" />` : ''}
  </div>

  <div class="field row">
    <input type="checkbox" id="editDeceased" ${p.deceased ? "checked" : ""} />
    <label for="editDeceased" style="margin-bottom:0;">Deceased</label>
  </div>

  <h3>Parents</h3>
  <div id="currentParents">
    ${(p.parents || []).filter(exists).map(pid => `
      <span class="pill">${escapeHtml(data.people[pid].name)} <button onclick="removeParent('${p.id}', '${pid}')" class="btn small danger" style="margin-left:5px;">x</button></span>
    `).join('') || 'None'}
  </div>
  <div class="field row">
    <label style="flex:1;">Add Parent</label>
    <select id="parentSelect" style="flex:2;">
      <option value="">(Select)</option>
      ${Object.values(data.people).filter(person => person.id !== p.id && !(p.parents || []).includes(person.id)).map(person => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join('')}
    </select>
    <button class="btn small" onclick="addParent('${p.id}')" style="margin-left:0.5rem;">Add</button>
  </div>

  <h3>Spouses</h3>
  <div id="currentSpouses">
    ${(p.spouses || []).filter(exists).map(sid => `
      <span class="pill">${escapeHtml(data.people[sid].name)} <button onclick="removeSpouse('${p.id}', '${sid}')" class="btn small danger" style="margin-left:5px;">x</button></span>
    `).join('') || 'None'}
  </div>
  <div class="field row">
    <label style="flex:1;">Add Spouse</label>
    <select id="spouseSelect" style="flex:2;">
      <option value="">(Select)</option>
      ${Object.values(data.people).filter(person => person.id !== p.id && !(p.spouses || []).includes(person.id)).map(person => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join('')}
    </select>
    <button class="btn small" onclick="addSpouse('${p.id}')" style="margin-left:0.5rem;">Add</button>
  </div>

  <div class="row" style="justify-content:flex-end; margin-top:1rem;">
    <button class="btn secondary" onclick="closeEdit()">Cancel</button>
    <button class="btn" onclick="savePerson('${p.id}', ${isNew})">Save</button>
  </div>`;
  editForm.innerHTML = html;

  // Event listener for photo upload
  const editPhotoUpload = document.getElementById('editPhotoUpload');
  if(editPhotoUpload) { // Check if element exists before attaching listener
    editPhotoUpload.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          _pendingPhotoDataURL = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }
  fillSelects(); // Call this after innerHTML is set up for parents/spouses, it now updates multiple places
}

function closeEdit() {
  const modal = document.getElementById("editModal");
  if (modal) {
    modal.setAttribute("aria-hidden", "true");
    modal.style.display = "none";
  }
  _pendingPhotoDataURL = null; // Clear pending photo on modal close
}


async function uploadPhoto(photoDataURL) {
  try {
    const response = await fetch(`${API_BASE_URL}/upload-photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': localStorage.getItem('adminKey') || '',
      },
      body: JSON.stringify({ dataURL: photoDataURL }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to upload photo: ${errorData.error || response.statusText}`);
    }
    const result = await response.json();
    return result.url;
  } catch (e) {
    console.error("Photo upload error:", e);
    alert("Failed to upload photo: " + e.message);
    return null;
  }
}

async function savePerson(id, isNew) {
  if (!isAdmin) {
    alert("You must be admin to save changes.");
    return;
  }

  const name = document.getElementById("editName").value.trim();
  if (!name) {
    alert("Name is required.");
    return;
  }

  const year = document.getElementById("editYear").value.trim();
  const bio = document.getElementById("editBio").value.trim();
  const gender = document.getElementById("editGender").value;
  const marriedCity = document.getElementById("editMarriedCity").value.trim();
  const deceased = document.getElementById("editDeceased").checked;
  let photo = document.getElementById("editPhotoUrl").value.trim();

  if (_pendingPhotoDataURL) {
    const uploadedPhotoUrl = await uploadPhoto(_pendingPhotoDataURL);
    if (uploadedPhotoUrl) {
      photo = uploadedPhotoUrl;
    } else {
      photo = photo || '';
    }
    _pendingPhotoDataURL = null;
  }

  const p = isNew ? { id: id, parents: [], spouses: [], children: [] } : data.people[id];

  p.name = name;
  p.year = year;
  p.bio = bio;
  p.gender = gender;
  p.marriedCity = marriedCity;
  p.photo = photo;
  p.deceased = deceased;

  if (isNew) {
    data.people[id] = p;
  }
  normalizeData(data);
  await saveData();
  closeEdit(); // Close edit modal
}

async function deletePerson(id) {
  if (!isAdmin) {
    alert("You must be admin to delete.");
    return;
  }
  if (!confirm(`Are you sure you want to delete ${data.people[id].name}? This cannot be undone.`)) {
    return;
  }

  Object.values(data.people).forEach(person => {
    person.parents = (person.parents || []).filter(pid => pid !== id);
    person.spouses = (person.spouses || []).filter(sid => sid !== id);
    person.children = (person.children || []).filter(cid => cid !== id);
  });

  delete data.people[id];
  normalizeData(data);
  await saveData();
  closePerson(); // Close view modal
}

function fillSelects() {
  // Selects for Compare section
  const personASelect = document.getElementById("personA");
  const personBSelect = document.getElementById("personB");
  // Selects for Edit/Add Person modal
  const parentSelect = document.getElementById("parentSelect"); // This will be dynamic in openEdit
  const spouseSelect = document.getElementById("spouseSelect"); // This will be dynamic in openEdit

  [personASelect, personBSelect].forEach(sel => {
    if (sel) sel.innerHTML = '<option value="">(Select)</option>';
  });
  // parentSelect and spouseSelect are handled directly in openEdit as they are within the dynamically loaded form.

  Object.values(data.people).forEach(p => {
    if (personASelect) {
      const optA = document.createElement("option");
      optA.value = p.id;
      optA.textContent = p.name;
      personASelect.appendChild(optA);
    }
    if (personBSelect) {
      const optB = document.createElement("option");
      optB.value = p.id;
      optB.textContent = p.name;
      personBSelect.appendChild(optB);
    }
  });
}

function addParent(childId) {
  const parentSelect = document.getElementById("parentSelect");
  const parentId = parentSelect?.value; // Use optional chaining
  if (parentId && exists(parentId) && childId !== parentId && !(data.people[childId].parents || []).includes(parentId)) {
    data.people[childId].parents.push(parentId);
    openEdit(childId); // Re-render edit form to show new parent
  }
}

function removeParent(childId, parentId) {
  data.people[childId].parents = (data.people[childId].parents || []).filter(pid => pid !== parentId);
  openEdit(childId); // Re-render edit form
}

function addSpouse(personId) {
  const spouseSelect = document.getElementById("spouseSelect");
  const spouseId = spouseSelect?.value; // Use optional chaining
  if (spouseId && exists(spouseId) && personId !== spouseId && !(data.people[personId].spouses || []).includes(spouseId)) {
    data.people[personId].spouses.push(spouseId);
    openEdit(personId); // Re-render edit form to show new spouse
  }
}

function removeSpouse(personId, spouseId) {
  data.people[personId].spouses = (data.people[personId].spouses || []).filter(sid => sid !== spouseId);
  openEdit(personId); // Re-render edit form
}

// --- Relationship Checker ---

function findRelationship(idA, idB) {
  if (!exists(idA) || !exists(idB)) return null;

  const personA = data.people[idA];
  const personB = data.people[idB];

  // Direct parent/child
  if ((personA.parents || []).includes(idB)) return `${personB.name} is parent of ${personA.name}`;
  if ((personA.children || []).includes(idB)) return `${personB.name} is child of ${personA.name}`;

  // Spouses
  if ((personA.spouses || []).includes(idB)) return `${personB.name} is spouse of ${personA.name}`;

  // Siblings (shared parents)
  const parentsA = new Set(personA.parents || []);
  const parentsB = new Set(personB.parents || []);
  for (const p of parentsA) {
    if (parentsB.has(p)) return `${personB.name} is sibling of ${personA.name}`;
  }

  // Grandparent/Grandchild
  for (const parentAId of (personA.parents || [])) {
    if (exists(parentAId)) {
      const grandParents = data.people[parentAId].parents || [];
      if (grandParents.includes(idB)) return `${personB.name} is grandparent of ${personA.name}`;
    }
  }
  for (const childAId of (personA.children || [])) {
    if (exists(childAId)) {
      const grandChildren = data.people[childAId].children || [];
      if (grandChildren.includes(idB)) return `${personB.name} is grandchild of ${personA.name}`;
    }
  }

  // BFS for more complex relationships
  const queue = [{ id: idA, path: [idA] }];
  const visited = new Set();
  visited.add(idA);

  while (queue.length > 0) {
    const { id: currentId, path } = queue.shift();

    const currentPerson = data.people[currentId];
    const neighbors = [
      ...(currentPerson.parents || []),
      ...(currentPerson.children || []),
      ...(currentPerson.spouses || []),
      ...Object.values(data.people).filter(p => (p.spouses || []).includes(currentId)).map(p => p.id), // Inverse spouses
      ...Object.values(data.people).filter(p => (p.parents || []).includes(currentId)).map(p => p.id), // Inverse children
    ].filter(nid => exists(nid));

    for (const neighborId of neighbors) {
      if (neighborId === idB) {
        return `Related through a path: ${path.map(id => data.people[id].name).join(" -> ")} -> ${personB.name}`;
      }
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, path: [...path, neighborId] });
      }
    }
  }

  return null;
}

// --- Admin Login ---

async function checkAdminStatus() {
  const storedKey = localStorage.getItem('adminKey');
  if (storedKey) {
    try {
      const response = await fetch(`${API_BASE_URL}/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: storedKey }),
      });
      const result = await response.json();
      isAdmin = result.success;
      if (!isAdmin) {
        localStorage.removeItem('adminKey');
      }
    } catch (e) {
      console.error("Auto-login check failed:", e);
      isAdmin = false;
      localStorage.removeItem('adminKey');
    }
  }
  renderAdminButtons();
}

function renderAdminButtons() {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const addBtn = document.getElementById("addBtn");
  const cloudSaveBtn = document.getElementById("cloudSaveBtn"); // New ID

  if (loginBtn) loginBtn.style.display = isAdmin ? "none" : "inline-flex";
  if (logoutBtn) logoutBtn.style.display = isAdmin ? "inline-flex" : "none";
  if (addBtn) addBtn.style.display = isAdmin ? "inline-flex" : "none";
  if (cloudSaveBtn) cloudSaveBtn.style.display = isAdmin ? "inline-flex" : "none"; // Only show cloud save if admin

  // Other admin-only elements in the Data Management section
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const dataBox = document.getElementById("dataBox");
  const saveToFileBtn = document.getElementById("saveToFileBtn"); // Assuming local file save is also admin-only
  const loadFromFileBtn = document.getElementById("loadFromFileBtn"); // Assuming local file load is also admin-only

  if (exportBtn) exportBtn.style.display = isAdmin ? "inline-flex" : "none";
  if (importBtn) importBtn.style.display = isAdmin ? "inline-flex" : "none";
  if (dataBox) dataBox.style.display = isAdmin ? "block" : "none";
  if (saveToFileBtn) saveToFileBtn.style.display = isAdmin ? "inline-flex" : "none";
  if (loadFromFileBtn) loadFromFileBtn.style.display = isAdmin ? "inline-flex" : "none";
}

// --- Tab Management ---
function showTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('.tab').forEach(tabBtn => {
    if (tabBtn.dataset.tab === tabId) {
      tabBtn.classList.add('active');
    } else {
      tabBtn.classList.remove('active');
    }
  });
  document.querySelectorAll('section').forEach(section => {
    if (section.id === tabId) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });
  if (tabId === 'tree') renderTree(); // Re-render tree if switching back to it
  if (tabId === 'compare') fillSelects(); // Re-populate selects for compare tab
}


// --- Initial Load and Event Listeners (within DOMContentLoaded) ---

document.addEventListener("DOMContentLoaded", async () => {
  // --- Admin Login/Logout ---
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const addBtn = document.getElementById("addBtn");

  if (loginBtn) {
    loginBtn.addEventListener("click", async function () {
      const password = prompt("Enter admin password:");
      if (!password) return;

      try {
        const response = await fetch(`${API_BASE_URL}/admin-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password }),
        });

        if (response.ok) {
          const result = await response.json();
          isAdmin = result.success;
          if (isAdmin) {
            localStorage.setItem('adminKey', password);
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
      renderAdminButtons();
      renderTree(); // Re-render to show/hide edit buttons on tree
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      isAdmin = false;
      localStorage.removeItem('adminKey');
      alert("Logged out as admin.");
      renderAdminButtons();
      renderTree(); // Re-render to show/hide edit buttons on tree
    });
  }

  // --- Add Person Button ---
  if (addBtn) {
    addBtn.addEventListener("click", () => openEdit(null));
  }

  // --- Search ---
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn"); // New Search button

  if (searchInput) {
    searchInput.addEventListener("input", function (event) {
      const query = event.target.value.toLowerCase();
      const resultsDiv = document.getElementById("searchResults");
      if (!resultsDiv) return;

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
  }

  if (searchBtn) { // Optional: if you want search button to trigger search
      searchBtn.addEventListener("click", () => {
          const searchInput = document.getElementById("searchInput");
          if (searchInput) {
              searchInput.dispatchEvent(new Event('input')); // Trigger input event
          }
      });
  }


  // --- Compare Relationship ---
  const compareBtn = document.getElementById("compareBtn");
  if (compareBtn) {
    compareBtn.addEventListener("click", function () {
      const personAId = document.getElementById("personA").value;
      const personBId = document.getElementById("personB").value;
      const resultDiv = document.getElementById("compareResult");
      if (!resultDiv) return;

      if (!personAId || !personBId || personAId === personBId) {
        resultDiv.textContent = "Please select two different people.";
        return;
      }

      const relation = findRelationship(personAId, personBId);
      resultDiv.textContent = relation || "No direct relationship found.";
    });
  }


  // --- Cloud Data Operations ---
  const cloudLoadBtn = document.getElementById("cloudLoadBtn");
  const cloudSaveBtn = document.getElementById("cloudSaveBtn");

  if (cloudLoadBtn) {
    cloudLoadBtn.addEventListener("click", async () => {
      await loadData(); // Simply calls the existing loadData function
      alert("Data loaded from cloud!");
    });
  }

  if (cloudSaveBtn) {
    cloudSaveBtn.addEventListener("click", async () => {
      await saveData(); // Simply calls the existing saveData function
      alert("Data saved to cloud!");
    });
  }


  // --- Local Data Export/Import (Textarea) ---
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const dataBox = document.getElementById("dataBox");

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      if (!isAdmin) { alert("Admin access required."); return; }
      if (dataBox) dataBox.value = JSON.stringify(data, null, 2);
    });
  }

  if (importBtn) {
    importBtn.addEventListener("click", async () => {
      if (!isAdmin) { alert("Admin access required."); return; }
      if (!dataBox || !dataBox.value) {
        alert("Please paste JSON data into the text area.");
        return;
      }
      try {
        const importedData = JSON.parse(dataBox.value);
        if (importedData && importedData.people) {
          data = importedData;
          normalizeData(data);
          await saveData(); // Save imported data to remote
          alert("Data imported and saved remotely!");
        } else {
          alert("Invalid JSON structure. Expected an object with a 'people' property.");
        }
      } catch (e) {
        console.error("Import error:", e);
        alert("Failed to parse JSON data: " + e.message);
      }
    });
  }


  // --- Local File Operations (File System Access API) ---
  const chooseFileBtn = document.getElementById("chooseFileBtn");
  const saveToFileBtn = document.getElementById("saveToFileBtn");
  const loadFromFileBtn = document.getElementById("loadFromFileBtn");
  const fileInfo = document.getElementById("fileInfo");

  if (chooseFileBtn) {
    chooseFileBtn.addEventListener('click', async () => {
      try {
        [currentFileHandle] = await window.showOpenFilePicker({
          types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
          excludeAcceptAllOption: true,
          multiple: false
        });
        if (fileInfo) fileInfo.textContent = currentFileHandle.name;
        if (saveToFileBtn) saveToFileBtn.disabled = false;
        if (loadFromFileBtn) loadFromFileBtn.disabled = false;
        alert(`File chosen: ${currentFileHandle.name}`);
      } catch (err) {
        console.error('File picker aborted or failed:', err);
        if (fileInfo) fileInfo.textContent = 'No file chosen.';
        if (saveToFileBtn) saveToFileBtn.disabled = true;
        if (loadFromFileBtn) loadFromFileBtn.disabled = true;
        currentFileHandle = null;
      }
    });
  }

  if (saveToFileBtn) {
    saveToFileBtn.addEventListener('click', async () => {
      if (!currentFileHandle) {
        alert("No file chosen. Please choose or create a file first.");
        return;
      }
      try {
        const writable = await currentFileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
        alert(`Data saved to ${currentFileHandle.name}`);
      } catch (err) {
        console.error('Error saving file:', err);
        alert('Failed to save file. Check console for details.');
      }
    });
  }

  if (loadFromFileBtn) {
    loadFromFileBtn.addEventListener('click', async () => {
      if (!currentFileHandle) {
        alert("No file chosen. Please choose a file first.");
        return;
      }
      try {
        const file = await currentFileHandle.getFile();
        const contents = await file.text();
        const loadedData = JSON.parse(contents);
        if (loadedData && loadedData.people) {
          data = loadedData;
          normalizeData(data);
          renderTree();
          fillSelects();
          alert(`Data loaded from ${currentFileHandle.name}`);
        } else {
          alert("Invalid data structure in file.");
        }
      } catch (err) {
        console.error('Error loading file:', err);
        alert('Failed to load file. Check console for details.');
      }
    });
  }

  // --- Tab Logic ---
  document.querySelectorAll('.tab').forEach(button => {
    button.addEventListener('click', () => {
      showTab(button.dataset.tab);
    });
  });

  // --- Initial Setup ---
  await checkAdminStatus(); // Check admin login state
  await loadData(); // Load data from remote on page load
  showTab(activeTab); // Show the initial tab
});
