/** ===== Utils & Normalization ===== */
const dedupe = arr => Array.from(new Set(arr || []));
const exists = (id, data) => !!data.people[id];
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function initials(name){ return name.split(' ').filter(Boolean).map(s=>s[0]).join('').toUpperCase(); }

function normalizeData(data) {
  // 1) clear and rebuild children from parents
  Object.values(data.people).forEach(p => { p.children = []; });
  Object.values(data.people).forEach(child => {
    (child.parents || []).forEach(pid => {
      if (exists(pid, data)) {
        const par = data.people[pid];
        par.children = dedupe([...(par.children || []), child.id]);
      }
    });
  });
  // 2) spouse symmetry
  Object.values(data.people).forEach(p => { p.spouses = dedupe(p.spouses || []); });
  Object.values(data.people).forEach(p => {
    (p.spouses || []).forEach(sid => {
      if (exists(sid, data)) {
        const s = data.people[sid];
        s.spouses = dedupe([...(s.spouses || []), p.id]);
      }
    });
  });
  // 3) hygiene
  Object.values(data.people).forEach(p => {
    p.gender = p.gender || "";          // "male" | "female" | ""
    p.marriedCity = p.marriedCity || ""; // shown if female
    p.parents  = dedupe((p.parents  || []).filter(id => exists(id, data)));
    p.children = dedupe((p.children || []).filter(id => exists(id, data)));
    p.spouses  = dedupe((p.spouses  || []).filter(id => exists(id, data)));
  });
  return data;
}

/** ===== Seed / Storage ===== */
let data = JSON.parse(localStorage.getItem('familyData') || 'null');
if (!data) {
  data = {
    people: {
      a:{id:'a',name:'John Alder',year:'1945',bio:'Patriarch; loved carpentry and chess.',deceased:true, gender:'male',   marriedCity:'',      parents:[],spouses:['b']},
      b:{id:'b',name:'Mary Alder',year:'1947',bio:'Matriarch; avid gardener.',         deceased:false,gender:'female', marriedCity:'Portland',parents:[],spouses:['a']},
      c:{id:'c',name:'Robert Alder',year:'1972',bio:'Software engineer.',              deceased:false,gender:'male',   marriedCity:'',      parents:['a','b'],spouses:['e']},
      d:{id:'d',name:'Laura Alder',year:'1975',bio:'Teacher and runner.',              deceased:false,gender:'female', marriedCity:'Denver', parents:['a','b'],spouses:[]},
      e:{id:'e',name:'Sofia Cruz', year:'1974',bio:'Architect.',                       deceased:false,gender:'female', marriedCity:'Seattle',parents:[],spouses:['c']},
      f:{id:'f',name:'Mia Alder',  year:'2002',bio:'Student of biology.',              deceased:false,gender:'female', marriedCity:'',      parents:['c','e'],spouses:[]},
      g:{id:'g',name:'Leo Alder',  year:'2006',bio:'Loves music and football.',        deceased:false,gender:'male',   marriedCity:'',      parents:['c','e'],spouses:[]}
    }
  };
}
data = normalizeData(data);
saveData(); // renders + fills selects
let isAdmin=false;

function saveData(){
  localStorage.setItem('familyData', JSON.stringify(data));
  renderTree();
  fillSelects();
}

/** ===== Tree Rendering ===== */
function renderTree(){
  // unique spouse-pairs at root
  const rawRoots = Object.values(data.people).filter(p => !(p.parents && p.parents.length));
  const seenPairs = new Set(), roots=[];
  for(const r of rawRoots){
    const s = (r.spouses||[]).find(id => exists(id, data) && !(data.people[id].parents||[]).length);
    if(s){
      const key=[r.id,s].sort().join('|');
      if(seenPairs.has(key)) continue;
      seenPairs.add(key);
    }
    roots.push(r);
  }

  const container=document.getElementById('treeContainer');
  container.innerHTML='';
  roots.forEach(r=>container.appendChild(buildNode(r)));
}

function buildNode(person){
  const wrap=document.createElement('div');
  wrap.className='node';

  const card=document.createElement('div');
  card.className='person';

  const spouseName = (person.spouses && person.spouses.length && data.people[person.spouses[0]])
    ? data.people[person.spouses[0]].name + ' (spouse)'
    : '';

  card.innerHTML = `
    <div class="avatar">${initials(person.name)}</div>
    <div class="name ${person.deceased ? 'deceased' : ''}">${escapeHtml(person.name)}</div>
    ${spouseName ? `<div class="subname">${escapeHtml(spouseName)}</div>` : ``}
    <div class="subname">${escapeHtml(person.year||'')}</div>
  `;
  card.onclick=()=>openPerson(person.id);
  wrap.appendChild(card);

  const kids=(person.children||[]).map(id=>data.people[id]).filter(Boolean);
  if(kids.length){
    const group=document.createElement('div');
    group.className='children';
    kids.forEach(k => group.appendChild(buildNode(k)));
    wrap.appendChild(group);
  } else {
    wrap.classList.add('no-children');
  }
  return wrap;
}

/** ===== Person Modal ===== */
function openPerson(id){
  const p=data.people[id];
  const parents = (p.parents||[]).map(i=>data.people[i]?.name).filter(Boolean).join(', ') || '—';
  const spouses = (p.spouses||[]).map(i=>data.people[i]?.name).filter(Boolean).join(', ') || '—';
  const children = (p.children||[]).map(i=>data.people[i]?.name).filter(Boolean).join(', ') || '—';

  document.getElementById('personDetails').innerHTML=`<div class="card">
    <h3 class="${p.deceased?'deceased':''}">${escapeHtml(p.name)}</h3>
    <p><b>Gender:</b> ${p.gender ? cap(p.gender) : '—'}</p>
    <p><b>Born:</b> ${escapeHtml(p.year||'—')}</p>
    ${p.gender==='female' && p.marriedCity ? `<p><b>Married in:</b> ${escapeHtml(p.marriedCity)}</p>` : ``}
    <p>${escapeHtml(p.bio||'')}</p>
    <p><b>Deceased:</b> ${p.deceased ? 'Yes' : 'No'}</p>
    <p><b>Parents:</b> ${escapeHtml(parents)}</p>
    <p><b>Spouses:</b> ${escapeHtml(spouses)}</p>
    <p><b>Children:</b> ${escapeHtml(children)}</p>
    ${isAdmin?`<div class='actions'>
      <button class='btn' onclick='editPerson("${id}")'>Edit</button>
      <button class='btn danger' onclick='deletePerson("${id}")'>Delete</button>
    </div>`:''}
  </div>`;
  document.getElementById('personModal').style.display='block';
}
function closePerson(){ document.getElementById('personModal').style.display='none'; }

/** ===== Admin Editor (gender + married city for women; children auto) ===== */
function editPerson(id){
  closePerson();
  const base={id:Date.now().toString(),name:'',year:'',bio:'',deceased:false,gender:'',marriedCity:'',parents:[],spouses:[]};
  const p=id?JSON.parse(JSON.stringify(data.people[id])):base;

  const form=document.getElementById('editForm');
  document.getElementById('editTitle').innerText=id?'Edit Person':'Add Person';

  const peopleList = Object.values(data.people);
  const opts=peopleList.map(q=>`<option value='${q.id}'>${escapeHtml(q.name)}</option>`).join('');

  form.innerHTML=`
    <div class='field'><label>Name</label><input id='pname' value='${escapeHtml(p.name)}'></div>
    <div class='field'><label>Year</label><input id='pyear' value='${escapeHtml(p.year||'')}'></div>
    <div class='field'><label>Gender</label>
      <select id='pgender'>
        <option value="" ${p.gender===''?'selected':''}>—</option>
        <option value="male" ${p.gender==='male'?'selected':''}>Male</option>
        <option value="female" ${p.gender==='female'?'selected':''}>Female</option>
      </select>
    </div>
    <div class='field'><label>Married in (city) — for women</label><input id='pmarriedcity' value='${escapeHtml(p.marriedCity||'')}'></div>
    <div class='field'><label>Bio</label><textarea id='pbio'>${escapeHtml(p.bio||'')}</textarea></div>
    <div class='field'><label><input type="checkbox" id="pdeceased" ${p.deceased?'checked':''}/> Deceased</label></div>

    <div class='field'><label>Parents</label>
      <select id='pparents' multiple>${opts}</select></div>
    <div class='field'><label>Spouses</label>
      <select id='pspouses' multiple>${opts}</select></div>

    <div class='actions'><button class='btn' onclick='savePerson("${id||''}")'>Save</button></div>
  `;
  document.getElementById('editModal').style.display='block';

  setMulti('pparents', p.parents||[]);
  setMulti('pspouses', p.spouses||[]);
}
function setMulti(id,values){
  const el=document.getElementById(id);
  [...el.options].forEach(o=>{ o.selected = (values||[]).includes(o.value); });
}
function closeEdit(){ document.getElementById('editModal').style.display='none'; }

function savePerson(id){
  const p={
    id:id || Date.now().toString(),
    name:document.getElementById('pname').value.trim(),
    year:document.getElementById('pyear').value.trim(),
    gender:document.getElementById('pgender').value,
    marriedCity:document.getElementById('pmarriedcity').value.trim(),
    bio:document.getElementById('pbio').value,
    deceased:document.getElementById('pdeceased').checked,
    parents:[...document.getElementById('pparents').selectedOptions].map(o=>o.value),
    spouses:[...document.getElementById('pspouses').selectedOptions].map(o=>o.value)
  };
  data.people[p.id] = p;
  data = normalizeData(data);
  saveData();
  closeEdit();
}

function deletePerson(id){
  if(!confirm('Delete this person?')) return;
  delete data.people[id];
  Object.values(data.people).forEach(q => {
    q.parents  = (q.parents  || []).filter(x => x !== id);
    q.spouses  = (q.spouses  || []).filter(x => x !== id);
    q.children = (q.children || []).filter(x => x !== id);
  });
  data = normalizeData(data);
  saveData();
  closePerson();
}

/** ===== Search ===== */
const searchInput = document.getElementById('searchInput');
document.getElementById('searchBtn').onclick = runSearch;
searchInput.addEventListener('keydown', e => { if(e.key==='Enter') runSearch(); });

function runSearch(){
  const q = (searchInput.value || '').trim().toLowerCase();
  const box = document.getElementById('searchResults');
  if(!q){ box.innerHTML=''; return; }
  const hits = Object.values(data.people).filter(p => p.name.toLowerCase().includes(q));
  if(!hits.length){ box.innerHTML = `<em>No matches.</em>`; return; }
  box.innerHTML = hits.map(p => `<span class="pill" onclick="openPerson('${p.id}')">${escapeHtml(p.name)}</span>`).join('');
}

/** ===== Compare with gender-aware labels & full sentence ===== */
function fillSelects(){
  const selA=document.getElementById('personA');
  const selB=document.getElementById('personB');
  selA.innerHTML='<option value="">Select Person A</option>';
  selB.innerHTML='<option value="">Select Person B</option>';
  Object.values(data.people).forEach(p=>{
    const optA=document.createElement('option'); optA.value=p.id; optA.textContent=p.name; selA.appendChild(optA);
    const optB=document.createElement('option'); optB.value=p.id; optB.textContent=p.name; selB.appendChild(optB);
  });
}
document.getElementById('compareBtn').onclick=()=>{
  const a=document.getElementById('personA').value;
  const b=document.getElementById('personB').value;
  const out=document.getElementById('compareResult');
  if(!a||!b){ out.textContent='Select both people.'; return; }
  if(!data.people[a]||!data.people[b]){ out.textContent='Unknown selection.'; return; }
  const rel = relationFromAToB(a,b); // role of A relative to B
  if(rel.type==='unrelated'){
    out.textContent = `${data.people[a].name} is not related to ${data.people[b].name}`;
  } else {
    out.textContent = `${data.people[a].name} is ${rel.label} to ${data.people[b].name}`;
  }
};

// Compute role of A relative to B (gender-aware where appropriate)
function relationFromAToB(aId,bId){
  if(aId===bId) return {type:'self', label:'the same person'};
  const A=data.people[aId], B=data.people[bId];

  // spouses
  if((A.spouses||[]).includes(bId)){
    const label = A.gender==='male' ? 'husband' : A.gender==='female' ? 'wife' : 'spouse';
    return {type:'spouse', label};
  }

  // direct parent/child (A relative to B)
  if((B.parents||[]).includes(aId)){
    const label = A.gender==='male' ? 'father' : A.gender==='female' ? 'mother' : 'parent';
    return {type:'ancestor', label};
  }
  if((A.parents||[]).includes(bId)){
    const label = A.gender==='male' ? 'son' : A.gender==='female' ? 'daughter' : 'child';
    return {type:'descendant', label};
  }

  // ancestor/descendant (farther)
  const upA = generationsUpTo(aId,bId);
  if(upA>1){ // A is ancestor of B at distance >1
    if(upA===2){
      const label = A.gender==='male' ? 'grandfather' : A.gender==='female' ? 'grandmother' : 'grandparent';
      return {type:'ancestor', label};
    }
    const gg = upA-2;
    const base = A.gender==='male' ? 'grandfather' : A.gender==='female' ? 'grandmother' : 'grandparent';
    const label = `${'great-'.repeat(gg)}${base}`;
    return {type:'ancestor', label};
  }
  const upB = generationsUpTo(bId,aId);
  if(upB>1){ // A is descendant of B at distance >1
    if(upB===2){
      const label = A.gender==='male' ? 'grandson' : A.gender==='female' ? 'granddaughter' : 'grandchild';
      return {type:'descendant', label};
    }
    const gg = upB-2;
    const base = A.gender==='male' ? 'grandson' : A.gender==='female' ? 'granddaughter' : 'grandchild';
    const label = `${'great-'.repeat(gg)}${base}`;
    return {type:'descendant', label};
  }

  // siblings
  if(shareAParent(aId,bId)){
    const label = A.gender==='male' ? 'brother' : A.gender==='female' ? 'sister' : 'sibling';
    return {type:'sibling', label};
  }

  // aunt/uncle / niece/nephew (A relative to B)
  for(const p of B.parents||[]){
    if(shareAParent(aId,p)){
      const label = A.gender==='male' ? 'uncle' : A.gender==='female' ? 'aunt' : 'aunt/uncle';
      return {type:'avuncular', label};
    }
  }
  for(const p of A.parents||[]){
    if(shareAParent(bId,p)){
      const label = A.gender==='male' ? 'nephew' : A.gender==='female' ? 'niece' : 'niece/nephew';
      return {type:'avuncular', label};
    }
  }

  // cousins (gender-neutral)
  const cousin = cousinLabel(aId,bId);
  if(cousin) return {type:'cousin', label:cousin};

  // related (but unknown label)
  const path = findPath(aId,bId);
  if(path) return {type:'related', label:'related'};

  return {type:'unrelated', label:'unrelated'};
}

/** ===== Relationship helpers ===== */
function shareAParent(a,b){
  const pA=new Set(data.people[a].parents||[]);
  const pB=new Set(data.people[b].parents||[]);
  for(const x of pA){ if(pB.has(x)) return true; } return false;
}
// generations upward from x to reach ancestor y (0 if not ancestor)
function generationsUpTo(x,y){
  let frontier=[x]; let visited=new Set([x]); let gen=0;
  while(frontier.length && gen<12){
    const next=[];
    for(const id of frontier){
      if(id===y) return gen;
      const parents=data.people[id]?.parents||[];
      for(const p of parents){ if(!visited.has(p)){ visited.add(p); next.push(p);} }
    }
    frontier=next; gen++;
  }
  return 0;
}
function cousinLabel(a,b){
  const ancA = ancestorMap(a,8);
  const ancB = ancestorMap(b,8);
  let best = null;
  for(const [id,genA] of ancA){
    if(ancB.has(id)){
      const genB = ancB.get(id);
      best = best ? (genA+genB < best.genA+best.genB ? {id,genA,genB} : best) : {id,genA,genB};
    }
  }
  if(!best) return null;
  const k = Math.min(best.genA,best.genB)-1; // degree (1 => first cousin)
  const r = Math.abs(best.genA - best.genB); // removed
  if(k < 1) return null; // would be siblings/avuncular/ancestor otherwise
  const degree = ['','first','second','third','fourth','fifth','sixth','seventh','eighth'][k] || `${k}th`;
  return r===0 ? `${degree} cousin` : `${degree} cousin ${r}× removed`;
}
function ancestorMap(x,limit){
  const map=new Map();
  let frontier=[x]; let gen=0;
  const seen=new Set([x]);
  while(frontier.length && gen<=limit){
    const next=[];
    for(const id of frontier){
      const parents=data.people[id]?.parents||[];
      for(const p of parents){
        if(!seen.has(p)){ seen.add(p); next.push(p); if(!map.has(p)) map.set(p,gen+1); }
      }
    }
    frontier=next; gen++;
  }
  return map;
}
function findPath(a,b){
  if(a===b) return [a];
  const queue=[a]; const prev={}; const seen=new Set([a]);
  while(queue.length){
    const cur=queue.shift();
    const p=data.people[cur];
    const neighbors=[...(p.parents||[]),...(p.spouses||[]),...(p.children||[])];
    for(const n of neighbors){
      if(!data.people[n]||seen.has(n)) continue;
      seen.add(n); prev[n]=cur;
      if(n===b){
        const path=[b]; let t=b;
        while(t!==a){ t=prev[t]; path.push(t); }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

/** ===== Auth & Tabs & Export/Import ===== */
function login(){
  const pw=prompt('Enter admin password:');
  if(pw==='admin'){isAdmin=true;
    document.getElementById('addBtn').style.display='inline-block';
    document.getElementById('logoutBtn').style.display='inline-block';
    document.getElementById('loginBtn').style.display='none';
    alert('Admin mode enabled');
  } else alert('Wrong password');
}
function logout(){
  isAdmin=false;
  document.getElementById('addBtn').style.display='none';
  document.getElementById('logoutBtn').style.display='none';
  document.getElementById('loginBtn').style.display='inline-block';
}
document.getElementById('loginBtn').onclick=login;
document.getElementById('logoutBtn').onclick=logout;
document.getElementById('addBtn').onclick=()=>editPerson('');

document.querySelectorAll('.tab').forEach(t=>{
  t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const tab=t.dataset.tab;
    document.querySelectorAll('section').forEach(s=>s.classList.remove('active'));
    document.getElementById(tab).classList.add('active');
  };
});

document.getElementById('exportBtn').onclick=()=>{
  document.getElementById('dataBox').value=JSON.stringify(data,null,2);
};
document.getElementById('importBtn').onclick=()=>{
  try{
    const json=JSON.parse(document.getElementById('dataBox').value);
    data=json;
    data = normalizeData(data);
    saveData();
    alert('Data imported successfully.');
  }catch(e){alert('Invalid JSON');}
};

/** ===== Init ===== */
