// ═══════════════════════════════════════════════════
// DATA & STORAGE
// ═══════════════════════════════════════════════════
const ADMIN_EMAIL = 'admin@trivekii.com';
const ADMIN_PW    = 'Admin@123';

// Default courses seeded on first run
// New model: each module can have its own quiz; course also has a final quiz.
const DEFAULT_COURSES = [
  { id:'c1', title:'Sample Course', cat:'General', catClass:'badge-blue',
    modules:[
      {id:'m1',title:'Module 1 — Introduction',dur:'10 min',description:'A sample module. Replace with your own content.',
        video:false, pdf:false, url:'https://www.example.com',
        quiz:[
          {q:'This is a sample module quiz question. What is 2 + 2?',opts:['3','4','5','6'],ans:1},
          {q:'Sample question two — which is a colour?',opts:['Square','Blue','Loud','Fast'],ans:1},
        ]
      },
      {id:'m2',title:'Module 2 — Going Deeper',dur:'12 min',description:'A second sample module.',
        video:false, pdf:false, url:'https://www.example.com',
        quiz:[
          {q:'Sample module-2 question. Which number is largest?',opts:['1','10','5','3'],ans:1},
        ]
      },
    ],
    quiz:[
      {q:'Final quiz — this covers the whole course. What is the capital of France?',opts:['Berlin','Madrid','Paris','Rome'],ans:2},
      {q:'Final quiz — which is a programming language?',opts:['Python','Tiger','River','Cloud'],ans:0},
    ]
  }
];

const DB = {
  users()       { try{return JSON.parse(localStorage.getItem('trv_users')||'[]')}catch{return[]} },
  saveUsers(u)  { localStorage.setItem('trv_users',JSON.stringify(u)) },
  courses()     { try{return JSON.parse(localStorage.getItem('trv_courses_v3')||'null')}catch{return null} },
  saveCourses(c){ localStorage.setItem('trv_courses_v3',JSON.stringify(c)) },
  prog(uid)     { try{return JSON.parse(localStorage.getItem('trv_prog_'+uid)||'{}')}catch{return{}} },
  saveProg(uid,p){ localStorage.setItem('trv_prog_'+uid,JSON.stringify(p)) },
  session()     { try{return JSON.parse(localStorage.getItem('trv_sess')||'null')}catch{return null} },
  saveSession(s){ localStorage.setItem('trv_sess',JSON.stringify(s)) },
  clearSession(){ localStorage.removeItem('trv_sess') },
  // blob methods delegated to IDB (defined below after DB)
  blob(id)       { return null; }, // sync stub — use IDB.get() async instead
  saveBlob(id,b) { return true; }, // sync stub — use IDB.save() async instead
  deleteBlob(id) { IDB.delete(id); },
  // quiz settings
  settings()     { try{return JSON.parse(localStorage.getItem('trv_settings')||'null')}catch{return null} },
  saveSettings(s){ localStorage.setItem('trv_settings',JSON.stringify(s)) },
};


// ── IndexedDB for binary file storage (videos/PDFs) ──────────────────────────
const IDB = (() => {
  const DB_NAME = 'trivekii_blobs', STORE = 'blobs', VERSION = 1;
  let _db = null;
  function open() {
    return new Promise((res, rej) => {
      if (_db) { res(_db); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }
  return {
    async save(id, data) {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(data, id);
        tx.oncomplete = () => res(true);
        tx.onerror    = e => rej(e.target.error);
      });
    },
    async get(id) {
      const db = await open();
      return new Promise((res, rej) => {
        const req = db.transaction(STORE).objectStore(STORE).get(id);
        req.onsuccess = e => res(e.target.result || null);
        req.onerror   = e => rej(e.target.error);
      });
    },
    async delete(id) {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => res();
        tx.onerror    = e => rej(e.target.error);
      });
    },
  };
})();

// Init courses if first visit
let COURSES = DB.courses();
if (!COURSES) { COURSES = DEFAULT_COURSES; DB.saveCourses(COURSES); }

function saveCourses() { DB.saveCourses(COURSES); }

// Quiz settings (admin-controlled, defaults: 80% pass, 2 retakes)
const DEFAULT_SETTINGS = { passThreshold: 80, maxRetakes: 2 };
let SETTINGS = DB.settings() || DEFAULT_SETTINGS;
function saveSettings() { DB.saveSettings(SETTINGS); }

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
let S = {
  session: null,
  tab: 'dashboard',
  activeCourse: null,
  activeModule: null,
  quiz: null,
  selectedUser: null,
  authMode: 'login',
  adminSubTab: 'info',
  videoWatched: {},
  _videoUrl: null,  // preloaded video blob (data URI) for active module
  _pdfUrl: null,    // preloaded PDF blob (data URI) for active module
  _contentTab: null, // which content the learner is viewing: 'video'|'pdf'|'url'
};

// ═══════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════
function uid() { return 'id_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); }
function calcCourseProg(userId, cid) {
  const c = COURSES.find(x=>x.id===cid); if(!c||!c.modules.length) return 0;
  const complete = c.modules.filter(m=>isModuleComplete(userId, cid, m.id)).length;
  return Math.round(complete/c.modules.length*100);
}
function calcOverall(userId) {
  const total    = COURSES.reduce((a,c)=>a+c.modules.length,0);
  const complete = COURSES.reduce((a,c)=>a+c.modules.filter(m=>isModuleComplete(userId,c.id,m.id)).length,0);
  return total ? Math.round(complete/total*100) : 0;
}
// ── Per-module quiz helpers ──────────────────────────────────────────────────
// Returns the score a learner got on a module's quiz (or null if not taken)
function getModuleQuizScore(userId, cid, mid) {
  const p = DB.prog(userId);
  return p[cid]?.moduleQuiz?.[mid] ?? null;
}
// A module is "complete" if it's watched AND (has no quiz OR its quiz is passed)
function isModuleComplete(userId, cid, mid) {
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  const mod = c.modules.find(m=>m.id===mid); if(!mod) return false;
  const watched = (DB.prog(userId)[cid]?.watched||[]).includes(mid);
  if (!watched) return false;
  const hasQuiz = mod.quiz && mod.quiz.length>0;
  if (!hasQuiz) return true;
  const sc = getModuleQuizScore(userId, cid, mid);
  return sc != null && sc >= SETTINGS.passThreshold;
}
// A module is unlocked if it's the first, or the previous module is complete
function isModuleUnlocked(userId, cid, modIndex) {
  if (modIndex === 0) return true;
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  const prevMod = c.modules[modIndex-1];
  return isModuleComplete(userId, cid, prevMod.id);
}
// Are all modules in a course complete? (gates the final course quiz)
function allModulesComplete(userId, cid) {
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  return c.modules.every(m=>isModuleComplete(userId, cid, m.id));
}

// A course is fully passed when all modules are complete AND
// (there is no final quiz, OR the final quiz is passed)
function isCoursePassed(userId, cid) {
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  if (!allModulesComplete(userId, cid)) return false;
  const hasFinal = c.quiz && c.quiz.length>0;
  if (!hasFinal) return true;
  const sc = DB.prog(userId)[cid]?.quizScore;
  return sc != null && sc >= SETTINGS.passThreshold;
}

function statusBadge(pct) {
  if(pct>=SETTINGS.passThreshold) return '<span class="badge badge-green">On track</span>';
  if(pct>=30) return '<span class="badge badge-orange">In progress</span>';
  return '<span class="badge badge-red">At risk</span>';
}
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, type='ok') {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast toast-'+type;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(()=>t.remove(), 3500);
}

// ═══════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════
const authScreen = document.getElementById('auth-screen');
const appScreen  = document.getElementById('app-screen');

function showMsg(html, type='err') {
  document.getElementById('auth-msg').innerHTML = `<div class="msg-${type}">${html}</div>`;
}
function setAuthMode(mode) {
  S.authMode = mode;
  const isLogin    = mode==='login';
  const isRegister = mode==='register';
  const isReset    = mode==='reset' || mode==='reset-answer' || mode==='reset-pw';
  document.getElementById('auth-title').textContent       = isLogin?'Welcome back':isRegister?'Create account':'Reset password';
  document.getElementById('auth-subtitle').textContent    = isLogin?'Sign in to your Trivekii account':isRegister?'Register as a learner to get started':'We\'ll verify your identity first';
  document.getElementById('auth-submit-btn').textContent  = isLogin?'Sign in →':isRegister?'Create account →':mode==='reset'?'Find my account →':mode==='reset-answer'?'Verify answer →':'Set new password →';
  document.getElementById('auth-switch-text').textContent = isLogin?"Don't have an account?":isRegister?'Already have an account?':'Remember your password?';
  document.getElementById('auth-toggle').textContent      = isLogin?' Register here':isRegister?' Sign in':' Sign in';
  document.getElementById('field-name').style.display     = isRegister?'':'none';
  document.getElementById('field-pw2').style.display      = isRegister||mode==='reset-pw'?'':'none';
  document.getElementById('field-sq').style.display       = isRegister?'':'none';
  document.getElementById('field-sa').style.display       = isRegister||mode==='reset-answer'?'':'none';
  // Email field: hide during answer/pw steps
  document.getElementById('inp-email').closest('.field').style.display = mode==='reset-answer'||mode==='reset-pw'?'none':'';
  // Password field: hide during reset email lookup and answer steps
  document.getElementById('inp-pw').closest('.field').style.display    = mode==='reset'||mode==='reset-answer'?'none':'';
  // Forgot link: only on login
  document.getElementById('forgot-row').style.display = isLogin?'':'none';
  document.getElementById('auth-msg').innerHTML = '';
}
document.getElementById('auth-toggle').addEventListener('click',()=>{
  if(S.authMode==='login') setAuthMode('register');
  else setAuthMode('login');
});
document.getElementById('forgot-link').addEventListener('click',()=>setAuthMode('reset'));
document.getElementById('auth-submit-btn').addEventListener('click', doAuth);
document.addEventListener('keydown', e=>{if(e.key==='Enter'&&authScreen.style.display!=='none')doAuth();});

function doAuth() {
  const email = document.getElementById('inp-email').value.trim();
  const pw    = document.getElementById('inp-pw').value;
  document.getElementById('auth-msg').innerHTML='';

  // ── LOGIN ──
  if (S.authMode==='login') {
    const adminPw = localStorage.getItem('trv_admin_pw_override')||ADMIN_PW;
    if (email===ADMIN_EMAIL && pw===adminPw) {
      launch({role:'admin', email, name:'Admin', id:'admin'});
    } else {
      const u = DB.users().find(x=>x.email===email && x.pw===pw);
      if (!u) { showMsg('Incorrect email or password.'); return; }
      if (u.disabled) { showMsg('This account has been disabled. Contact your administrator.'); return; }
      launch({role:'learner', email:u.email, name:u.name, id:u.id});
    }

  // ── REGISTER ──
  } else if (S.authMode==='register') {
    const name = document.getElementById('inp-name').value.trim();
    const pw2  = document.getElementById('inp-pw2').value;
    const sq   = document.getElementById('inp-sq').value;
    const sa   = document.getElementById('inp-sa').value.trim();
    if (!name)                { showMsg('Please enter your full name.'); return; }
    if (!email.includes('@')) { showMsg('Please enter a valid email.'); return; }
    if (pw.length<6)          { showMsg('Password must be at least 6 characters.'); return; }
    if (pw!==pw2)             { showMsg('Passwords do not match.'); return; }
    if (!sq)                  { showMsg('Please choose a security question.'); return; }
    if (!sa)                  { showMsg('Please provide your security answer.'); return; }
    const users = DB.users();
    if (users.find(x=>x.email===email)) { showMsg('This email is already registered.'); return; }
    const nu = {id:'u_'+Date.now(), name, email, pw, sq, sa:sa.toLowerCase().trim(),
                createdAt:new Date().toISOString(), disabled:false, dept:'', notes:''};
    DB.saveUsers([...users, nu]);
    showMsg('Account created! You can now sign in.','ok');
    setAuthMode('login');
    document.getElementById('inp-email').value = email;

  // ── RESET STEP 1: find account by email ──
  } else if (S.authMode==='reset') {
    if (!email) { showMsg('Please enter your email address.'); return; }
    if (email===ADMIN_EMAIL) {
      // Admin reset: use a special PIN stored in localStorage (admin sets it themselves)
      S._resetEmail = email;
      S._resetIsAdmin = true;
      setAuthMode('reset-answer');
      const sqField = document.getElementById('field-sa');
      // Repurpose the sa label for admin PIN
      sqField.querySelector('label').textContent = 'Admin PIN (set in Settings)';
      sqField.querySelector('input').placeholder = 'Enter your admin PIN';
      showMsg('Enter your admin PIN to reset the admin password.','ok');
      return;
    }
    const u = DB.users().find(x=>x.email===email);
    if (!u) { showMsg('No account found with that email address.'); return; }
    if (!u.sq || !u.sa) { showMsg('This account has no security question set. Please contact your administrator to reset your password.'); return; }
    S._resetEmail = email;
    S._resetIsAdmin = false;
    setAuthMode('reset-answer');
    // Show the actual question
    const sqMap = {
      pet:"What was the name of your first pet?",
      city:"What city were you born in?",
      mother:"What is your mother's maiden name?",
      school:"What was the name of your primary school?",
      friend:"What is the name of your childhood best friend?"
    };
    const saField = document.getElementById('field-sa');
    saField.querySelector('label').innerHTML = `Security question: <strong>${sqMap[u.sq]||u.sq}</strong>`;
    saField.querySelector('input').placeholder = 'Your answer';
    saField.querySelector('input').value = '';

  // ── RESET STEP 2: verify security answer ──
  } else if (S.authMode==='reset-answer') {
    const answer = document.getElementById('inp-sa').value.trim().toLowerCase();
    if (!answer) { showMsg('Please enter your answer.'); return; }
    if (S._resetIsAdmin) {
      const storedPin = localStorage.getItem('trv_admin_pin')||'';
      if (!storedPin) { showMsg('No admin PIN has been set. Please set one in Settings first.'); return; }
      if (answer !== storedPin) { showMsg('Incorrect PIN. Try again.'); return; }
    } else {
      const u = DB.users().find(x=>x.email===S._resetEmail);
      if (!u) { showMsg('Account not found.'); return; }
      if (answer !== u.sa) { showMsg('Incorrect answer. Please try again.'); return; }
    }
    setAuthMode('reset-pw');
    showMsg('Identity verified! Set your new password below.','ok');

  // ── RESET STEP 3: set new password ──
  } else if (S.authMode==='reset-pw') {
    const pw2 = document.getElementById('inp-pw2').value;
    if (pw.length<6)  { showMsg('Password must be at least 6 characters.'); return; }
    if (pw!==pw2)     { showMsg('Passwords do not match.'); return; }
    if (S._resetIsAdmin) {
      // Admin password is hardcoded — store override in localStorage
      localStorage.setItem('trv_admin_pw_override', pw);
      showMsg('Admin password updated! You can now sign in.','ok');
    } else {
      const users = DB.users();
      const idx = users.findIndex(x=>x.email===S._resetEmail);
      if (idx===-1) { showMsg('Account not found.'); return; }
      users[idx].pw = pw;
      DB.saveUsers(users);
      showMsg('Password updated! You can now sign in.','ok');
    }
    S._resetEmail = null;
    S._resetIsAdmin = false;
    setTimeout(()=>setAuthMode('login'), 1500);
  }
}

function launch(session) {
  S.session = session;
  DB.saveSession(session);
  authScreen.style.display = 'none';
  appScreen.style.display  = 'flex';
  document.getElementById('nav-username').textContent = session.name;
  document.getElementById('nav-avatar').textContent   = session.name[0].toUpperCase();
  if (session.role==='admin') {
    document.getElementById('topnav').classList.add('admin-nav');
    document.getElementById('nav-role-badge').style.display = 'inline';
  }
  buildSidebar(); render();
}

document.getElementById('logout-btn').addEventListener('click',()=>{
  DB.clearSession();
  S = {session:null,tab:'dashboard',activeCourse:null,activeModule:null,quiz:null,selectedUser:null,authMode:'login',adminSubTab:'info',videoWatched:{},_videoUrl:null,_pdfUrl:null,_contentTab:null};
  appScreen.style.display  = 'none';
  authScreen.style.display = 'grid';
  document.getElementById('topnav').classList.remove('admin-nav');
  document.getElementById('nav-role-badge').style.display = 'none';
  document.getElementById('auth-msg').innerHTML = '';
  document.getElementById('inp-email').value = '';
  document.getElementById('inp-pw').value = '';
});

// ═══════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════
const LEARNER_NAV = [
  {id:'dashboard',icon:'⊞',label:'Dashboard'},
  {id:'courses',  icon:'▶',label:'My Courses'},
  {id:'progress', icon:'↗',label:'My Progress'},
  {id:'certs',    icon:'🏆',label:'Certificates'},
];
const ADMIN_NAV = [
  {id:'dashboard',icon:'⊞',label:'Dashboard'},
  {id:'learners', icon:'👥',label:'Learners'},
  {id:'courses',  icon:'📚',label:'Courses'},
  {id:'reports',  icon:'📊',label:'Reports'},
  {id:'settings', icon:'⚙️',label:'Settings'},
];

function buildSidebar() {
  const nav = S.session.role==='admin' ? ADMIN_NAV : LEARNER_NAV;
  document.getElementById('sidebar-section-label').textContent = S.session.role==='admin'?'Admin':'Menu';
  document.getElementById('sidebar-nav').innerHTML = nav.map(n=>
    `<div class="nav-item${S.tab===n.id?' active':''}" data-tab="${n.id}">
       <span class="icon">${n.icon}</span> ${n.label}
     </div>`).join('');
  document.querySelectorAll('.nav-item').forEach(el=>{
    el.addEventListener('click',()=>{
      S.tab=el.dataset.tab;
      S.activeCourse=null;S.activeModule=null;S.quiz=null;S.selectedUser=null;
      buildSidebar();render();
    });
  });
}

// ═══════════════════════════════════════════════════
// RENDER ROUTER
// ═══════════════════════════════════════════════════
function render() {
  const mc = document.getElementById('main-content');
  if (S.session.role==='learner') mc.innerHTML = renderLearner();
  else mc.innerHTML = renderAdmin();
  bindEvents();
}

// Call this before render() whenever the active module changes
async function loadAndRender(preferredTab) {
  S._videoUrl = null; S._pdfUrl = null; S._contentTab = null;
  if (S.activeCourse && S.activeModule && S.activeModule.id) {
    const m = S.activeModule;
    try { if (m.video) S._videoUrl = await IDB.get(m.id+'_video'); } catch(e){}
    try { if (m.pdf)   S._pdfUrl   = await IDB.get(m.id+'_pdf');   } catch(e){}
    // Pick which content to show first: explicit preference, else video > pdf > url
    const avail = [];
    if (S._videoUrl) avail.push('video');
    if (S._pdfUrl)   avail.push('pdf');
    if (m.url)       avail.push('url');
    S._contentTab = (preferredTab && avail.includes(preferredTab)) ? preferredTab : (avail[0]||null);
  }
  render();
}

// ═══════════════════════════════════════════════════
// LEARNER VIEWS
// ═══════════════════════════════════════════════════
function renderLearner() {
  if (S.quiz)         return renderQuiz();
  if (S.activeCourse) return renderCoursePlayer();
  if (S.tab==='courses')  return renderCourseList();
  if (S.tab==='progress') return renderProgress();
  if (S.tab==='certs')    return renderCertificates();
  return renderLearnerDashboard();
}

function renderLearnerDashboard() {
  const uid = S.session.id; const p = DB.prog(uid);
  const overall   = calcOverall(uid);
  const completed = COURSES.filter(c=>isCoursePassed(uid,c.id)).length;
  const quizDone  = COURSES.filter(c=>p[c.id]?.quizScore!=null).length;
  const streak    = getStreakDays(uid);
  return `<div class="fade">
    <h1 class="page-title">Hello, ${esc(S.session.name.split(' ')[0])} 👋</h1>
    <p class="page-sub">Here's your learning summary today.</p>
    <div class="stat-grid">
      ${[
        ['Content viewed', overall+'%', 'How much of all course material you have watched/read'],
        ['Courses passed', completed+'/'+COURSES.length, 'Courses where you finished all modules AND passed the quiz'],
        ['Quizzes attempted', quizDone+'/'+COURSES.length, 'Number of course quizzes you have taken'],
        ['Day streak', streak+'🔥', 'Consecutive days of learning activity']
      ].map(([l,v,tip])=>`<div class="stat-card" title="${tip}">
          <div class="stat-val">${v}</div>
          <div class="stat-lbl">${l}</div>
        </div>`).join('')}
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px">Your progress</p>
        <span style="font-size:11px;color:var(--muted)">Content viewed across all courses</span>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
        <div class="prog-bg" style="flex:1;height:10px"><div class="prog-fill" style="width:${overall}%;background:var(--accent);height:10px;border-radius:5px"></div></div>
        <span style="font-weight:700;font-size:16px">${overall}%</span>
      </div>
      <div style="display:flex;gap:16px;font-size:11px;color:var(--muted);margin-bottom:20px;flex-wrap:wrap">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent);vertical-align:middle;margin-right:5px"></span>Content viewed = modules watched/read</span>
        <span><span class="badge badge-green" style="padding:1px 7px;font-size:9px">Quiz</span> = your score on the course test</span>
      </div>
      ${COURSES.map(c=>{
        const pct=calcCourseProg(uid,c.id);
        const sc=p[c.id]?.quizScore;
        const wl=p[c.id]?.watched||[];
        const passed = sc!=null && sc>=SETTINGS.passThreshold;
        // Determine clear status
        let statusPill;
        if (passed && pct===100) statusPill = `<span class="badge badge-green">✓ Completed</span>`;
        else if (pct===100 && sc==null) statusPill = `<span class="badge badge-orange">Quiz pending</span>`;
        else if (pct===100 && !passed) statusPill = `<span class="badge badge-red">Quiz not passed</span>`;
        else if (pct>0) statusPill = `<span class="badge badge-blue">In progress</span>`;
        else statusPill = `<span class="badge badge-gray">Not started</span>`;
        return `<div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:14px;font-weight:600">${esc(c.title)}</span>
            ${statusPill}
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
            <span style="font-size:11px;color:var(--muted);width:90px">Content viewed</span>
            <div class="prog-bg" style="flex:1"><div class="prog-fill" style="width:${pct}%;background:var(--accent)"></div></div>
            <span style="font-size:12px;font-weight:600;width:42px;text-align:right">${pct}%</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:11px;color:var(--muted);width:90px">Quiz score</span>
            <div class="prog-bg" style="flex:1"><div class="prog-fill" style="width:${sc!=null?sc:0}%;background:${passed?'var(--success)':sc!=null?'var(--gold)':'rgba(10,10,15,0.1)'}"></div></div>
            <span style="font-size:12px;font-weight:600;width:42px;text-align:right;color:${sc!=null?(passed?'var(--success)':'var(--gold)'):'var(--muted)'}">${sc!=null?sc+'%':'—'}</span>
          </div>
          <p style="font-size:11px;color:var(--muted);margin-top:8px">${wl.length}/${c.modules.length} modules · Pass mark ${SETTINGS.passThreshold}%</p>
        </div>`;
      }).join('')}
    </div>
    <div class="card" style="background:var(--ink);border-color:var(--ink)">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;color:#F5F3EE;margin-bottom:6px">Continue learning</p>
      <p style="font-size:13px;color:rgba(245,243,238,0.5);margin-bottom:14px">Pick up where you left off.</p>
      <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="S.tab='courses';buildSidebar();render()">Go to my courses →</button>
    </div>
  </div>`;
}

function getStreakDays(uid) {
  // Simple streak: check last activity date
  const p = DB.prog(uid);
  const key = 'trv_streak_'+uid;
  try {
    const d = JSON.parse(localStorage.getItem(key)||'{"streak":0,"lastDate":""}');
    const today = new Date().toDateString();
    if (d.lastDate===today) return d.streak;
    const yesterday = new Date(Date.now()-86400000).toDateString();
    if (d.lastDate===yesterday) return d.streak; // maintain
    return d.streak; // return stored value
  } catch { return 0; }
}
function updateStreak(uid) {
  const key = 'trv_streak_'+uid;
  try {
    const d = JSON.parse(localStorage.getItem(key)||'{"streak":0,"lastDate":""}');
    const today = new Date().toDateString();
    if (d.lastDate===today) return;
    const yesterday = new Date(Date.now()-86400000).toDateString();
    const newStreak = d.lastDate===yesterday ? d.streak+1 : 1;
    localStorage.setItem(key,JSON.stringify({streak:newStreak,lastDate:today}));
  } catch {}
}

function renderCourseList() {
  const uid=S.session.id; const p=DB.prog(uid);
  return `<div class="fade">
    <h1 class="page-title">My Courses</h1>
    <p class="page-sub">Click a course to start or continue learning.</p>
    <div class="course-grid">
      ${COURSES.map(c=>{
        const pct=calcCourseProg(uid,c.id);const sc=p[c.id]?.quizScore;const allW=pct===100;
        const passed = sc!=null && sc>=SETTINGS.passThreshold;
        return `<div class="course-card" data-cid="${c.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <span class="badge ${c.catClass}">${esc(c.cat)}</span>
            ${passed?`<span class="badge badge-green">✓ Passed</span>`:
              sc!=null?`<span class="badge badge-orange">Quiz: ${sc}%</span>`:
              allW?`<span style="font-size:11px;color:var(--accent);font-weight:600">Take quiz →</span>`:''}
          </div>
          <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:17px;margin-bottom:6px">${esc(c.title)}</p>
          <p style="font-size:12px;color:var(--muted);margin-bottom:14px">${c.modules.length} modules · ${(c.quiz?c.quiz.length:0)} final quiz Qs</p>
          <div class="prog-bg"><div class="prog-fill" style="width:${pct}%;background:var(--accent)"></div></div>
          <p style="font-size:11px;color:var(--muted);margin-top:6px">${pct}% complete</p>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderCoursePlayer() {
  const c=S.activeCourse; const uid=S.session.id;
  const m=S.activeModule||c.modules[0];
  const p=DB.prog(uid); const pct=calcCourseProg(uid,c.id);
  const allW=pct===100; const sc=p[c.id]?.quizScore;
  const watched=(p[c.id]?.watched||[]);
  const isWatched=watched.includes(m.id);
  const videoComplete=S.videoWatched[m.id]||isWatched;

  // Determine which content sources exist for this module
  const hasVideo = !!S._videoUrl;
  const hasPdf   = !!S._pdfUrl;
  const hasUrl   = !!m.url;
  const sources = [];
  if (hasVideo) sources.push({key:'video', label:'🎬 Video'});
  if (hasPdf)   sources.push({key:'pdf',   label:'📄 PDF'});
  if (hasUrl)   sources.push({key:'url',   label:'🔗 Link'});
  // active tab (fall back to first available)
  let activeTab = S._contentTab;
  if (!activeTab || !sources.find(s=>s.key===activeTab)) activeTab = sources[0]?.key || null;

  // Content tabs (only if more than one source)
  let tabsBlock = '';
  if (sources.length > 1) {
    tabsBlock = `<div style="display:flex;gap:6px;margin-bottom:10px">
      ${sources.map(s=>`<button class="content-tab-btn btn-ghost btn-sm" data-tab="${s.key}"
        style="${activeTab===s.key?'border-color:var(--accent);color:var(--accent);font-weight:600':''}">${s.label}</button>`).join('')}
    </div>`;
  }

  let mediaBlock = tabsBlock;
  if (!sources.length) {
    mediaBlock += `<div class="video-wrapper" style="background:#1a1a2e;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">📭</div>
        <p style="color:rgba(255,255,255,0.6);font-size:13px">${esc(m.title)}</p>
        <p style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:4px">No content uploaded yet</p>
      </div>
    </div>`;
  } else if (activeTab==='video') {
    mediaBlock += `<div class="video-wrapper">
      <video id="course-video" src="${S._videoUrl}" controls controlsList="nodownload nofullscreen" disablePictureInPicture
        style="width:100%;height:100%"></video>
      <div class="video-progress-bar"><div class="video-progress-fill" id="vpf" style="width:0%"></div></div>
    </div>`;
  } else if (activeTab==='pdf') {
    mediaBlock += `<div class="pdf-wrapper">
      <iframe src="${S._pdfUrl}" title="${esc(m.title)}"></iframe>
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
      <span style="font-size:12px;color:var(--muted)">📄 PDF — scroll through it, then mark the module complete below.</span>
    </div>`;
  } else if (activeTab==='url') {
    mediaBlock += `<div class="pdf-wrapper" style="background:#0E1525;min-height:300px;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center;padding:30px">
        <div style="font-size:42px;margin-bottom:12px">🔗</div>
        <p style="color:#F5F3EE;font-size:14px;margin-bottom:6px">External resource</p>
        <p style="color:rgba(245,243,238,0.45);font-size:12px;margin-bottom:18px;word-break:break-all">${esc(m.url)}</p>
        <a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="display:inline-block;text-decoration:none;width:auto;padding:11px 26px">Open link in new tab ↗</a>
      </div>
    </div>`;
  }

  return `<div class="fade">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">
      <button class="btn-ghost btn-sm" id="back-btn">← Back</button>
      <h1 style="font-family:'Syne',sans-serif;font-weight:800;font-size:22px">${esc(c.title)}</h1>
      <span class="badge ${c.catClass}">${esc(c.cat)}</span>
    </div>
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:12px;color:var(--muted)">Course progress</span>
        <span style="font-size:12px;font-weight:600">${pct}%</span>
      </div>
      <div class="prog-bg"><div class="prog-fill" style="width:${pct}%;background:var(--accent)"></div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 230px;gap:18px">
      <div>
        ${mediaBlock}
        <div class="card" style="margin-bottom:12px">
          <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:17px;margin-bottom:4px">${esc(m.title)}</p>
          <p style="font-size:13px;color:var(--muted);margin-bottom:14px">${esc(m.description||m.dur)}</p>
          ${(() => {
            const modHasQuiz = m.quiz && m.quiz.length>0;
            const modQuizScore = getModuleQuizScore(uid, c.id, m.id);
            const modQuizPassed = modQuizScore!=null && modQuizScore>=SETTINGS.passThreshold;
            const moduleComplete = isModuleComplete(uid, c.id, m.id);
            // Step 1: watch/read the content
            if (!isWatched) {
              // If a video exists, require full watch (enforced by player). Otherwise allow manual mark.
              if (hasVideo && activeTab==='video') {
                return `<div id="video-status-msg" style="font-size:12px;color:var(--muted)">⏳ Watch the full video to continue${(hasPdf||hasUrl)?' (or switch tabs and mark complete after reviewing the other material)':''}</div>`;
              }
              return `<button class="btn-primary btn-sm" id="mark-btn" data-cid="${c.id}" data-mid="${m.id}" style="width:auto">Mark as complete</button>`;
            }
            // Step 2: content watched — show quiz status / button
            if (!modHasQuiz) {
              return `<span class="badge badge-green" style="font-size:12px;padding:5px 14px">✓ Module complete</span>`;
            }
            if (modQuizPassed) {
              return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span class="badge badge-green" style="font-size:12px;padding:5px 14px">✓ Quiz passed: ${modQuizScore}%</span>
                <button class="btn-ghost btn-sm start-quiz-btn" data-cid="${c.id}" data-mid="${m.id}">Retake module quiz</button>
              </div>`;
            }
            // Watched but quiz not passed (or not taken yet)
            return `<div style="background:#FFF3E0;border:1px solid #FFD9A8;border-radius:var(--r);padding:14px">
              <p style="font-weight:600;font-size:13px;margin-bottom:4px">📝 Module quiz required</p>
              <p style="font-size:12px;color:var(--muted);margin-bottom:12px">${modQuizScore!=null?`Last score: ${modQuizScore}% — you need ${SETTINGS.passThreshold}% to unlock the next module.`:`Pass this quiz (${SETTINGS.passThreshold}%) to unlock the next module.`}</p>
              <button class="btn-primary btn-sm start-quiz-btn" data-cid="${c.id}" data-mid="${m.id}" style="width:auto;background:var(--accent)">
                ${modQuizScore!=null?'Retake module quiz':'Start module quiz →'}
              </button>
            </div>`;
          })()}
        </div>
        ${allW ? `<div class="card" style="background:#EAFAF4;border-color:#9FE1CB">
          <p style="font-weight:600;color:var(--success);margin-bottom:6px">🎉 ${sc!=null?'Final quiz taken!':'All modules complete!'}</p>
          <p style="font-size:13px;color:#085041;margin-bottom:12px">${sc!=null?`Your final quiz score: <strong>${sc}%</strong>. Retake anytime.`:'You\'ve passed every module — take the final quiz to complete the course.'}</p>
          <button class="btn-primary btn-sm start-quiz-btn" data-cid="${c.id}" style="width:auto;background:var(--success)">
            ${sc!=null?'Retake final quiz':'Start final quiz →'}
          </button>
        </div>` : (c.quiz && c.quiz.length ? `<div class="card" style="background:rgba(10,10,15,0.03)">
          <p style="font-weight:600;font-size:13px;color:var(--muted)">🔒 Final course quiz locked</p>
          <p style="font-size:12px;color:var(--muted);margin-top:4px">Complete all modules (watch + pass each module quiz) to unlock the final quiz.</p>
        </div>` : '')}
      </div>
      <div class="card" style="padding:16px">
        <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;margin-bottom:12px">Modules</p>
        ${c.modules.map((mod,i)=>{
          const complete=isModuleComplete(uid, c.id, mod.id);
          const unlocked=isModuleUnlocked(uid, c.id, i);
          const isActive=S.activeModule?.id===mod.id;
          const numBg=complete?'var(--success)':unlocked?'rgba(10,10,15,0.06)':'rgba(10,10,15,0.03)';
          const numColor=complete?'#fff':'var(--muted)';
          const modHasQuiz = mod.quiz && mod.quiz.length>0;
          return `<div class="mod-item${isActive?' active':''}${unlocked?'':' locked-mod'}" data-mid="${mod.id}" data-unlocked="${unlocked}" style="${unlocked?'':'opacity:0.5;cursor:not-allowed'}">
            <div class="mod-num" style="background:${numBg};color:${numColor}">${complete?'✓':unlocked?i+1:'🔒'}</div>
            <div>
              <p style="font-size:13px;font-weight:500">${esc(mod.title)}</p>
              <p style="font-size:11px;color:var(--muted)">${mod.dur}${[mod.video?'🎬':'',mod.pdf?'📄':'',mod.url?'🔗':''].filter(Boolean).length?' · '+[mod.video?'🎬':'',mod.pdf?'📄':'',mod.url?'🔗':''].filter(Boolean).join(' '):''}${modHasQuiz?' · 📝':''}</p>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function getRetakeCount(uid, cid) {
  try { return parseInt(localStorage.getItem('trv_retakes_'+uid+'_'+cid)||'0'); } catch { return 0; }
}
function incrementRetakeCount(uid, cid) {
  const n = getRetakeCount(uid, cid) + 1;
  localStorage.setItem('trv_retakes_'+uid+'_'+cid, n);
  return n;
}

function getQuizDef(cid, mid) {
  const c = COURSES.find(x=>x.id===cid);
  if (!c) return null;
  if (mid) { const m = c.modules.find(x=>x.id===mid); return m ? (m.quiz||[]) : []; }
  return c.quiz || [];
}
// Unique key for retake counting & answer storage (course quiz vs module quiz)
function quizKey(cid, mid) { return mid ? cid+'_mod_'+mid : cid; }

function saveQuizResult(cid, mid, score, answers) {
  const p = DB.prog(S.session.id);
  if (!p[cid]) p[cid] = {watched:[], quizScore:null, moduleQuiz:{}};
  if (!p[cid].moduleQuiz) p[cid].moduleQuiz = {};
  if (mid) {
    p[cid].moduleQuiz[mid] = score;
  } else {
    p[cid].quizScore = score;
  }
  DB.saveProg(S.session.id, p);
  localStorage.setItem('trv_qa_'+S.session.id+'_'+quizKey(cid,mid), JSON.stringify(answers));
  updateStreak(S.session.id);
}

function renderQuiz() {
  const c=COURSES.find(x=>x.id===S.quiz.cid);
  const mid=S.quiz.mid||null;
  const quizArr=getQuizDef(S.quiz.cid, mid);
  const isModuleQuiz=!!mid;
  const modObj=isModuleQuiz?c.modules.find(m=>m.id===mid):null;
  const quizTitle=isModuleQuiz?`${c.title} — ${modObj?modObj.title:'Module'}`:`${c.title} — Final Quiz`;
  const pass=SETTINGS.passThreshold;
  const maxRetakes=SETTINGS.maxRetakes; // 0 = unlimited
  const rkey=quizKey(S.quiz.cid, mid);

  if (S.quiz.done) {
    const passed=S.quiz.score>=pass;
    const retakesDone=getRetakeCount(S.session.id,rkey);
    const retakesLeft=maxRetakes===0?Infinity:Math.max(0,maxRetakes-retakesDone);
    const canRetry=!passed&&retakesLeft>0;
    const retakesMsg=maxRetakes===0?'Unlimited retakes allowed'
      :retakesDone>=maxRetakes?'No retakes remaining'
      :`${retakesLeft} retake${retakesLeft!==1?'s':''} remaining`;
    return `<div class="fade" style="max-width:500px;margin:0 auto">
      <div class="card pop" style="text-align:center;padding:48px 32px">
        <div style="font-size:56px;margin-bottom:16px">${passed?'🏆':retakesLeft>0?'📚':'❌'}</div>
        <h2 style="font-family:'Syne',sans-serif;font-weight:800;font-size:28px;margin-bottom:8px">
          ${passed?'Well done!':retakesLeft>0?'Keep going!':'No retakes left'}
        </h2>
        <p style="font-size:13px;color:var(--muted);margin-bottom:6px">${esc(quizTitle)}</p>
        <p style="font-size:15px;color:var(--muted);margin-bottom:6px">You scored</p>
        <p style="font-family:'Syne',sans-serif;font-weight:800;font-size:48px;color:${passed?'var(--success)':'var(--accent)'};margin-bottom:6px">${S.quiz.score}%</p>
        <p style="font-size:13px;color:var(--muted);margin-bottom:8px">${S.quiz.answers.reduce((a,ans,i)=>a+(ans===quizArr[i].ans?1:0),0)} of ${quizArr.length} correct</p>
        <p style="font-size:12px;color:var(--muted);margin-bottom:24px">Pass mark: <strong>${pass}%</strong></p>
        ${passed&&isModuleQuiz?`<div style="background:#EAFAF4;border-radius:var(--r);padding:14px;margin-bottom:24px">
          <p style="font-size:13px;color:var(--success);font-weight:600">✓ Module passed — next module unlocked!</p>
        </div>`:''}
        ${passed&&!isModuleQuiz?`<div style="background:#EAFAF4;border-radius:var(--r);padding:14px;margin-bottom:24px">
          <p style="font-size:13px;color:var(--success);font-weight:600">🎓 Course complete — certificate earned!</p>
          <p style="font-size:12px;color:#085041;margin-top:4px">View it in My Certificates</p>
        </div>`:''}
        ${!passed&&!canRetry?`<div style="background:#FEF2F2;border:1px solid #F09595;border-radius:var(--r);padding:14px;margin-bottom:24px">
          <p style="font-size:13px;color:var(--danger);font-weight:600">Retake limit reached</p>
          <p style="font-size:12px;color:#791F1F;margin-top:4px">Contact your administrator to reset your quiz attempts.</p>
        </div>`:''}
        ${!passed&&canRetry?`<p style="font-size:13px;color:var(--muted);margin-bottom:24px">
          You need <strong>${pass}%</strong> to ${isModuleQuiz?'unlock the next module':'pass'}. ${retakesMsg}.
        </p>`:''}
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn-primary" style="width:auto;padding:11px 26px" id="quiz-back-btn">Back to course</button>
          ${canRetry?`<button class="btn-ghost" id="quiz-retry-btn">Retry quiz</button>`:''}
          ${passed&&!isModuleQuiz?`<button class="btn-ghost" onclick="S.tab='certs';buildSidebar();S.quiz=null;render()">View certificate</button>`:''}
        </div>
        ${!passed&&maxRetakes>0?`<p style="font-size:11px;color:var(--muted);margin-top:16px">${retakesMsg}</p>`:''}
      </div>
      ${S.quiz.reviewMode?`<div class="card" style="margin-top:16px">
        <p style="font-family:'Syne',sans-serif;font-weight:700;margin-bottom:14px">Review answers</p>
        ${quizArr.map((q,i)=>{
          const userAns=S.quiz.answers[i]; const correct=q.ans===userAns;
          return `<div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid var(--border)">
            <p style="font-size:13px;font-weight:600;margin-bottom:8px">${i+1}. ${esc(q.q)}</p>
            ${q.opts.map((o,oi)=>`<div style="padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:4px;
              background:${oi===q.ans?'#EAFAF4':oi===userAns&&!correct?'#FEF2F2':'transparent'};
              border:1px solid ${oi===q.ans?'#9FE1CB':oi===userAns&&!correct?'#F09595':'var(--border)'}">
              ${oi===q.ans?'✓ ':''}${oi===userAns&&!correct?'✗ ':''}<span style="color:var(--muted)">${String.fromCharCode(65+oi)}.</span> ${esc(o)}
            </div>`).join('')}
          </div>`;
        }).join('')}
      </div>`:
      `<div style="text-align:center;margin-top:12px">
        <button class="btn-ghost btn-sm" onclick="S.quiz.reviewMode=true;render()">Review answers</button>
      </div>`}
    </div>`;
  }
  const q=quizArr[S.quiz.step];
  const retakesDone=getRetakeCount(S.session.id,rkey);
  const retakesLeft=maxRetakes===0?null:Math.max(0,maxRetakes-retakesDone);
  return `<div class="fade" style="max-width:560px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
      <div>
        <h1 style="font-family:'Syne',sans-serif;font-weight:800;font-size:20px">${esc(quizTitle)}</h1>
        <p style="font-size:13px;color:var(--muted)">Question ${S.quiz.step+1} of ${quizArr.length} · ${isModuleQuiz?'Module quiz':'Final course quiz'}</p>
      </div>
      <div style="text-align:right">
        <button class="btn-ghost btn-sm" id="quiz-exit-btn">Exit</button>
        <p style="font-size:11px;color:var(--muted);margin-top:4px">Pass: ${pass}%${maxRetakes===0?'':` · ${retakesLeft} retake${retakesLeft!==1?'s':''} left`}</p>
      </div>
    </div>
    <div class="prog-bg" style="margin-bottom:24px">
      <div class="prog-fill" style="width:${S.quiz.step/quizArr.length*100}%;background:var(--accent)"></div>
    </div>
    <div class="card" style="padding:28px">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:18px;margin-bottom:22px;line-height:1.45">${esc(q.q)}</p>
      ${q.opts.map((o,i)=>`<div class="quiz-opt" data-oi="${i}">
        <span style="font-weight:600;color:var(--accent);margin-right:8px">${String.fromCharCode(65+i)}.</span>${esc(o)}
      </div>`).join('')}
    </div>
  </div>`;
}

function renderProgress() {
  const uid=S.session.id; const p=DB.prog(uid);
  const overall=calcOverall(uid);
  return `<div class="fade">
    <h1 class="page-title">My Progress</h1>
    <p class="page-sub">Detailed view of every course and module.</p>
    <div class="card" style="margin-bottom:20px;background:var(--ink);border-color:var(--ink)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <p style="font-family:'Syne',sans-serif;font-weight:800;font-size:36px;color:#F5F3EE">${overall}%</p>
          <p style="font-size:13px;color:rgba(245,243,238,0.5)">Overall completion across all courses</p>
        </div>
        <div style="text-align:right">
          <p style="font-family:'Syne',sans-serif;font-weight:800;font-size:24px;color:var(--gold)">${COURSES.filter(c=>isCoursePassed(uid,c.id)).length}</p>
          <p style="font-size:12px;color:rgba(245,243,238,0.4)">Courses passed</p>
        </div>
      </div>
      <div class="prog-bg" style="margin-top:16px;height:8px"><div class="prog-fill" style="width:${overall}%;background:var(--accent);height:8px;border-radius:4px"></div></div>
    </div>
    ${COURSES.map(c=>{
      const pct=calcCourseProg(uid,c.id);const sc=p[c.id]?.quizScore;const wl=p[c.id]?.watched||[];
      return `<div class="card" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px">${esc(c.title)}</p>
            <p style="font-size:12px;color:var(--muted)">${wl.length}/${c.modules.length} modules completed · ${sc!=null?`Quiz: ${sc}%`:'Quiz pending'}</p>
          </div>
          <div style="display:flex;gap:7px">
            ${sc!=null?`<span class="badge ${sc>=SETTINGS.passThreshold?'badge-green':'badge-orange'}">${sc>=SETTINGS.passThreshold?'Passed':'Failed'}: ${sc}%</span>`
              :`<span class="badge badge-red">Quiz pending</span>`}
          </div>
        </div>
        <div class="prog-bg" style="margin-bottom:12px"><div class="prog-fill" style="width:${pct}%;background:var(--accent)"></div></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${c.modules.map(mod=>{
            const d=wl.includes(mod.id);
            return `<span style="font-size:11px;padding:3px 11px;border-radius:100px;background:${d?'#EAFAF4':'rgba(10,10,15,0.05)'};color:${d?'var(--success)':'var(--muted)'}">${d?'✓ ':'○ '}${esc(mod.title)}</span>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderCertificates() {
  const uid=S.session.id; const p=DB.prog(uid);
  const passed=COURSES.filter(c=>isCoursePassed(uid,c.id));
  return `<div class="fade">
    <h1 class="page-title">My Certificates</h1>
    <p class="page-sub">Certificates earned by passing courses with ≥${SETTINGS.passThreshold}%.</p>
    ${passed.length===0
      ? `<div class="empty"><div class="big-icon">🏆</div><p>No certificates yet. Complete a course and pass the quiz to earn one!</p></div>`
      : `<div class="course-grid">${passed.map(c=>{
          const hasFinal=c.quiz&&c.quiz.length>0;
          const sc=hasFinal?p[c.id]?.quizScore:null;
          return `<div class="cert-wrapper">
            <div style="font-size:36px;margin-bottom:12px;z-index:1;position:relative">🏆</div>
            <p style="font-family:'Syne',sans-serif;font-weight:800;font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--gold);margin-bottom:8px;z-index:1;position:relative">Certificate of Completion</p>
            <p style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:#F5F3EE;margin-bottom:8px;z-index:1;position:relative">${esc(c.title)}</p>
            <p style="font-size:12px;color:rgba(245,243,238,0.5);margin-bottom:16px;z-index:1;position:relative">Awarded to <strong style="color:#F5F3EE">${esc(S.session.name)}</strong></p>
            <span class="badge badge-green" style="z-index:1;position:relative">${sc!=null?'Final score: '+sc+'% ✓':'All modules passed ✓'}</span>
          </div>`;
        }).join('')}</div>`}
  </div>`;
}

// ═══════════════════════════════════════════════════
// ADMIN VIEWS
// ═══════════════════════════════════════════════════
function renderAdmin() {
  if (S.tab==='learners'&&S.selectedUser) return renderLearnerDetail();
  if (S.tab==='learners') return renderLearnersList();
  if (S.tab==='courses')  return renderAdminCourses();
  if (S.tab==='reports')  return renderReports();
  if (S.tab==='settings') return renderAdminSettings();
  return renderAdminDashboard();
}

function getAllStats() {
  return DB.users().map(u=>{
    const p=DB.prog(u.id);
    const overall=calcOverall(u.id);
    const qDone=COURSES.filter(c=>p[c.id]?.quizScore!=null).length;
    const passed=COURSES.filter(c=>isCoursePassed(u.id,c.id)).length;
    const avgQ=COURSES.length?Math.round(COURSES.filter(c=>p[c.id]?.quizScore!=null).reduce((a,c)=>a+(p[c.id]?.quizScore||0),0)/Math.max(1,COURSES.filter(c=>p[c.id]?.quizScore!=null).length)):0;
    return {...u,overall,qDone,passed,avgQ,p};
  });
}

function renderAdminDashboard() {
  const stats=getAllStats();
  const avgC=stats.length?Math.round(stats.reduce((a,u)=>a+u.overall,0)/stats.length):0;
  const atRisk=stats.filter(u=>u.overall<30&&!u.disabled).length;
  return `<div class="fade">
    <h1 class="page-title">Admin Dashboard</h1>
    <p class="page-sub">Organisation-wide learning metrics.</p>
    <div class="stat-grid">
      ${[[stats.filter(u=>!u.disabled).length,'Active learners'],[avgC+'%','Avg completion'],[atRisk,'At risk (<30%)'],[COURSES.length,'Active courses']]
        .map(([v,l])=>`<div class="stat-card"><div class="stat-val">${v}</div><div class="stat-lbl">${l}</div></div>`).join('')}
    </div>
    <div class="card" style="margin-bottom:16px">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:16px">Course completion overview</p>
      ${COURSES.map(c=>{
        const avg=stats.length?Math.round(stats.filter(u=>!u.disabled).reduce((a,u)=>a+calcCourseProg(u.id,c.id),0)/Math.max(1,stats.filter(u=>!u.disabled).length)):0;
        const passCount=stats.filter(u=>!u.disabled&&u.p[c.id]?.quizScore>=SETTINGS.passThreshold).length;
        return `<div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span style="font-size:13px;font-weight:500">${esc(c.title)}</span>
            <span style="font-size:12px;color:var(--muted)">Avg: ${avg}% · ${passCount} passed quiz</span>
          </div>
          <div class="prog-bg"><div class="prog-fill" style="width:${avg}%;background:var(--gold)"></div></div>
        </div>`;
      }).join('')}
    </div>
    ${stats.length?`<div class="card">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:14px">Learner overview</p>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Progress</th><th>Quizzes</th><th>Status</th></tr></thead>
        <tbody>
          ${stats.map(u=>`<tr class="clickable-row learner-row" data-uid="${u.id}">
            <td><strong>${esc(u.name)}</strong>${u.disabled?`<span class="badge badge-red" style="margin-left:6px">Disabled</span>`:''}</td>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div class="prog-bg" style="width:90px"><div class="prog-fill" style="width:${u.overall}%;background:var(--gold)"></div></div>
              <span>${u.overall}%</span>
            </div></td>
            <td>${u.qDone}/${COURSES.length}</td>
            <td>${statusBadge(u.overall)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`:`<div class="empty"><div class="big-icon">👥</div><p>No learners registered yet.</p></div>`}
  </div>`;
}

function renderLearnersList() {
  const stats=getAllStats();
  return `<div class="fade">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 class="page-title">Learners</h1>
      <div style="display:flex;gap:8px">
        <button class="btn-ghost btn-sm" id="add-learner-btn">+ Add Learner</button>
      </div>
    </div>
    <p class="page-sub">${stats.length} registered learner${stats.length!==1?'s':''} · Click a row to manage</p>
    ${stats.length?`<div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center">
        <input type="text" id="learner-search" placeholder="Search by name or email…" style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--r);font-size:13px;outline:none">
      </div>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Subject</th><th>Progress</th><th>Quizzes</th><th>Avg score</th><th>Status</th></tr></thead>
        <tbody id="learner-tbody">
          ${stats.map(u=>`<tr class="clickable-row learner-row" data-uid="${u.id}">
            <td><strong>${esc(u.name)}</strong>${u.disabled?`<span class="badge badge-red" style="margin-left:6px">Disabled</span>`:''}</td>
            <td style="color:var(--muted)">${esc(u.email)}</td>
            <td style="color:var(--muted)">${esc(u.dept||'—')}</td>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div class="prog-bg" style="width:80px"><div class="prog-fill" style="width:${u.overall}%;background:var(--gold)"></div></div>
              <span>${u.overall}%</span>
            </div></td>
            <td>${u.qDone}/${COURSES.length}</td>
            <td>${u.avgQ}%</td>
            <td>${statusBadge(u.overall)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`:`<div class="empty"><div class="big-icon">👥</div><p>No learners yet.</p><br><button class="btn-primary" style="width:auto;padding:10px 24px" id="add-learner-btn2">+ Add first learner</button></div>`}
  </div>`;
}

function renderLearnerDetail() {
  const stats=getAllStats();
  const u=stats.find(x=>x.id===S.selectedUser);
  if (!u){S.selectedUser=null;return renderLearnersList();}
  return `<div class="fade">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;flex-wrap:wrap">
      <button class="btn-ghost btn-sm" id="back-learners-btn">← Back</button>
      <h1 style="font-family:'Syne',sans-serif;font-weight:800;font-size:24px">${esc(u.name)}</h1>
      ${statusBadge(u.overall)}
      ${u.disabled?`<span class="badge badge-red">Disabled</span>`:''}
    </div>
    <div class="tab-bar">
      <button class="tab-btn${S.adminSubTab==='info'?' active':''}" data-subtab="info">Profile & Progress</button>
      <button class="tab-btn${S.adminSubTab==='edit'?' active':''}" data-subtab="edit">Edit Details</button>
      <button class="tab-btn${S.adminSubTab==='reset'?' active':''}" data-subtab="reset">Change Password</button>
    </div>
    ${S.adminSubTab==='info'?renderLearnerInfo(u):S.adminSubTab==='edit'?renderLearnerEdit(u):renderLearnerPwReset(u)}
  </div>`;
}

function renderLearnerInfo(u) {
  return `<div>
    <div class="stat-grid">
      ${[[u.overall+'%','Overall progress'],[u.passed+'/'+COURSES.length,'Courses passed'],[u.qDone+'/'+COURSES.length,'Quizzes done'],[u.avgQ+'%','Avg quiz score']]
        .map(([v,l])=>`<div class="stat-card"><div class="stat-val" style="font-size:${v.length>6?'18px':'28px'}">${v}</div><div class="stat-lbl">${l}</div></div>`).join('')}
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px">Per-course breakdown</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-ghost btn-sm" id="export-report-btn" data-uid="${u.id}">⬇ Download report</button>
          <button class="btn-ghost btn-sm" id="export-quiz-btn" data-uid="${u.id}">⬇ Quiz responses CSV</button>
          <button class="btn-danger btn-sm" id="reset-progress-btn" data-uid="${u.id}">Reset progress</button>
          <button class="btn-danger btn-sm" id="toggle-disable-btn" data-uid="${u.id}" data-disabled="${u.disabled}">
            ${u.disabled?'Enable account':'Disable account'}
          </button>
          <button class="btn-danger btn-sm" id="delete-learner-btn" data-uid="${u.id}">Delete learner</button>
        </div>
      </div>
      ${COURSES.map(c=>{
        const pct=calcCourseProg(u.id,c.id);const sc=u.p[c.id]?.quizScore;const wl=u.p[c.id]?.watched||[];
        return `<div style="margin-bottom:22px;padding-bottom:22px;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <p style="font-weight:600;font-size:14px">${esc(c.title)}</p>
            ${sc!=null?`<span class="badge ${sc>=SETTINGS.passThreshold?'badge-green':'badge-orange'}">Quiz: ${sc}%</span>`
              :`<span class="badge badge-red">Quiz not taken</span>`}
          </div>
          <p style="font-size:12px;color:var(--muted);margin-bottom:8px">${wl.length}/${c.modules.length} modules watched</p>
          <div class="prog-bg"><div class="prog-fill" style="width:${pct}%;background:var(--gold)"></div></div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
            ${c.modules.map(mod=>{const d=wl.includes(mod.id);return`<span style="font-size:11px;padding:3px 11px;border-radius:100px;background:${d?'#EAFAF4':'rgba(10,10,15,0.05)'};color:${d?'var(--success)':'var(--muted)'}">${d?'✓ ':'○ '}${esc(mod.title)}</span>`;}).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderLearnerEdit(u) {
  return `<div class="card" style="max-width:480px">
    <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:18px">Edit learner details</p>
    <div class="field"><label>Full name</label><input type="text" id="edit-name" value="${esc(u.name)}"></div>
    <div class="field"><label>Email address</label><input type="email" id="edit-email" value="${esc(u.email)}"></div>
    <div class="field"><label>Subject</label><input type="text" id="edit-dept" value="${esc(u.dept||'')}"></div>
    <div class="field"><label>Notes (admin only)</label><textarea id="edit-notes">${esc(u.notes||'')}</textarea></div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn-primary" style="width:auto;padding:10px 24px" id="save-edit-btn" data-uid="${u.id}">Save changes</button>
      <button class="btn-ghost" id="back-learners-btn">Cancel</button>
    </div>
  </div>`;
}

function renderLearnerPwReset(u) {
  return `<div class="card" style="max-width:400px">
    <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:6px">Change password for ${esc(u.name)}</p>
    <p style="font-size:13px;color:var(--muted);margin-bottom:18px">Set a temporary password for this learner. They can change it after logging in.</p>
    <div class="field"><label>New password</label><input type="password" id="new-pw" placeholder="Minimum 6 characters"></div>
    <div class="field"><label>Confirm new password</label><input type="password" id="new-pw2" placeholder="Repeat password"></div>
    <div id="pw-msg"></div>
    <button class="btn-primary" style="width:auto;padding:10px 24px" id="save-pw-btn" data-uid="${u.id}">Update password</button>
  </div>`;
}

function renderAdminCourses() {
  const stats=getAllStats();
  return `<div class="fade">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 class="page-title">Courses</h1>
      <button class="btn-primary" style="width:auto;padding:10px 22px" id="add-course-btn">+ New Course</button>
    </div>
    <p class="page-sub">Manage course library, modules, and quizzes.</p>
    <div class="course-grid">
      ${COURSES.map(c=>{
        const avg=stats.length?Math.round(stats.filter(u=>!u.disabled).reduce((a,u)=>a+calcCourseProg(u.id,c.id),0)/Math.max(1,stats.filter(u=>!u.disabled).length)):0;
        return `<div class="course-card" data-edit-cid="${c.id}" style="position:relative">
          <span class="badge ${c.catClass}" style="margin-bottom:8px;display:inline-block">${esc(c.cat)}</span>
          <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:17px;margin-bottom:6px">${esc(c.title)}</p>
          <p style="font-size:12px;color:var(--muted);margin-bottom:14px">${c.modules.length} modules · ${(c.quiz?c.quiz.length:0)} final quiz Qs</p>
          <div class="prog-bg"><div class="prog-fill" style="width:${avg}%;background:var(--gold)"></div></div>
          <p style="font-size:11px;color:var(--muted);margin-top:6px;margin-bottom:14px">Avg learner completion: ${avg}%</p>
          <div style="display:flex;gap:8px">
            <button class="btn-ghost btn-sm edit-course-btn" data-cid="${c.id}">Edit course</button>
            <button class="btn-danger btn-sm delete-course-btn" data-cid="${c.id}">Delete</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderReports() {
  const stats=getAllStats().filter(u=>!u.disabled);
  const totalLearners=stats.length;
  const completed=stats.filter(u=>u.overall===100).length;
  const atRisk=stats.filter(u=>u.overall<30).length;
  const avgScore=totalLearners?Math.round(stats.reduce((a,u)=>a+u.overall,0)/totalLearners):0;
  return `<div class="fade">
    <h1 class="page-title">Reports</h1>
    <p class="page-sub">Organisation-wide analytics and insights.</p>
    <div class="stat-grid">
      ${[[totalLearners,'Active learners'],[avgScore+'%','Avg completion'],[completed,'Fully completed'],[atRisk,'At risk']]
        .map(([v,l])=>`<div class="stat-card"><div class="stat-val">${v}</div><div class="stat-lbl">${l}</div></div>`).join('')}
    </div>
    <div class="card" style="margin-bottom:16px">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:16px">Course performance</p>
      <table class="data-table">
        <thead><tr><th>Course</th><th>Modules</th><th>Avg completion</th><th>Learners passed quiz</th><th>Avg quiz score</th></tr></thead>
        <tbody>
          ${COURSES.map(c=>{
            const avg=stats.length?Math.round(stats.reduce((a,u)=>a+calcCourseProg(u.id,c.id),0)/Math.max(1,stats.length)):0;
            const passCount=stats.filter(u=>u.p[c.id]?.quizScore>=SETTINGS.passThreshold).length;
            const avgQ=stats.filter(u=>u.p[c.id]?.quizScore!=null).length
              ?Math.round(stats.filter(u=>u.p[c.id]?.quizScore!=null).reduce((a,u)=>a+(u.p[c.id]?.quizScore||0),0)/Math.max(1,stats.filter(u=>u.p[c.id]?.quizScore!=null).length)):0;
            return `<tr>
              <td><strong>${esc(c.title)}</strong></td>
              <td>${c.modules.length}</td>
              <td><div style="display:flex;align-items:center;gap:8px">
                <div class="prog-bg" style="width:80px"><div class="prog-fill" style="width:${avg}%;background:var(--gold)"></div></div>
                ${avg}%
              </div></td>
              <td>${passCount}/${stats.length}</td>
              <td>${avgQ}%</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="card">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:16px">Learner progress breakdown</p>
      <table class="data-table">
        <thead><tr><th>Learner</th><th>Subject</th>${COURSES.map(c=>`<th>${esc(c.title.slice(0,12))}…</th>`).join('')}<th>Overall</th><th>Status</th></tr></thead>
        <tbody>
          ${stats.map(u=>`<tr>
            <td><strong>${esc(u.name)}</strong></td>
            <td style="color:var(--muted)">${esc(u.dept||'—')}</td>
            ${COURSES.map(c=>`<td><span class="badge ${u.p[c.id]?.quizScore>=SETTINGS.passThreshold?'badge-green':u.p[c.id]?.quizScore!=null?'badge-orange':'badge-gray'}">${u.p[c.id]?.quizScore!=null?u.p[c.id].quizScore+'%':'—'}</span></td>`).join('')}
            <td><div style="display:flex;align-items:center;gap:6px">
              <div class="prog-bg" style="width:60px"><div class="prog-fill" style="width:${u.overall}%;background:var(--gold)"></div></div>
              ${u.overall}%
            </div></td>
            <td>${statusBadge(u.overall)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// ADMIN SETTINGS VIEW
// ═══════════════════════════════════════════════════
function renderAdminSettings() {
  const stats=getAllStats();
  return `<div class="fade">
    <h1 class="page-title">Settings</h1>
    <p class="page-sub">Configure quiz rules and manage learner quiz attempts.</p>

    <div class="card" style="max-width:520px;margin-bottom:20px">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:4px">Quiz Rules</p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:20px">These settings apply to all courses platform-wide.</p>

      <div class="field">
        <label>Passing score (%)</label>
        <div style="display:flex;align-items:center;gap:12px">
          <input type="number" id="st-pass" min="1" max="100" value="${SETTINGS.passThreshold}"
            style="width:100px">
          <span style="font-size:12px;color:var(--muted)">Learners must score at least this % to pass (default: 80%)</span>
        </div>
      </div>

      <div class="field">
        <label>Maximum retakes per quiz</label>
        <div style="display:flex;align-items:center;gap:12px">
          <input type="number" id="st-retakes" min="0" max="99" value="${SETTINGS.maxRetakes}"
            style="width:100px">
          <span style="font-size:12px;color:var(--muted)">Set to 0 for unlimited retakes (default: 2)</span>
        </div>
      </div>

      <div id="st-msg"></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px">
        <button class="btn-primary" style="width:auto;padding:10px 24px" id="st-save-btn">Save settings</button>
        <button class="btn-ghost btn-sm" id="st-reset-btn">Reset to defaults</button>
      </div>
    </div>

    <div class="card" style="max-width:520px;margin-bottom:20px">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:4px">Admin Password Reset PIN</p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:18px">Set a PIN that allows the admin account password to be reset from the login screen if forgotten. Keep this somewhere safe.</p>
      <div class="field">
        <label>Admin PIN</label>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="password" id="st-admin-pin" placeholder="Set a PIN (any length)"
            style="max-width:200px" value="${localStorage.getItem('trv_admin_pin')||''}">
          <button class="btn-primary" style="width:auto;padding:9px 20px" id="st-pin-save-btn">Save PIN</button>
        </div>
      </div>
      <div id="st-pin-msg"></div>
    </div>

    <div class="card">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:4px">Learner Quiz Attempts</p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
        View how many retakes each learner has used and reset their attempts if needed.
        Current limit: <strong>${SETTINGS.maxRetakes===0?'Unlimited':SETTINGS.maxRetakes+' retake'+(SETTINGS.maxRetakes!==1?'s':'')}</strong>.
      </p>
      ${stats.length?`<table class="data-table">
        <thead>
          <tr>
            <th>Learner</th>
            ${COURSES.map(c=>`<th>${esc(c.title.length>14?c.title.slice(0,14)+'…':c.title)}<br><span style="font-weight:400;font-size:10px">retakes used</span></th>`).join('')}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${stats.map(u=>`<tr>
            <td><strong>${esc(u.name)}</strong></td>
            ${COURSES.map(c=>{
              const used=getRetakeCount(u.id,c.id);
              const over=SETTINGS.maxRetakes>0&&used>=SETTINGS.maxRetakes;
              return `<td><span class="badge ${over?'badge-red':used>0?'badge-orange':'badge-green'}">${used}${SETTINGS.maxRetakes>0?'/'+SETTINGS.maxRetakes:' used'}</span></td>`;
            }).join('')}
            <td>
              <button class="btn-ghost btn-sm reset-attempts-btn" data-uid="${u.id}" title="Reset all quiz attempt counters for this learner">Reset all</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`:`<div class="empty"><div class="big-icon">👥</div><p>No learners registered yet.</p></div>`}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════
function openModal(html) {
  const root=document.getElementById('modal-root');
  root.style.display='flex';
  root.innerHTML=`<div class="modal-overlay" id="modal-overlay"><div class="modal pop">${html}</div></div>`;
  document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target.id==='modal-overlay')closeModal();});
  bindModalEvents();
}
function closeModal() {
  const root=document.getElementById('modal-root');
  root.style.display='none';
  root.innerHTML='';
}

function openAddLearnerModal() {
  openModal(`
    <h3>Add Learner</h3>
    <p class="modal-sub">Create a new learner account manually.</p>
    <div class="field"><label>Full name</label><input type="text" id="ml-name" placeholder="Priya Kapoor"></div>
    <div class="field"><label>Email address</label><input type="email" id="ml-email" placeholder="priya@company.com"></div>
    <div class="field"><label>Subject (optional)</label><input type="text" id="ml-dept" placeholder="e.g. Science"></div>
    <div class="field"><label>Temporary password</label><input type="password" id="ml-pw" placeholder="Min 6 characters"></div>
    <div class="field">
      <label>Security question <span style="font-size:10px;color:var(--muted)">(learner can use this to reset password)</span></label>
      <select id="ml-sq">
        <option value="">— Choose a question —</option>
        <option value="pet">What was the name of your first pet?</option>
        <option value="city">What city were you born in?</option>
        <option value="mother">What is your mother's maiden name?</option>
        <option value="school">What was the name of your primary school?</option>
        <option value="friend">What is the name of your childhood best friend?</option>
      </select>
    </div>
    <div class="field"><label>Security answer</label><input type="text" id="ml-sa" placeholder="Answer (case-insensitive)"></div>
    <div id="ml-msg"></div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:10px 24px" id="ml-save-btn">Create account</button>
    </div>`);
}

function openAddCourseModal(existingCourse) {
  const c=existingCourse||null;
  const isEdit=!!c;
  openModal(`
    <h3>${isEdit?'Edit Course':'New Course'}</h3>
    <p class="modal-sub">${isEdit?'Update course details, modules, per-module quizzes, and the final quiz.':'Each module can have its own quiz. Learners must pass a module quiz to unlock the next module.'}</p>
    <div class="field"><label>Course title</label><input type="text" id="mc-title" value="${esc(c?.title||'')}"></div>
    <div class="field"><label>Category</label><input type="text" id="mc-cat" value="${esc(c?.cat||'')}"></div>
    <div class="field">
      <label>Category badge color</label>
      <select id="mc-catclass">
        ${[['badge-blue','Blue'],['badge-purple','Purple'],['badge-orange','Orange'],['badge-green','Green'],['badge-red','Red']].map(([v,l])=>`<option value="${v}"${c?.catClass===v?' selected':''}>${l}</option>`).join('')}
      </select>
    </div>
    <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:14px;margin-bottom:12px;margin-top:8px">Modules</p>
    <div id="mc-modules">
      ${(c?.modules||[{id:uid(),title:'',dur:'',description:'',video:false,pdf:false,url:'',quiz:[]}]).map((m,i)=>moduleRow(m,i)).join('')}
    </div>
    <button class="btn-ghost btn-sm" id="add-mod-btn" style="margin-bottom:20px">+ Add module</button>
    <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:14px;margin-bottom:4px;margin-top:8px">🏁 Final course quiz</p>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Taken after all modules are passed. Leave empty for no final quiz.</p>
    <div id="mc-quiz">
      ${(c?.quiz||[{q:'',opts:['','','',''],ans:0}]).map((q,i)=>quizRow(q,i)).join('')}
    </div>
    <button class="btn-ghost btn-sm" id="add-q-btn" style="margin-bottom:20px">+ Add question</button>
    <div id="mc-msg"></div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:10px 24px" id="mc-save-btn" data-cid="${esc(c?.id||'')}">
        ${isEdit?'Save changes':'Create course'}
      </button>
    </div>`);
}

function moduleRow(m, i) {
  const modQuiz = m.quiz || [];
  return `<div class="accordion-body" id="mod-row-${m.id}" data-mod-id="${m.id}" style="border:2px solid var(--border);background:rgba(10,10,15,0.015)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-weight:700;font-size:14px;font-family:'Syne',sans-serif">📦 Module ${i+1}</span>
      <button class="btn-danger btn-sm remove-mod-btn" data-mod-id="${m.id}">Remove module</button>
    </div>
    <div class="field"><label>Title</label><input type="text" class="mod-title" data-mod-id="${m.id}" value="${esc(m.title)}" placeholder="Module title"></div>
    <div class="field"><label>Duration</label><input type="text" class="mod-dur" data-mod-id="${m.id}" value="${esc(m.dur)}" placeholder="15 min"></div>
    <div class="field"><label>Description</label><input type="text" class="mod-desc" data-mod-id="${m.id}" value="${esc(m.description||'')}" placeholder="Brief description"></div>

    <div style="margin-top:6px;padding:12px;border:1px solid var(--border);border-radius:var(--r);background:#fff">
      <p style="font-weight:600;font-size:12px;margin-bottom:4px">📎 Learning content <span style="color:var(--muted);font-weight:400">(add at least one — video, PDF, and/or link)</span></p>

      <div class="field" style="margin-top:10px">
        <label>🎬 Video (.mp4 / .webm) — optional</label>
        <div class="drop-zone" id="dz-${m.id}-video" data-kind="video" data-mod-id="${m.id}">
          <div style="font-size:22px">🎬</div>
          <p class="dz-status" data-key="${m.id}_video">${m.video?'✅ Video uploaded — click or drop to replace':'Click or drop a video'}</p>
          <input type="file" class="mod-file-input" data-key="${m.id}_video" accept=".mp4,.webm" style="display:none">
        </div>
      </div>

      <div class="field">
        <label>📄 PDF — optional</label>
        <div class="drop-zone" id="dz-${m.id}-pdf" data-kind="pdf" data-mod-id="${m.id}">
          <div style="font-size:22px">📄</div>
          <p class="dz-status" data-key="${m.id}_pdf">${m.pdf?'✅ PDF uploaded — click or drop to replace':'Click or drop a PDF'}</p>
          <input type="file" class="mod-file-input" data-key="${m.id}_pdf" accept=".pdf" style="display:none">
        </div>
      </div>

      <div class="field" style="margin-bottom:0">
        <label>🔗 External link (URL) — optional</label>
        <input type="url" class="mod-url" data-mod-id="${m.id}" value="${esc(m.url||'')}" placeholder="https://example.com/resource">
      </div>
    </div>

    <div style="margin-top:10px;padding-top:12px;border-top:1px dashed var(--border)">
      <p style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--accent)">📝 Module quiz <span style="color:var(--muted);font-weight:400">(learner must pass to unlock next module — leave empty for none)</span></p>
      <div class="mod-quiz-list" data-mod-id="${m.id}">
        ${modQuiz.map((q,qi)=>modQuizRow(m.id,q,qi)).join('')}
      </div>
      <button type="button" class="btn-ghost btn-sm add-mod-quiz-btn" data-mod-id="${m.id}">+ Add quiz question</button>
    </div>
  </div>`;
}

function modQuizRow(modId, q, qi) {
  return `<div class="mod-quiz-row" data-mod-id="${modId}" data-mq-idx="${qi}" style="border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:8px;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-weight:600;font-size:12px">Q${qi+1}</span>
      <button type="button" class="btn-danger btn-sm remove-mod-quiz-btn" data-mod-id="${modId}" data-mq-idx="${qi}">Remove</button>
    </div>
    <div class="field"><input type="text" class="mq-text" value="${esc(q.q||'')}" placeholder="Question text"></div>
    ${[0,1,2,3].map(oi=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <input type="radio" name="mq-${modId}-${qi}" class="mq-ans" data-oi="${oi}" ${q.ans===oi?'checked':''}>
      <input type="text" class="mq-opt" data-oi="${oi}" value="${esc(q.opts?.[oi]||'')}" placeholder="Option ${String.fromCharCode(65+oi)}" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;outline:none">
    </div>`).join('')}
    <p style="font-size:10px;color:var(--muted);margin-top:2px">Select the radio button next to the correct answer.</p>
  </div>`;
}

function quizRow(q, i) {
  return `<div class="accordion-body" data-q-idx="${i}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-weight:600;font-size:13px">Question ${i+1}</span>
      <button class="btn-danger btn-sm remove-q-btn" data-q-idx="${i}">Remove</button>
    </div>
    <div class="field"><label>Question</label><input type="text" class="q-text" data-q-idx="${i}" value="${esc(q.q)}" placeholder="Enter question text"></div>
    ${[0,1,2,3].map(oi=>`<div class="field">
      <label style="display:flex;align-items:center;gap:8px">
        <input type="radio" name="ans-${i}" class="q-ans-radio" data-q-idx="${i}" data-oi="${oi}" ${q.ans===oi?'checked':''}>
        Option ${String.fromCharCode(65+oi)} <span style="font-size:10px;color:var(--success)">${q.ans===oi?'✓ Correct answer':''}</span>
      </label>
      <input type="text" class="q-opt" data-q-idx="${i}" data-oi="${oi}" value="${esc(q.opts[oi]||'')}" placeholder="Option ${String.fromCharCode(65+oi)}">
    </div>`).join('')}
  </div>`;
}

function bindModalEvents() {
  // Add module
  document.getElementById('add-mod-btn')?.addEventListener('click',()=>{
    const count=document.querySelectorAll('#mc-modules .accordion-body[data-mod-id]').length;
    const m={id:uid(),title:'',dur:'',description:'',video:false,pdf:false,url:'',quiz:[]};
    document.getElementById('mc-modules').insertAdjacentHTML('beforeend',moduleRow(m,count));
    bindDropZones();
    bindRemoveBtns();
  });
  // Add quiz question
  document.getElementById('add-q-btn')?.addEventListener('click',()=>{
    const count=document.querySelectorAll('#mc-quiz [data-q-idx]').length;
    const q={q:'',opts:['','','',''],ans:0};
    document.getElementById('mc-quiz').insertAdjacentHTML('beforeend',quizRow(q,count));
    bindRemoveBtns();
  });
  bindDropZones();
  bindRemoveBtns();
  // Per-module quiz add/remove — delegated on modal root so it works for added modules
  const modalRoot=document.getElementById('modal-root');
  if(modalRoot && !modalRoot._mqBound){
    modalRoot._mqBound=true;
    modalRoot.addEventListener('click',ev=>{
      const addBtn=ev.target.closest('.add-mod-quiz-btn');
      if(addBtn){
        const modId=addBtn.dataset.modId;
        const list=document.querySelector('.mod-quiz-list[data-mod-id="'+modId+'"]');
        const count=list.querySelectorAll('.mod-quiz-row').length;
        list.insertAdjacentHTML('beforeend',modQuizRow(modId,{q:'',opts:['','','',''],ans:0},count));
        return;
      }
      const rmBtn=ev.target.closest('.remove-mod-quiz-btn');
      if(rmBtn){
        const modId=rmBtn.dataset.modId;
        rmBtn.closest('.mod-quiz-row').remove();
        // renumber
        document.querySelectorAll('.mod-quiz-list[data-mod-id="'+modId+'"] .mod-quiz-row').forEach((r,idx)=>{
          r.dataset.mqIdx=idx;
          r.querySelector('span').textContent='Q'+(idx+1);
        });
        return;
      }
    });
  }
  // Save new learner
  document.getElementById('ml-save-btn')?.addEventListener('click',()=>{
    const name=document.getElementById('ml-name').value.trim();
    const email=document.getElementById('ml-email').value.trim();
    const dept=document.getElementById('ml-dept').value.trim();
    const pw=document.getElementById('ml-pw').value;
    const msg=document.getElementById('ml-msg');
    if(!name||!email||!pw){msg.innerHTML='<div class="msg-err">All fields required.</div>';return;}
    if(pw.length<6){msg.innerHTML='<div class="msg-err">Password must be 6+ characters.</div>';return;}
    const users=DB.users();
    if(users.find(u=>u.email===email)){msg.innerHTML='<div class="msg-err">Email already registered.</div>';return;}
    const sq=document.getElementById('ml-sq')?.value||'';
    const sa=(document.getElementById('ml-sa')?.value||'').trim().toLowerCase();
    const nu={id:'u_'+Date.now(),name,email,pw,sq,sa,dept,notes:'',createdAt:new Date().toISOString(),disabled:false};
    DB.saveUsers([...users,nu]);
    closeModal();toast('Learner added successfully');render();
  });
  // Save course
  document.getElementById('mc-save-btn')?.addEventListener('click',saveCourseFromModal);
}

function bindDropZones() {
  document.querySelectorAll('.drop-zone').forEach(dz=>{
    const inp=dz.querySelector('.mod-file-input');
    if(!inp)return;
    const storeKey=inp.dataset.key;  // e.g. "<modId>_video" or "<modId>_pdf"
    dz.addEventListener('click',(e)=>{if(e.target!==inp){inp.click();}});
    dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
    dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
    dz.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();dz.classList.remove('drag-over');handleFileUpload(e.dataTransfer.files[0],storeKey,dz);});
    inp.addEventListener('change',()=>handleFileUpload(inp.files[0],storeKey,dz));
    // Async-check IDB for existing upload status
    const pEl=dz.querySelector('.dz-status');
    if(pEl&&pEl.dataset.key){
      IDB.get(pEl.dataset.key).then(data=>{
        if(data) pEl.textContent='✅ File already uploaded — click or drop to replace';
      }).catch(()=>{});
    }
  });
}

async function handleFileUpload(file, storeKey, dz) {
  if(!file) return;
  if(file.size > 500*1024*1024) {
    toast('File is very large (>500MB). Consider compressing it first.','err');
    return;
  }
  // Validate type against the drop zone kind
  const kind = dz.dataset.kind; // 'video' or 'pdf'
  const isPdf = file.type==='application/pdf' || /\.pdf$/i.test(file.name);
  const isVideo = /^video\//.test(file.type) || /\.(mp4|webm)$/i.test(file.name);
  if (kind==='pdf' && !isPdf) { toast('That is not a PDF file.','err'); return; }
  if (kind==='video' && !isVideo) { toast('That is not a video file (.mp4/.webm).','err'); return; }

  const pEl = dz.querySelector('p');
  pEl.textContent = '⏳ Uploading…';
  try {
    const data = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = () => rej(new Error('Read failed'));
      r.readAsDataURL(file);
    });
    await IDB.save(storeKey, data);
    // Mark this drop zone as filled so the save routine knows
    dz.dataset.uploaded = 'true';
    pEl.textContent = '✅ ' + file.name + ' uploaded';
    toast('File uploaded successfully ✅');
  } catch(err) {
    pEl.textContent = 'Upload failed — try again';
    toast('Upload failed: ' + err.message, 'err');
  }
}

function bindRemoveBtns() {
  document.querySelectorAll('.remove-mod-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.getElementById('mod-row-'+btn.dataset.modId)?.remove();
      // renumber
      document.querySelectorAll('#mc-modules .accordion-body').forEach((el,i)=>{
        el.querySelector('span').textContent='Module '+(i+1);
      });
    });
  });
  document.querySelectorAll('.remove-q-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      btn.closest('.accordion-body').remove();
      document.querySelectorAll('#mc-quiz .accordion-body').forEach((el,i)=>{
        el.dataset.qIdx=i;el.querySelector('span').textContent='Question '+(i+1);
      });
    });
  });
}

async function saveCourseFromModal() {
  const msg=document.getElementById('mc-msg');
  if(!msg){console.error('mc-msg not found');return;}
  msg.innerHTML='';

  try {
    const titleEl=document.getElementById('mc-title');
    const catEl=document.getElementById('mc-cat');
    const catClassEl=document.getElementById('mc-catclass');
    const saveBtn=document.getElementById('mc-save-btn');

    if(!titleEl||!catEl||!catClassEl||!saveBtn){
      msg.innerHTML='<div class="msg-err">Form elements missing — please close and reopen the modal.</div>';
      return;
    }

    const title=titleEl.value.trim();
    const cat=catEl.value.trim();
    const catClass=catClassEl.value;
    const existingCid=saveBtn.dataset.cid.trim();

    const errors=[];
    if(!title) errors.push('Course title is required.');
    if(!cat)   errors.push('Category is required.');

    // Look up existing course so we can preserve existing src values
    const existingCourse=existingCid?COURSES.find(c=>c.id===existingCid):null;

    // Collect modules — preserve src for modules that already have one
    const modEls=document.querySelectorAll('#mc-modules .accordion-body[data-mod-id]');
    const modules=[];
    const modEntries=[];
    modEls.forEach(el=>{
      const mid=el.dataset.modId;
      const titleInput=el.querySelector('.mod-title');
      const durInput=el.querySelector('.mod-dur');
      const descInput=el.querySelector('.mod-desc');
      if(!titleInput){errors.push('A module row is missing its title field.');return;}
      const t=titleInput.value.trim();
      const d=durInput?.value.trim()||'';
      const desc=descInput?.value.trim()||'';
      if(!t){errors.push('All modules must have a title.');return;}
      modEntries.push({el, mid, t, d, desc});
    });

    // Async pass: gather content sources (video/pdf in IDB, url in DOM) per module
    for (const {el, mid, t, d, desc} of modEntries) {
      // URL field
      const url = (el.querySelector('.mod-url')?.value || '').trim();
      // Video / PDF presence — check IDB for stored blobs
      let hasVideo=false, hasPdf=false;
      try { hasVideo = !!(await IDB.get(mid+'_video')); } catch {}
      try { hasPdf   = !!(await IDB.get(mid+'_pdf'));   } catch {}
      if (!hasVideo && !hasPdf && !url) {
        errors.push(`Module "${t}" needs at least one content source (video, PDF, or link).`);
      }
      // Collect this module's quiz
      const modQuiz=[];
      el.querySelectorAll('.mod-quiz-row').forEach((row,qi)=>{
        const qt=row.querySelector('.mq-text')?.value.trim()||'';
        const opts=Array.from(row.querySelectorAll('.mq-opt')).map(o=>o.value.trim());
        const ansR=row.querySelector('.mq-ans:checked');
        const ans=ansR?parseInt(ansR.dataset.oi):0;
        if(qt && opts.filter(o=>o).length>=2){ modQuiz.push({q:qt,opts,ans}); }
        else if(qt && opts.filter(o=>o).length<2){ errors.push(`Module "${t}": a quiz question needs at least 2 options.`); }
      });
      modules.push({
        id:mid, title:t, dur:d||'—', description:desc, quiz:modQuiz,
        video: hasVideo, pdf: hasPdf, url: url||''
      });
    }

    if(!modules.length) errors.push('At least one module with a title is required.');

    // Collect final course quiz (optional)
    const qEls=document.querySelectorAll('#mc-quiz [data-q-idx]');
    const quiz=[];
    qEls.forEach((el,i)=>{
      const qTextEl=el.querySelector('.q-text');
      if(!qTextEl) return;
      const qText=qTextEl.value.trim();
      const opts=Array.from(el.querySelectorAll('.q-opt')).map(o=>o.value.trim());
      const ansRadio=el.querySelector('.q-ans-radio:checked');
      const ans=ansRadio?parseInt(ansRadio.dataset.oi):0;
      if(!qText) return; // skip blank final-quiz rows (final quiz is optional)
      if(opts.filter(o=>o).length<2){errors.push(`Final quiz question ${i+1} needs at least 2 options.`);return;}
      quiz.push({q:qText,opts,ans});
    });
    // Final quiz is optional now — no error if empty

    if(errors.length){
      msg.innerHTML='<div class="msg-err"><strong>Please fix the following:</strong><ul style="margin:6px 0 0 16px">'
        +errors.map(e=>`<li>${e}</li>`).join('')+'</ul></div>';
      msg.scrollIntoView({behavior:'smooth',block:'nearest'});
      return;
    }

    if(existingCid&&existingCourse){
      const idx=COURSES.findIndex(c=>c.id===existingCid);
      COURSES[idx]={...COURSES[idx],title,cat,catClass,modules,quiz};
    } else {
      COURSES.push({id:'c_'+Date.now(),title,cat,catClass,modules,quiz});
    }
    saveCourses();
    closeModal();
    toast(existingCid?'Course updated ✅':'Course created ✅');
    render();

  } catch(err) {
    msg.innerHTML=`<div class="msg-err"><strong>Unexpected error:</strong> ${err.message}</div>`;
    console.error('saveCourseFromModal error:', err);
  }
}


// ═══════════════════════════════════════════════════
// EXPORT FUNCTIONS
// ═══════════════════════════════════════════════════

function exportLearnerReport(uid) {
  const stats = getAllStats();
  const u = stats.find(x => x.id === uid);
  if (!u) return;

  const now = new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'long',year:'numeric'});
  const passThresh = SETTINGS.passThreshold;

  // Build per-course rows
  let courseRows = '';
  COURSES.forEach(c => {
    const pct = calcCourseProg(u.id, c.id);
    const wl  = u.p[c.id]?.watched || [];
    const coursePassed = isCoursePassed(u.id, c.id);
    const hasFinal = c.quiz && c.quiz.length>0;
    const finalSc = hasFinal ? u.p[c.id]?.quizScore : null;
    const statusColor = coursePassed ? '#1D9E75' : pct>0 ? '#E8A838' : '#E24B4A';
    const statusText  = coursePassed ? 'Completed' : pct>0 ? 'In progress' : 'Not started';

    let moduleRows = c.modules.map(mod => {
      const watchedMod = wl.includes(mod.id);
      const modHasQuiz = mod.quiz && mod.quiz.length>0;
      const mScore = u.p[c.id]?.moduleQuiz?.[mod.id] ?? null;
      const modComplete = isModuleComplete(u.id, c.id, mod.id);
      let statusLabel;
      if (modComplete) statusLabel = '<span style="color:#1D9E75;font-weight:600">✓ Passed</span>';
      else if (watchedMod && modHasQuiz) statusLabel = `<span style="color:#E8A838;font-weight:600">Watched · quiz ${mScore!=null?mScore+'%':'pending'}</span>`;
      else if (watchedMod) statusLabel = '<span style="color:#1D9E75;font-weight:600">✓ Watched</span>';
      else statusLabel = '<span style="color:#aaa;font-weight:600">○ Not started</span>';
      return `<tr>
        <td style="padding:6px 12px;font-size:12px;color:#444">${esc(mod.title)}${modHasQuiz?' <span style=\"color:#999;font-size:10px\">(has quiz)</span>':''}</td>
        <td style="padding:6px 12px;font-size:12px;text-align:center">${statusLabel}</td>
      </tr>`;
    }).join('');

    courseRows += `
      <tr style="background:#F5F3EE">
        <td colspan="2" style="padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:13px">${esc(c.title)}</strong>
            <div style="display:flex;gap:10px;align-items:center">
              <span style="font-size:12px;color:#666">${pct}% complete${hasFinal?' · Final quiz: '+(finalSc!=null?finalSc+'%':'pending'):''}</span>
              <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;background:${statusColor}20;color:${statusColor}">
                ${statusText}
              </span>
            </div>
          </div>
        </td>
      </tr>
      ${moduleRows}
      <tr><td colspan="2" style="padding:4px"></td></tr>`;
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Learner Report — ${esc(u.name)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 40px; color: #0A0A0F; background: #fff; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #FF4D00; }
  .logo { font-size: 22px; font-weight: 900; color: #0A0A0F; letter-spacing: -1px; }
  .logo span { color: #FF4D00; }
  .meta { font-size: 12px; color: #888; text-align: right; }
  h1 { font-size: 26px; font-weight: 800; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #888; margin-bottom: 28px; }
  .stats { display: flex; gap: 16px; margin-bottom: 28px; }
  .stat { flex: 1; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; }
  .stat-val { font-size: 26px; font-weight: 900; color: #0A0A0F; }
  .stat-lbl { font-size: 11px; color: #888; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 9px 12px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #888; border-bottom: 1px solid #eee; }
  .section-title { font-size: 15px; font-weight: 800; margin: 28px 0 12px; color: #0A0A0F; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #bbb; text-align: center; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Trivekii<span>.</span></div>
      <h1>${esc(u.name)}</h1>
      <div class="sub">${esc(u.email)}${u.dept ? ' · ' + esc(u.dept) : ''}</div>
    </div>
    <div class="meta">
      <div>Learner Progress Report</div>
      <div>Generated: ${now}</div>
      <div>Pass mark: ${passThresh}%</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-val">${u.overall}%</div><div class="stat-lbl">Overall completion</div></div>
    <div class="stat"><div class="stat-val">${u.passed}/${COURSES.length}</div><div class="stat-lbl">Courses passed</div></div>
    <div class="stat"><div class="stat-val">${u.qDone}/${COURSES.length}</div><div class="stat-lbl">Quizzes attempted</div></div>
    <div class="stat"><div class="stat-val">${u.avgQ}%</div><div class="stat-lbl">Avg quiz score</div></div>
  </div>

  <div class="section-title">Course & Module Breakdown</div>
  <table>
    <thead><tr><th>Module</th><th style="text-align:center">Status</th></tr></thead>
    <tbody>${courseRows}</tbody>
  </table>

  <div class="footer">Trivekii LMS · Confidential · ${now}</div>
</body>
</html>`;

  downloadFile(u.name.replace(/\s+/g,'_') + '_report.html', html, 'text/html');
  toast('Report downloaded');
}

function exportQuizCSV(uid) {
  const stats = getAllStats();
  const u = stats.find(x => x.id === uid);
  if (!u) return;

  const rows = [];
  rows.push(['Learner', 'Email', 'Course', 'Quiz', 'Question #', 'Question', 'Learner Answer', 'Correct Answer', 'Result', 'Quiz Score %']);

  // Helper to emit rows for one quiz (module or final)
  function emitQuiz(c, quizArr, quizLabel, score, storedAnswers) {
    if (!quizArr || !quizArr.length) return;
    quizArr.forEach((q, i) => {
      if (score == null) {
        rows.push([u.name, u.email, c.title, quizLabel, i+1, q.q, 'Not attempted', q.opts[q.ans], '—', '—']);
      } else if (storedAnswers && storedAnswers.length) {
        const ansIdx = storedAnswers[i] != null ? storedAnswers[i] : -1;
        const learnerAns = ansIdx >= 0 ? q.opts[ansIdx] : 'No answer recorded';
        const correct = ansIdx === q.ans;
        rows.push([u.name, u.email, c.title, quizLabel, i+1, q.q, learnerAns, q.opts[q.ans], correct?'Correct':'Incorrect', score+'%']);
      } else {
        rows.push([u.name, u.email, c.title, quizLabel, i+1, q.q, '(answer detail not available)', q.opts[q.ans], '—', score+'%']);
      }
    });
  }

  COURSES.forEach(c => {
    // Module quizzes
    c.modules.forEach(mod => {
      if (mod.quiz && mod.quiz.length) {
        const mScore = u.p[c.id]?.moduleQuiz?.[mod.id] ?? null;
        const mAns = getStoredQuizAnswers(uid, c.id+'_mod_'+mod.id);
        emitQuiz(c, mod.quiz, 'Module: '+mod.title, mScore, mAns);
      }
    });
    // Final course quiz
    if (c.quiz && c.quiz.length) {
      const fScore = u.p[c.id]?.quizScore ?? null;
      const fAns = getStoredQuizAnswers(uid, c.id);
      emitQuiz(c, c.quiz, 'Final course quiz', fScore, fAns);
    }
  });

  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell).replace(/"/g, '""');
    return /[,\n"]/.test(s) ? '"' + s + '"' : s;
  }).join(',')).join('\n');

  downloadFile(u.name.replace(/\s+/g,'_') + '_quiz_responses.csv', csv, 'text/csv');
  toast('Quiz responses CSV downloaded');
}

function getStoredQuizAnswers(uid, cid) {
  try { return JSON.parse(localStorage.getItem('trv_qa_' + uid + '_' + cid) || 'null'); } catch { return null; }
}

function downloadFile(filename, content, mimeType) {
  // Use data URI so it works on file:// protocol (no blob URL needed)
  const isText = mimeType.startsWith('text/');
  const encoded = isText
    ? 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(content)
    : 'data:' + mimeType + ';base64,' + btoa(unescape(encodeURIComponent(content)));
  const a = document.createElement('a');
  a.href = encoded;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 200);
}

// ═══════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════
function bindEvents() {
  // Course card clicks handled by persistent delegated listener (set up at boot)
  // Back from course
  document.getElementById('back-btn')?.addEventListener('click',()=>{S.activeCourse=null;S.activeModule=null;render();});
  // Module items
  document.querySelectorAll('.mod-item[data-mid]').forEach(el=>el.addEventListener('click',()=>{
    if(!S.activeCourse) return;
    if(el.dataset.unlocked==='false'){ toast('Complete the previous module first to unlock this one.','err'); return; }
    const mid=el.dataset.mid;
    const course=COURSES.find(c=>c.id===S.activeCourse.id);
    if(!course) return;
    const mod=course.modules.find(m=>m.id===mid);
    if(!mod) return;
    S.activeCourse=course;
    S.activeModule=mod;
    loadAndRender();
  }));
  // Content tabs (switch between video / pdf / link)
  document.querySelectorAll('.content-tab-btn').forEach(btn=>btn.addEventListener('click',e=>{
    S._contentTab=e.currentTarget.dataset.tab;
    render();
  }));
  // Mark complete (PDF / URL / no-video modules)
  document.getElementById('mark-btn')?.addEventListener('click',e=>{
    const {cid,mid}=e.currentTarget.dataset;
    const p=DB.prog(S.session.id);
    if(!p[cid])p[cid]={watched:[],quizScore:null,moduleQuiz:{}};
    if(!p[cid].moduleQuiz)p[cid].moduleQuiz={};
    if(!p[cid].watched.includes(mid))p[cid].watched.push(mid);
    DB.saveProg(S.session.id,p);
    updateStreak(S.session.id);
    const mod=S.activeCourse?.modules.find(m=>m.id===mid);
    toast(mod&&mod.quiz&&mod.quiz.length?'Content done — now take the module quiz':'Module complete!');
    loadAndRender(S._contentTab);
  });
  // Start quiz (course final OR module quiz)
  document.querySelectorAll('.start-quiz-btn').forEach(btn=>btn.addEventListener('click',e=>{
    const cid=e.currentTarget.dataset.cid;
    const mid=e.currentTarget.dataset.mid||null;
    S.quiz={cid,mid,step:0,answers:[],done:false,score:0};render();
  }));
  // Quiz options
  document.querySelectorAll('.quiz-opt').forEach(el=>el.addEventListener('click',()=>{
    const oi=parseInt(el.dataset.oi);const q=S.quiz;
    const quizArr=getQuizDef(q.cid, q.mid||null);
    q.answers.push(oi);
    if(q.step+1>=quizArr.length){
      const score=Math.round(q.answers.reduce((a,ans,i)=>a+(ans===quizArr[i].ans?1:0),0)/quizArr.length*100);
      q.score=score;q.done=true;
      saveQuizResult(q.cid, q.mid||null, score, q.answers);
    } else {q.step++;}
    render();
  }));
  document.getElementById('quiz-exit-btn')?.addEventListener('click',()=>{S.quiz=null;render();});
  document.getElementById('quiz-back-btn')?.addEventListener('click',()=>{S.quiz=null;loadAndRender();});
  document.getElementById('quiz-retry-btn')?.addEventListener('click',()=>{
    incrementRetakeCount(S.session.id, quizKey(S.quiz.cid, S.quiz.mid||null));
    S.quiz={cid:S.quiz.cid,mid:S.quiz.mid||null,step:0,answers:[],done:false,score:0};render();
  });
  // Admin learner rows
  document.querySelectorAll('.learner-row').forEach(el=>el.addEventListener('click',()=>{
    S.selectedUser=el.dataset.uid;S.tab='learners';S.adminSubTab='info';buildSidebar();render();
  }));
  document.getElementById('back-learners-btn')?.addEventListener('click',()=>{S.selectedUser=null;S.adminSubTab='info';render();});
  // Sub-tabs (learner detail page)
  document.querySelectorAll('[data-subtab]').forEach(el=>{
    el.addEventListener('click',()=>{S.adminSubTab=el.dataset.subtab;render();});
  });
  // Learner search
  document.getElementById('learner-search')?.addEventListener('input',e=>{
    const q=e.target.value.toLowerCase();
    document.querySelectorAll('#learner-tbody tr').forEach(row=>{
      row.style.display=row.textContent.toLowerCase().includes(q)?'':'none';
    });
  });
  // Learner detail — save edit
  document.getElementById('save-edit-btn')?.addEventListener('click',e=>{
    const uid2=e.currentTarget.dataset.uid;
    const users=DB.users();
    const idx=users.findIndex(u=>u.id===uid2);
    if(idx===-1)return;
    users[idx].name=document.getElementById('edit-name').value.trim()||users[idx].name;
    users[idx].email=document.getElementById('edit-email').value.trim()||users[idx].email;
    users[idx].dept=document.getElementById('edit-dept').value.trim();
    users[idx].notes=document.getElementById('edit-notes').value.trim();
    DB.saveUsers(users);
    toast('Learner details saved');render();
  });
  // Save password
  document.getElementById('save-pw-btn')?.addEventListener('click',e=>{
    const uid2=e.currentTarget.dataset.uid;
    const pw=document.getElementById('new-pw').value;
    const pw2=document.getElementById('new-pw2').value;
    const msg=document.getElementById('pw-msg');
    if(pw.length<6){msg.innerHTML='<div class="msg-err">Password must be 6+ characters.</div>';return;}
    if(pw!==pw2){msg.innerHTML='<div class="msg-err">Passwords do not match.</div>';return;}
    const users=DB.users();
    const idx=users.findIndex(u=>u.id===uid2);
    if(idx===-1)return;
    users[idx].pw=pw;
    DB.saveUsers(users);
    toast('Password updated successfully');
    document.getElementById('new-pw').value='';
    document.getElementById('new-pw2').value='';
    msg.innerHTML='<div class="msg-ok">Password changed.</div>';
  });
  // Disable/enable account
  document.getElementById('toggle-disable-btn')?.addEventListener('click',e=>{
    const uid2=e.currentTarget.dataset.uid;
    const isDisabled=e.currentTarget.dataset.disabled==='true';
    const users=DB.users();
    const idx=users.findIndex(u=>u.id===uid2);
    if(idx===-1)return;
    users[idx].disabled=!isDisabled;
    DB.saveUsers(users);
    toast(isDisabled?'Account enabled':'Account disabled');render();
  });
  // Export report
  document.getElementById('export-report-btn')?.addEventListener('click',e=>{
    const uid=e.currentTarget.dataset.uid;
    if(!uid){toast('Could not identify learner','err');return;}
    exportLearnerReport(uid);
  });
  // Export quiz CSV
  document.getElementById('export-quiz-btn')?.addEventListener('click',e=>{
    const uid=e.currentTarget.dataset.uid;
    if(!uid){toast('Could not identify learner','err');return;}
    exportQuizCSV(uid);
  });
  // Reset progress
  document.getElementById('reset-progress-btn')?.addEventListener('click',e=>{
    if(!confirm('Reset ALL progress for this learner? This cannot be undone.'))return;
    DB.saveProg(e.currentTarget.dataset.uid,{});
    toast('Progress reset');render();
  });
  // Delete learner
  document.getElementById('delete-learner-btn')?.addEventListener('click',e=>{
    if(!confirm('Permanently delete this learner? This cannot be undone.'))return;
    const uid2=e.currentTarget.dataset.uid;
    DB.saveUsers(DB.users().filter(u=>u.id!==uid2));
    localStorage.removeItem('trv_prog_'+uid2);
    S.selectedUser=null;S.tab='learners';
    toast('Learner deleted');buildSidebar();render();
  });

  // Admin course actions
  document.getElementById('add-course-btn')?.addEventListener('click',()=>openAddCourseModal(null));
  document.querySelectorAll('.edit-course-btn').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const c=COURSES.find(x=>x.id===el.dataset.cid);
    openAddCourseModal(c);
  }));
  document.querySelectorAll('.delete-course-btn').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    if(!confirm('Delete this course? Learner progress for this course will remain in storage.'))return;
    const idx=COURSES.findIndex(c=>c.id===el.dataset.cid);
    if(idx!==-1){COURSES.splice(idx,1);saveCourses();}
    toast('Course deleted');render();
  }));
  // Add learner button
  document.getElementById('add-learner-btn')?.addEventListener('click',()=>openAddLearnerModal());
  document.getElementById('add-learner-btn2')?.addEventListener('click',()=>openAddLearnerModal());

  // Settings page handlers
  document.getElementById('st-save-btn')?.addEventListener('click',()=>{
    const pass=parseInt(document.getElementById('st-pass').value);
    const retakes=parseInt(document.getElementById('st-retakes').value);
    const msg=document.getElementById('st-msg');
    if(isNaN(pass)||pass<1||pass>100){msg.innerHTML='<div class="msg-err">Pass % must be between 1 and 100.</div>';return;}
    if(isNaN(retakes)||retakes<0){msg.innerHTML='<div class="msg-err">Retakes must be 0 or more.</div>';return;}
    SETTINGS.passThreshold=pass;
    SETTINGS.maxRetakes=retakes;
    saveSettings();
    msg.innerHTML='<div class="msg-ok">Settings saved.</div>';
    setTimeout(()=>render(),800);
  });
  document.getElementById('st-reset-btn')?.addEventListener('click',()=>{
    if(!confirm('Reset to defaults? (80% pass, 2 retakes)'))return;
    SETTINGS={...DEFAULT_SETTINGS};
    saveSettings();
    toast('Settings reset to defaults');render();
  });
  document.getElementById('st-pin-save-btn')?.addEventListener('click',()=>{
    const pin=document.getElementById('st-admin-pin')?.value.trim();
    const pmsg=document.getElementById('st-pin-msg');
    if(!pin){pmsg.innerHTML='<div class="msg-err">Please enter a PIN.</div>';return;}
    localStorage.setItem('trv_admin_pin',pin);
    pmsg.innerHTML='<div class="msg-ok">PIN saved.</div>';
    setTimeout(()=>{if(pmsg)pmsg.innerHTML='';},2000);
  });
  document.querySelectorAll('.reset-attempts-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const uid2=btn.dataset.uid;
      COURSES.forEach(c=>localStorage.removeItem('trv_retakes_'+uid2+'_'+c.id));
      toast('Quiz attempts reset for this learner');render();
    });
  });

  // Modal events are bound by openModal() directly — not here
  // Video player enforcement
  initVideoPlayer();
}

// ═══════════════════════════════════════════════════
// VIDEO ENFORCEMENT
// ═══════════════════════════════════════════════════
function initVideoPlayer() {
  const video=document.getElementById('course-video');
  if(!video)return;
  const m=S.activeModule;
  const isAlreadyWatched=(DB.prog(S.session.id)[S.activeCourse?.id]?.watched||[]).includes(m?.id);
  if(isAlreadyWatched)return; // already completed, no restrictions

  let lastTime=0;
  let completed=false;

  video.addEventListener('timeupdate',()=>{
    const vpf=document.getElementById('vpf');
    if(vpf&&video.duration>0){
      vpf.style.width=(video.currentTime/video.duration*100)+'%';
    }
    // If user tries to seek forward more than 3s ahead of last watched time
    if(video.currentTime>lastTime+3){
      video.currentTime=lastTime;
      toast('Please watch the video without skipping','err');
    } else {
      lastTime=Math.max(lastTime,video.currentTime);
    }
    if(!completed&&video.duration>0&&video.currentTime>=video.duration-1){
      completed=true;
      markVideoComplete(m.id,S.activeCourse.id);
    }
  });

  // Disable right-click context menu
  video.addEventListener('contextmenu',e=>e.preventDefault());
  // Block rate change
  video.addEventListener('ratechange',()=>{if(video.playbackRate!==1)video.playbackRate=1;});
}

function markVideoComplete(mid, cid) {
  const p=DB.prog(S.session.id);
  if(!p[cid])p[cid]={watched:[],quizScore:null,moduleQuiz:{}};
  if(!p[cid].moduleQuiz)p[cid].moduleQuiz={};
  if(!p[cid].watched.includes(mid)){
    p[cid].watched.push(mid);
    DB.saveProg(S.session.id,p);
    updateStreak(S.session.id);
    S.videoWatched[mid]=true;
    const mod=S.activeCourse?.modules.find(m=>m.id===mid);
    const hasQuiz=mod&&mod.quiz&&mod.quiz.length;
    const statusMsg=document.getElementById('video-status-msg');
    if(statusMsg)statusMsg.innerHTML=`<span class="badge badge-green" style="font-size:12px;padding:5px 14px">✓ Video complete!${hasQuiz?' Take the module quiz below.':''}</span>`;
    toast(hasQuiz?'🎬 Video done — now take the module quiz':'🎉 Video complete!');
    // Re-render so the quiz button appears
    setTimeout(()=>loadAndRender(),1200);
  }
}

// ── Persistent delegated listeners (set up once, never re-attached) ──────────
// Course card click — works even after innerHTML re-renders
document.getElementById('main-content').addEventListener('click', e=>{
  // Course card
  const card = e.target.closest('.course-card[data-cid]');
  if (card && S.session && S.session.role==='learner') {
    const c = COURSES.find(x => x.id === card.dataset.cid);
    if (!c || !c.modules || !c.modules.length) return;
    S.activeCourse = c;
    S.activeModule = c.modules[0];
    loadAndRender();
    return;
  }
});

// Prevent browser from opening dropped files as a new tab
document.addEventListener('dragover', e=>{ if(!e.target.closest('.drop-zone')) e.preventDefault(); });
document.addEventListener('drop',     e=>{ if(!e.target.closest('.drop-zone')) e.preventDefault(); });

// ═══════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════
const existing=DB.session();
if(existing){launch(existing);}
