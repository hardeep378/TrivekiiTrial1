// ═══════════════════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════════════════
const SUPABASE_URL  = 'https://procvnkcvbihsyuthkvv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb2N2bmtjdmJpaHN5dXRoa3Z2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTM2MTIsImV4cCI6MjA5NzY4OTYxMn0.8sCxhuglrcPkSQ0gGgD4_Cn3-bfa2nchZYxYSDVvh4o';

// ═══════════════════════════════════════════════════
// AUTH TOKEN STORE
// Holds the live Supabase JWT. All DB calls use this
// token instead of the static anon key.
// ═══════════════════════════════════════════════════
const Auth = {
  _token:   null,
  _refresh: null,
  _authUid: null,

  // Call after a successful signIn / signUp
  set(session) {
    this._token   = session?.access_token  || null;
    this._refresh = session?.refresh_token || null;
    this._authUid = session?.user?.id      || null;
    if (session) {
      sessionStorage.setItem('trv_sb_token',  this._token);
      sessionStorage.setItem('trv_sb_refresh', this._refresh);
      sessionStorage.setItem('trv_sb_uid',     this._authUid);
    }
  },

  // Restore from sessionStorage on page load
  load() {
    this._token   = sessionStorage.getItem('trv_sb_token');
    this._refresh = sessionStorage.getItem('trv_sb_refresh');
    this._authUid = sessionStorage.getItem('trv_sb_uid');
    return !!this._token;
  },

  // Wipe on logout
  clear() {
    this._token = this._refresh = this._authUid = null;
    ['trv_sb_token','trv_sb_refresh','trv_sb_uid'].forEach(k => sessionStorage.removeItem(k));
  },

  // Always use the live JWT; fall back to anon key only if not logged in
  token() { return this._token || SUPABASE_ANON; },
};

// ── Supabase Auth API helpers ────────────────────────────────────────────────
const SBAUTH = {
  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Sign-in failed. Check your email and password.');
    return data; // { access_token, refresh_token, user: { id, email, user_metadata } }
  },

  async signUp(email, password, name) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, data: { role: 'learner', name } }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Registration failed.');
    return data;
  },

  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + token },
    }).catch(() => {}); // ignore errors — we clear locally regardless
  },

  async resetPasswordEmail(email) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.msg || 'Failed to send reset email.'); }
  },

  // Admin-only: update any user's password via the service role isn't possible from
  // the browser. Instead we use Supabase's admin API through a server function,
  // OR for now we generate a password-reset email on behalf of the learner.
  async sendLearnerPasswordReset(email) {
    return this.resetPasswordEmail(email);
  },
};

// ── Supabase REST helper ─────────────────────────────────────────────────────
const SB = {
  headers(extra={}) {
    return {
      'apikey':        SUPABASE_ANON,
      'Authorization': 'Bearer ' + Auth.token(), // ← live JWT when logged in
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...extra,
    };
  },

  async select(table, params='') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: this.headers(),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async insert(table, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method:  'POST',
      headers: this.headers(),
      body:    JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  },

  async update(table, params, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      method:  'PATCH',
      headers: this.headers(),
      body:    JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  },

  async delete(table, params) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      method:  'DELETE',
      headers: this.headers({'Prefer':'return=minimal'}),
    });
    if (!r.ok) throw new Error(await r.text());
  },

  async upsert(table, body, onConflict) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`,
      {
        method:  'POST',
        headers: this.headers({'Prefer':'resolution=merge-duplicates,return=representation'}),
        body:    JSON.stringify(body),
      }
    );
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  },

  async uploadFile(bucket, path, blob, contentType) {
    const r = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
      {
        method:  'POST',
        headers: {
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + Auth.token(),
          'Content-Type':  contentType,
        },
        body: blob,
      }
    );
    if (!r.ok) {
      if (r.status === 409) return this.updateFile(bucket, path, blob, contentType);
      throw new Error(await r.text());
    }
    return r.json();
  },

  async updateFile(bucket, path, blob, contentType) {
    const r = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
      {
        method:  'PUT',
        headers: {
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + Auth.token(),
          'Content-Type':  contentType,
        },
        body: blob,
      }
    );
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  publicUrl(bucket, path) {
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE ABSTRACTION
//
//   learners  (id uuid PK, auth_id uuid FK→auth.users, name, email,
//              subject, notes, disabled, created_at)
//   courses   (id text PK, data jsonb, updated_at timestamptz)
//   progress  (learner_id uuid, course_id text, data jsonb, PK: learner_id+course_id)
//              course_id='__meta'    → { streak, last_date, retakes:{}, quiz_answers:{} }
//              course_id=<actual id> → { watched:[], quizScore, moduleQuiz:{} }
//   settings  (id integer PK, data jsonb)
// ─────────────────────────────────────────────────────────────────────────────
const DB = {
  _learners: null,
  _courses:  null,
  _progMap:  {},
  _settings: null,

  // ── LEARNERS ───────────────────────────────────────────────────────────────
  async learners() {
    if (this._learners) return this._learners;
    const rows = await SB.select('learners', 'select=*&order=created_at.asc');
    this._learners = rows;
    return rows;
  },

  // Returns learners with dept alias (subject→dept) for compatibility with
  // existing render/stats code. No auth fields needed — they live in Supabase Auth.
  async learnersWithAuth() {
    const rows = await this.learners();
    return rows.map(r => ({ ...r, dept: r.subject || '' }));
  },

  // Save a learner row (no pw/sq/sa — those are gone).
  async saveLearner(u) {
    const { dept, ...rest } = u;
    const row = { ...rest, subject: dept || rest.subject || '' };
    delete row.dept;
    // Remove any legacy auth fields that may have come in
    delete row.pw; delete row.sq; delete row.sa;
    await SB.upsert('learners', row, 'id');
    this._learners = null;
  },

  async deleteLearner(id) {
    await SB.delete('learners', `id=eq.${id}`);
    await SB.delete('progress', `learner_id=eq.${id}`);
    this._learners = null;
    delete this._progMap[id];
  },

  // ── COURSES ────────────────────────────────────────────────────────────────
  async courses() {
    if (this._courses) return this._courses;
    const rows = await SB.select('courses', 'select=*&order=id.asc');
    this._courses = rows.map(r => ({ id: r.id, ...r.data }));
    return this._courses;
  },
  async saveCourse(course) {
    const { id, ...data } = course;
    await SB.upsert('courses', { id, data, updated_at: new Date().toISOString() }, 'id');
    this._courses = null;
  },
  async deleteCourse(id) {
    await SB.delete('courses', `id=eq.${id}`);
    this._courses = null;
  },

  // ── PROGRESS ───────────────────────────────────────────────────────────────
  async prog(learnerId) {
    if (this._progMap[learnerId]) return this._progMap[learnerId];
    const rows = await SB.select('progress',
      `select=course_id,data&learner_id=eq.${learnerId}`);
    const map = {};
    for (const r of rows) {
      if (r.course_id !== '__meta') {
        map[r.course_id] = r.data;
      }
    }
    this._progMap[learnerId] = map;
    return map;
  },
  async saveProgCourse(learnerId, courseId, data) {
    await SB.upsert('progress',
      { learner_id: learnerId, course_id: courseId, data },
      'learner_id,course_id');
    if (!this._progMap[learnerId]) this._progMap[learnerId] = {};
    this._progMap[learnerId][courseId] = data;
  },
  async resetProg(learnerId) {
    const rows = await SB.select('progress',
      `select=course_id&learner_id=eq.${learnerId}`);
    for (const r of rows) {
      if (r.course_id !== '__meta') {
        await SB.delete('progress',
          `learner_id=eq.${learnerId}&course_id=eq.${r.course_id}`);
      }
    }
    this._progMap[learnerId] = {};
  },

  // ── META (streaks + retakes + quiz_answers) ────────────────────────────────
  async _meta(learnerId) {
    try {
      const rows = await SB.select('progress',
        `select=data&learner_id=eq.${learnerId}&course_id=eq.__meta`);
      return rows.length ? (rows[0].data || {}) : {};
    } catch { return {}; }
  },
  async _saveMeta(learnerId, meta) {
    await SB.upsert('progress',
      { learner_id: learnerId, course_id: '__meta', data: meta },
      'learner_id,course_id');
  },

  async getRetakeCount(learnerId, qKey) {
    const meta = await this._meta(learnerId);
    return (meta.retakes || {})[qKey] || 0;
  },
  async incrementRetakeCount(learnerId, qKey) {
    const meta = await this._meta(learnerId);
    if (!meta.retakes) meta.retakes = {};
    meta.retakes[qKey] = (meta.retakes[qKey] || 0) + 1;
    await this._saveMeta(learnerId, meta);
    return meta.retakes[qKey];
  },
  async resetRetakes(learnerId) {
    const meta = await this._meta(learnerId);
    meta.retakes = {};
    await this._saveMeta(learnerId, meta);
  },

  async saveQuizAnswers(learnerId, qKey, answers) {
    const meta = await this._meta(learnerId);
    if (!meta.quiz_answers) meta.quiz_answers = {};
    meta.quiz_answers[qKey] = answers;
    await this._saveMeta(learnerId, meta);
  },
  async getQuizAnswers(learnerId, qKey) {
    const meta = await this._meta(learnerId);
    return (meta.quiz_answers || {})[qKey] || null;
  },

  async getStreak(learnerId) {
    const meta = await this._meta(learnerId);
    return { streak: meta.streak || 0, last_date: meta.last_date || '' };
  },
  async saveStreak(learnerId, streak, last_date) {
    const meta = await this._meta(learnerId);
    meta.streak = streak;
    meta.last_date = last_date;
    await this._saveMeta(learnerId, meta);
  },

  // ── SETTINGS ───────────────────────────────────────────────────────────────
  async settings() {
    if (this._settings) return this._settings;
    const rows = await SB.select('settings', 'select=*&id=eq.1');
    if (!rows.length) return null;
    this._settings = rows[0].data;
    return this._settings;
  },
  async saveSettings(data) {
    await SB.upsert('settings', { id: 1, data }, 'id');
    this._settings = data;
  },

  // ── SESSION (app-level, stored in sessionStorage) ──────────────────────────
  session()      { try { return JSON.parse(sessionStorage.getItem('trv_sess')||'null'); } catch { return null; } },
  saveSession(s) { sessionStorage.setItem('trv_sess', JSON.stringify(s)); },
  clearSession() { sessionStorage.removeItem('trv_sess'); },
};

// ═══════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════
const DEFAULT_COURSES = [
  { id:'c1', title:'Sample Course', cat:'General', catClass:'badge-blue',
    modules:[
      {id:'m1',title:'Module 1 — Introduction',dur:'10 min',description:'A sample module. Replace with your own content.',
        video:false, pdf:false, ytId:'',
        quiz:[
          {q:'This is a sample module quiz question. What is 2 + 2?',opts:['3','4','5','6'],ans:1},
          {q:'Sample question two — which is a colour?',opts:['Square','Blue','Loud','Fast'],ans:1},
        ]
      },
      {id:'m2',title:'Module 2 — Going Deeper',dur:'12 min',description:'A second sample module.',
        video:false, pdf:false, ytId:'',
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

const DEFAULT_SETTINGS = { passThreshold: 80, maxRetakes: 2 };

// ═══════════════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════════════
let COURSES  = [];
let SETTINGS = { ...DEFAULT_SETTINGS };

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
let S = {
  session:      null,
  tab:          'dashboard',
  activeCourse: null,
  activeModule: null,
  quiz:         null,
  selectedUser: null,
  authMode:     'login',
  adminSubTab:  'info',
  videoWatched: {},
  _pdfUrl:      null,
  _ytId:        null,
  _contentTab:  null,
  _allUsers:    null,
  _allProg:     {},
};

// ═══════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════
function uid() { return 'id_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); }

function calcCourseProg(userId, cid) {
  const c = COURSES.find(x=>x.id===cid); if(!c||!c.modules.length) return 0;
  const p = S._allProg[userId] || {};
  const complete = c.modules.filter(m=>isModuleComplete(userId, cid, m.id, p)).length;
  return Math.round(complete/c.modules.length*100);
}
function calcOverall(userId) {
  const p = S._allProg[userId] || {};
  const total    = COURSES.reduce((a,c)=>a+c.modules.length,0);
  const complete = COURSES.reduce((a,c)=>a+c.modules.filter(m=>isModuleComplete(userId,c.id,m.id,p)).length,0);
  return total ? Math.round(complete/total*100) : 0;
}

function getModuleQuizScore(userId, cid, mid, progMap) {
  const p = progMap || S._allProg[userId] || {};
  return p[cid]?.moduleQuiz?.[mid] ?? null;
}
function isModuleComplete(userId, cid, mid, progMap) {
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  const mod = c.modules.find(m=>m.id===mid); if(!mod) return false;
  const p = progMap || S._allProg[userId] || {};
  const watched = (p[cid]?.watched||[]).includes(mid);
  if (!watched) return false;
  const hasQuiz = mod.quiz && mod.quiz.length>0;
  if (!hasQuiz) return true;
  const sc = getModuleQuizScore(userId, cid, mid, p);
  return sc != null && sc >= SETTINGS.passThreshold;
}
function isModuleUnlocked(userId, cid, modIndex, progMap) {
  if (modIndex === 0) return true;
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  const prevMod = c.modules[modIndex-1];
  return isModuleComplete(userId, cid, prevMod.id, progMap);
}
function allModulesComplete(userId, cid, progMap) {
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  return c.modules.every(m=>isModuleComplete(userId, cid, m.id, progMap));
}
function isCoursePassed(userId, cid, progMap) {
  const c = COURSES.find(x=>x.id===cid); if(!c) return false;
  const p = progMap || S._allProg[userId] || {};
  if (!allModulesComplete(userId, cid, p)) return false;
  const hasFinal = c.quiz && c.quiz.length>0;
  if (!hasFinal) return true;
  const sc = p[cid]?.quizScore;
  return sc != null && sc >= SETTINGS.passThreshold;
}

function statusBadge(pct) {
  if(pct>=SETTINGS.passThreshold) return '<span class="badge badge-green">On track</span>';
  if(pct>=30)                     return '<span class="badge badge-orange">In progress</span>';
  return '<span class="badge badge-red">At risk</span>';
}
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function parseYtId(raw) {
  if (!raw) return '';
  raw = raw.trim();
  let m = raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = raw.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  return '';
}
function toast(msg, type='ok') {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast toast-'+type;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(()=>t.remove(), 3500);
}
function quizKey(cid, mid) { return mid ? cid+'_mod_'+mid : cid; }

// ═══════════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════════
const authScreen = document.getElementById('auth-screen');
const appScreen  = document.getElementById('app-screen');

function showMsg(html, type='err') {
  document.getElementById('auth-msg').innerHTML = `<div class="msg-${type}">${html}</div>`;
}

function setAuthMode(mode) {
  S.authMode = mode;
  const isLogin    = mode === 'login';
  const isRegister = mode === 'register';
  const isReset    = mode === 'reset';

  document.getElementById('auth-title').textContent =
    isLogin ? 'Welcome back' : isRegister ? 'Create account' : 'Reset password';
  document.getElementById('auth-subtitle').textContent =
    isLogin    ? 'Sign in to your Trivekii account' :
    isRegister ? 'Register as a learner to get started' :
                 'Enter your email and we\'ll send a reset link';
  document.getElementById('auth-submit-btn').textContent =
    isLogin ? 'Sign in →' : isRegister ? 'Create account →' : 'Send reset link →';
  document.getElementById('auth-switch-text').textContent =
    isLogin ? "Don't have an account?" : isRegister ? 'Already have an account?' : 'Remember your password?';
  document.getElementById('auth-toggle').textContent =
    isLogin ? ' Register here' : ' Sign in';

  // Show/hide fields
  document.getElementById('field-name').style.display  = isRegister ? '' : 'none';
  document.getElementById('field-pw2').style.display   = isRegister ? '' : 'none';
  document.getElementById('field-sq').style.display    = 'none'; // no longer used
  document.getElementById('field-sa').style.display    = 'none'; // no longer used
  document.getElementById('inp-pw').closest('.field').style.display  = isReset ? 'none' : '';
  document.getElementById('forgot-row').style.display  = isLogin ? '' : 'none';
  document.getElementById('auth-msg').innerHTML = '';
}

document.getElementById('auth-toggle').addEventListener('click', () => {
  setAuthMode(S.authMode === 'login' ? 'register' : 'login');
});
document.getElementById('forgot-link').addEventListener('click', () => setAuthMode('reset'));
document.getElementById('auth-submit-btn').addEventListener('click', doAuth);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && authScreen.style.display !== 'none') doAuth();
});

async function doAuth() {
  const email = document.getElementById('inp-email').value.trim().toLowerCase();
  const pw    = document.getElementById('inp-pw').value;
  const btn   = document.getElementById('auth-submit-btn');
  document.getElementById('auth-msg').innerHTML = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    // ── LOGIN ──────────────────────────────────────────────────────────────
    if (S.authMode === 'login') {
      const sbSession = await SBAUTH.signIn(email, pw);
      Auth.set(sbSession);

      const meta = sbSession.user.user_metadata || {};
      const role = meta.role || 'learner';
      const name = meta.name || email;
      const authUid = sbSession.user.id;

      if (role === 'admin') {
        await boot({ role: 'admin', email, name, id: 'admin', authUid });
      } else {
        // Fetch the learners row that was linked to this auth user
        const rows = await SB.select('learners', `select=*&auth_id=eq.${authUid}`);
        if (!rows.length) {
          Auth.clear();
          throw new Error('No learner profile found for this account. Please contact your administrator.');
        }
        const u = rows[0];
        if (u.disabled) {
          Auth.clear();
          throw new Error('This account has been disabled. Please contact your administrator.');
        }
        await boot({ role: 'learner', email: u.email, name: u.name, id: u.id, authUid });
      }

    // ── REGISTER ────────────────────────────────────────────────────────────
    } else if (S.authMode === 'register') {
      const name = document.getElementById('inp-name').value.trim();
      const pw2  = document.getElementById('inp-pw2').value;

      if (!name)                { showMsg('Please enter your full name.'); return; }
      if (!email.includes('@')) { showMsg('Please enter a valid email address.'); return; }
      if (pw.length < 6)        { showMsg('Password must be at least 6 characters.'); return; }
      if (pw !== pw2)           { showMsg('Passwords do not match.'); return; }

      // 1. Create the Supabase Auth user
      const sbSession = await SBAUTH.signUp(email, pw, name);
      const authUid = sbSession.user?.id;
      if (!authUid) throw new Error('Registration failed — please try again.');

      // 2. Set the JWT so the next DB call is authenticated
      Auth.set(sbSession);

      // 3. Insert the learners row linked to the new auth user
      await SB.insert('learners', {
        id:         crypto.randomUUID(),
        auth_id:    authUid,
        name,
        email,
        created_at: new Date().toISOString(),
        disabled:   false,
        subject:    '',
        notes:      '',
      });

      showMsg('Account created! You can now sign in.', 'ok');
      Auth.clear(); // clear so they sign in fresh
      setAuthMode('login');
      document.getElementById('inp-email').value = email;
      document.getElementById('inp-pw').value    = '';

    // ── FORGOT PASSWORD ──────────────────────────────────────────────────────
    } else if (S.authMode === 'reset') {
      if (!email) { showMsg('Please enter your email address.'); return; }
      await SBAUTH.resetPasswordEmail(email);
      showMsg('If that email is registered, a password reset link has been sent. Check your inbox.', 'ok');
      setTimeout(() => setAuthMode('login'), 4000);
    }

  } catch(err) {
    showMsg('Error: ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    const labels = { login: 'Sign in →', register: 'Create account →', reset: 'Send reset link →' };
    btn.textContent = labels[S.authMode] || 'Submit';
  }
}

// ─── Boot: load all remote data then render ──────────────────────────────────
async function boot(session) {
  S.session = session;
  DB.saveSession(session);

  showLoadingOverlay('Loading your workspace…');
  try {
    const [remoteCourses, remoteSettings] = await Promise.all([
      DB.courses(),
      DB.settings(),
    ]);

    if (!remoteCourses.length) {
      for (const c of DEFAULT_COURSES) await DB.saveCourse(c);
      COURSES = DEFAULT_COURSES.slice();
    } else {
      COURSES = remoteCourses;
    }

    SETTINGS = remoteSettings || DEFAULT_SETTINGS;
    if (!remoteSettings) await DB.saveSettings(SETTINGS);

    if (session.role === 'learner') {
      const p = await DB.prog(session.id);
      S._allProg[session.id] = p;
      // Load streak
      const streakRow = await DB.getStreak(session.id);
      S._streak = streakRow.streak || 0;
    } else {
      await refreshAllStats();
    }

    launch(session);
  } catch(err) {
    hideLoadingOverlay();
    showMsg('Failed to load data: ' + err.message);
    console.error(err);
  }
}

function showLoadingOverlay(msg) {
  let el = document.getElementById('load-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'load-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:var(--paper);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999;gap:16px';
    el.innerHTML = `<div class="spinner" style="width:36px;height:36px;border-width:3px;border-top-color:var(--accent)"></div><p style="font-size:14px;color:var(--muted)">${msg}</p>`;
    document.body.appendChild(el);
  }
}
function hideLoadingOverlay() {
  document.getElementById('load-overlay')?.remove();
}

function launch(session) {
  hideLoadingOverlay();
  S.session = session;
  authScreen.style.display = 'none';
  appScreen.style.display  = 'flex';
  document.getElementById('nav-username').textContent = session.name;
  document.getElementById('nav-avatar').textContent   = session.name[0].toUpperCase();
  if (session.role === 'admin') {
    document.getElementById('topnav').classList.add('admin-nav');
    document.getElementById('nav-role-badge').style.display = 'inline';
  }
  buildSidebar(); render();
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await SBAUTH.signOut(Auth.token());
  Auth.clear();
  DB.clearSession();
  if (S._pdfUrl && S._pdfUrl.startsWith('blob:')) URL.revokeObjectURL(S._pdfUrl);
  S = {session:null,tab:'dashboard',activeCourse:null,activeModule:null,quiz:null,
       selectedUser:null,authMode:'login',adminSubTab:'info',videoWatched:{},
       _pdfUrl:null,_videoUrl:null,_ytId:null,_contentTab:null,_allUsers:null,_allProg:{}};
  COURSES = []; SETTINGS = {...DEFAULT_SETTINGS};
  DB._learners=null; DB._courses=null; DB._progMap={}; DB._settings=null;
  appScreen.style.display  = 'none';
  authScreen.style.display = 'grid';
  document.getElementById('topnav').classList.remove('admin-nav');
  document.getElementById('nav-role-badge').style.display = 'none';
  document.getElementById('auth-msg').innerHTML = '';
  document.getElementById('inp-email').value = '';
  document.getElementById('inp-pw').value    = '';
});

// ─── Admin: load all users + progress for stats ──────────────────────────────
async function refreshAllStats() {
  const users = await DB.learnersWithAuth();
  S._allUsers = users;
  await Promise.all(users.map(async u => {
    const p = await DB.prog(u.id);
    S._allProg[u.id] = p;
  }));
}

function getAllStats() {
  const users = S._allUsers || [];
  return users.map(u=>{
    const p = S._allProg[u.id] || {};
    const overall=calcOverall(u.id);
    const qDone=COURSES.filter(c=>p[c.id]?.quizScore!=null).length;
    const passed=COURSES.filter(c=>isCoursePassed(u.id,c.id,p)).length;
    const avgQ=COURSES.length?Math.round(COURSES.filter(c=>p[c.id]?.quizScore!=null).reduce((a,c)=>a+(p[c.id]?.quizScore||0),0)/Math.max(1,COURSES.filter(c=>p[c.id]?.quizScore!=null).length)):0;
    return {...u, overall, qDone, passed, avgQ, p};
  });
}

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

async function loadAndRender(preferredTab) {
  if (S._pdfUrl   && S._pdfUrl.startsWith('blob:'))   URL.revokeObjectURL(S._pdfUrl);
  S._pdfUrl = null; S._videoUrl = null; S._ytId = null; S._contentTab = null;

  if (S.activeCourse && S.activeModule && S.activeModule.id) {
    const m = S.activeModule;
    if (m.ytId) S._ytId = m.ytId;

    if (m.video) {
      try {
        const videoUrl = SB.publicUrl('videos', m.id + '.mp4');
        const res = await fetch(videoUrl, { method: 'HEAD', headers: { 'apikey': SUPABASE_ANON } });
        if (res.ok) S._videoUrl = videoUrl;
      } catch(e) { console.warn('Video fetch failed', e); }
    }

    if (m.pdf) {
      try {
        const pdfUrl = SB.publicUrl('pdfs', m.id + '.pdf');
        const res = await fetch(pdfUrl, { headers: { 'apikey': SUPABASE_ANON } });
        if (res.ok) {
          const blob = await res.blob();
          S._pdfUrl = URL.createObjectURL(blob);
        }
      } catch(e) { console.warn('PDF fetch failed', e); }
    }

    const avail = [];
    if (S._videoUrl) avail.push('video');
    if (m.ytId)      avail.push('youtube');
    if (S._pdfUrl)   avail.push('pdf');
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

function currentProg() {
  return S._allProg[S.session.id] || {};
}

function renderLearnerDashboard() {
  const uid = S.session.id;
  const p   = currentProg();
  const overall   = calcOverall(uid);
  const completed = COURSES.filter(c=>isCoursePassed(uid,c.id,p)).length;
  const quizDone  = COURSES.filter(c=>p[c.id]?.quizScore!=null).length;
  const streak    = S._streak || 0;
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
      ${COURSES.map(c=>{
        const pct=calcCourseProg(uid,c.id);
        const sc=p[c.id]?.quizScore;
        const passed=sc!=null&&sc>=SETTINGS.passThreshold;
        let statusPill;
        if(isCoursePassed(uid,c.id,p)) statusPill=`<span class="badge badge-green">✓ Passed</span>`;
        else if(pct>0) statusPill=`<span class="badge badge-orange">In progress</span>`;
        else statusPill=`<span class="badge badge-gray">Not started</span>`;
        const wl=p[c.id]?.watched||[];
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

function renderCourseList() {
  const uid=S.session.id; const p=currentProg();
  return `<div class="fade">
    <h1 class="page-title">My Courses</h1>
    <p class="page-sub">Select a course to begin or continue learning.</p>
    <div class="course-grid">
      ${COURSES.map(c=>{
        const pct=calcCourseProg(uid,c.id);
        const passed=isCoursePassed(uid,c.id,p);
        return `<div class="course-card" data-cid="${c.id}">
          <span class="badge ${c.catClass}" style="margin-bottom:8px;display:inline-block">${esc(c.cat)}</span>
          <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:17px;margin-bottom:6px">${esc(c.title)}</p>
          <p style="font-size:12px;color:var(--muted);margin-bottom:14px">${c.modules.length} modules</p>
          <div class="prog-bg" style="margin-bottom:6px"><div class="prog-fill" style="width:${pct}%;background:${passed?'var(--success)':'var(--accent)'}"></div></div>
          <p style="font-size:11px;color:var(--muted)">${passed?'✓ Completed':pct>0?pct+'% complete':'Not started'}</p>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderCoursePlayer() {
  const c=S.activeCourse; const uid=S.session.id; const p=currentProg();
  const m=S.activeModule;
  if(!m) return `<div class="fade"><button class="btn-ghost btn-sm" id="back-btn">← Back</button></div>`;
  const isWatched=(p[c.id]?.watched||[]).includes(m.id);
  const modIndex=c.modules.findIndex(x=>x.id===m.id);
  const unlocked=isModuleUnlocked(uid,c.id,modIndex,p);
  const hasQuiz=m.quiz&&m.quiz.length>0;
  const modScore=getModuleQuizScore(uid,c.id,m.id,p);
  const modPassed=modScore!=null&&modScore>=SETTINGS.passThreshold;

  const avail=[];
  if(S._videoUrl) avail.push({k:'video',label:'🎬 Video'});
  if(m.ytId)      avail.push({k:'youtube',label:'▶ YouTube'});
  if(S._pdfUrl)   avail.push({k:'pdf',label:'📄 PDF'});
  const activeTab=S._contentTab||(avail[0]?.k)||null;

  let contentHtml='';
  if(!unlocked){
    contentHtml=`<div class="video-wrapper"><div class="video-placeholder"><div class="video-lock-msg"><p style="color:#fff;font-weight:600;font-size:15px;margin-bottom:6px">🔒 Module locked</p><p style="color:rgba(255,255,255,0.5);font-size:13px">Complete the previous module to unlock this one.</p></div></div></div>`;
  } else if(avail.length>0){
    const tabBar=avail.length>1?`<div class="tab-bar" style="margin-bottom:14px">${avail.map(a=>`<button class="tab-btn content-tab-btn${activeTab===a.k?' active':''}" data-tab="${a.k}">${a.label}</button>`).join('')}</div>`:'';
    if(activeTab==='video'&&S._videoUrl){
      contentHtml=tabBar+`<div class="video-wrapper"><video id="course-video" src="${S._videoUrl}" controls controlsList="nodownload" playsinline style="width:100%;height:100%"></video><div class="video-progress-bar"><div class="video-progress-fill" id="vpf" style="width:0%"></div></div></div>`;
    } else if(activeTab==='youtube'&&m.ytId){
      contentHtml=tabBar+`<div class="video-wrapper" id="yt-player-wrap"><div id="yt-player" style="width:100%;height:100%"></div><div class="video-progress-bar"><div class="video-progress-fill" id="yt-vpf" style="width:0%"></div></div></div>`;
    } else if(activeTab==='pdf'&&S._pdfUrl){
      contentHtml=tabBar+`<div class="pdf-wrapper"><iframe src="${S._pdfUrl}" title="Module PDF"></iframe></div>`;
    }
  } else {
    contentHtml=`<div class="card" style="background:rgba(10,10,15,0.03);text-align:center;padding:32px"><p style="font-size:14px;color:var(--muted)">No media content for this module.</p></div>`;
  }

  const allModsDone=allModulesComplete(uid,c.id,p);
  const sc=p[c.id]?.quizScore;
  const coursePassed=isCoursePassed(uid,c.id,p);

  return `<div class="fade">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
      <button class="btn-ghost btn-sm" id="back-btn">← Back</button>
      <h1 style="font-family:'Syne',sans-serif;font-weight:800;font-size:22px">${esc(c.title)}</h1>
    </div>
    <div style="display:grid;grid-template-columns:1fr 260px;gap:20px;align-items:start">
      <div>
        ${contentHtml}
        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
            <div>
              <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:4px">${esc(m.title)}</p>
              <p style="font-size:13px;color:var(--muted)">${esc(m.description||'')}</p>
            </div>
            <span id="video-status-msg">${isWatched?'<span class="badge badge-green" style="font-size:12px;padding:5px 14px">✓ Watched</span>':''}</span>
          </div>
          ${unlocked&&!isWatched&&avail.length>0&&!S._videoUrl&&!m.ytId?`<button class="btn-ghost btn-sm" id="mark-btn" data-cid="${c.id}" data-mid="${m.id}" style="margin-top:12px">✓ Mark as read</button>`:''}
        </div>
        ${unlocked&&hasQuiz?`<div class="card">
          <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:14px;margin-bottom:4px">📝 Module quiz</p>
          <p style="font-size:13px;color:var(--muted);margin-bottom:14px">Pass with ${SETTINGS.passThreshold}% or more to unlock the next module.</p>
          ${modScore!=null?`<p style="font-size:13px;margin-bottom:12px">Last score: <strong style="color:${modPassed?'var(--success)':'var(--danger)'}">${modScore}%</strong> ${modPassed?'✓ Passed':'✗ Not passed'}</p>`:''}
          ${isWatched?`<button class="btn-primary start-quiz-btn" style="width:auto;padding:10px 24px" data-cid="${c.id}" data-mid="${m.id}">
            ${modScore!=null?'Retake module quiz':'Start module quiz →'}
          </button>`:`<p style="font-size:13px;color:var(--muted)">Watch the content above to unlock this quiz.</p>`}
        </div>`:''}
        ${allModsDone?(sc!=null||coursePassed?`<div class="card" style="background:#EAFAF4;border-color:#9FE1CB">
          <p style="font-weight:700;font-size:14px;color:var(--success);margin-bottom:6px">${coursePassed?'🎉 Course passed!':'📝 Final quiz result'}</p>
          <p style="font-size:13px;color:var(--muted);margin-bottom:14px">Score: <strong>${sc}%</strong>${coursePassed?' — Certificate earned!':' — Need '+SETTINGS.passThreshold+'% to pass'}</p>
          <button class="btn-primary start-quiz-btn" style="width:auto;padding:10px 24px" data-cid="${c.id}" data-mid="">
            ${sc!=null?'Retake final quiz':'Start final quiz →'}
          </button>
        </div>`:(c.quiz&&c.quiz.length?`<div class="card">
          <p style="font-weight:700;font-size:14px;margin-bottom:6px">🏁 Final course quiz</p>
          <p style="font-size:13px;color:var(--muted);margin-bottom:14px">All modules complete! Take the final quiz to earn your certificate.</p>
          <button class="btn-primary start-quiz-btn" style="width:auto;padding:10px 24px" data-cid="${c.id}" data-mid="">Start final quiz →</button>
        </div>`:'')):(c.quiz&&c.quiz.length?`<div class="card" style="background:rgba(10,10,15,0.03)">
          <p style="font-weight:600;font-size:13px;color:var(--muted)">🔒 Final course quiz locked</p>
          <p style="font-size:12px;color:var(--muted);margin-top:4px">Complete all modules (watch + pass each module quiz) to unlock the final quiz.</p>
        </div>`:'')}
      </div>
      <div class="card" style="padding:16px">
        <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;margin-bottom:12px">Modules</p>
        ${c.modules.map((mod,i)=>{
          const complete=isModuleComplete(uid,c.id,mod.id,p);
          const unlck=isModuleUnlocked(uid,c.id,i,p);
          const isActive=S.activeModule?.id===mod.id;
          const numBg=complete?'var(--success)':unlck?'rgba(10,10,15,0.06)':'rgba(10,10,15,0.03)';
          const numColor=complete?'#fff':'var(--muted)';
          const modHasQuiz=mod.quiz&&mod.quiz.length>0;
          return `<div class="mod-item${isActive?' active':''}${unlck?'':' locked-mod'}" data-mid="${mod.id}" data-unlocked="${unlck}" style="${unlck?'':'opacity:0.5;cursor:not-allowed'}">
            <div class="mod-num" style="background:${numBg};color:${numColor}">${complete?'✓':unlck?i+1:'🔒'}</div>
            <div>
              <p style="font-size:13px;font-weight:500">${esc(mod.title)}</p>
              <p style="font-size:11px;color:var(--muted)">${mod.dur}${[mod.ytId?'▶':'',mod.pdf?'📄':''].filter(Boolean).length?' · '+[mod.ytId?'▶':'',mod.pdf?'📄':''].filter(Boolean).join(' '):''}${modHasQuiz?' · 📝':''}</p>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function renderProgress() {
  const uid=S.session.id; const p=currentProg();
  return `<div class="fade">
    <h1 class="page-title">My Progress</h1>
    <p class="page-sub">Detailed breakdown across all courses.</p>
    ${COURSES.map(c=>{
      const pct=calcCourseProg(uid,c.id);const sc=p[c.id]?.quizScore;const wl=p[c.id]?.watched||[];
      const passed=sc!=null&&sc>=SETTINGS.passThreshold;
      return `<div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px">${esc(c.title)}</p>
          <span class="badge ${c.catClass}">${esc(c.cat)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
          <span style="font-size:11px;color:var(--muted);width:90px">Content viewed</span>
          <div class="prog-bg" style="flex:1"><div class="prog-fill" style="width:${pct}%;background:var(--accent)"></div></div>
          <span style="font-size:12px;font-weight:600;width:42px;text-align:right">${pct}%</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <span style="font-size:11px;color:var(--muted);width:90px">Quiz score</span>
          <div class="prog-bg" style="flex:1"><div class="prog-fill" style="width:${sc!=null?sc:0}%;background:${passed?'var(--success)':sc!=null?'var(--gold)':'rgba(10,10,15,0.1)'}"></div></div>
          <span style="font-size:12px;font-weight:600;width:42px;text-align:right;color:${sc!=null?(passed?'var(--success)':'var(--gold)'):'var(--muted)'}">${sc!=null?sc+'%':'—'}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${c.modules.map(mod=>{const d=wl.includes(mod.id);return`<span style="font-size:11px;padding:3px 11px;border-radius:100px;background:${d?'#EAFAF4':'rgba(10,10,15,0.05)'};color:${d?'var(--success)':'var(--muted)'}">${d?'✓ ':'○ '}${esc(mod.title)}</span>`;}).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderCertificates() {
  const uid=S.session.id; const p=currentProg();
  const passed=COURSES.filter(c=>isCoursePassed(uid,c.id,p));
  return `<div class="fade">
    <h1 class="page-title">My Certificates</h1>
    <p class="page-sub">Certificates earned by passing courses with ≥${SETTINGS.passThreshold}%.</p>
    ${passed.length===0
      ?`<div class="empty"><div class="big-icon">🏆</div><p>No certificates yet. Complete a course and pass the quiz to earn one!</p></div>`
      :`<div class="course-grid">${passed.map(c=>{
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
// QUIZ
// ═══════════════════════════════════════════════════
function getQuizDef(cid, mid) {
  const c = COURSES.find(x=>x.id===cid);
  if (!c) return null;
  if (mid) { const m = c.modules.find(x=>x.id===mid); return m ? (m.quiz||[]) : []; }
  return c.quiz || [];
}

async function saveQuizResult(cid, mid, score, answers) {
  const uid = S.session.id;
  const p   = currentProg();
  if (!p[cid]) p[cid] = {watched:[], quizScore:null, moduleQuiz:{}};
  if (!p[cid].moduleQuiz) p[cid].moduleQuiz = {};
  if (mid) p[cid].moduleQuiz[mid] = score;
  else p[cid].quizScore = score;
  S._allProg[uid] = p;
  await DB.saveProgCourse(uid, cid, p[cid]);
  await DB.saveQuizAnswers(uid, quizKey(cid, mid), answers);
  await updateStreak(uid);
}

function renderQuiz() {
  const c=COURSES.find(x=>x.id===S.quiz.cid);
  const mid=S.quiz.mid||null;
  const quizArr=getQuizDef(S.quiz.cid, mid);
  const isModuleQuiz=!!mid;
  const modObj=isModuleQuiz?c.modules.find(m=>m.id===mid):null;
  const quizTitle=isModuleQuiz?`${c.title} — ${modObj?modObj.title:'Module'}`:`${c.title} — Final Quiz`;
  const pass=SETTINGS.passThreshold;
  const maxRetakes=SETTINGS.maxRetakes;
  const rcount=S._retakeCount||0;

  if (S.quiz.done) {
    const score=S.quiz.score;
    const passed=score>=pass;
    const canRetake=maxRetakes===0||rcount<maxRetakes;
    return `<div class="fade" style="max-width:520px;margin:0 auto">
      <div class="card" style="text-align:center;padding:36px">
        <div style="font-size:52px;margin-bottom:16px">${passed?'🎉':'😔'}</div>
        <h2 style="font-family:'Syne',sans-serif;font-weight:800;font-size:26px;margin-bottom:6px">${passed?'Quiz passed!':'Not quite'}</h2>
        <p style="font-size:14px;color:var(--muted);margin-bottom:24px">You scored <strong style="font-size:28px;color:${passed?'var(--success)':'var(--danger)'}">${score}%</strong> on ${quizTitle}</p>
        <p style="font-size:13px;color:var(--muted);margin-bottom:20px">Pass mark: ${pass}%${maxRetakes>0?` · Retakes used: ${rcount}/${maxRetakes}`:' · Unlimited retakes'}</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          ${canRetake&&!passed?`<button class="btn-primary" style="width:auto;padding:10px 24px" id="quiz-retry-btn">Try again</button>`:''}
          <button class="btn-ghost" id="quiz-back-btn">Back to course</button>
          ${passed?`<button class="btn-ghost" id="quiz-exit-btn">Go to dashboard</button>`:''}
        </div>
      </div>
    </div>`;
  }

  const q=quizArr[S.quiz.step];
  const total=quizArr.length;
  return `<div class="fade" style="max-width:560px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">
      <button class="btn-ghost btn-sm" id="quiz-exit-btn">✕ Exit quiz</button>
      <span style="font-size:13px;color:var(--muted)">${quizTitle}</span>
    </div>
    <div class="prog-bg" style="margin-bottom:22px"><div class="prog-fill" style="width:${(S.quiz.step/total*100)}%;background:var(--accent)"></div></div>
    <div class="card">
      <p style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px">Question ${S.quiz.step+1} of ${total}</p>
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:18px;margin-bottom:20px">${esc(q.q)}</p>
      ${q.opts.map((opt,oi)=>opt?`<div class="quiz-opt" data-oi="${oi}">${esc(opt)}</div>`:'').join('')}
    </div>
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
      <button class="tab-btn${S.adminSubTab==='reset'?' active':''}" data-subtab="reset">Reset Password</button>
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
  return `<div class="card" style="max-width:460px">
    <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:6px">Reset password for ${esc(u.name)}</p>
    <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
      This will send a password reset email to <strong>${esc(u.email)}</strong>. The learner clicks the link in the email to set a new password.
    </p>
    <div id="pw-msg"></div>
    <button class="btn-primary" style="width:auto;padding:10px 24px" id="send-pw-reset-btn" data-uid="${u.id}" data-email="${esc(u.email)}">Send reset email</button>
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
            return `<tr><td><strong>${esc(c.title)}</strong></td><td>${c.modules.length}</td>
              <td><div style="display:flex;align-items:center;gap:8px">
                <div class="prog-bg" style="width:80px"><div class="prog-fill" style="width:${avg}%;background:var(--gold)"></div></div>
                ${avg}%
              </div></td>
              <td>${passCount}/${stats.length}</td><td>${avgQ}%</td>
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
          <input type="number" id="st-pass" min="1" max="100" value="${SETTINGS.passThreshold}" style="width:100px">
          <span style="font-size:12px;color:var(--muted)">Learners must score at least this % to pass (default: 80%)</span>
        </div>
      </div>
      <div class="field">
        <label>Maximum retakes per quiz</label>
        <div style="display:flex;align-items:center;gap:12px">
          <input type="number" id="st-retakes" min="0" max="99" value="${SETTINGS.maxRetakes}" style="width:100px">
          <span style="font-size:12px;color:var(--muted)">Set to 0 for unlimited retakes (default: 2)</span>
        </div>
      </div>
      <div id="st-msg"></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px">
        <button class="btn-primary" style="width:auto;padding:10px 24px" id="st-save-btn">Save settings</button>
        <button class="btn-ghost btn-sm" id="st-reset-btn">Reset to defaults</button>
      </div>
    </div>
    <div class="card">
      <p style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:4px">Learner Quiz Attempts</p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
        Current limit: <strong>${SETTINGS.maxRetakes===0?'Unlimited':SETTINGS.maxRetakes+' retake'+(SETTINGS.maxRetakes!==1?'s':'')}</strong>.
      </p>
      ${stats.length?`<table class="data-table">
        <thead><tr><th>Learner</th><th>Actions</th></tr></thead>
        <tbody>
          ${stats.map(u=>`<tr>
            <td><strong>${esc(u.name)}</strong></td>
            <td><button class="btn-ghost btn-sm reset-attempts-btn" data-uid="${u.id}">Reset all quiz attempts</button></td>
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
    <p class="modal-sub">Create a new learner account. They will receive a welcome email from Supabase.</p>
    <div class="field"><label>Full name</label><input type="text" id="ml-name" placeholder="Priya Kapoor"></div>
    <div class="field"><label>Email address</label><input type="email" id="ml-email" placeholder="priya@company.com"></div>
    <div class="field"><label>Subject (optional)</label><input type="text" id="ml-dept" placeholder="e.g. Science"></div>
    <div class="field"><label>Temporary password</label><input type="password" id="ml-pw" placeholder="Min 6 characters"></div>
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
      ${(c?.modules||[{id:uid(),title:'',dur:'',description:'',video:false,pdf:false,ytId:'',quiz:[]}]).map((m,i)=>moduleRow(m,i)).join('')}
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
      <p style="font-weight:600;font-size:12px;margin-bottom:8px">📎 Learning content <span style="color:var(--muted);font-weight:400">(add at least one)</span></p>
      <div class="field">
        <label>🎬 Video (.mp4) — upload to Supabase storage</label>
        <div class="drop-zone" id="dz-${m.id}-video" data-kind="video" data-mod-id="${m.id}">
          <div style="font-size:22px">🎬</div>
          <p class="dz-status" data-key="${m.id}_video">${m.video?'✅ Video uploaded — click or drop to replace':'Click or drop an .mp4 file'}</p>
          <input type="file" class="mod-file-input" data-key="${m.id}_video" accept=".mp4,video/mp4" style="display:none">
        </div>
      </div>
      <div class="field">
        <label>▶ YouTube video link — optional</label>
        <input type="text" class="mod-yt" data-mod-id="${m.id}" value="${esc(m.ytId||'')}"
          placeholder="https://www.youtube.com/watch?v=... or bare video ID">
        ${m.ytId ? `<p style="font-size:11px;color:var(--success);margin-top:4px">✅ YouTube video linked (ID: ${esc(m.ytId)})</p>` : ''}
      </div>
      <div class="field" style="margin-bottom:0">
        <label>📄 PDF — upload to Supabase storage</label>
        <div class="drop-zone" id="dz-${m.id}-pdf" data-kind="pdf" data-mod-id="${m.id}">
          <div style="font-size:22px">📄</div>
          <p class="dz-status" data-key="${m.id}_pdf">${m.pdf?'✅ PDF uploaded — click or drop to replace':'Click or drop a PDF'}</p>
          <input type="file" class="mod-file-input" data-key="${m.id}_pdf" accept=".pdf" style="display:none">
        </div>
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
  document.getElementById('add-mod-btn')?.addEventListener('click',()=>{
    const count=document.querySelectorAll('#mc-modules .accordion-body[data-mod-id]').length;
    const m={id:uid(),title:'',dur:'',description:'',video:false,pdf:false,ytId:'',quiz:[]};
    document.getElementById('mc-modules').insertAdjacentHTML('beforeend',moduleRow(m,count));
    bindDropZones();
    bindRemoveBtns();
  });
  document.getElementById('add-q-btn')?.addEventListener('click',()=>{
    const count=document.querySelectorAll('#mc-quiz [data-q-idx]').length;
    const q={q:'',opts:['','','',''],ans:0};
    document.getElementById('mc-quiz').insertAdjacentHTML('beforeend',quizRow(q,count));
    bindRemoveBtns();
  });
  bindDropZones();
  bindRemoveBtns();

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
        document.querySelectorAll('.mod-quiz-list[data-mod-id="'+modId+'"] .mod-quiz-row').forEach((r,idx)=>{
          r.dataset.mqIdx=idx;
          r.querySelector('span').textContent='Q'+(idx+1);
        });
        return;
      }
    });
  }

  // Save new learner (admin modal — uses SBAUTH.signUp then inserts learners row)
  document.getElementById('ml-save-btn')?.addEventListener('click', async ()=>{
    const name  = document.getElementById('ml-name').value.trim();
    const email = document.getElementById('ml-email').value.trim().toLowerCase();
    const dept  = document.getElementById('ml-dept').value.trim();
    const pw    = document.getElementById('ml-pw').value;
    const msg   = document.getElementById('ml-msg');

    if (!name||!email||!pw) { msg.innerHTML='<div class="msg-err">Name, email, and password are required.</div>'; return; }
    if (pw.length < 6)      { msg.innerHTML='<div class="msg-err">Password must be 6+ characters.</div>'; return; }

    try {
      msg.innerHTML='<div class="msg-ok">Creating account…</div>';

      // 1. Create Supabase Auth user (this doesn't affect the admin's own session)
      const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw, data: { role: 'learner', name } }),
      });
      const sbUser = await r.json();
      if (!r.ok) throw new Error(sbUser.error_description || sbUser.msg || 'Auth sign-up failed.');
      const authUid = sbUser.user?.id;
      if (!authUid) throw new Error('No user ID returned from sign-up.');

      // 2. Insert the learners row linked to the new auth user
      await SB.insert('learners', {
        id:         crypto.randomUUID(),
        auth_id:    authUid,
        name, email,
        subject:    dept,
        notes:      '',
        created_at: new Date().toISOString(),
        disabled:   false,
      });

      // 3. Refresh admin stats
      S._allUsers = await DB.learnersWithAuth();
      await Promise.all((S._allUsers||[]).map(async u => {
        if (!S._allProg[u.id]) S._allProg[u.id] = await DB.prog(u.id);
      }));
      DB._learners = null;

      closeModal();
      toast('Learner added successfully ✅');
      render();
    } catch(err) {
      msg.innerHTML=`<div class="msg-err">Error: ${err.message}</div>`;
    }
  });

  // Save course
  document.getElementById('mc-save-btn')?.addEventListener('click', saveCourseFromModal);
}

function bindDropZones() {
  document.querySelectorAll('.drop-zone').forEach(dz=>{
    const inp=dz.querySelector('.mod-file-input');
    if(!inp)return;
    const storeKey=inp.dataset.key;
    dz.addEventListener('click',(e)=>{if(e.target!==inp){inp.click();}});
    dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
    dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
    dz.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();dz.classList.remove('drag-over');handleFileUpload(e.dataTransfer.files[0],storeKey,dz);});
    inp.addEventListener('change',()=>handleFileUpload(inp.files[0],storeKey,dz));
  });
}

async function handleFileUpload(file, storeKey, dz) {
  if (!file) return;
  const kind = dz.dataset.kind;
  const pEl  = dz.querySelector('p');

  if (kind === 'pdf') {
    const isPdf = file.type==='application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) { toast('That is not a PDF file.','err'); return; }
    if (file.size > 50*1024*1024) { toast('PDF is too large (>50MB).','err'); return; }
    pEl.textContent = '⏳ Uploading PDF to Supabase…';
    const modId = storeKey.replace('_pdf','');
    try {
      await SB.uploadFile('pdfs', modId + '.pdf', file, 'application/pdf');
      dz.dataset.uploaded = 'true';
      pEl.textContent = '✅ ' + file.name + ' uploaded';
      toast('PDF uploaded ✅');
    } catch(err) {
      pEl.textContent = 'Upload failed — try again';
      toast('Upload failed: ' + err.message, 'err');
    }
  } else if (kind === 'video') {
    const isVideo = /^video\//.test(file.type) || /\.(mp4)$/i.test(file.name);
    if (!isVideo) { toast('Please upload an .mp4 file.','err'); return; }
    if (file.size > 500*1024*1024) { toast('Video is too large (>500MB). Consider compressing it first.','err'); return; }
    pEl.textContent = '⏳ Uploading video to Supabase…';
    const modId = storeKey.replace('_video','');
    try {
      await SB.uploadFile('videos', modId + '.mp4', file, 'video/mp4');
      dz.dataset.uploaded = 'true';
      pEl.textContent = '✅ ' + file.name + ' uploaded';
      toast('Video uploaded ✅');
    } catch(err) {
      pEl.textContent = 'Upload failed — try again';
      toast('Upload failed: ' + err.message, 'err');
    }
  }
}

function bindRemoveBtns() {
  document.querySelectorAll('.remove-mod-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.getElementById('mod-row-'+btn.dataset.modId)?.remove();
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

    const title=titleEl.value.trim();
    const cat=catEl.value.trim();
    const catClass=catClassEl.value;
    const existingCid=saveBtn.dataset.cid.trim();
    const errors=[];
    if(!title) errors.push('Course title is required.');
    if(!cat)   errors.push('Category is required.');

    const modEls=document.querySelectorAll('#mc-modules .accordion-body[data-mod-id]');
    const modules=[];
    modEls.forEach(el=>{
      const mid=el.dataset.modId;
      const t=(el.querySelector('.mod-title')?.value||'').trim();
      const d=(el.querySelector('.mod-dur')?.value||'').trim();
      const desc=(el.querySelector('.mod-desc')?.value||'').trim();
      if(!t){errors.push('All modules must have a title.');return;}

      const ytRaw=(el.querySelector('.mod-yt')?.value||'').trim();
      const ytId=parseYtId(ytRaw);
      if(ytRaw&&!ytId) errors.push(`Module "${t}": the YouTube link/ID doesn't look valid.`);

      const existingCourse   = COURSES.find(c=>c.id===existingCid);
      const existingMod      = existingCourse?.modules.find(m=>m.id===mid);
      const pdfDz            = el.querySelector('.drop-zone[data-kind="pdf"]');
      const videoDz          = el.querySelector('.drop-zone[data-kind="video"]');
      const hasPdfUploaded   = pdfDz?.dataset.uploaded === 'true';
      const hasVideoUploaded = videoDz?.dataset.uploaded === 'true';
      const hasPdf   = hasPdfUploaded   || (existingMod?.pdf   || false);
      const hasVideo = hasVideoUploaded || (existingMod?.video || false);

      if (!ytId && !hasPdf && !hasVideo) {
        errors.push(`Module "${t}" needs at least one content source (uploaded video, PDF, or YouTube link).`);
      }

      const modQuiz=[];
      el.querySelectorAll('.mod-quiz-row').forEach((row)=>{
        const qt=row.querySelector('.mq-text')?.value.trim()||'';
        const opts=Array.from(row.querySelectorAll('.mq-opt')).map(o=>o.value.trim());
        const ansR=row.querySelector('.mq-ans:checked');
        const ans=ansR?parseInt(ansR.dataset.oi):0;
        if(qt&&opts.filter(o=>o).length>=2){ modQuiz.push({q:qt,opts,ans}); }
        else if(qt&&opts.filter(o=>o).length<2){ errors.push(`Module "${t}": a quiz question needs at least 2 options.`); }
      });

      modules.push({id:mid,title:t,dur:d||'—',description:desc,quiz:modQuiz,
        video:hasVideo, pdf:hasPdf, ytId:ytId||''});
    });

    if(!modules.length) errors.push('At least one module is required.');

    const qEls=document.querySelectorAll('#mc-quiz [data-q-idx]');
    const quiz=[];
    qEls.forEach((el)=>{
      const qText=el.querySelector('.q-text')?.value.trim();
      const opts=Array.from(el.querySelectorAll('.q-opt')).map(o=>o.value.trim());
      const ansRadio=el.querySelector('.q-ans-radio:checked');
      const ans=ansRadio?parseInt(ansRadio.dataset.oi):0;
      if(!qText) return;
      if(opts.filter(o=>o).length<2){errors.push(`Final quiz question needs at least 2 options.`);return;}
      quiz.push({q:qText,opts,ans});
    });

    if(errors.length){
      msg.innerHTML='<div class="msg-err"><strong>Please fix the following:</strong><ul style="margin:6px 0 0 16px">'+errors.map(e=>`<li>${e}</li>`).join('')+'</ul></div>';
      msg.scrollIntoView({behavior:'smooth',block:'nearest'});
      return;
    }

    const courseId = existingCid || 'c_'+Date.now();
    const course = {id:courseId, title, cat, catClass, modules, quiz};
    await DB.saveCourse(course);
    COURSES = await DB.courses();
    closeModal();
    toast(existingCid?'Course updated ✅':'Course created ✅');
    render();

  } catch(err) {
    msg.innerHTML=`<div class="msg-err"><strong>Unexpected error:</strong> ${err.message}</div>`;
    console.error('saveCourseFromModal error:', err);
  }
}

// ═══════════════════════════════════════════════════
// STREAK HELPERS
// ═══════════════════════════════════════════════════
async function updateStreak(userId) {
  try {
    const today = new Date().toDateString();
    const row   = await DB.getStreak(userId);
    if (row.last_date === today) return;
    const yesterday = new Date(Date.now()-86400000).toDateString();
    const newStreak = row.last_date === yesterday ? (row.streak||0)+1 : 1;
    await DB.saveStreak(userId, newStreak, today);
    if (userId === S.session?.id) S._streak = newStreak;
  } catch(e) { console.warn('streak update failed', e); }
}

// ═══════════════════════════════════════════════════
// EXPORT HELPERS
// ═══════════════════════════════════════════════════
function exportLearnerReport(uid) {
  const stats = getAllStats();
  const u = stats.find(x=>x.id===uid);
  if (!u) return;
  const now = new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'long',year:'numeric'});
  const passThresh = SETTINGS.passThreshold;
  let courseRows = '';
  COURSES.forEach(c => {
    const pct = calcCourseProg(u.id, c.id);
    const wl  = u.p[c.id]?.watched || [];
    const coursePassed = isCoursePassed(u.id, c.id, u.p);
    const hasFinal = c.quiz && c.quiz.length>0;
    const finalSc = hasFinal ? u.p[c.id]?.quizScore : null;
    const statusColor = coursePassed ? '#1D9E75' : pct>0 ? '#E8A838' : '#E24B4A';
    const statusText  = coursePassed ? 'Completed' : pct>0 ? 'In progress' : 'Not started';
    let moduleRows = c.modules.map(mod => {
      const watchedMod = wl.includes(mod.id);
      const modHasQuiz = mod.quiz && mod.quiz.length>0;
      const mScore = u.p[c.id]?.moduleQuiz?.[mod.id] ?? null;
      const modComplete = isModuleComplete(u.id, c.id, mod.id, u.p);
      let statusLabel;
      if (modComplete) statusLabel = '<span style="color:#1D9E75;font-weight:600">✓ Passed</span>';
      else if (watchedMod && modHasQuiz) statusLabel = `<span style="color:#E8A838;font-weight:600">Watched · quiz ${mScore!=null?mScore+'%':'pending'}</span>`;
      else if (watchedMod) statusLabel = '<span style="color:#1D9E75;font-weight:600">✓ Watched</span>';
      else statusLabel = '<span style="color:#aaa;font-weight:600">○ Not started</span>';
      return `<tr><td style="padding:6px 12px;font-size:12px;color:#444">${esc(mod.title)}</td><td style="padding:6px 12px;font-size:12px;text-align:center">${statusLabel}</td></tr>`;
    }).join('');
    courseRows += `<tr style="background:#F5F3EE"><td colspan="2" style="padding:10px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:13px">${esc(c.title)}</strong>
        <div style="display:flex;gap:10px;align-items:center">
          <span style="font-size:12px;color:#666">${pct}% complete${hasFinal?' · Final quiz: '+(finalSc!=null?finalSc+'%':'pending'):''}</span>
          <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;background:${statusColor}20;color:${statusColor}">${statusText}</span>
        </div>
      </div></td></tr>${moduleRows}<tr><td colspan="2" style="padding:4px"></td></tr>`;
  });
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Learner Report — ${esc(u.name)}</title>
  <style>body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:40px;color:#0A0A0F;background:#fff}.logo{font-size:22px;font-weight:900;color:#0A0A0F}.logo span{color:#FF4D00}h1{font-size:26px;font-weight:800;margin:0 0 4px}.stats{display:flex;gap:16px;margin-bottom:28px}.stat{flex:1;border:1px solid #eee;border-radius:10px;padding:14px 16px}.stat-val{font-size:26px;font-weight:900}.stat-lbl{font-size:11px;color:#888;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:9px 12px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#888;border-bottom:1px solid #eee}.section-title{font-size:15px;font-weight:800;margin:28px 0 12px}.footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#bbb;text-align:center}</style>
  </head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #FF4D00">
    <div><div class="logo">Trivekii<span>.</span></div><h1>${esc(u.name)}</h1><div style="font-size:13px;color:#888">${esc(u.email)}${u.dept?' · '+esc(u.dept):''}</div></div>
    <div style="font-size:12px;color:#888;text-align:right"><div>Learner Progress Report</div><div>Generated: ${now}</div><div>Pass mark: ${passThresh}%</div></div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${u.overall}%</div><div class="stat-lbl">Overall completion</div></div>
    <div class="stat"><div class="stat-val">${u.passed}/${COURSES.length}</div><div class="stat-lbl">Courses passed</div></div>
    <div class="stat"><div class="stat-val">${u.qDone}/${COURSES.length}</div><div class="stat-lbl">Quizzes attempted</div></div>
    <div class="stat"><div class="stat-val">${u.avgQ}%</div><div class="stat-lbl">Avg quiz score</div></div>
  </div>
  <div class="section-title">Course & Module Breakdown</div>
  <table><thead><tr><th>Module</th><th style="text-align:center">Status</th></tr></thead><tbody>${courseRows}</tbody></table>
  <div class="footer">Trivekii LMS · Confidential · ${now}</div>
  </body></html>`;
  downloadFile(u.name.replace(/\s+/g,'_')+'_report.html', html, 'text/html');
  toast('Report downloaded');
}

async function exportQuizCSV(uid) {
  const stats = getAllStats();
  const u = stats.find(x=>x.id===uid);
  if (!u) return;
  const rows=[['Learner','Email','Course','Quiz','Question #','Question','Learner Answer','Correct Answer','Result','Quiz Score %']];
  async function emitQuiz(c, quizArr, quizLabel, score, qKey) {
    if(!quizArr||!quizArr.length) return;
    const storedAnswers = await DB.getQuizAnswers(uid, qKey);
    quizArr.forEach((q,i)=>{
      if(score==null){rows.push([u.name,u.email,c.title,quizLabel,i+1,q.q,'Not attempted',q.opts[q.ans],'—','—']);}
      else if(storedAnswers&&storedAnswers.length){
        const ansIdx=storedAnswers[i]!=null?storedAnswers[i]:-1;
        const learnerAns=ansIdx>=0?q.opts[ansIdx]:'No answer recorded';
        const correct=ansIdx===q.ans;
        rows.push([u.name,u.email,c.title,quizLabel,i+1,q.q,learnerAns,q.opts[q.ans],correct?'Correct':'Incorrect',score+'%']);
      } else {
        rows.push([u.name,u.email,c.title,quizLabel,i+1,q.q,'(detail not available)',q.opts[q.ans],'—',score+'%']);
      }
    });
  }
  for(const c of COURSES){
    for(const mod of c.modules){
      if(mod.quiz&&mod.quiz.length){
        const mScore=u.p[c.id]?.moduleQuiz?.[mod.id]??null;
        await emitQuiz(c,mod.quiz,'Module: '+mod.title,mScore,quizKey(c.id,mod.id));
      }
    }
    if(c.quiz&&c.quiz.length){
      const fScore=u.p[c.id]?.quizScore??null;
      await emitQuiz(c,c.quiz,'Final course quiz',fScore,quizKey(c.id,null));
    }
  }
  const csv=rows.map(r=>r.map(cell=>{const s=String(cell==null?'':cell).replace(/"/g,'""');return/[,\n"]/.test(s)?'"'+s+'"':s;}).join(',')).join('\n');
  downloadFile(u.name.replace(/\s+/g,'_')+'_quiz_responses.csv',csv,'text/csv');
  toast('Quiz responses CSV downloaded');
}

function downloadFile(filename, content, mimeType) {
  const encoded = 'data:'+mimeType+';charset=utf-8,'+encodeURIComponent(content);
  const a=document.createElement('a');
  a.href=encoded; a.download=filename; a.style.display='none';
  document.body.appendChild(a); a.click();
  setTimeout(()=>document.body.removeChild(a),200);
}

// ═══════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════
function bindEvents() {
  document.getElementById('back-btn')?.addEventListener('click',()=>{S.activeCourse=null;S.activeModule=null;render();});

  document.querySelectorAll('.mod-item[data-mid]').forEach(el=>el.addEventListener('click',()=>{
    if(!S.activeCourse) return;
    if(el.dataset.unlocked==='false'){ toast('Complete the previous module first to unlock this one.','err'); return; }
    const mid=el.dataset.mid;
    const course=COURSES.find(c=>c.id===S.activeCourse.id);
    if(!course) return;
    const mod=course.modules.find(m=>m.id===mid);
    if(!mod) return;
    S.activeCourse=course; S.activeModule=mod;
    loadAndRender();
  }));

  document.querySelectorAll('.content-tab-btn').forEach(btn=>btn.addEventListener('click',e=>{
    S._contentTab=e.currentTarget.dataset.tab;
    render();
  }));

  document.getElementById('mark-btn')?.addEventListener('click', async e=>{
    const {cid,mid}=e.currentTarget.dataset;
    const uid=S.session.id;
    const p=currentProg();
    if(!p[cid])p[cid]={watched:[],quizScore:null,moduleQuiz:{}};
    if(!p[cid].moduleQuiz)p[cid].moduleQuiz={};
    if(!p[cid].watched.includes(mid))p[cid].watched.push(mid);
    S._allProg[uid]=p;
    await DB.saveProgCourse(uid,cid,p[cid]);
    await updateStreak(uid);
    const mod=S.activeCourse?.modules.find(m=>m.id===mid);
    toast(mod&&mod.quiz&&mod.quiz.length?'Content done — now take the module quiz':'Module complete!');
    loadAndRender(S._contentTab);
  });

  document.querySelectorAll('.start-quiz-btn').forEach(btn=>btn.addEventListener('click', async e=>{
    const cid=e.currentTarget.dataset.cid;
    const mid=e.currentTarget.dataset.mid||null;
    const rcount = await DB.getRetakeCount(S.session.id, quizKey(cid,mid));
    S._retakeCount = rcount;
    S.quiz={cid,mid,step:0,answers:[],done:false,score:0};
    render();
  }));

  document.querySelectorAll('.quiz-opt').forEach(el=>el.addEventListener('click', async ()=>{
    const oi=parseInt(el.dataset.oi); const q=S.quiz;
    const quizArr=getQuizDef(q.cid, q.mid||null);
    q.answers.push(oi);
    if(q.step+1>=quizArr.length){
      const score=Math.round(q.answers.reduce((a,ans,i)=>a+(ans===quizArr[i].ans?1:0),0)/quizArr.length*100);
      q.score=score; q.done=true;
      await saveQuizResult(q.cid, q.mid||null, score, q.answers);
    } else {q.step++;}
    render();
  }));

  document.getElementById('quiz-exit-btn')?.addEventListener('click',()=>{S.quiz=null;render();});
  document.getElementById('quiz-back-btn')?.addEventListener('click',()=>{S.quiz=null;loadAndRender();});
  document.getElementById('quiz-retry-btn')?.addEventListener('click', async ()=>{
    const newCount = await DB.incrementRetakeCount(S.session.id, quizKey(S.quiz.cid, S.quiz.mid||null));
    S._retakeCount = newCount;
    S.quiz={cid:S.quiz.cid,mid:S.quiz.mid||null,step:0,answers:[],done:false,score:0};
    render();
  });

  document.querySelectorAll('.learner-row').forEach(el=>el.addEventListener('click',()=>{
    S.selectedUser=el.dataset.uid; S.tab='learners'; S.adminSubTab='info';
    buildSidebar(); render();
  }));
  document.getElementById('back-learners-btn')?.addEventListener('click',()=>{S.selectedUser=null;S.adminSubTab='info';render();});
  document.querySelectorAll('[data-subtab]').forEach(el=>{
    el.addEventListener('click',()=>{S.adminSubTab=el.dataset.subtab;render();});
  });
  document.getElementById('learner-search')?.addEventListener('input',e=>{
    const q=e.target.value.toLowerCase();
    document.querySelectorAll('#learner-tbody tr').forEach(row=>{
      row.style.display=row.textContent.toLowerCase().includes(q)?'':'none';
    });
  });

  document.getElementById('save-edit-btn')?.addEventListener('click', async e=>{
    const uid2=e.currentTarget.dataset.uid;
    const users=await DB.learnersWithAuth();
    const u=users.find(x=>x.id===uid2);
    if(!u)return;
    const updated={...u,
      name:document.getElementById('edit-name').value.trim()||u.name,
      email:document.getElementById('edit-email').value.trim()||u.email,
      dept:document.getElementById('edit-dept').value.trim(),
      notes:document.getElementById('edit-notes').value.trim()
    };
    await DB.saveLearner(updated);
    S._allUsers = await DB.learnersWithAuth();
    toast('Learner details saved'); render();
  });

  // Password reset — sends Supabase email to learner
  document.getElementById('send-pw-reset-btn')?.addEventListener('click', async e=>{
    const email = e.currentTarget.dataset.email;
    const msg   = document.getElementById('pw-msg');
    try {
      msg.innerHTML='<div class="msg-ok">Sending reset email…</div>';
      await SBAUTH.sendLearnerPasswordReset(email);
      msg.innerHTML=`<div class="msg-ok">Reset email sent to <strong>${esc(email)}</strong>. The learner should check their inbox.</div>`;
    } catch(err) {
      msg.innerHTML=`<div class="msg-err">Failed to send reset email: ${err.message}</div>`;
    }
  });

  document.getElementById('toggle-disable-btn')?.addEventListener('click', async e=>{
    const uid2=e.currentTarget.dataset.uid;
    const isDisabled=e.currentTarget.dataset.disabled==='true';
    const users=await DB.learnersWithAuth();
    const u=users.find(x=>x.id===uid2);
    if(!u)return;
    await DB.saveLearner({...u, disabled:!isDisabled});
    S._allUsers = await DB.learnersWithAuth();
    toast(isDisabled?'Account enabled':'Account disabled'); render();
  });

  document.getElementById('export-report-btn')?.addEventListener('click',e=>{
    exportLearnerReport(e.currentTarget.dataset.uid);
  });
  document.getElementById('export-quiz-btn')?.addEventListener('click',e=>{
    exportQuizCSV(e.currentTarget.dataset.uid);
  });

  document.getElementById('reset-progress-btn')?.addEventListener('click', async e=>{
    if(!confirm('Reset ALL progress for this learner? This cannot be undone.'))return;
    const uid2=e.currentTarget.dataset.uid;
    await DB.resetProg(uid2);
    S._allProg[uid2]={};
    toast('Progress reset'); render();
  });

  document.getElementById('delete-learner-btn')?.addEventListener('click', async e=>{
    if(!confirm('Permanently delete this learner? This cannot be undone.'))return;
    const uid2=e.currentTarget.dataset.uid;
    await DB.deleteLearner(uid2);
    await DB.resetRetakes(uid2);
    S._allUsers = S._allUsers?.filter(u=>u.id!==uid2);
    S._allProg[uid2]={};
    S.selectedUser=null; S.tab='learners';
    toast('Learner deleted'); buildSidebar(); render();
  });

  document.getElementById('add-course-btn')?.addEventListener('click',()=>openAddCourseModal(null));
  document.querySelectorAll('.edit-course-btn').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const c=COURSES.find(x=>x.id===el.dataset.cid);
    openAddCourseModal(c);
  }));
  document.querySelectorAll('.delete-course-btn').forEach(el=>el.addEventListener('click', async e=>{
    e.stopPropagation();
    if(!confirm('Delete this course? Learner progress for this course will remain in storage.'))return;
    await DB.deleteCourse(el.dataset.cid);
    COURSES = await DB.courses();
    toast('Course deleted'); render();
  }));

  document.getElementById('add-learner-btn')?.addEventListener('click',()=>openAddLearnerModal());
  document.getElementById('add-learner-btn2')?.addEventListener('click',()=>openAddLearnerModal());

  document.getElementById('st-save-btn')?.addEventListener('click', async ()=>{
    const pass=parseInt(document.getElementById('st-pass').value);
    const retakes=parseInt(document.getElementById('st-retakes').value);
    const msg=document.getElementById('st-msg');
    if(isNaN(pass)||pass<1||pass>100){msg.innerHTML='<div class="msg-err">Pass % must be between 1 and 100.</div>';return;}
    if(isNaN(retakes)||retakes<0){msg.innerHTML='<div class="msg-err">Retakes must be 0 or more.</div>';return;}
    SETTINGS.passThreshold=pass;
    SETTINGS.maxRetakes=retakes;
    await DB.saveSettings(SETTINGS);
    msg.innerHTML='<div class="msg-ok">Settings saved.</div>';
    setTimeout(()=>render(),800);
  });
  document.getElementById('st-reset-btn')?.addEventListener('click', async ()=>{
    if(!confirm('Reset to defaults? (80% pass, 2 retakes)'))return;
    SETTINGS={...DEFAULT_SETTINGS};
    await DB.saveSettings(SETTINGS);
    toast('Settings reset to defaults'); render();
  });
  document.querySelectorAll('.reset-attempts-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      await DB.resetRetakes(btn.dataset.uid);
      toast('Quiz attempts reset for this learner'); render();
    });
  });

  initVideoPlayer();
  initYouTubePlayer();
}

// ═══════════════════════════════════════════════════
// DIRECT VIDEO PLAYER ENFORCEMENT
// ═══════════════════════════════════════════════════
function initVideoPlayer() {
  const video = document.getElementById('course-video');
  if (!video) return;
  const m = S.activeModule;
  const cid = S.activeCourse?.id;
  const p = currentProg();
  const isAlreadyWatched = (p[cid]?.watched || []).includes(m?.id);
  if (isAlreadyWatched) return;

  let lastTime  = 0;
  let completed = false;

  video.addEventListener('timeupdate', () => {
    const vpf = document.getElementById('vpf');
    if (vpf && video.duration > 0) vpf.style.width = (video.currentTime / video.duration * 100) + '%';
    if (video.currentTime > lastTime + 3) {
      video.currentTime = lastTime;
      toast('Please watch the video without skipping', 'err');
    } else {
      lastTime = Math.max(lastTime, video.currentTime);
    }
    if (!completed && video.duration > 0 && video.currentTime >= video.duration - 1) {
      completed = true;
      markVideoComplete(m.id, cid);
    }
  });
  video.addEventListener('contextmenu', e => e.preventDefault());
  video.addEventListener('ratechange', () => { if (video.playbackRate !== 1) video.playbackRate = 1; });
}

// Course card click (delegated)
document.getElementById('main-content').addEventListener('click', e=>{
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

document.addEventListener('dragover', e=>{ if(!e.target.closest('.drop-zone')) e.preventDefault(); });
document.addEventListener('drop',     e=>{ if(!e.target.closest('.drop-zone')) e.preventDefault(); });

// ═══════════════════════════════════════════════════
// YOUTUBE PLAYER
// ═══════════════════════════════════════════════════
function initYouTubePlayer() {
  const wrap = document.getElementById('yt-player-wrap');
  if (!wrap) return;
  const m   = S.activeModule;
  const cid = S.activeCourse?.id;
  if (!m || !m.ytId) return;
  if (location.protocol === 'file:') return;

  const p = currentProg();
  const isAlreadyWatched = (p[cid]?.watched || []).includes(m.id);
  const ytVidId = m.ytId;

  function createPlayer() {
    if (!document.getElementById('yt-player')) return;
    let lastTime=0, completed=false, tickTimer=null;

    function showEmbedError(code) {
      clearInterval(tickTimer);
      const isEmbedBlocked=[101,150,153].includes(code);
      wrap.innerHTML=`<div style="width:100%;min-height:200px;display:flex;align-items:center;justify-content:center;background:#0f0f0f;border-radius:6px;padding:24px;box-sizing:border-box">
        <div style="text-align:center;max-width:340px">
          <div style="font-size:40px;margin-bottom:12px">${isEmbedBlocked?'🚫':'⚠️'}</div>
          <p style="color:#fff;font-weight:700;font-size:15px;margin-bottom:8px">${isEmbedBlocked?'Embedding disabled for this video':'Video unavailable'}</p>
          <p style="color:rgba(255,255,255,0.55);font-size:12px;margin-bottom:18px;line-height:1.5">${isEmbedBlocked?'The video owner has disabled embedding. Ask your admin to replace this video.':`YouTube error ${code} — the video may be private, deleted, or region-restricted.`}</p>
          <a href="https://www.youtube.com/watch?v=${encodeURIComponent(ytVidId)}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;padding:9px 20px;background:#FF0000;color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none">Watch on YouTube ↗</a>
        </div>
      </div>`;
      const bar=document.getElementById('yt-vpf'); if(bar)bar.style.display='none';
    }

    new YT.Player('yt-player', {
      videoId: ytVidId, width:'100%', height:'100%',
      playerVars:{rel:0,modestbranding:1,iv_load_policy:3,controls:1,origin:location.origin},
      events:{
        onError(e){clearInterval(tickTimer);showEmbedError(e.data);},
        onStateChange(e){
          if(e.data===YT.PlayerState.PLAYING){
            clearInterval(tickTimer);
            tickTimer=setInterval(()=>{
              if(!document.getElementById('yt-player')&&!document.querySelector('iframe#yt-iframe')){clearInterval(tickTimer);return;}
              let cur,dur;
              try{cur=e.target.getCurrentTime();dur=e.target.getDuration();}catch(_){clearInterval(tickTimer);return;}
              const bar=document.getElementById('yt-vpf');
              if(bar&&dur>0)bar.style.width=(cur/dur*100)+'%';
              if(isAlreadyWatched||completed||!(dur>0))return;
              if(cur>lastTime+4){
                try{e.target.seekTo(lastTime,true);}catch(_){}
                toast('Please watch the video without skipping ⛔','err');
                return;
              }
              lastTime=Math.max(lastTime,cur);
              if(cur>=dur-2){completed=true;clearInterval(tickTimer);markVideoComplete(m.id,cid);}
            },500);
          } else {clearInterval(tickTimer);}
          if(e.data===YT.PlayerState.ENDED&&!completed&&!isAlreadyWatched){
            let finalDur=0;try{finalDur=e.target.getDuration();}catch(_){}
            if(finalDur>0&&lastTime>=finalDur-5){
              completed=true;clearInterval(tickTimer);markVideoComplete(m.id,cid);
            } else {
              try{e.target.seekTo(lastTime,true);e.target.playVideo();}catch(_){}
              toast('Please watch the video without skipping ⛔','err');
            }
          }
        },
      },
    });
  }

  if(window.YT&&window.YT.Player){createPlayer();}
  else if(!window._ytLoading){
    window._ytLoading=true; window._ytQueue=window._ytQueue||[];
    window._ytQueue.push(createPlayer);
    window.onYouTubeIframeAPIReady=function(){(window._ytQueue||[]).splice(0).forEach(fn=>fn());};
    const tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
  } else {
    window._ytQueue=window._ytQueue||[];
    window._ytQueue.push(createPlayer);
    if(window.YT&&window.YT.Player)createPlayer();
  }
}

async function markVideoComplete(mid, cid) {
  const uid=S.session.id;
  const p=currentProg();
  if(!p[cid])p[cid]={watched:[],quizScore:null,moduleQuiz:{}};
  if(!p[cid].moduleQuiz)p[cid].moduleQuiz={};
  if(!p[cid].watched.includes(mid)){
    p[cid].watched.push(mid);
    S._allProg[uid]=p;
    await DB.saveProgCourse(uid,cid,p[cid]);
    await updateStreak(uid);
    S.videoWatched[mid]=true;
    const mod=S.activeCourse?.modules.find(m=>m.id===mid);
    const hasQuiz=mod&&mod.quiz&&mod.quiz.length;
    const statusMsg=document.getElementById('video-status-msg');
    if(statusMsg)statusMsg.innerHTML=`<span class="badge badge-green" style="font-size:12px;padding:5px 14px">✓ Video complete!${hasQuiz?' Take the module quiz below.':''}</span>`;
    toast(hasQuiz?'🎬 Video done — now take the module quiz':'🎉 Video complete!');
    setTimeout(()=>loadAndRender(),1200);
  }
}

// ═══════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════
(async () => {
  if (Auth.load()) {
    const existing = DB.session();
    if (existing) {
      await boot(existing);
    } else {
      // Token exists but no app session — force clean login
      Auth.clear();
    }
  }
})();
