// Data structure:
// data = { people: { id: { id, name, birthYear, deathYear, bio, gender, marriedCity, parents[], spouses[], children[], photo, deceased } } }

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
    p.children = []; // Reset children, will be rebuilt
    p.parents = Array.from(new Set(p.parents || [])).filter(id => exists(id, d));
    p.spouses = Array.from(new Set(p.spouses || [])).filter(id => exists(id, d));
  });

  // Build children array from parents
  Object.values(d.people).forEach(child => {
    (child.parents || []).forEach(pid => {
      if (exists(pid, d)) {
        const parent = d.people[pid];
        parent.children = parent.children || [];
        if (!parent.children.includes(child.id)) { // Prevent duplicates
          parent.children.push(child.id);
        }
      }
    });
  });

  // Ensure children arrays are unique and contain existing people
  Object.values(d.people).forEach(p => {
    p.children = Array.from(new Set(p.children || [])).filter(id => exists(id, d));
  });

  // Ensure spouses relationship is reciprocal
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
    const response = await fetch(`${API_BASE_URL}/load`);
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
    renderNamesList(); // Also render the names list
  }
}

async function saveData() {
  if (!isAdmin) {
    alert("You must be logged in as an administrator to save changes.");
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/save`, {
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
    renderNamesList(); // Re-render the names list
  }
}

// --- Tree rendering ---

function renderTree() {
  const container = document.getElementById("treeContainer");
  if (!container) return;

  container.innerHTML = "";

  const people = Object.values(data.people);
  if (!people.length) {
    container.innerHTML = '<div class="empty-message">No people yet. Log in as admin and add your first person.</div>';
    return;
  }

  // Determine root nodes based on who has no parents and has children or spouses
  const roots = people.filter(p => !(p.parents && p.parents.length));

  // Build a set of IDs that have already been rendered as part of another person's node (e.g., female spouses)
  const renderedIDs = new Set();

  // Iterate over roots, prioritizing males for main branches, then females
  const sortedRoots = roots.sort((a, b) => {
    if (a.gender === 'male' && b.gender !== 'male') return -1;
    if (a.gender !== 'male' && b.gender === 'male') return 1;
    return 0;
  });

  sortedRoots.forEach(r => {
    if (renderedIDs.has(r.id)) return; // Skip if already rendered as a spouse

    // If a male root, render him and his spouse(s) below him
    if (r.gender === 'male') {
      container.appendChild(buildNode(r, renderedIDs));
    } else {
      // If a female root and not a spouse of a male root, render her as a normal root
      const isSpouseOfRootMale = r.spouses.some(sId => exists(sId) && !data.people[sId].parents.length && data.people[sId].gender === 'male');
      if (!isSpouseOfRootMale) {
        container.appendChild(buildNode(r, renderedIDs));
      }
    }
  });

  // Handle people who are not roots, but also not children of any rendered person
  // This is a fallback for disconnected graphs, could be orphans or other misconfigurations
  const allRenderedIDs = new Set();
  const getChildrenRecursive = (personId) => {
    if (allRenderedIDs.has(personId)) return;
    allRenderedIDs.add(personId);
    data.people[personId]?.spouses.forEach(spouseId => allRenderedIDs.add(spouseId)); // Also mark spouses as rendered
    data.people[personId]?.children.forEach(childId => getChildrenRecursive(childId));
  };

  sortedRoots.forEach(r => getChildrenRecursive(r.id));

  // Add any remaining unrendered people as simple cards at the end (as a fallback)
  const unrenderedPeople = people.filter(p => !allRenderedIDs.has(p.id));
  if (unrenderedPeople.length > 0) {
    const disconnectedWrapper = document.createElement("div");
    disconnectedWrapper.className = "node disconnected-group";
    disconnectedWrapper.innerHTML = '<h3>Disconnected individuals:</h3>';
    unrenderedPeople.forEach(p => {
      const card = document.createElement("div");
      card.className = `person ${p.gender || ''}`;
      card.onclick = () => openPerson(p.id);
      card.innerHTML = `
        <div class="avatar initials">${getInitials(p.name)}</div>
        <div class="name">${escapeHtml(p.name)}</div>
      `;
      disconnectedWrapper.appendChild(card);
    });
    container.appendChild(disconnectedWrapper);
  }
}


function buildNode(person, renderedIDs = new Set()) {
  renderedIDs.add(person.id); // Mark this person as rendered

  const wrapper = document.createElement("div");
  wrapper.className = "node";

  const card = document.createElement("div");
  card.className = `person ${person.gender || ''}`;
  card.onclick = () => openPerson(person.id);

  const genderChip = document.createElement('div');
  genderChip.className = 'gender-chip';
  genderChip.textContent = person.gender ? person.gender[0].toUpperCase() : '';
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
  secondary.className = "subname";

  let lifeSpan = "";
  if (person.deceased) {
    if (person.birthYear && person.deathYear) {
      lifeSpan = `${person.birthYear}-${person.deathYear}`;
    } else if (person.birthYear) {
      lifeSpan = `b. ${person.birthYear}`;
    } else if (person.deathYear) {
      lifeSpan = `d. ${person.deathYear}`;
    }
  } else if (person.birthYear) {
    lifeSpan = `b. ${person.birthYear}`;
  }

  if (lifeSpan) {
    secondary.textContent = lifeSpan;
  } else if (person.year) { // Fallback to old 'year' field if no specific birth/death years
    secondary.textContent = String(person.year);
  }

  info.appendChild(nameEl);
  if (secondary.textContent) info.appendChild(secondary);

  // Spouses listed directly under the main person (NEW LOGIC)
  const spousesToDisplay = (person.spouses || []).filter(sId => exists(sId) && !renderedIDs.has(sId));
  if (spousesToDisplay.length > 0) {
    const spouseListDiv = document.createElement('div');
    spouseListDiv.className = 'spouse-list';
    spousesToDisplay.forEach(sId => {
      const spouse = data.people[sId];
      if (spouse) {
        const spouseNameEl = document.createElement('span');
        spouseNameEl.className = `spouse-name ${spouse.deceased ? 'deceased' : ''}`;
        spouseNameEl.textContent = `Married to ${spouse.name}`;
        spouseNameEl.onclick = (e) => {
          e.stopPropagation(); // Prevent opening the main person's profile
          openPerson(spouse.id);
        };
        spouseListDiv.appendChild(spouseNameEl);
        renderedIDs.add(spouse.id); // Mark spouse as rendered
      }
    });
    info.appendChild(spouseListDiv);
  }


  card.appendChild(avatar);
  card.appendChild(info);
  wrapper.appendChild(card);

  const childrenIds = person.children || [];
  if (childrenIds.length) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "children";
    childrenIds.forEach(cid => {
      if (!exists(cid) || renderedIDs.has(cid)) return; // Don't re-render if already part of another node's output
      childrenContainer.appendChild(buildNode(data.people[cid], renderedIDs));
    });
    wrapper.appendChild(childrenContainer);
  } else {
    wrapper.classList.add('no-children');
  }

  return wrapper;
}


// --- Modals ---

// For viewing person details (GENERIC PROFILE PAGE)
function openPerson(id) {
  if (!exists(id)) return;
  const p = data.people[id];

  const modal = document.getElementById("personModal");
  const detailsDiv = document.getElementById("personDetails");
  if (!modal || !detailsDiv) return;

  modal.setAttribute("aria-hidden", "false");
  modal.style.display = "flex"; // Changed to flex for centering
  modal.style.alignItems = "center"; // Center vertically
  modal.style.justifyContent = "center"; // Center horizontally

  let html = "";
  if (p.photo) {
    html += `<img src="${p.photo}" alt="${escapeHtml(p.name)}" class="profile-photo" />`;
  } else {
    html += `<div class="avatar initials profile-photo">${getInitials(p.name)}</div>`;
  }
  html += `<h2 class="modal-title${p.deceased ? " name deceased" : ""}">${escapeHtml(p.name || "(Unnamed)")}</h2>`;

  let lifeSpan = "";
  if (p.birthYear || p.deathYear) {
    lifeSpan = `${p.birthYear || '?'} - ${p.deceased ? (p.deathYear || '?') : 'Present'}`;
  }
  if (lifeSpan) html += `<p class="life-span">${lifeSpan}</p>`;

  if (p.gender) html += `<p><strong>Gender:</strong> ${escapeHtml(p.gender)}</p>`;
  if (p.marriedCity) html += `<p><strong>Married in:</strong> ${escapeHtml(p.marriedCity)}</p>`;
  if (p.year && !p.birthYear && !p.deathYear) html += `<p><strong>Significant Year:</strong> ${escapeHtml(p.year)}</p>`;

  const parents = (p.parents || []).filter(exists).map(pid => `<span class="relations-list" onclick="openPerson('${pid}')">${escapeHtml(data.people[pid].name)}</span>`);
  if (parents.length) html += `<p><strong>Parents:</strong> ${parents.join(", ")}</p>`;

  const spouses = (p.spouses || []).filter(exists).map(sid => `<span class="relations-list ${data.people[sid].deceased ? 'deceased' : ''}" onclick="openPerson('${sid}')">${escapeHtml(data.people[sid].name)}</span>`);
  if (spouses.length) html += `<p><strong>Spouses:</strong> ${spouses.join(", ")}</p>`;

  const kids = (p.children || []).filter(exists).map(cid => `<span class="relations-list" onclick="openPerson('${cid}')">${escapeHtml(data.people[cid].name)}</span>`);
  if (kids.length) html += `<p><strong>Children:</strong> ${kids.join(", ")}</p>`;

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
    modal.style.display = "none";
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
    ? { id: String(Date.now()), name: "", birthYear: "", deathYear: "", bio: "", gender: "", marriedCity: "", parents: [], spouses: [], children: [], photo: "", deceased: false }
    : { ...data.people[id] };

  const editModal = document.getElementById("editModal");
  const editTitle = document.getElementById("editTitle");
  const editForm = document.getElementById("editForm");
  if (!editModal || !editTitle || !editForm) return;

  editTitle.textContent = isNew ? "Add Person" : `Edit ${p.name || "(Unnamed)"}`;
  editModal.setAttribute("aria-hidden", "false");
  editModal.style.display = "flex"; // Changed to flex for centering
  editModal.style.alignItems = "center";
  editModal.style.justifyContent = "center";

  let html = `<div class="field">
    <label>Name</label>
    <input type="text" id="editName" value="${escapeHtml(p.name || "")}" />
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
    <label>Birth Year</label>
    <input type="text" id="editBirthYear" value="${escapeHtml(p.birthYear || "")}" placeholder="e.g., 1980" />
  </div>
  <div class="field row" style="align-items: center;">
    <input type="checkbox" id="editDeceased" ${p.deceased ? "checked" : ""} style="width: auto; margin-right: 0.5rem;" />
    <label for="editDeceased" style="margin-bottom:0; flex-grow: 1;">Deceased</label>
  </div>
  <div class="field">
    <label>Death Year</label>
    <input type="text" id="editDeathYear" value="${escapeHtml(p.deathYear || "")}" placeholder="e.g., 2023" ${p.deceased ? '' : 'disabled'} />
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

  <h3>Parents</h3>
  <div id="currentParents">
    ${(p.parents || []).filter(exists).map(pid => `
      <span class="pill">${escapeHtml(data.people[pid].name)} <button onclick="removeParent('${p.id}', '${pid}')" class="btn small danger" style="margin-left:5px;">x</button></span>
    `).join('') || 'None'}
  </div>
  <div class="field row" style="position:relative;">
    <label style="flex:1;">Add Parent</label>
    <input type="text" id="parentSearchInput" placeholder="Search and select parent..." style="flex:2;" />
    <div id="parentSuggestions" class="autocomplete-suggestions"></div>
  </div>

  <h3>Spouses</h3>
  <div id="currentSpouses">
    ${(p.spouses || []).filter(exists).map(sid => `
      <span class="pill">${escapeHtml(data.people[sid].name)} <button onclick="removeSpouse('${p.id}', '${sid}')" class="btn small danger" style="margin-left:5px;">x</button></span>
    `).join('') || 'None'}
  </div>
  <div class="field row" style="position:relative;">
    <label style="flex:1;">Add Spouse</label>
    <input type="text" id="spouseSearchInput" placeholder="Search and select spouse..." style="flex:2;" />
    <div id="spouseSuggestions" class="autocomplete-suggestions"></div>
  </div>

  <div class="row" style="justify-content:flex-end; margin-top:1rem;">
    <button class="btn secondary" onclick="closeEdit()">Cancel</button>
    <button class="btn" onclick="savePerson('${p.id}', ${isNew})">Save</button>
  </div>`;
  editForm.innerHTML = html;

  // Event listeners for deceased checkbox and photo upload
  document.getElementById('editDeceased').addEventListener('change', function() {
    document.getElementById('editDeathYear').disabled = !this.checked;
    if (!this.checked) document.getElementById('editDeathYear').value = '';
  });

  const editPhotoUpload = document.getElementById('editPhotoUpload');
  if(editPhotoUpload) {
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

  // Autocomplete setup for Parents and Spouses
  setupAutocomplete('parentSearchInput', 'parentSuggestions', (selectedId) => addParent(p.id, selectedId));
  setupAutocomplete('spouseSearchInput', 'spouseSuggestions', (selectedId) => addSpouse(p.id, selectedId));
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

  const birthYear = document.getElementById("editBirthYear").value.trim();
  const deathYear = document.getElementById("editDeathYear").value.trim();
  const bio = document.getElementById("editBio").value.trim();
  const gender = document.getElementById("editGender").value;
  const marriedCity = document.getElementById("editMarriedCity").value.trim();
  const deceased = document.getElementById("editDeceased").checked;
  let photo = document.getElementById("editPhotoUrl").value.trim();

  // Validate years if provided
  if (birthYear && !/^\d{4}$/.test(birthYear)) {
    alert("Birth year must be a 4-digit number.");
    return;
  }
  if (deceased && deathYear && !/^\d{4}$/.test(deathYear)) {
    alert("Death year must be a 4-digit number.");
    return;
  }
  if (birthYear && deathYear && parseInt(birthYear) > parseInt(deathYear)) {
    alert("Birth year cannot be after death year.");
    return;
  }

  if (_pendingPhotoDataURL) {
    const uploadedPhotoUrl = await uploadPhoto(_pendingPhotoDataURL);
    if (uploadedPhotoUrl) {
      photo = uploadedPhotoUrl;
    } else {
      photo = photo || ''; // Fallback to existing photo URL or empty
    }
    _pendingPhotoDataURL = null;
  }

  const p = isNew ? { id: id, parents: [], spouses: [], children: [] } : data.people[id];

  p.name = name;
  p.birthYear = birthYear;
  p.deathYear = deceased ? deathYear : ''; // Clear deathYear if not deceased
  p.bio = bio;
  p.gender = gender;
  p.marriedCity = marriedCity;
  p.photo = photo;
  p.deceased = deceased;
  // Old `year` field removed, rely on birth/deathYear

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

  [personASelect, personBSelect].forEach(sel => {
    if (sel) sel.innerHTML = '<option value="">(Select)</option>';
  });

  Object.values(data.people).sort((a,b) => a.name.localeCompare(b.name)).forEach(p => {
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

function addParent(childId, parentId) {
  if (parentId && exists(parentId) && childId !== parentId && !(data.people[childId].parents || []).includes(parentId)) {
    data.people[childId].parents.push(parentId);
    openEdit(childId); // Re-render edit form to show new parent
  }
}

function removeParent(childId, parentId) {
  data.people[childId].parents = (data.people[childId].parents || []).filter(pid => pid !== parentId);
  openEdit(childId); // Re-render edit form
}

function addSpouse(personId, spouseId) {
  if (spouseId && exists(spouseId) && personId !== spouseId && !(data.people[personId].spouses || []).includes(spouseId)) {
    data.people[personId].spouses.push(spouseId);
    openEdit(personId); // Re-render edit form to show new spouse
  }
}

function removeSpouse(personId, spouseId) {
  data.people[personId].spouses = (data.people[personId].spouses || []).filter(sid => sid !== spouseId);
  openEdit(personId); // Re-render edit form
}

// --- Autocomplete (NEW) ---
function setupAutocomplete(inputId, suggestionsId, onSelectCallback) {
  const input = document.getElementById(inputId);
  const suggestionsDiv = document.getElementById(suggestionsId);
  if (!input || !suggestionsDiv) return;

  let currentFocus = -1;

  const filterSuggestions = (query) => {
    suggestionsDiv.innerHTML = '';
    currentFocus = -1;
    if (!query) return;

    const matches = Object.values(data.people).filter(p =>
      p.name.toLowerCase().includes(query.toLowerCase())
    ).sort((a,b) => a.name.localeCompare(b.name));

    matches.forEach((p, index) => {
      const div = document.createElement('div');
      div.textContent = p.name;
      div.dataset.id = p.id;
      div.addEventListener('click', () => {
        input.value = p.name;
        suggestionsDiv.innerHTML = '';
        onSelectCallback(p.id);
      });
      suggestionsDiv.appendChild(div);
    });

    if (matches.length === 0) {
      suggestionsDiv.innerHTML = '<div>No matches</div>';
    }
  };

  input.addEventListener('input', (e) => filterSuggestions(e.target.value));

  input.addEventListener('keydown', (e) => {
    let items = suggestionsDiv.getElementsByTagName('div');
    if (e.keyCode === 40) { // Down arrow
      currentFocus++;
      addActive(items);
    } else if (e.keyCode === 38) { // Up arrow
      currentFocus--;
      addActive(items);
    } else if (e.keyCode === 13) { // Enter key
      e.preventDefault();
      if (currentFocus > -1) {
        if (items[currentFocus]) items[currentFocus].click();
      }
    }
  });

  function addActive(items) {
    if (!items) return false;
    removeActive(items);
    if (currentFocus >= items.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = (items.length - 1);
    items[currentFocus].classList.add("selected");
    items[currentFocus].scrollIntoView({ block: 'nearest' });
  }

  function removeActive(items) {
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove("selected");
    }
  }

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#${suggestionsId}`) && e.target !== input) {
      suggestionsDiv.innerHTML = '';
    }
  });
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

  return "No direct relationship found.";
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
  const cloudSaveBtn = document.getElementById("cloudSaveBtn");
  const dataManagementCard = document.getElementById("dataManagementCard"); // New element

  if (loginBtn) loginBtn.style.display = isAdmin ? "none" : "inline-flex";
  if (logoutBtn) logoutBtn.style.display = isAdmin ? "inline-flex" : "none";
  if (addBtn) addBtn.style.display = isAdmin ? "inline-flex" : "none";
  if (cloudSaveBtn) cloudSaveBtn.style.display = isAdmin ? "inline-flex" : "none";

  // Hide/show entire Data Management card
  if (dataManagementCard) {
    dataManagementCard.style.display = isAdmin ? "block" : "none";
  }
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
  if (tabId === 'tree') renderTree();
  if (tabId === 'compare') fillSelects();
  if (tabId === 'list') renderNamesList(); // Render list when switching to it
}

// --- Names List (NEW) ---
function renderNamesList() {
  const container = document.getElementById('namesListContainer');
  const searchInput = document.getElementById('listSearchInput');
  const searchResultsDiv = document.getElementById('listSearchResults');

  if (!container || !searchInput || !searchResultsDiv) return;

  const people = Object.values(data.people).sort((a,b) => a.name.localeCompare(b.name));

  const displayList = (filterQuery = '') => {
    container.innerHTML = '';
    searchResultsDiv.innerHTML = '';

    const filteredPeople = people.filter(p =>
      (p.name || '').toLowerCase().includes(filterQuery.toLowerCase())
    );

    if (filteredPeople.length === 0 && filterQuery) {
      searchResultsDiv.innerHTML = '<div class="hint">No matches found.</div>';
      return;
    }

    filteredPeople.forEach(p => {
      const card = document.createElement('div');
      card.className = 'list-person-card';
      card.onclick = () => openPerson(p.id);

      let lifeSpan = "";
      if (p.birthYear || p.deathYear) {
        lifeSpan = `${p.birthYear || '?'} - ${p.deceased ? (p.deathYear || '?') : 'Present'}`;
      }

      card.innerHTML = `
        <div class="name ${p.deceased ? 'deceased' : ''}">${escapeHtml(p.name)}</div>
        ${lifeSpan ? `<div class="subname">${lifeSpan}</div>` : ''}
      `;
      container.appendChild(card);
    });
  };

  searchInput.removeEventListener('input', searchInput._listSearchHandler); // Remove old handler
  searchInput._listSearchHandler = (event) => displayList(event.target.value);
  searchInput.addEventListener('input', searchInput._listSearchHandler);

  displayList(); // Initial render of the full list
}


// --- Draggable Tree (NEW) ---
function setupTreeDragging() {
  const treeWrapper = document.getElementById('treeWrapper');
  if (!treeWrapper) return;

  let isDragging = false;
  let startX;
  let scrollLeft;

  treeWrapper.addEventListener('mousedown', (e) => {
    isDragging = true;
    treeWrapper.classList.add('grabbing');
    startX = e.pageX - treeWrapper.offsetLeft;
    scrollLeft = treeWrapper.scrollLeft;
    e.preventDefault(); // Prevent text selection
  });

  treeWrapper.addEventListener('mouseleave', () => {
    isDragging = false;
    treeWrapper.classList.remove('grabbing');
  });

  treeWrapper.addEventListener('mouseup', () => {
    isDragging = false;
    treeWrapper.classList.remove('grabbing');
  });

  treeWrapper.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - treeWrapper.offsetLeft;
    const walk = (x - startX) * 1.5; // Adjust scroll speed
    treeWrapper.scrollLeft = scrollLeft - walk;
  });
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
      renderNamesList(); // Re-render names list to update admin features
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      isAdmin = false;
      localStorage.removeItem('adminKey');
      alert("Logged out as admin.");
      renderAdminButtons();
      renderTree(); // Re-render to show/hide edit buttons on tree
      renderNamesList(); // Re-render names list to update admin features
    });
  }

  // --- Add Person Button ---
  if (addBtn) {
    addBtn.addEventListener("click", () => openEdit(null));
  }

  // --- Global Search ---
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");

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
      ).sort((a,b) => a.name.localeCompare(b.name));

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

  if (searchBtn) {
      searchBtn.addEventListener("click", () => {
          const searchInput = document.getElementById("searchInput");
          if (searchInput) {
              searchInput.dispatchEvent(new Event('input'));
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
      await loadData();
      alert("Data loaded from cloud!");
    });
  }

  if (cloudSaveBtn) {
    cloudSaveBtn.addEventListener("click", async () => {
      await saveData();
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
          renderNamesList();
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
  setupTreeDragging(); // Setup draggable tree
  showTab(activeTab); // Show the initial tab
});
