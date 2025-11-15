// Data structure:
// data = { people: { id: { id, name, year, bio, gender, marriedCity, parents[], spouses[], children[], photo, deceased } } }

let data = { people: {} };
let isAdmin = false;
let _pendingPhotoDataURL = null;
let currentFileHandle = null;

// --- API Endpoints ---
const API_BASE_URL = '/api'; // Assuming your API routes are under /api

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
  // clear children
  Object.values(d.people).forEach(p => {
    p.children = [];
    p.parents = Array.from(new Set(p.parents || [])).filter(id => exists(id, d));
    p.spouses = Array.from(new Set(p.spouses || [])).filter(id => exists(id, d));
  });

  // rebuild children from parents
  Object.values(d.people).forEach(child => {
    (child.parents || []).forEach(pid => {
      if (exists(pid, d)) {
        const parent = d.people[pid];
        parent.children = parent.children || [];
        parent.children.push(child.id);
      }
    });
  });

  // dedupe children and cleanup invalid ids
  Object.values(d.people).forEach(p => {
    p.children = Array.from(new Set(p.children || [])).filter(id => exists(id, d));
  });

  // ensure spouse symmetry
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
        'X-Admin-Key': localStorage.getItem('adminKey') || '', // Send admin key for authorization
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
  container.innerHTML = "";

  const people = Object.values(data.people);
  if (!people.length) {
    container.innerHTML = '<div class="empty-message">No people yet. Log in as admin and add your first person.</div>';
    return;
  }

  // roots = people without parents
  const rawRoots = people.filter(p => !(p.parents && p.parents.length));

  // avoid duplicate spouse-pair roots
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
    // fallback: show everyone flat
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
  card.className = "person";
  card.onclick = () => openPerson(person.id);

  const avatar = document.createElement("div");
  if (person.photo) {
    avatar.className = "avatar";
    avatar.style.backgroundImage = `url(${person.photo})`;
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
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
  secondary.className = "secondary";
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
  }

  return wrapper;
}

// --- Modal (view person) ---

function openPerson(id) {
  if (!exists(id)) return;
  const p = data.people[id];

  const backdrop = document.getElementById("personModalBackdrop");
  const body = document.getElementById("personModalBody");
  backdrop.classList.add("open");
  body.innerHTML = "";

  let html = "";

  if (p.photo) {
    html += `<img src="${p.photo}" alt="${escapeHtml(p.name)}" class="person-photo" />`;
  }

  html += `<h2 class="modal-title${p.deceased ? " name deceased" : ""}">${escapeHtml(p.name || "(Unnamed)")}</h2>`;

  if (p.year) {
    html += `<div class="modal-section"><strong>Year:</strong> ${escapeHtml(p.year)}</div>`;
  }

  if (p.marriedCity) {
    html += `<div class="modal-section"><strong>Married city:</strong> ${escapeHtml(p.marriedCity)}</div>`;
  }

  const parents = (p.parents || []).filter(exists).map(pid => data.people[pid].name);
  if (parents.length) {
    html += `<div class="modal-section"><strong>Parents:</strong> ${parents.map(escapeHtml).join(", ")}</div>`;
  }

  const spouses = (p.spouses || []).filter(exists).map(sid => data.people[sid].name);
  if (spouses.length) {
    html += `<div class="modal-section"><strong>Spouses:</strong> ${spouses.map(escapeHtml).join(", ")}</div>`;
  }

  const kids = (p.children || []).filter(exists).map(cid => data.people[cid].name);
  if (kids.length) {
    html += `<div class="modal-section"><strong>Children:</strong> ${kids.map(escapeHtml).join(", ")}</div>`;
  }

  if (p.bio) {
    html += `<div class="modal-bio">${escapeHtml(p.bio)}</div>`;
  }

  if (isAdmin) {
    html += `<div class="modal-footer">
      <button class="btn small" onclick="editPerson('${id}')">Edit</button>
      <button class="btn small danger" onclick="deletePerson('${id}')">Delete</button>
    </div>`;
  }

  body.innerHTML = html;
}

function closePersonModal() {
  document.getElementById("personModalBackdrop").classList.remove("open");
  _pendingPhotoDataURL = null; // Clear pending photo on modal close
}

// --- Edit / add person ---

function fillSelects() {
  const selA = document.getElementById("relPersonA");
  const selB = document.getElementById("relPersonB");
  const parentSelect = document.getElementById("parentSelect");
  const spouseSelect = document.getElementById("spouseSelect");
  [selA, selB, parentSelect, spouseSelect].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '<option value="">(Select)</option>';
  });

  Object.values(data.people).forEach(p => {
    if (selA && selB) {
      const optA = document.createElement("option");
      optA.value = p.id;
      optA.textContent = p.name;
      selA.appendChild(optA);

      const optB = document.createElement("option");
      optB.value = p.id;
      optB.textContent = p.name;
      selB.appendChild(optB);
    }
    if (parentSelect && spouseSelect) {
      const optP = document.createElement("option");
      optP.value = p.id;
      optP.textContent = p.name;
      parentSelect.appendChild(optP);

      const optS = document.createElement("option");
      optS.value = p.id;
      optS.textContent = p.name;
      spouseSelect.appendChild(optS);
    }
  });
}

function editPerson(id) {
  if (!isAdmin) {
    alert("You must be admin to edit.");
    return;
  }
  const isNew = !id || !exists(id);
  const p = isNew
    ? { id: String(Date.now()), name: "", year: "", bio: "", gender: "", marriedCity: "", parents: [], spouses: [], children: [], photo: "", deceased: false }
    : { ...data.people[id] };

  const backdrop = document.getElementById("personModalBackdrop");
  const body = document.getElementById("personModalBody");
  backdrop.classList.add("open");

  let html = `<h2 class="modal-title">${isNew ? "Add person" : "Edit person"}</h2>`;
  html += `<div class="person-form">
    <label>
      Name
      <input type="text" id="editName" value="${escapeHtml(p.name || "")}" />
    </label>
    <label>
      Year
      <input type="text" id="editYear" value="${escapeHtml(p.year || "")}" />
    </label>
    <label>
      Gender
      <select id="editGender">
        <option value=""></option>
        <option value="male"${p.gender === "male" ? " selected" : ""}>Male</option>
        <option value="female"${p.gender === "female" ? " selected" : ""}>Female</option>
        <option value="other"${p.gender === "other" ? " selected" : ""}>Other</option>
      </select>
    </label>
    <label>
      Married City
      <input type="text" id="editMarriedCity" value="${escapeHtml(p.marriedCity || "")}" />
    </label>
    <label>
      Bio
      <textarea id="editBio">${escapeHtml(p.bio || "")}</textarea>
    </label>

    <label>
      Photo (URL or upload)
      <input type="text" id="editPhotoUrl" value="${escapeHtml(p.photo || "")}" placeholder="Paste image URL or upload below" />
      <input type="file" id="editPhotoUpload" accept="image/*" style="margin-top:0.3rem;" />
      ${p.photo ? `<img src="${p.photo}" style="max-width:100%; max-height:100px; object-fit:cover; margin-top:0.5rem; border-radius:0.5rem;" />` : ''}
    </label>

    <div class="checkbox-row">
      <input type="checkbox" id="editDeceased" ${p.deceased ? "checked" : ""} />
      <label for="editDeceased">Deceased</label>
    </div>

    <h3>Parents</h3>
    <div id="currentParents">
      ${(p.parents || []).filter(exists).map(pid => `
        <span class="pill">${escapeHtml(data.people[pid].name)} <button onclick="removeParent('${p.id}', '${pid}')" class="btn small danger" style="margin-left:5px;">x</button></span>
      `).join('') || 'None'}
    </div>
    <label>
      Add Parent
      <select id="parentSelect">
        <option value="">(Select)</option>
        ${Object.values(data.people).filter(person => person.id !== p.id && !(p.parents || []).includes(person.id)).map(person => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join('')}
      </select>
      <button class="btn small" onclick="addParent('${p.id}')" style="margin-top:0.3rem;">Add</button>
    </label>

    <h3>Spouses</h3>
    <div id="currentSpouses">
      ${(p.spouses || []).filter(exists).map(sid => `
        <span class="pill">${escapeHtml(data.people[sid].name)} <button onclick="removeSpouse('${p.id}', '${sid}')" class="btn small danger" style="margin-left:5px;">x</button></span>
      `).join('') || 'None'}
    </div>
    <label>
      Add Spouse
      <select id="spouseSelect">
        <option value="">(Select)</option>
        ${Object.values(data.people).filter(person => person.id !== p.id && !(p.spouses || []).includes(person.id)).map(person => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join('')}
      </select>
      <button class="btn small" onclick="addSpouse('${p.id}')" style="margin-top:0.3rem;">Add</button>
    </label>

    <div class="modal-footer">
      <button class="btn secondary" onclick="closePersonModal()">Cancel</button>
      <button class="btn primary" onclick="savePerson('${p.id}', ${isNew})">Save</button>
    </div>
  </div>`;
  body.innerHTML = html;

  fillSelects(); // Call this after innerHTML is set up for parents/spouses

  // Event listener for photo upload
  document.getElementById('editPhotoUpload').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        _pendingPhotoDataURL = e.target.result; // Store Data URL temporarily
        // Optionally, display a preview
        // document.getElementById('editPhotoUrl').value = 'PENDING UPLOAD...';
      };
      reader.readAsDataURL(file);
    }
  });
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
    return result.url; // Return the URL of the uploaded photo
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

  // If a new photo was uploaded, upload it to Blob storage
  if (_pendingPhotoDataURL) {
    const uploadedPhotoUrl = await uploadPhoto(_pendingPhotoDataURL);
    if (uploadedPhotoUrl) {
      photo = uploadedPhotoUrl;
    } else {
      // If upload failed, revert to existing photo or clear
      photo = photo || ''; // keep existing URL if there was one, else clear
    }
    _pendingPhotoDataURL = null; // Clear after attempt
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
  normalizeData(data); // Re-normalize after changes
  await saveData(); // Save to remote
  closePersonModal();
}

async function deletePerson(id) {
  if (!isAdmin) {
    alert("You must be admin to delete.");
    return;
  }
  if (!confirm(`Are you sure you want to delete ${data.people[id].name}? This cannot be undone.`)) {
    return;
  }

  // Remove person from all relationships
  Object.values(data.people).forEach(person => {
    person.parents = (person.parents || []).filter(pid => pid !== id);
    person.spouses = (person.spouses || []).filter(sid => sid !== id);
    person.children = (person.children || []).filter(cid => cid !== id);
  });

  delete data.people[id];
  normalizeData(data); // Re-normalize after deletion
  await saveData(); // Save to remote
  closePersonModal();
}

function addParent(childId) {
  const parentSelect = document.getElementById("parentSelect");
  const parentId = parentSelect.value;
  if (parentId && exists(parentId) && childId !== parentId && !(data.people[childId].parents || []).includes(parentId)) {
    data.people[childId].parents.push(parentId);
    editPerson(childId); // Re-render edit form to show new parent
  }
}

function removeParent(childId, parentId) {
  data.people[childId].parents = (data.people[childId].parents || []).filter(pid => pid !== parentId);
  editPerson(childId); // Re-render edit form
}

function addSpouse(personId) {
  const spouseSelect = document.getElementById("spouseSelect");
  const spouseId = spouseSelect.value;
  if (spouseId && exists(spouseId) && personId !== spouseId && !(data.people[personId].spouses || []).includes(spouseId)) {
    data.people[personId].spouses.push(spouseId);
    editPerson(personId); // Re-render edit form to show new spouse
  }
}

function removeSpouse(personId, spouseId) {
  data.people[personId].spouses = (data.people[personId].spouses || []).filter(sid => sid !== spouseId);
  editPerson(personId); // Re-render edit form
}


// --- Search ---

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

// --- Relationship Checker ---

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

  // Aunts/Uncles/Nephews/Nieces (children of siblings of parents)
  for (const parentAId of (personA.parents || [])) { // Iterate through A's parents
    if (exists(parentAId)) {
      const siblingsOfParentA = (data.people[parentAId].children || [])
        .filter(id => id !== parentAId && id !== idA && exists(id)); // Siblings of A's parent
      for (const siblingOfParentAId of siblingsOfParentA) {
        if (siblingOfParentAId === idB) return `${personB.name} is aunt/uncle of ${personA.name}`;
        if ((data.people[siblingOfParentAId].children || []).includes(idB)) return `${personB.name} is cousin of ${personA.name}`;
      }
    }
  }
  for (const parentBId of (personB.parents || [])) { // Iterate through B's parents
    if (exists(parentBId)) {
      const siblingsOfParentB = (data.people[parentBId].children || [])
        .filter(id => id !== parentBId && id !== idB && exists(id)); // Siblings of B's parent
      for (const siblingOfParentBId of siblingsOfParentB) {
        if (siblingOfParentBId === idA) return `${personA.name} is aunt/uncle of ${personB.name}`;
        if ((data.people[siblingOfParentBId].children || []).includes(idA)) return `${personA.name} is cousin of ${personB.name}`;
      }
    }
  }

  // Cousins (children of siblings of parents)
  // This is a simplified check, a full cousin checker would be more complex.
  // We already handle a simple case above.

  // Breadth-First Search (BFS) for more complex relationships
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
        // Found a path
        return `Related through a path: ${path.map(id => data.people[id].name).join(" -> ")} -> ${personB.name}`;
      }
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, path: [...path, neighborId] });
      }
    }
  }


  return null; // No relationship found
}


// --- Admin Login ---

document.getElementById("adminLoginBtn").addEventListener("click", async function () {
  if (isAdmin) {
    isAdmin = false;
    localStorage.removeItem('adminKey'); // Clear stored key
    this.textContent = "Login";
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
          localStorage.setItem('adminKey', password); // Store the key (password) for subsequent requests
          this.textContent = "Logout";
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

function renderAdminButtons() {
  document.getElementById("addPersonBtn").style.display = isAdmin ? "inline-flex" : "none";
  document.getElementById("exportBtn").style.display = isAdmin ? "inline-flex" : "none";
  document.getElementById("importBtn").style.display = isAdmin ? "inline-flex" : "none";
  document.getElementById("jsonExport").style.display = isAdmin ? "block" : "none";

  const adminLoginBtn = document.getElementById("adminLoginBtn");
  if (adminLoginBtn) {
    adminLoginBtn.textContent = isAdmin ? "Logout" : "Login";
  }
}

// Check initial admin status on load (if key is stored)
async function checkAdminStatus() {
  const storedKey = localStorage.getItem('adminKey');
  if (storedKey) {
    try {
      const response = await fetch(`${API_BASE_URL}/admin-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: storedKey }),
      });
      const result = await response.json();
      isAdmin = result.success;
      if (!isAdmin) {
        localStorage.removeItem('adminKey'); // Stored key is no longer valid
      }
    } catch (e) {
      console.error("Auto-login check failed:", e);
      isAdmin = false;
      localStorage.removeItem('adminKey');
    }
  }
  renderAdminButtons();
}


// --- Data Export/Import ---

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


// --- Local File Operations (Optional, can keep or remove if not needed) ---
// Note: These will still save/load locally, not to Blob storage.
// If you want to integrate with Blob, you'd need separate APIs for listing/downloading/uploading files to Blob
// and modify these functions to use those APIs. For now, they remain local file system only.

document.getElementById('chooseFileBtn').addEventListener('click', async () => {
  try {
    [currentFileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
      excludeAcceptAllOption: true,
      multiple: false
    });
    document.getElementById('fileInfo').textContent = currentFileHandle.name;
    alert(`File chosen: ${currentFileHandle.name}`);
  } catch (err) {
    console.error('File picker aborted or failed:', err);
    document.getElementById('fileInfo').textContent = 'No file chosen.';
    currentFileHandle = null;
  }
});

document.getElementById('saveToFileBtn').addEventListener('click', async () => {
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

document.getElementById('loadFromFileBtn').addEventListener('click', async () => {
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

// --- Initial Load ---

document.addEventListener("DOMContentLoaded", async () => {
  await checkAdminStatus(); // Check admin login state first
  await loadData(); // Load data from remote on page load
});

document.getElementById("addPersonBtn").addEventListener("click", () => editPerson(null));
