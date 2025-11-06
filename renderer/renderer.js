const API_LIST  = 'https://api.alquran.cloud/v1/surah';
const API_TEXT  = id => `https://api.alquran.cloud/v1/surah/${id}/editions/quran-simple,en.asad`;
const API_AUDIO = id => `https://api.alquran.cloud/v1/surah/${id}/ar.alafasy`;


const { ipcRenderer } = require('electron');

async function notesGetAll(){ return await ipcRenderer.invoke('notes:getAll'); }
async function noteUpsert(note){ return await ipcRenderer.invoke('notes:upsert', note); }
async function noteDelete(id){ return await ipcRenderer.invoke('notes:delete', id); }

function loadNotes(){ return []; }   
function saveNotes(){  }

const $  = q => document.querySelector(q);
const on = (el, ev, fn) => el.addEventListener(ev, fn);
const escapeHtml = s => (s||'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}));
function norm(str=''){
  return str.toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'')
    .replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');
}
function gotoScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelector(`#screen-${name}`).classList.add('active');
  if (name==='explore' || name==='journal'){
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add('active');
  }
}
function debounce(fn, delay=150){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),delay); }; }
const nextFrame = ()=> new Promise(r=>requestAnimationFrame(()=>r()));


function toast(msg, ms=1600){
  let el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `
    position:fixed; left:16px; bottom:16px; z-index:9999;
    background:#5f3dc4; color:#fff; padding:10px 14px;
    border-radius:12px; box-shadow:0 8px 22px rgba(95,61,196,.25);
    font-family:Quicksand,system-ui; font-weight:600; opacity:.98;
  `;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .35s'; el.style.opacity='0'; }, ms);
  setTimeout(()=> el.remove(), ms+400);
}


document.querySelectorAll('.tab').forEach(t=>{
  on(t,'click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.querySelector(`#screen-${t.dataset.tab}`).classList.add('active');
  });
});


const S = {
  surahs: [],
  currentId: null,
  bundle: null,
  audios: [],
  notes: loadNotes(),
  detail: { index: -1, surahId: null },
  cacheAyahs: []
};


const audio = $('#globalAudio');
const playback = { mode:'idle', index:-1, paused:false };

audio.addEventListener('ended', ()=>{
  if (playback.mode === 'all' && !playback.paused) {
    if (playback.index + 1 < S.audios.length) playAyah(playback.index + 1, true);
    else { playback.mode = 'idle'; playback.index = -1; clearPlaying(); }
  }
});


(async function boot(){
  await loadSurahList();
  setupJournal();

  S.notes = await notesGetAll();
  refreshNotes();
})();


async function loadSurahList(){
  const res = await fetch(API_LIST);
  const json = await res.json();
  S.surahs = json.data || [];
  renderGrid(S.surahs);

  const nSel = $('#noteSurah'), fSel = $('#filterSurah');
  nSel.innerHTML = ''; fSel.innerHTML = '<option value="">All surah</option>';
  for (const s of S.surahs){
    nSel.innerHTML += `<option value="${s.number}">${s.number}. ${s.englishName}</option>`;
    fSel.innerHTML += `<option value="${s.number}">${s.number}. ${s.englishName}</option>`;
  }
}

function renderGrid(items){
  const grid = $('#surahGrid');
  grid.innerHTML = '';
  for (const s of items){
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="top">
        <b>${s.number}. ${s.englishName}</b>
        <span class="badge">${s.revelationType}</span>
      </div>
      <div class="meta">${s.name} • ${s.numberOfAyahs} ayah</div>
      <button class="open-btn">Open Surah</button>
    `;
    li.querySelector('.open-btn').addEventListener('click', ()=> openSurah(s.number));
    grid.appendChild(li);
  }
}

const filterSurahList = debounce(()=>{
  const q = norm($('#searchInput').value.trim());
  const filtered = S.surahs.filter(s => norm(`${s.englishName} ${s.name}`).includes(q));
  renderGrid(filtered);
}, 120);
on($('#searchInput'),'input', filterSurahList);
on($('#btnReset'),'click',()=>{ $('#searchInput').value=''; renderGrid(S.surahs); });

// ===== Buka Surah =====
async function openSurah(id){
  const [textRes, audioRes] = await Promise.all([fetch(API_TEXT(id)), fetch(API_AUDIO(id))]);
  const textJson = await textRes.json(); const audioJson = await audioRes.json();
  const [ar, en] = textJson.data;
  S.bundle = { ar, en };
  S.audios = audioJson.data.ayahs.map(a => a.audio);
  S.currentId = id;

  $('#viewerTitle').textContent = `Surah ${ar.englishName} (${ar.name})`;
  $('#viewerMeta').textContent  = `Revelation: ${ar.revelationType} • Ayahs: ${ar.numberOfAyahs}`;
  $('#viewer').classList.remove('hidden');
  $('#searchAyah').disabled = true;

  const wrap = $('#ayahList');
  wrap.innerHTML = '';
  S.cacheAyahs = [];

  const BATCH = 24;
  for (let start = 0; start < ar.ayahs.length; start += BATCH){
    const end = Math.min(start + BATCH, ar.ayahs.length);
    const frag = document.createDocumentFragment();

    for (let i = start; i < end; i++){
      const n = i+1;
      const card = document.createElement('div');
      card.className = 'ayah';
      card.id = `ayah-${n}`;
      card.innerHTML = `
        <div class="line">
          <b>Ayah ${n}</b>
          <div class="row gap" style="width:auto">
            <button type="button" class="open" data-i="${i}" title="Open Ayah ${n}">Open</button>
            <button type="button" class="play" data-i="${i}" title="Play Ayah ${n}">►</button>
            <button type="button" class="to-note" data-n="${n}" title="Add to Journal">+ Note</button>
          </div>
        </div>
        <div class="ar">${S.bundle.ar.ayahs[i].text}</div>
        <div class="tr en">EN (Asad): ${escapeHtml(S.bundle.en.ayahs[i].text)}</div>
      `;
      card.querySelector('.open').addEventListener('click',()=> openAyahDetail(i));
      card.querySelector('.play').addEventListener('click',()=> { playback.mode='single'; playAyah(i, true); });

      S.cacheAyahs.push({
        node: card,
        ar: norm(S.bundle.ar.ayahs[i].text),
        en: norm(S.bundle.en.ayahs[i].text)
      });

      frag.appendChild(card);
    }
    wrap.appendChild(frag);
    await nextFrame();
  }

  $('#searchAyah').disabled = false;
  $('#searchAyah').value = '';
  $('#searchAyah').focus();
  $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearPlaying(){ document.querySelectorAll('.ayah.playing').forEach(el=> el.classList.remove('playing')); }

function playAyah(i, autoscroll=false){
  playback.index = i; playback.paused = false;
  audio.src = S.audios[i]; audio.play();
  clearPlaying();
  const el = document.getElementById(`ayah-${i+1}`);
  if (el){
    el.classList.add('playing');
    if (autoscroll) el.scrollIntoView({ behavior:'smooth', block:'center' });
  }
}

on($('#btnPlayAll'),'click', ()=>{
  if (!S.audios.length) return;
  if (playback.mode !== 'all') {
    playback.mode = 'all';
    if (playback.index >= 0) playAyah(playback.index, true); else playAyah(0, true);
    return;
  }
  if (playback.mode === 'all' && playback.paused) { playback.paused = false; audio.play(); }
});
on($('#btnPauseResume'),'click', ()=>{
  if (!S.audios.length || playback.mode === 'idle') return;
  if (!playback.paused && !audio.paused) { audio.pause(); playback.paused = true; $('#btnPauseResume').textContent='Resume'; }
  else { playback.paused = false; audio.play(); $('#btnPauseResume').textContent='Pause'; }
});


const filterAyahDebounced = debounce(()=>{
  const q = norm($('#searchAyah').value.trim());
  for (const it of S.cacheAyahs){
    const show = !q || it.ar.includes(q) || it.en.includes(q);
    it.node.style.display = show ? '' : 'none';
  }
}, 140);
on($('#searchAyah'), 'input', filterAyahDebounced);

// +Note delegation
on($('#ayahList'), 'click', (e)=>{
  const btn = e.target.closest('button.to-note');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const n = Number(btn.dataset.n || '0');
  if (n > 0) quickToNote(n);
});


function openAyahDetail(i){
  S.detail.index = i; S.detail.surahId = S.currentId;
  const n = i+1; const { ar, en } = S.bundle;

  $('#dTitle').textContent = `Surah ${ar.englishName} (${ar.name}) — Ayah ${n}`;
  $('#dMeta').textContent  = `Revelation: ${ar.revelationType} • Ayahs: ${ar.numberOfAyahs}`;
  $('#dArabic').innerHTML  = ar.ayahs[i].text;
  $('#dMs').textContent    = '';
  $('#dEn').textContent    = `EN (Asad): ${en.ayahs[i].text}`;

  audio.src = S.audios[i];
  $('#dPauseResume').textContent = 'Pause';
  playback.mode = 'single'; playback.index = i; playback.paused = false;

  gotoScreen('detail');
}
on($('#dPlay'),'click',()=>{ if (S.detail.index>=0) playAyah(S.detail.index,false); });
on($('#dPauseResume'),'click', ()=>{
  if (!S.audios.length) return;
  if (!playback.paused && !audio.paused){ audio.pause(); playback.paused = true; $('#dPauseResume').textContent='Resume'; }
  else { playback.paused = false; audio.play(); $('#dPauseResume').textContent='Pause'; }
});
on($('#dToNote'),'click',()=>{
  const n=(S.detail.index??-1)+1; if (n<=0) return;
  document.querySelector('.tab[data-tab="journal"]').click();
  setTimeout(()=>{
    $('#noteSurah').value=String(S.detail.surahId||S.currentId||1);
    $('#noteAyah').value=String(n);
    $('#noteTitle')?.focus();
  },0);
});
on($('#btnBackToExplore'),'click',()=>{
  gotoScreen('explore');
  const el=document.getElementById(`ayah-${(S.detail.index??-1)+1}`);
  el?.scrollIntoView({behavior:'smooth',block:'center'});
});

function quickToNote(ayahNum){
  document.querySelector('.tab[data-tab="journal"]').click();
  setTimeout(()=>{
    const surahId = S.currentId || S.detail.surahId || 1;
    $('#noteSurah').value = String(surahId);
    $('#noteAyah').value  = String(ayahNum);
    $('#noteTitle')?.focus();
  }, 0);
}


function setupJournal(){
  on($('#noteForm'),'submit',e=>{
    e.preventDefault();
    const id = $('#noteId').value || crypto.randomUUID();
    const data = {
      id,
      surah: Number($('#noteSurah').value),
      ayah: Number($('#noteAyah').value||1),
      title: ($('#noteTitle').value||'').trim() || 'Untitled',
      body: ($('#noteBody').value||'').trim(),
      updatedAt: Date.now()
    };

    (async () => {
      const saved = await noteUpsert(data);
      const i = S.notes.findIndex(x=>x.id===saved.id);
      if (i>=0) S.notes[i]=saved; else S.notes.push(saved);
      refreshNotes(); toast('Saved');
      $('#noteId').value = saved.id; $('#btnDelete').disabled=false;
    })();
  });

  on($('#btnNew'),'click',()=>{ $('#noteForm').reset(); $('#noteId').value=''; $('#btnDelete').disabled=true; });

  on($('#btnDelete'),'click',()=>{
    const id=$('#noteId').value; if(!id) return;
    if(!confirm('Delete this note?')) return;
    (async () => {
      await noteDelete(id);
      S.notes=S.notes.filter(x=>x.id!==id);
      refreshNotes();
      $('#noteForm').reset(); $('#noteId').value=''; $('#btnDelete').disabled=true;
      toast('Deleted');
    })();
  });

  on($('#filterSurah'),'change',refreshNotes);
  on($('#filterText'),'input', debounce(refreshNotes, 150));
}

function refreshNotes(){
  const fs=$('#filterSurah').value, q=($('#filterText').value||'').toLowerCase();
  const list=$('#notesList'); list.innerHTML='';
  const items=S.notes
    .filter(n=>!fs||String(n.surah)===String(fs))
    .filter(n=>!q||n.title.toLowerCase().includes(q)||n.body.toLowerCase().includes(q))
    .sort((a,b)=>b.updatedAt-a.updatedAt);

  for(const n of items){
    const li=document.createElement('li');
    li.innerHTML=`
      <div class="row" style="justify-content:space-between">
        <b>${escapeHtml(n.title)}</b>
        <small>${new Date(n.updatedAt).toLocaleString()}</small>
      </div>
      <div class="meta">Surah ${n.surah} • Ayah ${n.ayah}</div>
      <p>${escapeHtml(n.body)}</p>
      <div class="row gap">
        <button class="primary" data-id="${n.id}" data-act="load" type="button">Edit Note</button>
        <button class="danger" data-id="${n.id}" data-act="del" type="button">Delete</button>
      </div>`;
    li.querySelector('[data-act="load"]').addEventListener('click',()=>{
      const m=S.notes.find(x=>x.id===n.id); if(!m)return;
      $('#noteId').value=m.id; $('#noteSurah').value=String(m.surah);
      $('#noteAyah').value=String(m.ayah); $('#noteTitle').value=m.title; $('#noteBody').value=m.body;
      $('#btnDelete').disabled=false;
    });
    li.querySelector('[data-act="del"]').addEventListener('click',()=>{
      if(!confirm('Delete this note'))return;
      (async () => {
        await noteDelete(n.id);
        S.notes=S.notes.filter(x=>x.id!==n.id);
        refreshNotes(); toast('Deleted');
      })();
    });
    list.appendChild(li);
  }
}



function gotoScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const target = document.querySelector(`#screen-${name}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.tab === name);
  });
}


(function wireTabs(){
  document.addEventListener('click', (e)=>{
    const t = e.target.closest('.tab');
    if (!t || !t.dataset.tab) return;
    e.preventDefault();
    gotoScreen(t.dataset.tab);
  });
})();


(function wireHomeCards(){
  document.querySelectorAll('.link-card').forEach(card=>{
    card.style.cursor = 'pointer';
    card.setAttribute('role','button');
    card.setAttribute('tabindex','0');

    const go = ()=> gotoScreen(card.dataset.tab);

    card.addEventListener('click', (e)=>{
      // elak klik pada <a> default
      e.preventDefault();
      e.stopPropagation();
      go();
    });
    card.addEventListener('keypress', (e)=>{
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
})();


document.querySelectorAll('.link-card .card-thumb').forEach(img=>{
  img.style.pointerEvents = 'none'; // klik tembus ke .link-card
});
