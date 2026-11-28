const KEY='igris-neet-v1';
const QUIZ_KEY='igris-neet-v1-quizzes';
const BASE_TITLE='IGRIS — NEET Command Center';
const MISSION_TYPES=['Practice','Revision','Lecture'];
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const addDays=(isoDate,days)=>{
  const [y,m,d]=String(isoDate||today()).split('-').map(Number);
  const dt=new Date(y,(m||1)-1,(d||1)+days,12,0,0);
  return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
};
const isDaily=t=>!t.stage||t.stage==='today';
const daysBetween=(a,b)=>{const p=x=>{const [y,m,d]=String(x).split('-').map(Number);return Date.UTC(y,(m||1)-1,d||1)};return Math.round((p(b)-p(a))/86400000)};
const seed=()=>({
  tasks:[],
  streakDays:{},
  chapters:{Physics:[],Chemistry:[],Biology:[]},
  sessions:[],
  mistakes:[],
  revisions:[],
  tests:[],
  vault:[],
  quizzes:[],
  quizAttempts:[],
  upcomingTests:[],
  settings:{name:'IGRIS',currentRank:'4 Lakh',upcomingRank:'10k',geminiKey:'',notifyEnabled:true,soundEnabled:true,theme:'light',dailyGoals:{mins:120,qs:40,missions:3},timerWall:'soft'}
});

let db=load(), current='dashboard', missionTab='open', mistakeTab='open', practiceTab='quiz', trackTab='Physics', strengthFilter='All', vaultFilter='All', attemptChapterFilter='All', selectedQuizSubject=null, analysisTab='Physics';
let timerSeconds=25*60, timerInitial=25*60, timerRunning=false, timerInterval=null, clockInterval=null, quizClockInterval=null, reminderInterval=null, toastTimer=null;
let activeQuiz=null, activeQuizMeta={subject:'All',chapter:'All'}, quizIdx=0, quizScore=0, quizAnswered=false, quizPickedIdx=null, quizWrongList=[], quizElapsedSec=0, retestIdx=0, aiOutput='';
let quizAnswers={};
let topBannerHidden=false, activeReminderTaskId=null;
let timerEndAt=0, timerLabel='', wakeLock=null, ongoingNotifLast=0;
let timerMissionId=null, missionRanSecs=0, runStartedAt=0, missionSessionId=null, lastMissionFlush=0;
let vaultChapterFilter='All', mistakeOpenGroups=new Set(), vaultOpenGroups=new Set(), topicOpenGroups=new Set(), activeQuizKey=null, activeQuizArgs=null;
let mockLabFix=8, mockLabFocusId=null;
let skipDrill=false, drillNet=0, drillForced=0, drillRight=0, drillWrong=0, drillSkip=0;
let mockBuild={step:'subject', subjects:['Physics','Chemistry','Biology'], chapters:[], source:'both', count:45};
let quizReview=new Set(); // question ids marked for review in active quiz
let mistakeTypeFilter='All';
let mistakeSubjectFilter='All';
let quizPaceLeft=0, quizPaceInterval=null;

const SAMPLE_JSON=JSON.stringify([
  {
    "subject":"Biology",
    "chapter":"Cell Cycle and Cell Division",
    "q":"Crossing over takes place between non-sister chromatids of homologous chromosomes during which stage of meiosis I?",
    "opts":["Leptotene","Pachytene","Diplotene","Diakinesis"],
    "ans":1,
    "mark":"Imp",
    "exp":"Recombination nodules appear during Pachytene where crossing over occurs between non-sister chromatids."
  },
  {
    "subject":"Physics",
    "chapter":"Laws of Motion",
    "q":"A block of mass 5 kg rests on a horizontal surface (mu = 0.2). What horizontal force is just sufficient to move it? (g = 10 m/s^2)",
    "opts":["5 N","10 N","15 N","20 N"],
    "ans":1,
    "mark":"Hard",
    "exp":"Limiting friction f_max = mu * N = 0.2 * (5 * 10) = 10 N."
  }
],null,2);

/* ===== Practice Sheets (curated NCERT / coaching packs) =====
   Add new sheets here + matching key in PRACTICE_SHEET_DATA (practice-sheets-data.js).
   Clicking a sheet starts the same quiz runner as Bulk JSON Practice. */
const PRACTICE_SHEET_CATALOG = [
  {
    id: 'bio-ncert-cell-cycle',
    subject: 'Biology',
    book: 'NCERT to NCERT',
    chapter: 'Cell cycle and cell division',
    count: 139,
    dataKey: 'cell_cycle_ncert'
  },
  {
    id: 'phy-allen-basic-math',
    subject: 'Physics',
    book: 'Allen module',
    chapter: 'Basic Mathematics used in Physics',
    count: 27,
    dataKey: 'allen_basic_math'
  },
  {
    id: 'phy-allen-vectors',
    subject: 'Physics',
    book: 'Allen module',
    chapter: 'Vectors',
    count: 41,
    dataKey: 'allen_vectors'
  }
];
let practiceSheetSubject = 'Biology';
let practiceSheetBook = null;

function resolveQuizImg(src){
  if(!src) return '';
  const s = String(src).trim();
  if(!s) return '';
  if(/^(https?:|data:|blob:)/i.test(s)) return s;
  try{ return new URL(s.replace(/^\.\//,''), document.baseURI || location.href).href; }
  catch(_){ return s; }
}
function quizImgCandidates(src){
  if(!src) return [];
  const s = String(src).trim();
  if(!s) return [];
  if(/^(https?:|data:|blob:)/i.test(s)) return [s];
  const base = s.split('/').pop();
  // Try common layouts: nested folder (recommended) + repo root (user upload style)
  const list = [
    s,
    s.replace(/^\.\//,''),
    'images/physics/' + base,
    './images/physics/' + base,
    'images/' + base,
    base,
    './' + base
  ];
  // unique preserve order
  return [...new Set(list.filter(Boolean))];
}
window.quizImgError = function(el){
  try{
    const cands = (el.dataset.cands || '').split('|').filter(Boolean);
    let i = parseInt(el.dataset.i || '0', 10);
    i += 1;
    if(i < cands.length){
      el.dataset.i = String(i);
      el.src = resolveQuizImg(cands[i]);
      return;
    }
    el.style.display = 'none';
    const n = el.nextElementSibling;
    if(n) n.hidden = false;
  }catch(e){ console.warn(e); }
}

function getPracticeSheetQuestions(sheet){
  const bank = (typeof window !== 'undefined' && window.PRACTICE_SHEET_DATA) ? window.PRACTICE_SHEET_DATA : {};
  const raw = bank[sheet.dataKey];
  if(!Array.isArray(raw) || !raw.length) return [];
  return raw.map((q,i)=>({
    id: q.id || (`sheet-${sheet.id}-${i}`),
    subject: q.subject || sheet.subject,
    chapter: q.chapter || sheet.chapter,
    q: q.q,
    opts: Array.isArray(q.opts) ? q.opts.slice() : [],
    ans: typeof q.ans === 'number' ? q.ans : 0,
    mark: normalizeMark(q.mark || q.tag || 'Imp'),
    exp: q.exp || '',
    img: q.img || '',
    sheetId: sheet.id,
    book: sheet.book
  }));
}

window.setPracticeSheetSubject = sub => {
  practiceSheetSubject = sub;
  practiceSheetBook = null;
  render();
};
window.setPracticeSheetBook = book => {
  practiceSheetBook = book;
  render();
};
window.startPracticeSheet = (id, markFilter='All', forceRestart=false) => {
  const sheet = PRACTICE_SHEET_CATALOG.find(s => s.id === id);
  if(!sheet){ toast('Sheet not found.'); return; }
  let items = getPracticeSheetQuestions(sheet);
  if(!items.length){
    toast('Sheet data missing — practice-sheets-data.js load check karo.');
    return;
  }
  const mk = markFilter && markFilter !== 'All' ? normalizeMark(markFilter) : 'All';
  if(mk !== 'All'){
    items = items.filter(q => normalizeMark(q.mark || q.tag) === mk);
    if(!items.length){
      toast(`Is sheet me "${mk}" level ke questions nahi mile. All try karo.`);
      return;
    }
  }
  // Merge into quiz bank (dedupe by q text + chapter)
  db.quizzes = db.quizzes || [];
  const existing = new Set(db.quizzes.map(x => `${String(x.chapter||'').toLowerCase()}||${String(x.q||'').trim()}`));
  let added = 0;
  for(const q of getPracticeSheetQuestions(sheet)){
    const k = `${String(q.chapter||'').toLowerCase()}||${String(q.q||'').trim()}`;
    if(!existing.has(k)){
      db.quizzes.push({...q});
      existing.add(k);
      added++;
    }
  }
  if(added) save();
  const key = 'sheet:' + sheet.id + (mk !== 'All' ? ':' + mk : '');
  // Resume prompt
  const prog = (db.quizProgress || {})[key];
  if(!forceRestart && prog && prog.ids && prog.idx < prog.ids.length){
    const go = confirm(`Last attempt milaa: Q${(prog.idx||0)+1}/${prog.ids.length} (score ${prog.score||0}).\n\nOK = Continue last attempt\nCancel = Restart from Q1`);
    if(go){
      // rebuild from progress ids against sheet items
      const byId = {};
      items.forEach(q => { byId[q.id] = q; });
      const rebuilt = (prog.ids || []).map(i => byId[i]).filter(Boolean);
      if(rebuilt.length === prog.ids.length){
        activeQuizKey = key;
        activeQuizArgs = null;
        activeQuiz = rebuilt.map(x => ({...x, mark: normalizeMark(x.mark || x.tag)}));
        activeQuizMeta = prog.meta || { subject: sheet.subject, chapter: `${sheet.book} • ${sheet.chapter}`, sheetId: sheet.id, markFilter: mk };
        quizIdx = prog.idx || 0;
        quizScore = prog.score || 0;
        quizWrongList = prog.wrong || [];
        quizElapsedSec = prog.elapsed || 0;
        quizAnswers = prog.answers || {};
        if(quizAnswers[quizIdx] && quizAnswers[quizIdx].picked !== undefined && quizAnswers[quizIdx].picked !== -1 && !quizAnswers[quizIdx].skipped){
          quizAnswered = true;
          quizPickedIdx = quizAnswers[quizIdx].picked;
        }else{
          quizAnswered = false;
          quizPickedIdx = (quizAnswers[quizIdx] && quizAnswers[quizIdx].picked >= 0) ? quizAnswers[quizIdx].picked : null;
        }
        skipDrill = false;
        practiceTab = 'quiz';
        render();
        toast(`Continue: Q${quizIdx+1}/${activeQuiz.length}`);
        return;
      }
    }else{
      delete db.quizProgress[key];
      save();
    }
  }
  beginQuizSession(items, {
    subject: sheet.subject,
    chapter: `${sheet.book} • ${sheet.chapter}` + (mk !== 'All' ? ` • ${mk}` : ''),
    sheetId: sheet.id,
    markFilter: mk
  }, key, null);
  toast(`${sheet.chapter}${mk!=='All'?' ['+mk+']':''}: ${items.length} Q started${added?` (+${added} bank)`:''}`);
};

window.promptStartPracticeSheet = id => {
  const sheet = PRACTICE_SHEET_CATALOG.find(s => s.id === id);
  if(!sheet){ toast('Sheet not found.'); return; }
  const all = getPracticeSheetQuestions(sheet);
  if(!all.length){ toast('Sheet data missing.'); return; }
  const counts = { All: all.length, Imp: 0, Easy: 0, Medium: 0, Hard: 0 };
  all.forEach(q => {
    const m = normalizeMark(q.mark || q.tag);
    if(counts[m] !== undefined) counts[m]++;
  });
  // level picker via simple prompt chain — UI chips are preferred in sheet list
  const levels = ['All','Imp','Easy','Medium','Hard'].filter(l => l==='All' || counts[l] > 0);
  const label = levels.map(l => `${l}(${counts[l]})`).join(' / ');
  const pick = prompt(`Level select karo:\n${label}\n\nType: All / Imp / Easy / Medium / Hard`, 'All');
  if(pick === null) return;
  const chosen = String(pick).trim();
  const norm = chosen.toLowerCase() === 'all' ? 'All' : normalizeMark(chosen);
  if(norm !== 'All' && !counts[norm]){ toast(`"${chosen}" level is sheet me nahi hai.`); return; }
  startPracticeSheet(id, norm);
};


function loadQuizzesBucket(fallback=[]){
  try{
    const raw=localStorage.getItem(QUIZ_KEY);
    if(raw!==null){
      const parsed=JSON.parse(raw);
      return Array.isArray(parsed)?parsed:[];
    }
  }catch(_){}
  return Array.isArray(fallback)?fallback:[];
}
function saveQuizzesBucket(list){
  try{
    localStorage.setItem(QUIZ_KEY,JSON.stringify(Array.isArray(list)?list:[]));
  }catch(e){
    console.warn('quiz save failed',e);
  }
}
function load(){
  try{
    const parsed=JSON.parse(localStorage.getItem(KEY)||'{}');
    const base=seed();
    const merged={...base,...parsed,settings:{...base.settings,...(parsed.settings||{})}};
    merged.chapters=merged.chapters||{};
    for(const s of ['Physics','Chemistry','Biology']){
      if(!Array.isArray(merged.chapters[s]))merged.chapters[s]=Array.isArray(base.chapters[s])?base.chapters[s].slice():[];
    }
    merged.tasks=Array.isArray(merged.tasks)?merged.tasks:[];
    merged.sessions=Array.isArray(merged.sessions)?merged.sessions:[];
    merged.mistakes=Array.isArray(merged.mistakes)?merged.mistakes:[];
    const bucketQuizzes=loadQuizzesBucket(parsed.quizzes);
    merged.quizzes=bucketQuizzes.length?bucketQuizzes:(Array.isArray(parsed.quizzes)?parsed.quizzes:[]);
    if(Array.isArray(parsed.quizzes)&&parsed.quizzes.length&&localStorage.getItem(QUIZ_KEY)===null){
      saveQuizzesBucket(merged.quizzes);
    }
    merged.topics=merged.topics&&typeof merged.topics==='object'?merged.topics:{};
    return merged;
  }catch(e){return seed()}
}
function save(){
  try{
    const quizzesCopy=Array.isArray(db.quizzes)?db.quizzes:[];
    saveQuizzesBucket(quizzesCopy);
    const slimDb={...db,quizzes:[]};
    localStorage.setItem(KEY,JSON.stringify(slimDb));
  }
  catch(e){console.warn('save failed',e);try{toast('Storage full — export backup / clear old quizzes.')}catch(_){}}
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(s){
  let t=document.getElementById('toast');
  if(!t)return;
  t.textContent=s;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2300);
}
function dateText(d=today()){return new Date(d+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}

const SFX={ohno:'sfx-ohno.mp3',aachi:'sfx-aachi.mp3',sparkle:'sfx-sparkle.wav',guitar:'sfx-guitar.wav'};
const sfxCache={};
function playSfx(name){
  try{
    if(db.settings&&db.settings.soundEnabled===false)return;
    const src=SFX[name];
    if(!src)return;
    let a=sfxCache[name];
    if(!a){a=new Audio(src);a.preload='auto';sfxCache[name]=a}
    a.pause();
    a.currentTime=0;
    const p=a.play();
    if(p&&p.catch)p.catch(()=>{});
  }catch(_){}
}
window.toggleAppSound=()=>{
  db.settings=db.settings||{};
  const on=db.settings.soundEnabled!==false;
  db.settings.soundEnabled=!on;
  save();
  toast(db.settings.soundEnabled?'Sounds ON 🔊':'Sounds OFF 🔇');
  render();
  syncFocusMedia();
};

async function requestBrowserNotifyPermission(showToast=true){
  if(!('Notification' in window)){
    if(showToast)toast('Browser notifications are not supported here.');
    return false;
  }
  let perm=Notification.permission;
  if(perm==='default'){
    try{perm=await Notification.requestPermission()}catch(_){perm=Notification.permission}
  }
  const ok=perm==='granted';
  db.settings.notifyEnabled=ok;
  save();
  if(current==='focus'||current==='missions')render();
  if(showToast){
    if(ok){
      const err=await sendTopNotification('IGRIS test ✅','Notification bar working hai.','igris-test');
      toast(err?('Notification error: '+err):'Test notification bhej di, shade check karo.');
    }else toast('Notification permission blocked.');
  }
  return ok;
}
window.requestBrowserNotifyPermission=()=>requestBrowserNotifyPermission(true);

async function sendTopNotification(titleText,bodyText,tag='igris-top',opts={}){
  if(!('Notification' in window))return 'Notification not supported';
  if(Notification.permission!=='granted')return 'Permission: '+Notification.permission;
  if(db.settings.notifyEnabled===false)return 'Notifications disabled in settings';
  const o={body:bodyText,tag,icon:'./icon-192.png',badge:'./icon-192.png',...opts};
  if(o.silent)delete o.vibrate;
  else if(!o.vibrate)o.vibrate=[200,100,200];
  try{
    if('serviceWorker' in navigator){
      const reg=await navigator.serviceWorker.getRegistration();
      if(reg){await reg.showNotification(titleText,o);return null}
    }
    new Notification(titleText,o);
    return null;
  }catch(e){return String(e&&e.message||e)}
}
async function closeOngoingNotif(){
  try{
    if('serviceWorker' in navigator){
      const reg=await navigator.serviceWorker.getRegistration();
      if(reg){(await reg.getNotifications({tag:'igris-focus-timer'})).forEach(n=>n.close())}
    }
  }catch(_){}
}

function updateTopFocusUI(){
  const banner=document.getElementById('topFocusBanner');
  const txtEl=document.getElementById('topFocusText');
  const activeOrPaused=timerRunning || timerSeconds!==timerInitial;
  if(banner && txtEl){
    if(activeOrPaused && !topBannerHidden){
      banner.hidden=false;
      txtEl.textContent=`${timerRunning?'FOCUS RUNNING':'FOCUS PAUSED'} • ${fmtMMSS(timerSeconds)} REMAINING`;
    }else{
      banner.hidden=true;
    }
  }
  document.title=timerRunning?`⏱ ${fmtMMSS(timerSeconds)} — IGRIS`:BASE_TITLE;
}

window.hideTopFocusBanner=()=>{
  topBannerHidden=true;
  updateTopFocusUI();
};

function formatReminderLabel(isoLocal){
  if(!isoLocal)return '';
  const dt=new Date(isoLocal);
  if(Number.isNaN(dt.getTime()))return isoLocal;
  return dt.toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}

function showReminderAlert(task){
  activeReminderTaskId=task.id;
  const bar=document.getElementById('reminderAlertBar');
  const tEl=document.getElementById('reminderAlertTitle');
  const bEl=document.getElementById('reminderAlertBody');
  const openBtn=document.getElementById('reminderOpenBtn');
  if(bar && tEl && bEl){
    tEl.textContent=`MISSION REMINDER • ${task.subject||'GENERAL'}`;
    bEl.textContent=`${task.text} (${formatReminderLabel(task.reminderAt)})`;
    bar.hidden=false;
  }
  if(openBtn){
    openBtn.onclick=()=>{
      dismissReminderAlert();
      navigate('missions');
    };
  }
  toast(`Reminder: ${task.text}`);
  sendTopNotification(`IGRIS Mission Reminder (${task.subject||'General'})`,task.text,'igris-mission-reminder',{requireInteraction:true,renotify:true});
}

window.dismissReminderAlert=()=>{
  activeReminderTaskId=null;
  const bar=document.getElementById('reminderAlertBar');
  if(bar)bar.hidden=true;
};

window.clearTaskReminder=(id)=>{
  const t=db.tasks.find(x=>x.id===id);
  if(!t)return;
  delete t.reminderAt;
  delete t.reminded;
  save();
  render();
  toast('Mission reminder removed.');
};

window.snoozeTaskReminder=(id,mins=10)=>{
  const t=db.tasks.find(x=>x.id===id);
  if(!t)return;
  const nextDt=new Date(Date.now()+mins*60000);
  const localIso=`${nextDt.getFullYear()}-${String(nextDt.getMonth()+1).padStart(2,'0')}-${String(nextDt.getDate()).padStart(2,'0')}T${String(nextDt.getHours()).padStart(2,'0')}:${String(nextDt.getMinutes()).padStart(2,'0')}`;
  t.reminderAt=localIso;
  t.reminded=false;
  dismissReminderAlert();
  save();
  render();
  toast(`Snoozed for ${mins} mins.`);
};

function checkDueReminders(){
  const now=Date.now();
  let changed=false;
  for(const t of db.tasks){
    if(t.done || !isDaily(t) || !t.reminderAt || t.reminded)continue;
    const dueMs=new Date(t.reminderAt).getTime();
    if(!Number.isNaN(dueMs) && dueMs<=now){
      t.reminded=true;
      changed=true;
      showReminderAlert(t);
      break;
    }
  }
  const dueRev=typeof dueRevisionsList==='function'?dueRevisionsList():[];
  if(dueRev.length && db.settings.lastRevAlert!==today()){
    db.settings.lastRevAlert=today();
    changed=true;
    const first=dueRev[0];
    showReminderAlert({
      id:'rev-'+first.id,
      subject:first.subject||'Revision',
      text:`Spaced revision due: ${first.chapter} (+${dueRev.length>1?(dueRev.length-1)+' more':''})`,
      reminderAt:today()
    });
    sendTopNotification('IGRIS Revision Due',`${dueRev.length} chapter(s) need spaced revision`,'igris-revision',{requireInteraction:true});
  }
  if(changed)save();
}

window.toggleZenMode=force=>{
  const next=typeof force==='boolean'?force:!document.body.classList.contains('zen-mode');
  document.body.classList.toggle('zen-mode',next);
  toast(next?'Full view enabled (Sidebar hidden).':'Sidebar restored.');
};
const zenBtn=document.getElementById('zenBtn');
if(zenBtn)zenBtn.onclick=()=>toggleZenMode();

const TIMER_WALLS=[
  {id:'soft',label:'🌸 Soft blush'},
  {id:'mint',label:'🌿 Mint calm'},
  {id:'dusk',label:'🌙 Night study'},
  {id:'peach',label:'🍑 Warm peach'},
  {id:'sky',label:'☁️ Soft sky'},
  {id:'plain',label:'⬜ Clean'},
  {id:'study1',label:'🛏️ Study desk'},
  {id:'study2',label:'🐱 Cat nap'},
  {id:'study3',label:'💜 Mom pride'},
  {id:'redsun',label:'🔴 Red sun'},
  {id:'knight',label:'⚔️ Knight'},
  {id:'ananya',label:'📖 Study girl'},
  {id:'cutecat',label:'🐱 I am cute'},
  {id:'guts',label:'🗡️ Guts'},
  {id:'anya',label:'🥜 Anya'},
  {id:'shinchan',label:'🖍️ Shinchan'},
  {id:'vrainforest',label:'🌧️ Rain forest',video:'wall-vid-rainforest.mp4'},
  {id:'vheavyrain',label:'🌧️ Heavy rain',video:'wall-vid-heavyrain.mp4'},
  {id:'vrainywindow',label:'🪟 Rainy window',video:'wall-vid-rainywindow.mp4'},
  {id:'vmilkyway',label:'🌌 Milky Way',video:'wall-vid-milkyway.mp4'},
  {id:'vmatterhorn',label:'🏔️ Matterhorn',video:'wall-vid-matterhorn.mp4'},
  {id:'vtunnel',label:'🚇 Tunnel',video:'wall-vid-tunnel.mp4'}
];
const VIDEO_WALL_IDS=TIMER_WALLS.filter(w=>w.video).map(w=>w.id);
function applyTimerWallpaper(el){
  if(!el)return;
  const id=(db.settings&&db.settings.timerWall)||'soft';
  TIMER_WALLS.forEach(w=>el.classList.remove('wall-'+w.id));
  const valid=TIMER_WALLS.some(w=>w.id===id)?id:'soft';
  el.classList.add('wall-'+valid);
  el.style.backgroundImage='';
  el.style.backgroundSize='';
  el.style.backgroundPosition='';
  // video wallpaper (only loads the file when that wall is selected)
  const w=TIMER_WALLS.find(x=>x.id===valid);
  el.classList.toggle('wall-video',!!(w&&w.video));
  const v=el.querySelector('#tfVideo');
  if(v){
    if(w&&w.video){
      if(v.getAttribute('data-src')!==w.video){
        v.setAttribute('data-src',w.video);
        v.muted=true;v.loop=true;
        v.src=w.video;
        try{v.load()}catch(_){}
      }
      v.style.display='block';
    }else{
      if(v.getAttribute('data-src')){
        try{v.pause()}catch(_){}
        v.removeAttribute('data-src');v.removeAttribute('src');
        try{v.load()}catch(_){}
      }
      v.style.display='none';
    }
  }
}
window.setTimerWallpaper=id=>{
  db.settings=db.settings||{};
  db.settings.timerWall=id;
  save();
  const el=document.getElementById('timerFull');
  applyTimerWallpaper(el);
  const bar=document.getElementById('tfWallBar');
  if(bar){
    bar.querySelectorAll('[data-wall]').forEach(b=>{
      b.classList.toggle('active',b.getAttribute('data-wall')===id);
    });
  }
  syncFocusMedia();
};
function applyAppTheme(){
  const t=(db.settings&&db.settings.theme)==='dark'?'dark':'light';
  document.documentElement.classList.toggle('theme-dark',t==='dark');
  document.documentElement.classList.toggle('theme-light',t==='light');
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',t==='dark'?'#07060c':'#f5f6f8');
  const btn=document.getElementById('themeBtn');
  if(btn)btn.textContent=t==='dark'?'☀️':'🌙';
}
window.toggleAppTheme=()=>{
  db.settings=db.settings||{};
  const next=(db.settings.theme==='dark')?'light':'dark';
  db.settings.theme=next;
  // auto-suggest matching timer wall
  if(next==='dark' && !['redsun','knight','dusk','study1','study2','study3','guts',...VIDEO_WALL_IDS].includes(db.settings.timerWall)){
    db.settings.timerWall='redsun';
  }
  if(next==='light' && ['redsun','knight','guts'].includes(db.settings.timerWall)){
    db.settings.timerWall='soft';
  }
  save();
  applyAppTheme();
  const el=document.getElementById('timerFull');
  if(el)applyTimerWallpaper(el);
  toast(next==='dark'?'Dark / Galaxy theme 🌌':'Soft White theme ☀️');
};
// ---- Focus ambience: rain sound (toggle) + looping video wallpaper (only while timer runs) ----
let rainAudio=null;
function rainOn(){return !(db.settings&&db.settings.rainSound===false)}
function rainLabel(){return rainOn()?'🌧️ Rain: ON':'🌧️ Rain: OFF'}
function rainWanted(){return timerRunning&&rainOn()&&!(db.settings&&db.settings.soundEnabled===false)}
function syncFocusMedia(){
  try{
    if(rainWanted()){
      if(!rainAudio){rainAudio=new Audio('rain-loop.mp3');rainAudio.loop=true;rainAudio.volume=.55;rainAudio.preload='auto'}
      if(rainAudio.paused){const p=rainAudio.play();if(p&&p.catch)p.catch(()=>{})}
    }else if(rainAudio&&!rainAudio.paused){rainAudio.pause()}
    const el=document.getElementById('timerFull');
    const v=el&&el.querySelector('#tfVideo');
    if(v){
      const want=timerRunning&&!el.hidden&&!!v.getAttribute('data-src');
      if(want){if(v.paused){v.muted=true;const p=v.play();if(p&&p.catch)p.catch(()=>{})}}
      else if(!v.paused){v.pause()}
    }
  }catch(_){}
}
window.toggleRainSound=()=>{
  db.settings=db.settings||{};
  db.settings.rainSound=!rainOn();
  save();
  document.querySelectorAll('#tfRain,#rainBtn').forEach(b=>b.textContent=rainLabel());
  syncFocusMedia();
  toast(rainOn()?(db.settings.soundEnabled===false?'Rain ON (but app Sound OFF hai 🔇)':'Rain sound ON 🌧️'):'Rain sound OFF');
};
function ensureTimerFullEl(){
  let el=document.getElementById('timerFull');
  if(el)return el;
  el=document.createElement('div');
  el.id='timerFull';
  el.className='timer-full';
  el.hidden=true;
  const wallId=(db.settings&&db.settings.timerWall)||'soft';
  el.innerHTML=`<video class="tf-video" id="tfVideo" muted loop playsinline webkit-playsinline preload="none" aria-hidden="true" tabindex="-1"></video><div class="tf-video-shade"></div>
  <button type="button" class="icon-btn tf-close" aria-label="Close" onclick="toggleTimerFullscreen(false)">×</button>
  <div class="tf-wall-bar" id="tfWallBar">${TIMER_WALLS.map(w=>`<button type="button" class="tf-wall-chip ${w.id===wallId?'active':''}" data-wall="${w.id}" onclick="setTimerWallpaper('${w.id}')">${w.label}</button>`).join('')}</div>
  <div class="tf-label" id="tfLabel"></div>
  <div class="tf-time" id="tfTime">00:00:00</div>
  <div class="tf-state" id="tfState"></div>
  <div class="actions" style="justify-content:center;margin-top:30px"><button type="button" class="btn" id="tfToggle">Start focus</button><button type="button" class="btn secondary" id="tfReset">Reset</button><button type="button" class="btn ghost" id="tfRain" onclick="toggleRainSound()">🌧️ Rain: ON</button></div>`;
  document.body.appendChild(el);
  applyTimerWallpaper(el);
  el.querySelector('#tfToggle').onclick=()=>startTimer();
  el.querySelector('#tfReset').onclick=()=>resetCurrentTimer();
  return el;
}
function updateTimerFullDOM(){
  const el=document.getElementById('timerFull');
  if(!el||el.hidden)return;
  applyTimerWallpaper(el);
  const {h,m,s}=timerParts(timerSeconds);
  document.getElementById('tfTime').textContent=`${h}:${m}:${s}`;
  document.getElementById('tfToggle').textContent=timerRunning?'Pause':'Start focus';
  document.getElementById('tfState').textContent=timerRunning?'FOCUS SESSION ACTIVE':(timerSeconds<=0?'SESSION COMPLETE':(timerSeconds!==timerInitial?'PAUSED':'READY WHEN YOU ARE'));
  document.getElementById('tfLabel').textContent=timerLabel?('MISSION • '+timerLabel):'';
  const rb=document.getElementById('tfRain');if(rb)rb.textContent=rainLabel();
}
window.toggleTimerFullscreen=async force=>{
  const el=ensureTimerFullEl();
  const next=typeof force==='boolean'?force:el.hidden;
  el.hidden=!next;
  document.body.classList.toggle('timer-full-open',next);
  syncFocusMedia();
  if(next){
    updateTimerFullDOM();
    try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen()}catch(_){}
    try{if('wakeLock' in navigator)wakeLock=await navigator.wakeLock.request('screen')}catch(_){}
  }else{
    try{if(document.fullscreenElement)await document.exitFullscreen()}catch(_){}
    try{if(wakeLock){await wakeLock.release();wakeLock=null}}catch(_){}
  }
};
window.resetCurrentTimer=()=>{
  const keepId=timerMissionId, keepLabel=timerLabel;
  setTimer(Math.round(timerInitial/60)||25);
  if(keepId){timerMissionId=keepId;timerLabel=keepLabel;updateTimerDOM();refreshFocusPanels()}
};

document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && document.body.classList.contains('zen-mode'))toggleZenMode(false);
  if(e.key==='Escape' && document.body.classList.contains('timer-full-open'))toggleTimerFullscreen(false);
  // Quiz shortcuts — ignore when typing in inputs
  const tag=(e.target&&e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select'||e.target?.isContentEditable)return;
  if(!activeQuiz||quizIdx>=activeQuiz.length)return;
  if(current!=='practice')return;
  const k=e.key;
  if(k>='1'&&k<='4'){
    e.preventDefault();
    if(!quizAnswered)answerQuizOpt(parseInt(k,10)-1);
  }else if(k==='s'||k==='S'){
    e.preventDefault();
    if(!quizAnswered)skipQuizQuestion();
  }else if(k==='Enter'){
    e.preventDefault();
    if(!quizAnswered && quizPickedIdx!==null && quizPickedIdx>=0) submitQuizAnswer();
    else if(quizAnswered) nextQuizQuestion();
  }else if(k==='n'||k==='N'){
    e.preventDefault();
    if(quizAnswered)nextQuizQuestion();
  }else if(k==='p'||k==='P'||k==='Backspace'){
    e.preventDefault();
    prevQuizQuestion();
  }else if(k==='r'||k==='R'){
    e.preventDefault();
    toggleQuizReview();
  }
});

const IDB_NAME='igris-files-db', STORE_NAME='files';
function openFilesDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open(IDB_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(STORE_NAME,{keyPath:'id'});
    req.onsuccess=()=>res(req.result);
    req.onerror=()=>rej(req.error);
  });
}
async function storeFile(file){
  const id=crypto.randomUUID();
  const blob=file instanceof Blob?file:new Blob([file],{type:file?.type||'application/octet-stream'});
  const idb=await openFilesDB();
  await new Promise((res,rej)=>{
    const tx=idb.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).put({id,name:file.name,type:file.type||blob.type,blob});
    tx.oncomplete=res;
    tx.onerror=()=>rej(tx.error);
  });
  return {id,name:file.name,type:file.type||blob.type};
}
async function getStoredFile(id){
  const idb=await openFilesDB();
  return new Promise((res,rej)=>{
    const tx=idb.transaction(STORE_NAME,'readonly');
    const req=tx.objectStore(STORE_NAME).get(id);
    req.onsuccess=()=>res(req.result);
    req.onerror=()=>rej(req.error);
  });
}
async function deleteStoredFile(id){
  if(!id)return;
  try{
    const idb=await openFilesDB();
    await new Promise((res,rej)=>{
      const tx=idb.transaction(STORE_NAME,'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete=res;
      tx.onerror=()=>rej(tx.error);
    });
  }catch(_){}
}
let previewToken=0, previewPdf=null, previewObserver=null, activePreviewUrl=null;
function revokePreviewUrl(){
  if(activePreviewUrl){
    try{URL.revokeObjectURL(activePreviewUrl)}catch(_){}
    activePreviewUrl=null;
  }
}
async function blobOfRec(rec){
  if(rec&&rec.blob instanceof Blob)return rec.blob;
  if(rec&&rec.dataUrl)return (await fetch(rec.dataUrl)).blob();
  throw new Error('Empty file record');
}
window.downloadStoredFile=async id=>{
  const rec=await getStoredFile(id);
  if(!rec){toast('File not found.');return}
  const blob=await blobOfRec(rec);
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=rec.name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast('Download ho gaya — ReadEra / Files se khol lo.');
};
window.shareStoredFile=async id=>{
  const rec=await getStoredFile(id);
  if(!rec){toast('File not found.');return}
  try{
    const blob=await blobOfRec(rec);
    const file=new File([blob],rec.name,{type:rec.type||blob.type});
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:rec.name});return}
  }catch(e){if(e&&e.name==='AbortError')return}
  toast('Share sheet nahi mili, download kar raha hoon.');
  downloadStoredFile(id);
};
function loadPdfJs(){
  if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  return new Promise((res,rej)=>{
    const sc=document.createElement('script');
    sc.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    sc.onload=()=>{
      if(!window.pdfjsLib){rej(new Error('pdfjs missing'));return}
      window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      res(window.pdfjsLib);
    };
    sc.onerror=()=>rej(new Error('pdfjs load failed'));
    document.head.appendChild(sc);
  });
}
async function renderPdfInto(container,blob,token){
  const lib=await loadPdfJs();
  const buf=await blob.arrayBuffer();
  const pdf=await lib.getDocument({data:buf}).promise;
  if(token!==previewToken){try{pdf.destroy()}catch(_){}return}
  previewPdf=pdf;
  container.innerHTML='';
  const width=Math.max(280,Math.min((container.clientWidth||800)-4,1000));
  const first=await pdf.getPage(1);
  const v0=first.getViewport({scale:1});
  const estH=Math.round(width*v0.height/v0.width);
  if(previewObserver)previewObserver.disconnect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  previewObserver=new IntersectionObserver(entries=>{
    entries.forEach(async en=>{
      if(!en.isIntersecting)return;
      const holder=en.target;
      previewObserver&&previewObserver.unobserve(holder);
      if(token!==previewToken)return;
      try{
        const page=await pdf.getPage(+holder.dataset.n);
        const sc=width/page.getViewport({scale:1}).width;
        const vp=page.getViewport({scale:sc*dpr});
        const cv=document.createElement('canvas');
        cv.width=vp.width;cv.height=vp.height;
        cv.style.width=width+'px';cv.style.height=(vp.height/dpr)+'px';
        await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        if(token!==previewToken)return;
        holder.style.minHeight='';
        holder.innerHTML='';
        holder.appendChild(cv);
      }catch(_){}
    });
  },{rootMargin:'800px 0px'});
  for(let n=1;n<=pdf.numPages;n++){
    const h=document.createElement('div');
    h.className='pdf-page';h.dataset.n=n;h.style.minHeight=estH+'px';
    h.innerHTML=`<span class="muted" style="font-size:10px">Page ${n}</span>`;
    container.appendChild(h);
    previewObserver.observe(h);
  }
}
window.previewFile=async(fileId)=>{
  const rec=await getStoredFile(fileId);
  if(!rec){toast('File not found in local vault.');return}
  revokePreviewUrl();
  const token=++previewToken;
  document.getElementById('previewTitle').textContent=rec.name;
  const body=document.getElementById('previewBody');
  const isPdf=rec.type==='application/pdf'||/\.pdf$/i.test(rec.name||'');
  const blob=await blobOfRec(rec);
  const imgSrc=isPdf?'':(activePreviewUrl=URL.createObjectURL(blob));
  body.innerHTML=`<div class="preview-actions"><button type="button" class="btn" onclick="shareStoredFile('${fileId}')">📤 Open with… (ReadEra / Drive)</button><button type="button" class="btn secondary" onclick="downloadStoredFile('${fileId}')">⬇ Download</button></div>`
    +(isPdf?'<div id="pdfPages" class="pdf-pages"><div class="muted" style="font-size:11px;padding:20px">PDF load ho rahi hai…</div></div>':`<img src="${imgSrc}" alt="${esc(rec.name)}">`);
  document.getElementById('previewModal').classList.add('open');
  if(isPdf){
    try{
      await renderPdfInto(document.getElementById('pdfPages'),blob,token);
    }catch(e){
      if(token===previewToken){
        const box=document.getElementById('pdfPages');
        if(box)box.innerHTML='<div class="muted" style="font-size:11px;line-height:1.7;padding:20px">In-app PDF viewer load nahi hua (internet chahiye). Upar <b>Open with…</b> ya <b>Download</b> se ReadEra / Drive me khol lo.</div>';
      }
    }
  }
};
window.closePreview=()=>{
  previewToken++;
  revokePreviewUrl();
  if(previewObserver){previewObserver.disconnect();previewObserver=null}
  if(previewPdf){try{previewPdf.destroy()}catch(_){}previewPdf=null}
  document.getElementById('previewModal').classList.remove('open');
  document.getElementById('previewBody').innerHTML='';
};

const dateChipEl=document.getElementById('dateChip');
if(dateChipEl)dateChipEl.textContent=dateText();
const menuBtnEl=document.getElementById('menuBtn');
if(menuBtnEl)menuBtnEl.onclick=()=>document.getElementById('sidebar').classList.toggle('open');
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>navigate(b.dataset.view));

function navigate(v){
  clearInterval(quizClockInterval);
  current=v;
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  document.getElementById('sidebar').classList.remove('open');
  render();
}
function title(s){document.getElementById('viewTitle').textContent=s}
function stat(label,value,note){return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`}
function progress(label,done,total){let p=total?Math.round(done/total*100):0;return `<div class="progress-row"><div class="progress-meta"><span>${label}</span><span>${p}%</span></div><div class="bar"><span style="width:${p}%"></span></div></div>`}
function todayTasks(){return db.tasks.filter(t=>isDaily(t)&&t.date===today())}
function totalMinutes(){return db.sessions.filter(s=>s.date===today()).reduce((a,s)=>a+s.minutes,0)}
function totalQuestionsToday(){
  let n = db.sessions.filter(s=>s.date===today()).reduce((a,s)=>a+(s.questions||0),0);
  // completed quiz attempts today
  for(const a of (db.quizAttempts||[])){
    if(a.date===today()) n += (a.total||0);
  }
  // in-progress quiz answers (not yet finished)
  if(activeQuiz && quizAnswers){
    const answered = Object.values(quizAnswers).filter(x=>x && (x.picked!==undefined)).length;
    n += answered;
  }
  return n;
}
function examDate(){return db.settings.examDate||'2027-05-02'}

function getCountdownParts(){
  const [y,m,d]=examDate().split('-').map(Number);
  const target=new Date(y,m-1,d,9,0,0);
  const diff=Math.max(0,target-new Date());
  return {
    diff,
    days:Math.floor(diff/864e5),
    hrs:Math.floor((diff%864e5)/36e5),
    mins:Math.floor((diff%36e5)/6e4),
    secs:Math.floor((diff%6e4)/1e3)
  };
}
function pad2(n){return String(n).padStart(2,'0')}
function fmtMMSS(sec){return `${pad2(Math.floor(sec/60))}:${pad2(sec%60)}`}

function countdown(){
  const {days,hrs,mins,secs}=getCountdownParts();
  const all=Object.values(db.chapters).flat(),total=all.length,left=all.filter(c=>!c.done).length,custom=!!db.settings.examDateSet;
  const dt=new Date(examDate()+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  const pace=days>30&&total?`<div class="cd-note">Chapters left: <b>${left}</b> of ${total}. Aim for about <b>${(left/Math.max(Math.floor((days-30)/7),1)).toFixed(1)}</b> chapters/week to finish 30 days early.</div>`:'';
  return `<div class="card countdown">
    <div>
      <div class="eyebrow">NEET 2027 LIVE COUNTDOWN • ${custom?'YOUR DATE':'TENTATIVE'}: ${dt}</div>
      <div class="flip-group">
        <div class="flip-unit"><div class="flip-val" id="cdDays">${pad2(days)}</div><div class="flip-lbl">DAYS</div></div>
        <div class="flip-unit"><div class="flip-val" id="cdHrs">${pad2(hrs)}</div><div class="flip-lbl">HRS</div></div>
        <div class="flip-unit"><div class="flip-val" id="cdMins">${pad2(mins)}</div><div class="flip-lbl">MINS</div></div>
        <div class="flip-unit"><div class="flip-val" id="cdSecs">${pad2(secs)}</div><div class="flip-lbl">SECS</div></div>
      </div>
      ${pace}
    </div>
    <div class="cd-set">
      <label class="eyebrow" for="examDateInput">EXAM DATE</label>
      <div class="actions" style="margin-top:6px">
        <input type="date" id="examDateInput" value="${examDate()}" style="width:auto">
        <button type="button" class="btn secondary" onclick="setExamDate()">Save</button>
      </div>
      <div class="muted" style="font-size:9px;margin-top:6px">Update once NTA releases the official bulletin.</div>
    </div>
  </div>`;
}

function startLiveCountdown(){
  clearInterval(clockInterval);
  clockInterval=setInterval(()=>{
    const elD=document.getElementById('cdDays');
    if(!elD)return;
    const {days,hrs,mins,secs}=getCountdownParts();
    elD.textContent=pad2(days);
    document.getElementById('cdHrs').textContent=pad2(hrs);
    document.getElementById('cdMins').textContent=pad2(mins);
    document.getElementById('cdSecs').textContent=pad2(secs);
  },1000);
}

window.setExamDate=()=>{
  const v=document.getElementById('examDateInput').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)){toast('Pick a valid date.');return}
  db.settings.examDate=v;db.settings.examDateSet=true;save();render();toast('Exam date saved.');
};

window.editRanks=()=>{
  const cur=prompt('Enter your Current Rank (e.g. 4 Lakh, 1.2 Lakh):',db.settings.currentRank||'4 Lakh');
  if(cur===null)return;
  const up=prompt('Enter your Upcoming Target Rank (e.g. 10k, 5k, AIR 500):',db.settings.upcomingRank||'10k');
  if(up===null)return;
  db.settings.currentRank=cur.trim()||'4 Lakh';
  db.settings.upcomingRank=up.trim()||'10k';
  save();render();toast('Rank targets updated.');
};

function backlogDueList(){
  const out=[];
  for(const sub of Object.keys(db.chapters)){
    for(const c of db.chapters[sub]){
      const revDone=['r1','r2','r3','r4','r5'].filter(k=>c.t&&c.t[k]).length;
      const isWeak=c.strength==='Weak'||(c.weakTopics&&c.weakTopics.trim());
      if(isWeak || (c.done && revDone===0)){
        const reason=isWeak?(c.weakTopics?`Weak: ${c.weakTopics}`:'Weak chapter'):'Completed • Rev 1 pending';
        out.push({sub,name:c.name,reason});
      }
    }
  }
  const have=new Set(out.map(x=>String(x.name).toLowerCase()));
  for(const o of mistakeInsights()){
    const weakN=Object.entries(o.types).filter(([k])=>WEAKISH_TYPES.includes(k)).reduce((a,[,n])=>a+n,0);
    const nm=String(o.chapter);
    if(weakN>=3&&!have.has(nm.toLowerCase())){
      out.push({sub:o.sub||'General',name:nm,reason:`${weakN} open mistakes • mostly ${o.topType}`});
      have.add(nm.toLowerCase());
    }
  }
  return out;
}

function dashboard(){
  title('Dashboard');
  let tasks=todayTasks(),done=tasks.filter(t=>t.done).length,mins=totalMinutes(),qCount=totalQuestionsToday(),openMistakes=db.mistakes.filter(m=>!m.closed).length;
  const curRank=esc(db.settings.currentRank||'4 Lakh'), upRank=esc(db.settings.upcomingRank||'10k');
  const dueList=backlogDueList().slice(0,5);
  return `<div class="hero">
    <div class="hero-row">
      <div>
        <div class="eyebrow">SYSTEM INITIALIZED • NEET 2027</div>
        <h1>Welcome back, 𓆩⚔️𓆪 IGRIS 💙</h1>
        <p>Your mission is not to be perfect. Your mission is to show up, learn from errors, and make the next attempt better.</p>
      </div>
      <div class="rank-box">
        <div class="rank">
          <button type="button" class="rank-edit" title="Edit Ranks" onclick="editRanks()">✎</button>
          <small>CURRENT RANK</small>
          <b>${curRank}</b>
        </div>
        <div class="rank upcoming">
          <button type="button" class="rank-edit" title="Edit Ranks" onclick="editRanks()">✎</button>
          <small>UPCOMING RANK</small>
          <b>${upRank}</b>
        </div>
      </div>
    </div>
  </div>
  ${countdown()}
  ${dailyGoalsHTML()}
  ${streakStripHTML()}
  <div class="stats">
    ${stat('STREAK',streakLabel(),'6h focus or 60% missions daily')}
    ${stat('MISSIONS COMPLETED',`${done}/${tasks.length}`,'Today’s task progress')}
    ${stat('FOCUS TIME',`${Math.floor(mins/60)}h ${mins%60}m`,`${qCount} Qs logged today`)}
    ${stat('OPEN MISTAKES',openMistakes,`${db.mistakes.length} total tracked`)}
  </div>
  ${revisionQueueHTML()}
  <div class="two-col">
    <div>
      <div class="section-head"><h2>Today's Missions</h2><small>${dateText()}</small></div>
      <div class="card">
        ${tasks.length?tasks.map(t=>taskHTML(t)).join(''):'<div class="empty">No missions added yet. Create your first daily target.</div>'}
        <div class="actions" style="margin-top:12px"><button class="btn" onclick="navigate('missions')">Manage missions</button></div>
      </div>
      <div class="section-head"><h2>Focus — last 7 days</h2><small>MINUTES</small></div>
      <div class="card">${barChart(dayKeys(7).map(dayLabel),dayKeys(7).map(k=>db.sessions.filter(x=>x.date===k).reduce((a,x)=>a+x.minutes,0)),'bar-focus')}</div>
      <div class="section-head"><h2>Subject Progress</h2><small>CHAPTERS MARKED COMPLETE</small></div>
      <div class="card">${['Physics','Chemistry','Biology'].map(s=>{const arr=Array.isArray(db.chapters[s])?db.chapters[s]:[];return progress(s,arr.filter(c=>c.done).length,arr.length)}).join('')||'No chapters yet'}</div>
    </div>
    <div>
      <div class="section-head"><h2>Quick Actions</h2><small>COMMAND SHORTCUTS</small></div>
      <div class="card">
        <div class="actions">
          <button class="btn" onclick="navigate('missions')">＋ Add mission</button>
          <button class="btn secondary" onclick="navigate('practice')">🩺 Practice & Quiz</button>
          <button class="btn secondary" onclick="navigate('aitutor')">✦ AI Tutor</button>
          <button class="btn secondary" onclick="navigate('vault')">🗂 Study Vault</button>
        </div>
      </div>
      <div class="section-head"><h2>Revision Due & Weak Backlog</h2><small>PRIORITY QUEUE</small></div>
      <div class="card">
        ${dueList.length?dueList.map(w=>`<div class="list-item"><div><b>${esc(w.name)}</b><div class="muted">${esc(w.sub)} • ${esc(w.reason)}</div></div><span class="tag gold">DUE</span></div>`).join(''):'<div class="empty">No weak or revision-due chapters flagged right now.</div>'}
        ${dueList.length?`<div class="actions" style="margin-top:10px"><button type="button" class="btn" onclick="generateWeakMissions()">＋ Auto missions from weak chapters</button></div>`:''}
      </div>
      <div class="section-head"><h2>Recent Activity</h2><small>LATEST RECORDS</small></div>
      <div class="card">${recentActivity()}</div>
    </div>
  </div>`;
}

function normalizeMissionType(t={}){
  if(t.missionType && MISSION_TYPES.includes(t.missionType))return t.missionType;
  const s=`${t.text||''} ${t.subject||''}`.toLowerCase();
  if(/\b(lec|lecture|class|video|oneshot|one shot)\b/.test(s))return 'Lecture';
  if(/\b(rev|revision|revise|notes|ncert|recall)\b/.test(s))return 'Revision';
  return 'Practice';
}

function missionTypeTagClass(mType){
  if(mType==='Practice')return 'tag blue';
  if(mType==='Revision')return 'tag gold';
  return 'tag purple';
}

window.startMissionFocus=(id)=>{
  const t=db.tasks.find(x=>x.id===id);
  const mins=parseInt(t?.focusMins,10);
  if(!t||!mins||mins<1){toast('Is mission ki focus duration set nahi hai.');return}
  pauseMissionClock();
  flushMissionSession();
  clearInterval(timerInterval);
  timerRunning=false;
  timerEndAt=0;
  resetMissionRun();
  timerMissionId=t.id;
  timerLabel=t.text;
  closeOngoingNotif();
  topBannerHidden=false;
  timerInitial=mins*60;
  timerSeconds=mins*60;
  navigate('focus');
  updateTimerDOM();
  toast(`Focus timer set to ${mins}m for "${t.text}"`);
};

function taskHTML(t){
  const stage=t.stage||'today';
  const mType=normalizeMissionType(t);
  const tag=`<span class="${missionTypeTagClass(mType)}">${esc(mType)}</span>`;
  const sub=`<small>${esc(t.subject||'GENERAL')}</small>`;
  const del=`<button type="button" class="icon-btn" style="padding:2px 6px" onclick="deleteTask('${t.id}')">×</button>`;
  if(t.done){
    return `<label class="task done"><input type="checkbox" checked onchange="toggleTask('${t.id}',this.checked)"><span class="task-text">${esc(t.text)}</span>${tag}<span class="tag green">✅ ${esc(shortDate(t.doneAt||t.date))}</span>${sub}${del}</label>`;
  }
  if(stage==='open'){
    return `<div class="task"><span class="task-text">${esc(t.text)}</span>${tag}${sub}<button type="button" class="btn mini" title="Closed list me daalo" onclick="moveTask('${t.id}','closed')">＋</button>${del}</div>`;
  }
  if(stage==='closed'){
    return `<div class="task"><span class="task-text">${esc(t.text)}</span>${tag}${sub}<button type="button" class="btn secondary mini" title="Open list me wapas" onclick="moveTask('${t.id}','open')">↩</button><button type="button" class="btn mini" title="Aaj ke daily mission me daalo" onclick="moveTask('${t.id}','today')">＋</button>${del}</div>`;
  }
  const carried=t.date<today();
  const old=carried?`<span class="tag gold">Carried over • ${dateText(t.date)}</span>`:'';
  const rem=t.reminderAt?`<span class="reminder-chip">⏰ ${esc(formatReminderLabel(t.reminderAt))}${t.reminded?' • Sent':''}</span>`:'';
  const remActions=t.reminderAt?`<button type="button" class="icon-btn" style="padding:2px 6px;font-size:10px" title="Snooze 10m" onclick="snoozeTaskReminder('${t.id}',10)">+10m</button><button type="button" class="icon-btn" style="padding:2px 6px;font-size:10px" title="Clear reminder" onclick="clearTaskReminder('${t.id}')">🔕</button>`:'';
  const fBtn=t.focusMins?`<button type="button" class="btn secondary" style="padding:2px 7px;font-size:10px" onclick="startMissionFocus('${t.id}')">▶ ${t.focusMins}m</button>`:'';
  const back=`<button type="button" class="icon-btn" style="padding:2px 6px;font-size:10px" title="Closed list me wapas" onclick="moveTask('${t.id}','closed')">↩</button>`;
  return `<label class="task"><input type="checkbox" onchange="toggleTask('${t.id}',this.checked)"><span class="task-text">${esc(t.text)}</span>${tag}${old}${rem}${remActions}${fBtn}${sub}${back}${del}</label>`;
}

function groupedMissionsHTML(list,emptyMsg){
  if(!list.length)return `<div class="empty">${emptyMsg}</div>`;
  const subs=['Physics','Chemistry','Biology'];
  const subIcons={Physics:'⚛',Chemistry:'⚗',Biology:'🧬'};
  const blocks=subs.map(sub=>{
    const subItems=list.filter(t=>(t.subject||'General').toLowerCase()===sub.toLowerCase());
    if(!subItems.length)return '';
    return `<div class="sub-group-box">
      <div class="sub-group-head">
        <span class="sub-group-title">${subIcons[sub]} ${sub}</span>
        <span class="tag blue">${subItems.length}</span>
      </div>
      <div class="type-blocks-grid">
        ${MISSION_TYPES.map(mType=>{
          const items=subItems.filter(t=>normalizeMissionType(t)===mType);
          return `<div class="type-block">
            <div class="type-block-head"><span>${mType}</span><span>${items.length}</span></div>
            ${items.length?items.map(t=>taskHTML(t)).join(''):`<div class="muted" style="font-size:10px;padding:6px 0">No ${mType.toLowerCase()}</div>`}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  const otherItems=list.filter(t=>!subs.some(s=>(t.subject||'General').toLowerCase()===s.toLowerCase()));
  const otherHtml=otherItems.length?`<div class="sub-group-box">
    <div class="sub-group-head">
      <span class="sub-group-title">📌 General / Other</span>
      <span class="tag gold">${otherItems.length}</span>
    </div>
    <div class="type-blocks-grid">
      ${MISSION_TYPES.map(mType=>{
        const items=otherItems.filter(t=>normalizeMissionType(t)===mType);
        return `<div class="type-block">
          <div class="type-block-head"><span>${mType}</span><span>${items.length}</span></div>
          ${items.length?items.map(t=>taskHTML(t)).join(''):`<div class="muted" style="font-size:10px;padding:6px 0">No ${mType.toLowerCase()}</div>`}
        </div>`;
      }).join('')}
    </div>
  </div>`:'';

  return blocks+otherHtml;
}

function recentActivity(){let items=[...db.sessions.map(x=>({date:x.date,text:`Focus session • ${x.subject} • ${x.minutes} min${x.questions?' • '+x.questions+' Qs':''}`})),...db.tests.map(x=>({date:x.date,text:`Mock test • ${x.name} • ${x.score} marks`})),...(db.quizAttempts||[]).map(x=>({date:x.date,text:`Quiz (${x.chapter}) • ${x.score}/${x.total} (${x.accuracy}%)`})),...allRevs().slice(0,5).map(x=>({date:x.date,text:`Revision • ${x.chapter} (${x.kind})`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);return items.length?items.map(x=>`<div class="list-item"><span>${esc(x.text)}</span><span class="muted">${x.date}</span></div>`).join(''):'<div class="empty">Your activity will appear here as you use IGRIS.</div>'}
function tabsHTML(cur,open,closed,fn){return `<div class="tabs"><button type="button" class="tab ${cur==='open'?'active':''}" onclick="${fn}('open')">Open <b>${open}</b></button><button type="button" class="tab ${cur==='closed'?'active':''}" onclick="${fn}('closed')">Closed <b>${closed}</b></button></div>`}

function suggestMissionSubject(txt=''){
  const s=txt.toLowerCase();
  if(/\b(nlm|kinematics|projectile|friction|work power|rotational|gravitation|shm|wave|electrostatics|capacitor|current electricity|magnetism|emi|ac|optics|ray optics|wave optics|modern physics|atom|nuclei|semiconductor|vector|unit)\b/.test(s))return 'Physics';
  if(/\b(mole|stoichiometry|atomic|thermodynamics|equilibrium|electrochemistry|kinetics|chemical bonding|coordination|organic|aldehyde|ketone|carboxylic|amine|haloalkane|alcohol|phenol|biomolecule|iupac|isomerism|periodic|solution|physical chem|inorganic)\b/.test(s))return 'Chemistry';
  if(/\b(cell|mitosis|meiosis|genetics|dna|rna|transcription|translation|evolution|reproduction|human physiology|digestion|breathing|circulation|excretion|neural|endocrine|plant physiology|photosynthesis|respiration|ecology|biodiversity|biotech|microbe|human health|ncert|morphology|anatomy)\b/.test(s))return 'Biology';
  return null;
}

function suggestMissionType(txt=''){
  const s=txt.toLowerCase();
  if(/\b(lec|lecture|class|video|oneshot|one shot)\b/.test(s))return 'Lecture';
  if(/\b(rev|revision|revise|notes|ncert|recall)\b/.test(s))return 'Revision';
  if(/\b(mcq|pyq|dpp|practice|question|numerical|test)\b/.test(s))return 'Practice';
  return null;
}

window.onMissionDescInput=el=>{
  const sel=document.querySelector('#taskForm select[name="subject"]');
  if(sel && sel.dataset.manual!=='1'){
    const hit=suggestMissionSubject(el.value);
    if(hit)sel.value=hit;
  }
  const typeSel=document.querySelector('#taskForm select[name="missionType"]');
  if(typeSel && typeSel.dataset.manual!=='1'){
    const tHit=suggestMissionType(el.value);
    if(tHit)typeSel.value=tHit;
  }
};

function missionTabsHTML(counts){
  const tabs=[['open','Open'],['closed','Closed'],['today','Today'],['done','Done']];
  return `<div class="tabs four">${tabs.map(([k,l])=>`<button type="button" class="tab ${missionTab===k?'active':''}" onclick="setMissionTab('${k}')">${l} <b>${counts[k]}</b></button>`).join('')}</div>`;
}

function missions(){
  title('Daily Missions');
  const tdy=today();
  const lists={
    open:db.tasks.filter(t=>t.stage==='open'&&!t.done),
    closed:db.tasks.filter(t=>t.stage==='closed'&&!t.done),
    today:db.tasks.filter(t=>isDaily(t)&&(!t.done||(t.doneAt||t.date)===tdy)).sort((a,b)=>a.date.localeCompare(b.date)),
    done:db.tasks.filter(t=>t.done).sort((a,b)=>(b.doneAt||b.date).localeCompare(a.doneAt||a.date))
  };
  if(!['open','closed','today','done'].includes(missionTab))missionTab='open';
  const counts={open:lists.open.length,closed:lists.closed.length,today:lists.today.filter(t=>!t.done).length,done:lists.done.length};
  const tt=todayTasks(),td=tt.filter(t=>t.done).length,list=lists[missionTab];
  const heads={open:'Open — 3-week target',closed:'Closed — queue',today:'Today — daily missions',done:'Done'};
  const hints={
    open:'Poore 3-week ka target yaha likho. Jo target pakadna hai uske aage ＋ dabao → Closed list me chala jayega.',
    closed:'Ye selected targets hain. ＋ dabao → aaj ke daily mission (Today) me add ho jayega. ↩ se Open me wapas.',
    today:'Aaj ke missions. ✅ tick karo → Done list me date ke saath chala jayega.',
    done:'Complete hue missions, date ke saath. Untick karoge to wapas Today me aa jayega.'
  };
  const empty={
    open:'Open list khali hai. Right side se apna 3-week target add karo.',
    closed:'Closed list khali hai. Open list ke ＋ se target yaha lao.',
    today:'Aaj ka koi mission nahi. Closed list ke ＋ se add karo (streak ke liye zaruri hai 🔥).',
    done:'Abhi koi done mission nahi. Today me ✅ tick karo.'
  }[missionTab];
  const notifyStatus=('Notification' in window)?Notification.permission:'unsupported';
  const addTo=missionTab==='done'?'open':missionTab;
  const opt=(v,l)=>`<option value="${v}" ${addTo===v?'selected':''}>${l}</option>`;
  return `<div class="section-head"><h2>Mission Board</h2><small>${dateText()} • ${td}/${tt.length} TODAY</small></div>
  <div class="two-col">
    <div class="card"><h3>${heads[missionTab]}</h3>${missionTabsHTML(counts)}<p class="muted" style="font-size:10px;line-height:1.6;margin:0 0 10px">${hints[missionTab]}</p>${groupedMissionsHTML(list,empty)}<div style="margin-top:12px">${progress('TODAY’S COMPLETION',td,tt.length)}</div></div>
    <div class="card"><h3>Deploy a new mission</h3>
      <form id="taskForm">
        <div class="field"><label>TASK DESCRIPTION</label><input name="text" placeholder="e.g. Redox rxn lec -02 / 30 MCQs" oninput="onMissionDescInput(this)" required></div>
        <div class="form-grid">
          <div class="field"><label>SUBJECT</label><select name="subject" onchange="this.dataset.manual='1'"><option>General</option><option>Physics</option><option>Chemistry</option><option>Biology</option></select></div>
          <div class="field"><label>MISSION TYPE TAG</label><select name="missionType" onchange="this.dataset.manual='1'"><option value="Practice">Practice</option><option value="Revision">Revision</option><option value="Lecture">Lecture</option></select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>FOCUS DURATION (MINS)</label><input name="focusMins" type="number" min="1" max="720" placeholder="e.g. 45"></div>
          <div class="field"><label>REMINDER TIME (OPTIONAL)</label><input type="datetime-local" name="reminderAt"></div>
        </div>
        <div class="field"><label>ADD TO</label><select name="stage">${opt('open','Open list (3-week target)')}${opt('closed','Closed list (queue)')}${opt('today','Today (daily mission)')}</select></div>
        <div class="actions" style="margin-top:4px">
          <button type="submit" class="btn">＋ Add mission</button>
          <button type="button" class="btn secondary" onclick="requestBrowserNotifyPermission()">🔔 Top Alert (${esc(notifyStatus)})</button>
        </div>
      </form>
      <div class="actions" style="margin-top:12px">
        <button type="button" class="btn secondary" onclick="generateWeakMissions()">⚔ Weak chapters → missions</button>
      </div>
      <p class="muted" style="font-size:10px;line-height:1.6;margin-top:16px">Flow: Open (3-week target) ＋→ Closed ＋→ Today ✅→ Done. Har list Physics, Chemistry, Biology me banti hai — subject ke andar Practice, Revision, Lecture blocks. Weak-auto missions seedhe Today me aate hain.</p>
    </div>
  </div>`;
}

window.generateWeakMissions=()=>{
  const weak=backlogDueList().slice(0,5);
  if(!weak.length){toast('No weak / rev-pending chapters found.');return}
  let n=0;
  for(const w of weak){
    const text=`${w.name}: 20 MCQ + short revision`;
    const exists=db.tasks.some(t=>!t.done&&isDaily(t)&&t.date===today()&&String(t.text||'').includes(w.name));
    if(exists)continue;
    db.tasks.push({
      id:crypto.randomUUID(),
      date:today(),
      text,
      subject:w.sub||'General',
      stage:'today',
      missionType:'Practice',
      done:false,
      focusMins:45,
      source:'weak-auto'
    });
    n++;
  }
  save();
  missionTab='today';
  render();
  toast(n?`${n} weak-chapter mission(s) added for today.`:'Already queued for today.');
  if(n)navigate('missions');
};

function branchOf(c){if(c.branch)return c.branch;const i=NEET_SYLLABUS.Chemistry.findIndex(n=>n.toLowerCase()===c.name.trim().toLowerCase());return i<0||i<8?'Physical':i<12?'Inorganic':'Organic'}
function tabChapters(cfg){return(db.chapters[cfg.sub]||[]).filter(c=>!cfg.branch||branchOf(c)===cfg.branch)}
function shortDate(d){return new Date(d+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}
function trackCols(cfg){return[['done','Done',0],...cfg.cols.map(([k,l])=>[k,l,0]),...Array.from({length:cfg.rev},(_,i)=>['r'+(i+1),'Rev '+(i+1),1])]}

window.setStrengthFilter=f=>{strengthFilter=f;render()};
window.updateChapterStrength=(sub,id,val)=>{
  const c=(db.chapters[sub]||[]).find(x=>x.id===id);
  if(c){c.strength=val;save();keepScroll(render);toast(`Marked as ${val}`)}
};
window.updateWeakTopics=(sub,id,val)=>{
  const c=(db.chapters[sub]||[]).find(x=>x.id===id);
  if(c){c.weakTopics=val.trim();save()}
};

function subjects(){
  title('Subject HQ');
  const cfg=TRACK[trackTab],cols=trackCols(cfg),allList=tabChapters(cfg),doneN=allList.filter(c=>c.done).length;
  const list=strengthFilter==='All'?allList:allList.filter(c=>(c.strength||'Medium')===strengthFilter);
  const cnt=k=>allList.filter(c=>k==='done'?c.done:(c.t||{})[k]).length;
  const weakCount=allList.filter(c=>c.strength==='Weak').length;

  return `<div class="section-head">
    <h2>Chapter Tracker & Strength Matrix</h2>
    <div class="actions" style="align-items:center">
      <select class="str-select" style="background:#14141d;color:#ddd" onchange="setStrengthFilter(this.value)">
        <option value="All" ${strengthFilter==='All'?'selected':''}>All Levels (${allList.length})</option>
        <option value="Weak" ${strengthFilter==='Weak'?'selected':''}>🔴 Weak (${weakCount})</option>
        <option value="Medium" ${strengthFilter==='Medium'?'selected':''}>🟡 Medium (${allList.filter(c=>(c.strength||'Medium')==='Medium').length})</option>
        <option value="Strong" ${strengthFilter==='Strong'?'selected':''}>🟢 Strong (${allList.filter(c=>(c.strength||'Medium')==='Strong').length})</option>
      </select>
      <button type="button" class="btn secondary" style="padding:7px 10px" onclick="loadSyllabus()">⬇ Load NEET chapters</button>
    </div>
  </div>
  <div class="tabs tracktabs">${TRACK_ORDER.map(k=>`<button type="button" class="tab ${trackTab===k?'active':''}" onclick="setTrackTab('${k}')">${TRACK[k].label}<b>${tabChapters(TRACK[k]).length}</b></button>`).join('')}</div>
  <div class="card" style="padding:12px 17px;margin-bottom:12px">${progress(cfg.label.toUpperCase()+' • CHAPTERS DONE',doneN,allList.length)}</div>
  ${list.length?`<div class="track-wrap"><table class="track">
    <thead>
      <tr>
        <th>CHAPTER</th>
        <th>LEVEL</th>
        <th>WEAK TOPICS</th>
        ${cols.map(([k,l,r])=>`<th class="${r?'rv':''}">${l}<small>${cnt(k)}/${allList.length}</small></th>`).join('')}
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${list.map(c=>{
        const st=c.strength||'Medium';
        return `<tr>
          <td><div class="cn-wrap"><span class="cn">${esc(c.name)}</span></div></td>
          <td>
            <select class="str-select str-${st}" onchange="updateChapterStrength('${cfg.sub}','${c.id}',this.value)">
              <option value="Weak" ${st==='Weak'?'selected':''}>Weak</option>
              <option value="Medium" ${st==='Medium'?'selected':''}>Medium</option>
              <option value="Strong" ${st==='Strong'?'selected':''}>Strong</option>
            </select>
          </td>
          <td>
            <input type="text" class="weak-input" value="${esc(c.weakTopics||'')}" placeholder="Write weak subtopics..." onchange="updateWeakTopics('${cfg.sub}','${c.id}',this.value)">
          </td>
          ${cols.map(([k,l,r])=>{
            const v=k==='done'?(c.done?'1':''):((c.t||{})[k]||'');
            return`<td><button type="button" class="cell ${r?'rev':''} ${v?'on':''}" aria-label="${esc(l)}" onclick="toggleCell('${c.id}','${k}')">✓</button>${r?`<span class="cdate">${v&&v!=='1'?shortDate(v):''}</span>`:''}</td>`
          }).join('')}
          <td><button type="button" class="icon-btn" style="padding:2px 6px" title="Delete chapter" onclick="deleteChapter('${cfg.sub}','${c.id}')">×</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`:'<div class="card"><div class="empty">No chapters match this filter.</div></div>'}
  <form class="card addrow" onsubmit="addTrackChapter(event)" style="margin-top:12px">
    <div class="field" style="flex:1;margin:0"><label>ADD CHAPTER TO ${cfg.label.toUpperCase()}</label><input name="chapter" placeholder="Chapter name" required></div>
    <button class="btn secondary">＋ Add</button>
  </form>`;
}

function timerParts(sec){
  const h=Math.floor(sec/3600);
  const m=Math.floor((sec%3600)/60);
  const s=sec%60;
  return {h:pad2(h),m:pad2(m),s:pad2(s)};
}

function missionRunSecs(){return missionRanSecs+(runStartedAt?(Date.now()-runStartedAt)/1000:0)}
function pauseMissionClock(){if(timerMissionId&&runStartedAt){missionRanSecs+=(Date.now()-runStartedAt)/1000;runStartedAt=0}}
function resetMissionRun(){missionRanSecs=0;runStartedAt=0;missionSessionId=null}
function flushMissionSession(){
  if(!timerMissionId)return;
  const secs=Math.round(missionRunSecs());
  const mins=Math.round(secs/60);
  const t=db.tasks.find(x=>x.id===timerMissionId);
  let rec=missionSessionId?db.sessions.find(x=>x.id===missionSessionId):null;
  if(!rec){
    if(mins<1)return;
    rec={id:crypto.randomUUID(),date:today(),subject:(t&&t.subject)||'Focus Timer',minutes:mins,questions:0,topic:(t&&t.text)||timerLabel||'Mission focus',missionId:timerMissionId,plannedMins:Math.round(timerInitial/60),seconds:secs};
    db.sessions.push(rec);
    missionSessionId=rec.id;
  }else{rec.minutes=mins;rec.seconds=secs}
  save();
  refreshFocusPanels();
}
window.missionRowAction=id=>{
  if(timerMissionId===id){
    if(timerRunning){startTimer();return}
    if(timerSeconds>0&&timerSeconds<timerInitial){startTimer();return}
  }
  startMissionFocus(id);
  startTimer();
};
function missionFocusRowsHTML(){
  const list=db.tasks.filter(t=>isDaily(t)&&t.focusMins>0&&(!t.done||t.date===today())).sort((a,b)=>(a.done?1:0)-(b.done?1:0)||String(a.date).localeCompare(String(b.date)));
  if(!list.length)return '<div class="empty">Koi mission focus time ke saath nahi hai. Daily Missions me mission add karte waqt focus minutes daalo.</div>';
  return list.map(t=>{
    const used=db.sessions.filter(x=>x.date===today()&&x.missionId===t.id).reduce((a,x)=>a+x.minutes,0);
    const active=timerMissionId===t.id;
    const running=active&&timerRunning;
    const label=running?'⏸ Pause':(active&&timerSeconds>0&&timerSeconds<timerInitial?'▶ Resume':'▶ Start');
    return `<div class="list-item" style="gap:8px;${active?'border-left:3px solid #e33b4b;padding-left:8px':''}">
      <div style="min-width:0;flex:1"><b style="font-size:12px;${t.done?'text-decoration:line-through;opacity:.6':''}">${esc(t.text)}</b>
        <div class="muted" style="font-size:10px;margin-top:3px">${esc(t.subject||'GENERAL')} • planned ${t.focusMins}m${used?` • <span style="color:${used>=t.focusMins?'#86efac':'#e7c477'}">${used}m of ${t.focusMins}m used today</span>`:''}${running?' • <b style="color:#fca5a5">RUNNING</b>':''}</div></div>
      <button type="button" class="btn ${running?'':'secondary'}" style="padding:6px 12px;white-space:nowrap" onclick="missionRowAction('${t.id}')">${label}</button>
    </div>`;
  }).join('');
}
function todaySessionsHTML(){
  return db.sessions.filter(s=>s.date===today()).map(s=>`<div class="list-item"><span>${esc(s.subject)} — ${esc(s.topic||'Study session')}${s.questions?` <span class="tag blue">${s.questions} Qs</span>`:''}${s.plannedMins&&s.minutes<s.plannedMins?` <span class="tag gold">${s.minutes}m of ${s.plannedMins}m planned</span>`:''}</span><div style="display:flex;align-items:center;gap:8px"><b>${s.minutes}m</b><button type="button" class="icon-btn" style="padding:2px 6px" onclick="removeItem('sessions','${s.id}')">×</button></div></div>`).join('')||'<div class="empty">No sessions logged today.</div>';
}
function refreshFocusPanels(){
  const a=document.getElementById('missionFocusList');if(a)a.innerHTML=missionFocusRowsHTML();
  const b=document.getElementById('todaySessionsList');if(b)b.innerHTML=todaySessionsHTML();
  const c=document.getElementById('todaySessionsMeta');if(c)c.textContent=`${totalMinutes()} MIN • ${totalQuestionsToday()} Qs`;
}

function focus(){
  title('Focus Room');
  const {h,m,s}=timerParts(timerSeconds);
  const notifyStatus=('Notification' in window)?Notification.permission:'unsupported';
  return `<div class="section-head"><h2>Deep Work Protocol</h2><small>FLIP TIMER • TOP ALERT</small></div>
  <div class="two-col">
    <div class="card timer-wrap">
      <div class="timer-top-bar">
        <div class="timer-state" id="timerState">${timerRunning?'FOCUS SESSION ACTIVE':'READY WHEN YOU ARE'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn ghost" style="padding:4px 9px;font-size:10px" onclick="toggleTimerFullscreen(true)">⛶ Full screen</button><button type="button" class="btn ghost" style="padding:4px 9px;font-size:10px" onclick="requestBrowserNotifyPermission()">🔔 Alert: ${esc(notifyStatus)}</button><button type="button" class="btn ghost" style="padding:4px 9px;font-size:10px" onclick="toggleAppSound()">${(db.settings&&db.settings.soundEnabled===false)?'🔇 Sound OFF':'🔊 Sound ON'}</button><button type="button" class="btn ghost" id="rainBtn" style="padding:4px 9px;font-size:10px" onclick="toggleRainSound()">${rainLabel()}</button></div>
      </div>
      <div class="timer-flip-wrap">
        <div class="timer-flip-unit"><div class="timer-flip-val" id="tHrs">${h}</div><div class="timer-flip-lbl">HRS</div></div>
        <div class="timer-colon">:</div>
        <div class="timer-flip-unit"><div class="timer-flip-val" id="tMins">${m}</div><div class="timer-flip-lbl">MINS</div></div>
        <div class="timer-colon">:</div>
        <div class="timer-flip-unit"><div class="timer-flip-val" id="tSecs">${s}</div><div class="timer-flip-lbl">SECS</div></div>
      </div>
      <div class="actions" style="justify-content:center;margin-bottom:14px">
        <button type="button" class="btn" id="startTimer">${timerRunning?'Pause':'Start focus'}</button>
        <button type="button" class="btn secondary" id="resetTimer">Reset</button>
      </div>
      <div class="actions" style="justify-content:center">
        <button type="button" class="btn ghost" onclick="setTimer(25)">25 min</button>
        <button type="button" class="btn ghost" onclick="setTimer(50)">50 min</button>
        <button type="button" class="btn ghost" onclick="setTimer(90)">90 min</button>
        <button type="button" class="btn ghost" onclick="setTimer(180)">3 hrs (Mock)</button>
      </div>
      <div class="custom-time-row">
        <input type="number" id="customMinInput" min="1" max="720" placeholder="Custom mins">
        <button type="button" class="btn secondary" onclick="applyCustomTimer()">Set</button>
      </div>
      <p class="muted" style="font-size:10px;margin-top:10px">Timer chalte waqt notification bar me live countdown dikhega aur session finish hone par alert aayega. Pehle 🔔 button se notification Allow kar do.</p>
      <p class="muted" id="tickDebug" style="font-size:9px;margin-top:6px"></p>
    </div>
    <div class="card">
      <h3>Mission focus timers</h3>
      <p class="muted" style="font-size:10px;line-height:1.6;margin-bottom:8px">Mission pe ▶ dabao, timer start ho jayega. Jitna timer chalega utna hi save hoga (planned se kam chala to wo bhi dikhega).</p>
      <div id="missionFocusList">${missionFocusRowsHTML()}</div>
      <details class="group" style="margin-top:14px"><summary><b>＋ Manual log (optional)</b></summary><div class="group-body" style="padding-bottom:12px">
        <form id="sessionForm">
          <div class="form-grid">
            <div class="field"><label>SUBJECT</label><select name="subject"><option>Physics</option><option>Chemistry</option><option>Biology</option><option>Revision</option></select></div>
            <div class="field"><label>DURATION (MINUTES)</label><input name="minutes" type="number" min="1" max="1440" placeholder="e.g. 50" required></div>
          </div>
          <div class="form-grid">
            <div class="field"><label>WHAT DID YOU WORK ON?</label><input name="topic" placeholder="e.g. Electrostatics numericals"></div>
            <div class="field"><label>MCQS SOLVED (OPTIONAL)</label><input name="questions" type="number" min="0" max="500" placeholder="e.g. 45"></div>
          </div>
          <button type="submit" class="btn">Save session</button>
        </form>
      </div></details>
      <div class="section-head"><h2>Today's sessions</h2><small id="todaySessionsMeta">${totalMinutes()} MIN • ${totalQuestionsToday()} Qs</small></div>
      <div id="todaySessionsList">${todaySessionsHTML()}</div>
    </div>
  </div>`;
}

function updateTimerDOM(){
  const {h,m,s}=timerParts(timerSeconds);
  const eh=document.getElementById('tHrs'),em=document.getElementById('tMins'),es=document.getElementById('tSecs');
  if(eh)eh.textContent=h;
  if(em)em.textContent=m;
  if(es)es.textContent=s;
  const b1=document.getElementById('startTimer');
  if(b1)b1.textContent=timerRunning?'Pause':'Start focus';
  updateTopFocusUI();
  updateTimerFullDOM();
  syncFocusMedia();
}
window.setTimer=m=>{
  pauseMissionClock();
  flushMissionSession();
  timerMissionId=null;
  resetMissionRun();
  clearInterval(timerInterval);
  timerRunning=false;
  timerEndAt=0;
  timerLabel='';
  closeOngoingNotif();
  topBannerHidden=false;
  timerInitial=m*60;
  timerSeconds=m*60;
  render();
  updateTimerDOM();
};
window.applyCustomTimer=()=>{
  const v=parseInt(document.getElementById('customMinInput').value,10);
  if(!v||v<1||v>720){toast('Enter valid minutes (1–720).');return}
  setTimer(v);
  toast(`Timer set to ${v} mins.`);
};
function fmtClock(sec){const {h,m,s}=timerParts(sec);return (+h>0?h+':':'')+m+':'+s}
function updateOngoingNotif(force){
  if(!timerRunning)return;
  const now=Date.now();
  if(!force && now-ongoingNotifLast<15000)return;
  ongoingNotifLast=now;
  const endTxt=new Date(timerEndAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  sendTopNotification(`⏳ Focus • ${fmtClock(timerSeconds)} left`,`${timerLabel?timerLabel+' • ':''}Ends at ${endTxt}`,'igris-focus-timer',{silent:true,requireInteraction:true});
}
function setTimerStateText(txt){const st=document.getElementById('timerState');if(st)st.textContent=txt}
function finishTimer(){
  clearInterval(timerInterval);
  timerRunning=false;
  timerEndAt=0;
  const completedMins=Math.max(1,Math.round(timerInitial/60));
  if(timerMissionId){
    runStartedAt=0;
    missionRanSecs=timerInitial;
    flushMissionSession();
    resetMissionRun();
  }else{
    db.sessions.push({id:crypto.randomUUID(),date:today(),subject:'Focus Timer',minutes:completedMins,questions:0,topic:'Completed flip timer session'});
  }
  save();
  syncFocusMedia();
  playSfx('ohno');
  toast(`Focus complete! ${completedMins} min session logged.`);
  sendTopNotification('⏰ IGRIS Focus Complete!',`${completedMins} min focus session logged.`,'igris-focus-timer',{requireInteraction:true,renotify:true,silent:false,vibrate:[300,150,300,150,600]});
  render();
}
function timerTick(){
  if(!timerRunning)return;
  try{
    timerSeconds=Math.max(0,Math.ceil((timerEndAt-Date.now())/1000));
    updateTimerDOM();
    const dbg=document.getElementById('tickDebug');
    if(dbg)dbg.textContent='sync '+new Date().toLocaleTimeString('en-IN');
    if(timerSeconds<=0){finishTimer();return}
    updateOngoingNotif(false);
    if(timerMissionId&&Date.now()-lastMissionFlush>15000){lastMissionFlush=Date.now();flushMissionSession()}
  }catch(e){console.error('timerTick',e)}
}
function startTimer(){
  if(timerRunning){
    timerTick();
    if(!timerRunning)return;
    clearInterval(timerInterval);
    pauseMissionClock();
    timerRunning=false;
    timerEndAt=0;
    closeOngoingNotif();
    flushMissionSession();
    setTimerStateText('PAUSED');
    updateTimerDOM();
    refreshFocusPanels();
    return;
  }
  if(timerSeconds<=0)timerSeconds=timerInitial;
  timerRunning=true;
  if(timerMissionId)runStartedAt=Date.now();
  lastMissionFlush=Date.now();
  topBannerHidden=false;
  timerEndAt=Date.now()+timerSeconds*1000;
  ongoingNotifLast=0;
  clearInterval(timerInterval);
  timerInterval=setInterval(timerTick,500);
  setTimerStateText('FOCUS SESSION ACTIVE');
  updateTimerDOM();
  refreshFocusPanels();
  setTimeout(()=>{try{updateOngoingNotif(true)}catch(_){}},0);
}

const MARKS=['Imp','Easy','Medium','Hard'];
function normalizeMark(val){
  const raw=String(val||'').trim().toLowerCase();
  if(raw==='imp' || raw==='important')return 'Imp';
  if(raw==='easy')return 'Easy';
  if(raw==='hard')return 'Hard';
  if(raw==='medium' || raw==='med')return 'Medium';
  return 'Medium';
}
function markBadgeStyle(mk){
  if(mk==='Imp')return 'background:#5c3d08;color:#ffd369;border-color:#a36d10';
  if(mk==='Hard')return 'background:#5e141f;color:#ff9aa6;border-color:#b8283e';
  if(mk==='Easy')return 'background:#12442f;color:#86efac;border-color:#1f7a55';
  return 'background:#1d2742;color:#93c5fd;border-color:#2d4375';
}

window.setPracticeTab=t=>{clearInterval(quizClockInterval);practiceTab=t;render()};
window.setAttemptChapterFilter=ch=>{attemptChapterFilter=ch;render()};
window.selectQuizSubject=sub=>{selectedQuizSubject=sub;render()};
window.exitActiveQuiz=(force)=>{
  if(!force && activeQuiz && quizIdx < activeQuiz.length){
    const answered = Object.keys(quizAnswers||{}).length;
    const msg = answered
      ? `Quiz chhod rahe ho?\n\n• OK = Progress save karke exit (Q${quizIdx+1}/${activeQuiz.length}, ${answered} answered)\n• Cancel = wapas quiz pe`
      : `Quiz exit karein? Progress abhi nahi hai.`;
    if(!confirm(msg)) return;
  }
  clearQuizPace();
  clearInterval(quizClockInterval);
  if(activeQuiz && quizIdx < activeQuiz.length) saveQuizProgress();
  activeQuiz=null;quizIdx=0;quizAnswered=false;quizPickedIdx=null;quizElapsedSec=0;quizAnswers={};skipDrill=false;
  render();
};
window.finishQuizEarly=()=>{
  if(!activeQuiz)return;
  if(!confirm('Abhi tak ke answers submit karke attempt save karein?'))return;
  clearQuizPace();
  // mark remaining unanswered as skipped
  for(let i=0;i<activeQuiz.length;i++){
    if(!quizAnswers[i]) quizAnswers[i]={picked:-1,correct:false,skipped:true};
  }
  recomputeQuizScore();
  quizIdx=activeQuiz.length;
  saveQuizAttemptIfDone();
  render();
  playSfx('guitar');
};
window.launchChapterBtn=btn=>{
  const sub=btn?.dataset?.sub||'All';
  const chap=btn?.dataset?.chap||'All';
  startSavedQuiz(sub,chap,'All');
};

function startQuizStopwatch(){
  clearInterval(quizClockInterval);
  if(!activeQuiz || quizIdx>=activeQuiz.length)return;
  quizClockInterval=setInterval(()=>{
    quizElapsedSec++;
    const el=document.getElementById('quizLiveClock');
    if(el)el.textContent=fmtMMSS(quizElapsedSec);
  },1000);
}
function clearQuizPace(){
  clearInterval(quizPaceInterval);
  quizPaceInterval=null;
  quizPaceLeft=0;
}
function getQuizPaceSec(){
  const n=parseInt(db.settings&&db.settings.quizPaceSec,10);
  return [0,45,60,90].includes(n)?n:0;
}
window.setQuizPace=sec=>{
  db.settings=db.settings||{};
  db.settings.quizPaceSec=parseInt(sec,10)||0;
  save();
  if(activeQuiz&&quizIdx<activeQuiz.length&&!quizAnswered)startQuizPace();
  else render();
  toast(db.settings.quizPaceSec?`Pace: ${db.settings.quizPaceSec}s / Q`:'Pace timer OFF');
};
function startQuizPace(){
  clearQuizPace();
  const sec=getQuizPaceSec();
  if(!sec||!activeQuiz||quizIdx>=activeQuiz.length||quizAnswered)return;
  quizPaceLeft=sec;
  const tick=()=>{
    const el=document.getElementById('quizPaceClock');
    if(el){
      el.textContent=String(quizPaceLeft);
      el.style.color=quizPaceLeft<=10?'#ef4444':(quizPaceLeft<=20?'#f59e0b':'');
    }
  };
  tick();
  quizPaceInterval=setInterval(()=>{
    if(quizAnswered||!activeQuiz||quizIdx>=activeQuiz.length){clearQuizPace();return}
    quizPaceLeft--;
    tick();
    if(quizPaceLeft<=0){
      clearQuizPace();
      // time up → auto skip (NEET pressure)
      if(!quizAnswered){
        toast('Time up — skipped');
        skipQuizQuestion();
      }
    }
  },1000);
}

function getChaptersForSubject(sub){
  const fromDb=(db.chapters[sub]||[]).map(c=>c.name);
  const fromSyl=NEET_SYLLABUS[sub]||[];
  const fromQuiz=(db.quizzes||[]).filter(q=>q.subject===sub).map(q=>q.chapter).filter(Boolean);
  return [...new Set([...fromDb,...fromSyl,...fromQuiz])];
}

function topicKey(sub,ch){return String(sub||'')+'||'+String(ch||'').trim()}
function getTopics(sub,ch){db.topics=db.topics||{};return db.topics[topicKey(sub,ch)]||[]}
window.toggleTopicGroup=el=>{const k=el.dataset.key;if(el.open)topicOpenGroups.add(k);else topicOpenGroups.delete(k)};
window.addPracticeTopic=btn=>{
  const inp=btn.parentElement.querySelector('input');
  const name=(inp.value||'').trim();
  if(!name){toast('Topic ka naam likho.');return}
  const key=topicKey(btn.dataset.sub,btn.dataset.chap);
  db.topics=db.topics||{};
  const list=db.topics[key]=db.topics[key]||[];
  if(list.some(t=>t.toLowerCase()===name.toLowerCase())){toast('Ye topic pehle se hai.');return}
  list.push(name);
  topicOpenGroups.add(key);
  save();render();toast('Topic add ho gaya.');
};
window.deletePracticeTopic=btn=>{
  const key=topicKey(btn.dataset.sub,btn.dataset.chap);
  const list=(db.topics||{})[key]||[];
  const i=parseInt(btn.dataset.i,10);
  if(!(i>=0&&i<list.length))return;
  if(!confirm('Ye topic delete karein?'))return;
  list.splice(i,1);
  if(!list.length)delete db.topics[key];
  save();render();
};
window.startTopicQuiz=btn=>{
  const sub=btn.dataset.sub,chap=btn.dataset.chap,top=btn.dataset.topic;
  const pool=(db.quizzes||[]).filter(q=>String(q.subject||'').trim().toLowerCase()===sub.toLowerCase()&&String(q.chapter||'').trim().toLowerCase()===chap.trim().toLowerCase()&&String(q.topic||'').trim().toLowerCase()===top.trim().toLowerCase());
  if(!pool.length){
    toast('Is topic ke MCQs nahi hain. Bulk JSON mein "topic":"'+top+'" field daalo, phir Start chalega.');
    return;
  }
  beginQuizSession(pool,{subject:sub,chapter:chap+' • '+top});
};
function topicsBlockHTML(sub,ch,subBank){
  const key=topicKey(sub,ch),list=getTopics(sub,ch);
  return `<details class="group" style="margin:4px 0 10px" data-key="${esc(key)}" ${topicOpenGroups.has(key)?'open':''} ontoggle="toggleTopicGroup(this)">
    <summary><span>📑 Topics</span><span class="tag ${list.length?'green':''}">${list.length}</span></summary>
    <div class="group-body" style="padding:8px 12px 10px">
      ${list.map((t,i)=>{
        const n=subBank.filter(x=>String(x.chapter||'').trim().toLowerCase()===ch.trim().toLowerCase()&&String(x.topic||'').trim().toLowerCase()===t.toLowerCase()).length;
        return `<div class="list-item" style="gap:8px">
          <span style="flex:1;min-width:0"><b style="font-size:12px">${esc(t)}</b> <span class="tag ${n?'green':''}">${n} Qs</span></span>
          <span style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            <button type="button" class="btn ${n?'secondary':'ghost'}" style="padding:4px 8px;font-size:10px" data-sub="${esc(sub)}" data-chap="${esc(ch)}" data-topic="${esc(t)}" onclick="startTopicQuiz(this)">${n?'Start':'0 Qs'}</button>
            <button type="button" class="icon-btn" style="padding:2px 6px" data-sub="${esc(sub)}" data-chap="${esc(ch)}" data-i="${i}" onclick="deletePracticeTopic(this)">×</button>
          </span>
        </div>`;
      }).join('')||'<div class="muted" style="font-size:11px;padding:6px 0">Abhi koi topic nahi. Neeche naam likh ke Add karo.</div>'}
      <div class="actions" style="margin-top:8px;gap:6px">
        <input placeholder="Naya topic (e.g. Meiosis)" style="flex:1;min-width:0" onkeydown="if(event.key==='Enter'){event.preventDefault();this.nextElementSibling.click()}">
        <button type="button" class="btn" style="padding:5px 10px" data-sub="${esc(sub)}" data-chap="${esc(ch)}" onclick="addPracticeTopic(this)">＋ Add</button>
      </div>
      <p class="muted" style="font-size:10px;margin:8px 0 0;line-height:1.5">Tip: Quiz start tab hota hai jab imported JSON mein same chapter + <b>"topic"</b> field match kare. Bina topic field ke sirf chapter quiz chalega.</p>
    </div>
  </details>`;
}

window.setQuestionMark=(markVal)=>{
  const norm=normalizeMark(markVal);
  if(!activeQuiz||!activeQuiz[quizIdx])return;
  const curQ=activeQuiz[quizIdx];
  curQ.mark=norm;
  const bankItem=(db.quizzes||[]).find(x=>x.id===curQ.id || x.q===curQ.q);
  if(bankItem)bankItem.mark=norm;
  save();
  render();
  toast(`Tagged as ${norm}`);
};

window.loadSampleJson=()=>{
  const ta=document.getElementById('bulkJsonInput');
  if(ta){ta.value=SAMPLE_JSON;toast('Sample NEET JSON loaded.')}
};

function quizKey(sub,chap,mark){return [sub,chap,mark].map(x=>String(x||'All').trim().toLowerCase()).join('|')}
function saveQuizProgress(){
  if(!activeQuizKey||!activeQuiz)return;
  db.quizProgress=db.quizProgress||{};
  if(quizIdx>=activeQuiz.length){delete db.quizProgress[activeQuizKey];save();return}
  db.quizProgress[activeQuizKey]={ids:activeQuiz.map(q=>q.id),idx:quizIdx,score:quizScore,wrong:quizWrongList,elapsed:quizElapsedSec,answered:quizAnswered,picked:quizPickedIdx,answers:quizAnswers,meta:activeQuizMeta,updatedAt:Date.now()};
  save();
}
window.restartActiveQuiz=()=>{
  if(!activeQuizKey){toast('Is quiz ko restart nahi kar sakte.');return}
  if(!confirm('Quiz reset karke pehle question se shuru karein?'))return;
  if(db.quizProgress)delete db.quizProgress[activeQuizKey];
  save();
  clearInterval(quizClockInterval);
  const key=activeQuizKey;
  activeQuiz=null;
  if(String(key).startsWith('sheet:')){
    const rest=String(key).slice(6); // id or id:Mark
    const parts=rest.split(':');
    const sid=parts[0];
    const mk=parts[1]||'All';
    startPracticeSheet(sid, mk, true);
    return;
  }
  if(!activeQuizArgs){toast('Is quiz ko restart nahi kar sakte.');return}
  const args=activeQuizArgs;
  startSavedQuiz(args[0],args[1],args[2]);
};
window.resetChapterProgress=btn=>{
  const key=quizKey(btn.dataset.sub,btn.dataset.chap,'All');
  if(db.quizProgress&&db.quizProgress[key]){delete db.quizProgress[key];save();render();toast('Is chapter ka progress reset ho gaya.')}
};
function beginQuizSession(items,meta,key=null,args=null){
  activeQuizKey=key;
  activeQuizArgs=args;
  activeQuiz=items.map(x=>({...x,mark:normalizeMark(x.mark||x.tag)}));
  activeQuizMeta=meta||{};
  quizIdx=0;
  quizScore=0;
  quizAnswered=false;
  quizPickedIdx=null;
  quizWrongList=[];
  quizAnswers={};
  quizReview=new Set();
  quizElapsedSec=0;
  clearQuizPace();
  skipDrill=!!(meta&&meta.skipDrill);
  drillNet=0;drillForced=0;drillRight=0;drillWrong=0;drillSkip=0;
  practiceTab='quiz';
  render();
  startQuizPace();
}
function restoreQuizAnswerState(idx){
  const saved=quizAnswers[idx];
  if(saved && saved.picked!==-1 && !saved.skipped){
    // previously answered — lock and show pick
    quizAnswered=true;
    quizPickedIdx=saved.picked;
  }else if(saved && (saved.skipped || saved.picked===-1)){
    // skipped earlier — allow re-attempt, don't show answer
    quizAnswered=false;
    quizPickedIdx=null;
    // clear skip so a new answer can replace it
  }else{
    quizAnswered=false;
    quizPickedIdx=null;
  }
}
function recomputeQuizScore(){
  if(!activeQuiz){quizScore=0;return}
  let s=0;
  const wrong=[];
  for(let i=0;i<activeQuiz.length;i++){
    const a=quizAnswers[i];
    if(!a||a.picked===-1)continue;
    const q=activeQuiz[i];
    if(a.picked===q.ans)s++;
    else wrong.push({q:q.q,picked:q.opts[a.picked],correct:q.opts[q.ans],mark:normalizeMark(q.mark||q.tag),exp:q.exp||''});
  }
  quizScore=s;
  quizWrongList=wrong;
}
window.startSkipDrill=(n=15)=>{
  const bank=db.quizzes||[];
  if(bank.length<3){toast('Pehle Practice tab se kam se kam 3 MCQ import karo.');return}
  const pool=[...bank].sort(()=>Math.random()-0.5).slice(0,Math.min(n,bank.length));
  beginQuizSession(pool,{subject:'Mixed',chapter:'NEET Skip Drill',skipDrill:true});
  toast(`Skip drill: ${pool.length} Qs • +4 / −1 / 0 skip`);
};

function parseQuizJsonText(raw){
  let t=String(raw||'').trim();
  if(!t || t==='Thinking...')throw new Error('Empty output');
  // strip markdown fences anywhere
  t=t.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
  // common AI mess: smart quotes, trailing commas before ] or }
  t=t.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g,'"')
     .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g,"'")
     .replace(/,\s*([}\]])/g,'$1');
  let start=t.indexOf('['), end=t.lastIndexOf(']');
  if(start<0)throw new Error('No JSON array found ([ ... ])');
  // if response was truncated (no closing ]), recover complete objects
  if(end<=start){
    const slice=t.slice(start);
    const objs=[];
    let depth=0, objStart=-1, inStr=false, esc=false;
    for(let i=0;i<slice.length;i++){
      const c=slice[i];
      if(inStr){
        if(esc)esc=false;
        else if(c==='\\')esc=true;
        else if(c==='"')inStr=false;
        continue;
      }
      if(c==='"'){inStr=true;continue}
      if(c==='{'){if(depth===0)objStart=i;depth++}
      else if(c==='}'){
        depth--;
        if(depth===0&&objStart>=0){
          try{objs.push(JSON.parse(slice.slice(objStart,i+1)))}catch(_){}
          objStart=-1;
        }
      }
    }
    if(!objs.length)throw new Error('JSON incomplete / truncated');
    t=JSON.stringify(objs);
  }else{
    t=t.slice(start,end+1);
  }
  let arr;
  try{arr=JSON.parse(t)}catch(e){
    // last resort: extract individual {..} objects
    const objs=[];
    let depth=0, objStart=-1, inStr=false, escCh=false;
    for(let i=0;i<t.length;i++){
      const c=t[i];
      if(inStr){
        if(escCh)escCh=false;
        else if(c==='\\')escCh=true;
        else if(c==='"')inStr=false;
        continue;
      }
      if(c==='"'){inStr=true;continue}
      if(c==='{'){if(depth===0)objStart=i;depth++}
      else if(c==='}'){
        depth--;
        if(depth===0&&objStart>=0){
          try{objs.push(JSON.parse(t.slice(objStart,i+1)))}catch(_){}
          objStart=-1;
        }
      }
    }
    if(!objs.length)throw new Error('JSON parse failed: '+(e.message||e));
    arr=objs;
  }
  if(!Array.isArray(arr)||!arr.length)throw new Error('Empty array');
  const cleaned=[];
  for(const item of arr){
    if(!item||typeof item!=='object')continue;
    const q=item.q||item.question||item.Q;
    let opts=item.opts||item.options||item.opt;
    if(typeof opts==='string'){
      try{opts=JSON.parse(opts)}catch(_){opts=opts.split(/\n|\|/).map(s=>s.trim()).filter(Boolean)}
    }
    if(!q || !Array.isArray(opts) || opts.length<2)continue;
    let ansIdx=0;
    const ans=item.ans??item.answer??item.correct??0;
    if(typeof ans==='number')ansIdx=Math.max(0,Math.min(opts.length-1,ans));
    else if(typeof ans==='string'){
      const letterMap={A:0,B:1,C:2,D:3};
      const up=ans.trim().toUpperCase();
      if(up in letterMap)ansIdx=letterMap[up];
      else{
        const found=opts.findIndex(o=>String(o).trim().toLowerCase()===ans.trim().toLowerCase());
        ansIdx=found>=0?found:0;
      }
    }
    const mk=normalizeMark(item.mark||item.tag||item.difficulty);
    cleaned.push({
      id:crypto.randomUUID(),
      subject:item.subject||'Biology',
      chapter:item.chapter||'General Practice',
      q:String(q).trim(),
      opts:opts.map(o=>String(o)),
      ans:ansIdx,
      mark:mk,
      topic:String(item.topic||'').trim(),
      exp:String(item.exp||item.explanation||'').trim()
    });
  }
  if(!cleaned.length)throw new Error('No valid MCQs (need q + opts[2+])');
  return cleaned;
}
window.importBulkJson=()=>{
  const ta=document.getElementById('bulkJsonInput');
  if(!ta||!ta.value.trim()){toast('Paste JSON first.');return}
  try{
    const cleaned=parseQuizJsonText(ta.value);
    db.quizzes=db.quizzes||[];
    db.quizzes.push(...cleaned);
    save();
    const chapters=[...new Set(cleaned.map(x=>x.chapter))];
    beginQuizSession(cleaned,{subject:cleaned[0].subject||'Mixed',chapter:chapters.length===1?chapters[0]:'Mixed Chapters'});
    toast(`${cleaned.length} MCQs imported & quiz started!`);
  }catch(err){
    toast('Invalid JSON format. Check brackets and commas.');
  }
};
async function callGemini(prompt){
  const key=(db.settings.geminiKey||'').trim();
  if(!key)throw new Error('NO_KEY');
  if(!prompt)throw new Error('NO_PROMPT');
  const models=['gemini-3.8-flash','gemini-3.6-flash','gemini-flash-latest'];
  let lastErr='';
  for(const m of models){
    for(let t=0;t<2;t++){
      try{
        const url='https://generativelanguage.googleapis.com/v1beta/models/'+m+':generateContent?key='+encodeURIComponent(key);
        const res=await fetch(url,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            contents:[{parts:[{text:prompt}]}],
            generationConfig:{temperature:0.4,maxOutputTokens:8192}
          })
        });
        const data=await res.json();
        if(data?.error?.message){lastErr=data.error.message;await new Promise(r=>setTimeout(r,1500));continue}
        const text=data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if(text)return text;
        lastErr='Empty Gemini response';
      }catch(e){lastErr=String(e.message||e)}
    }
  }
  throw new Error(lastErr||'Gemini failed');
}
window.vaultMakeQuiz=async(id)=>{
  const v=(db.vault||[]).find(x=>x.id===id);
  if(!v){toast('Vault item missing.');return}
  const sub=(v.subject&&v.subject!=='Formula / Notes')?v.subject:'Physics';
  const chap=(v.chapter||v.title||'General').trim();
  const topic=`Material: "${v.title}"${v.category?' ('+v.category+')':''}. NCERT + NEET PYQ style from this chapter.`;
  const prompt=`Act as a NEET exam question maker for ${sub} (Chapter: "${chap}", Topic: "${topic}"). Create 12 NCERT-aligned multiple choice questions. Return ONLY a valid JSON array in this exact schema with no extra text:\n[{"subject":"${sub}","chapter":"${chap}","q":"Question text","opts":["Option A","Option B","Option C","Option D"],"ans":0,"mark":"Imp","exp":"Short clear explanation"}]`;
  const key=(db.settings.geminiKey||'').trim();
  if(!key){
    aiOutput=prompt;
    navigate('aitutor');
    setTimeout(()=>{
      const box=document.getElementById('aiPromptBox');
      if(box)box.textContent=prompt;
      navigator.clipboard?.writeText(prompt).catch(()=>{});
      toast('Key nahi mili — prompt copy ho gaya. AI Tutor mein Gemini key save karo ya GPT mein paste karo.');
    },80);
    return;
  }
  toast('Gemini se 12 MCQ ban rahe hain…');
  try{
    const text=await callGemini(prompt);
    const cleaned=parseQuizJsonText(text);
    db.quizzes=db.quizzes||[];
    db.quizzes.push(...cleaned);
    save();
    beginQuizSession(cleaned,{subject:sub,chapter:chap});
    toast(`${cleaned.length} MCQs Vault se ban ke quiz start!`);
  }catch(e){
    const msg=String(e.message||e);
    if(msg==='NO_KEY')toast('Gemini key AI Tutor mein save karo.');
    else{
      aiOutput=prompt+'\n\n--- Gemini error ---\n'+msg;
      navigate('aitutor');
      setTimeout(()=>{
        const box=document.getElementById('aiPromptBox');
        if(box)box.textContent=prompt;
        toast('Gemini fail: '+msg.slice(0,80)+' — prompt ready, paste GPT/Claude mein.');
      },80);
    }
  }
};

window.startSavedQuiz=(subFilter='All',chapFilter='All',markFilter='All')=>{
  const targetMark=markFilter==='All'?'All':normalizeMark(markFilter);
  const normSub=String(subFilter||'All').trim().toLowerCase();
  const normChap=String(chapFilter||'All').trim().toLowerCase();
  const pool=(db.quizzes||[]).filter(q=>{
    const qMark=normalizeMark(q.mark||q.tag);
    const qSub=String(q.subject||'').trim().toLowerCase();
    const qChap=String(q.chapter||'').trim().toLowerCase();
    return (normSub==='all'||qSub===normSub) &&
           (normChap==='all'||qChap===normChap) &&
           (targetMark==='All'||qMark===targetMark);
  });
  if(!pool.length){toast(`No ${targetMark==='All'?'saved':targetMark} MCQs found for this selection.`);return}
  const labelChap=chapFilter==='All'?(targetMark==='All'?'All Chapters':`${targetMark} Marked`):chapFilter;
  const key=quizKey(subFilter,chapFilter,markFilter);
  const prog=(db.quizProgress||{})[key];
  if(prog&&prog.ids&&prog.idx<prog.ids.length){
    const go=confirm(`Last attempt: Q${(prog.idx||0)+1}/${prog.ids.length} (score ${prog.score||0}).\n\nOK = Continue\nCancel = Restart from Q1`);
    if(go){
      const bank=db.quizzes||[];
      const rebuilt=prog.ids.map(id=>bank.find(q=>q.id===id)).filter(Boolean);
      if(rebuilt.length===prog.ids.length){
        activeQuiz=rebuilt.map(x=>({...x,mark:normalizeMark(x.mark||x.tag)}));
        activeQuizMeta=prog.meta||{subject:subFilter,chapter:labelChap};
        activeQuizKey=key;
        activeQuizArgs=[subFilter,chapFilter,markFilter];
        quizIdx=prog.idx;quizScore=prog.score||0;quizWrongList=prog.wrong||[];quizElapsedSec=prog.elapsed||0;
        quizAnswers=prog.answers||{};
        if(quizAnswers[quizIdx] && quizAnswers[quizIdx].picked!==undefined && quizAnswers[quizIdx].picked!==-1 && !quizAnswers[quizIdx].skipped){
          quizAnswered=true;quizPickedIdx=quizAnswers[quizIdx].picked;
        }else{
          quizAnswered=false;
          quizPickedIdx=(quizAnswers[quizIdx]&&quizAnswers[quizIdx].picked>=0)?quizAnswers[quizIdx].picked:null;
        }
        skipDrill=!!(activeQuizMeta&&activeQuizMeta.skipDrill);
        practiceTab='quiz';
        render();
        toast(`Continue: Q${quizIdx+1}/${activeQuiz.length}`);
        return;
      }
    }
    delete db.quizProgress[key];
    save();
  }
  beginQuizSession(pool,{subject:subFilter,chapter:labelChap},key,[subFilter,chapFilter,markFilter]);
};

window.retryAttemptWrongQuestions=(attemptId)=>{
  const att=(db.quizAttempts||[]).find(a=>a.id===attemptId);
  const wrong=att && att.wrongItems ? att.wrongItems : [];
  if(!wrong.length){toast('No wrong questions in this attempt!');return}
  const qBank=db.quizzes||[];
  const rebuilt=wrong.map(w=>{
    const matched=qBank.find(q=>q.q===w.q);
    if(matched)return {...matched};
    const opts=[w.picked,w.correct].filter(Boolean);
    if(opts.length<2)opts.push('Option A','Option B');
    const ansIdx=Math.max(0,opts.indexOf(w.correct));
    return {
      id:crypto.randomUUID(),
      subject:att.subject||'Biology',
      chapter:att.chapter||'Wrong Q Re-Test',
      q:w.q,
      opts,
      ans:ansIdx,
      mark:normalizeMark(w.mark||'Hard'),
      exp:w.exp||`True Answer: ${w.correct}`
    };
  });
  beginQuizSession(rebuilt,{subject:att.subject||'Mixed',chapter:`${att.chapter} (Wrong Qs)`});
  toast(`Starting ${rebuilt.length} missed question(s)!`);
};

function saveQuizAttemptIfDone(){
  clearInterval(quizClockInterval);
  if(!activeQuiz||!activeQuiz.length)return;
  const total=activeQuiz.length;
  const acc=Math.round(quizScore/total*100);
  const avgSec=Math.max(1,Math.round(quizElapsedSec/total));
  db.quizAttempts=db.quizAttempts||[];
  db.quizAttempts.push({
    id:crypto.randomUUID(),
    date:today(),
    subject:activeQuizMeta.subject||'Mixed',
    chapter:activeQuizMeta.chapter||'General Practice',
    score:quizScore,
    total,
    accuracy:acc,
    elapsedSec:quizElapsedSec,
    avgSec,
    marksSummary:activeQuiz.map(q=>({q:q.q,mark:normalizeMark(q.mark||q.tag)})),
    wrongItems:quizWrongList.slice()
  });
  if(activeQuizKey&&db.quizProgress)delete db.quizProgress[activeQuizKey];
  save();
  toast(`Attempt saved (${acc}% • ${avgSec}s/Q)!`);
}

const WHY_OPTS=['Silly mistake','Concept gap','Lack of revision','Not reading properly','Calculation','Formula recall','Other'];
function findMistakeForQuestion(q){
  if(!q) return null;
  // 1) linked id from this quiz answer
  const ans = quizAnswers && quizAnswers[quizIdx];
  if(ans && ans.mistakeId){
    const byId = db.mistakes.find(x => x.id === ans.mistakeId);
    if(byId) return byId;
  }
  // 2) match by question text (open mistakes first)
  const needle = String(q.q || '').slice(0, 60);
  if(!needle) return null;
  let m = db.mistakes.find(x => !x.closed && String(x.error || '').includes(needle));
  if(m) return m;
  // 3) any mistake (including closed) with same stem
  m = db.mistakes.find(x => String(x.error || '').includes(needle));
  return m || null;
}
function whyBoxInner(m){
  if(!m) return '<div class="muted" style="font-size:11px">Mistake link missing — Next pe jaake wapas aao.</div>';
  const cur = m.type;
  const mid = String(m.id || '');
  return `<div class="muted" style="font-size:11px;margin-bottom:8px">Kyu galat hua? <span style="opacity:.7">(Mistake Hunter me save)</span>${cur && cur!=='Untagged'?` · <b style="color:var(--red)">${esc(cur)}</b>`:''}</div>
  <div class="why-chips" data-mistake-id="${esc(mid)}">${WHY_OPTS.map(o=>`<button type="button" class="why-chip ${cur===o?'active':''}" data-why="${esc(o)}" onclick="event.preventDefault();event.stopPropagation();setWhyWrong('${mid.replace(/'/g,"\'")}','${o.replace(/'/g,"\'")}')">${o}</button>`).join('')}</div>
  ${cur==='Other'?`<input class="why-note" placeholder="Apna reason likho…" value="${esc(m.whyNote||'')}" oninput="setWhyNote('${mid.replace(/'/g,"\'")}',this.value)">`:''}`;
}
function whyForQuestionHTML(q){
  if(!quizAnswered||quizPickedIdx===-1||quizPickedIdx===q.ans)return '';
  let m = findMistakeForQuestion(q);
  // auto-create if somehow missing
  if(!m){
    m = {
      id: crypto.randomUUID(),
      date: today(),
      subject: q.subject || 'Biology',
      type: 'Untagged',
      chapter: q.chapter || 'Quiz Practice',
      error: `Wrong MCQ: ${q.q} (Picked: ${q.opts[quizPickedIdx]}) | True Answer: ${q.opts[q.ans]}`,
      fix: q.exp ? `True Answer: ${q.opts[q.ans]}. ${q.exp}` : `True Answer: ${q.opts[q.ans]}.`
    };
    db.mistakes = db.mistakes || [];
    db.mistakes.push(m);
    if(quizAnswers[quizIdx]) quizAnswers[quizIdx].mistakeId = m.id;
    save();
  } else if(quizAnswers[quizIdx] && !quizAnswers[quizIdx].mistakeId){
    quizAnswers[quizIdx].mistakeId = m.id;
  }
  return `<div class="why-box" id="whyBox">${whyBoxInner(m)}</div>`;
}
window.setWhyWrong=(id,opt)=>{
  try{
    if(!id || !opt){ toast('Why option missing'); return; }
    let m = db.mistakes.find(x => x.id === id);
    if(!m){
      // fallback: current question's mistake
      m = activeQuiz && activeQuiz[quizIdx] ? findMistakeForQuestion(activeQuiz[quizIdx]) : null;
    }
    if(!m){ toast('Mistake entry nahi mili — dubara answer submit karo'); return; }
    m.type = opt;
    if(opt !== 'Other') delete m.whyNote;
    if(quizAnswers[quizIdx]) quizAnswers[quizIdx].mistakeId = m.id;
    save();
    const el = document.getElementById('whyBox');
    if(el) el.innerHTML = whyBoxInner(m);
    // also paint chips directly in case DOM id drifted
    document.querySelectorAll('.why-chip').forEach(btn=>{
      btn.classList.toggle('active', btn.getAttribute('data-why') === opt);
    });
    toast(`Reason: ${opt}`);
  }catch(e){
    console.warn('setWhyWrong', e);
    toast('Why save fail');
  }
};
window.setWhyNote=(id,v)=>{
  const m = db.mistakes.find(x=>x.id===id) || (activeQuiz && activeQuiz[quizIdx] ? findMistakeForQuestion(activeQuiz[quizIdx]) : null);
  if(m){ m.whyNote=v; save(); }
};

window.answerQuizOpt=(choiceIdx)=>{
  // Select only — answer reveals after Submit
  if(quizAnswered||!activeQuiz||!activeQuiz[quizIdx])return;
  quizPickedIdx=choiceIdx;
  render();
};
window.submitQuizAnswer=()=>{
  if(quizAnswered||!activeQuiz||!activeQuiz[quizIdx])return;
  if(quizPickedIdx===null||quizPickedIdx===undefined||quizPickedIdx<0){
    toast('Pehle option select karo, phir Submit.');
    return;
  }
  quizAnswered=true;
  const choiceIdx=quizPickedIdx;
  const curQ=activeQuiz[quizIdx];
  const mk=normalizeMark(curQ.mark||curQ.tag);
  const isCorrect=choiceIdx===curQ.ans;
  const trueAnsText=curQ.opts[curQ.ans];
  quizAnswers[quizIdx]={picked:choiceIdx,correct:isCorrect};
  if(skipDrill){
    if(isCorrect){drillNet+=4;drillForced+=4;drillRight++}
    else{drillNet-=1;drillForced-=1;drillWrong++}
  }
  if(!isCorrect){
    playSfx('ohno');
    const needle = String(curQ.q||'').slice(0,60);
    let m = db.mistakes.find(x => !x.closed && String(x.error||'').includes(needle));
    if(!m){
      m = {
        id: crypto.randomUUID(),
        date: today(),
        subject: curQ.subject||'Biology',
        type: skipDrill ? 'Time management' : 'Untagged',
        chapter: curQ.chapter||'Quiz Practice',
        error: `Wrong MCQ [${mk}]: ${curQ.q} (Picked: ${curQ.opts[choiceIdx]}) | True Answer: ${trueAnsText}`,
        fix: curQ.exp ? `True Answer: ${trueAnsText}. ${curQ.exp}` : `True Answer: ${trueAnsText}.`
      };
      db.mistakes.push(m);
      toast('Saved to Mistake Hunter with True Answer.');
    }
    quizAnswers[quizIdx] = {picked: choiceIdx, correct: false, mistakeId: m.id};
    save();
  }
  if(isCorrect)playSfx('sparkle');
  clearQuizPace();
  recomputeQuizScore();
  if(quizIdx+1>=activeQuiz.length)saveQuizAttemptIfDone();else saveQuizProgress();
  render();
};
window.skipQuizQuestion=()=>{
  if(quizAnswered||!activeQuiz||!activeQuiz[quizIdx])return;
  clearQuizPace();
  playSfx('aachi');
  // Mark skipped — do NOT reveal answer; jump to next Q
  quizAnswers[quizIdx]={picked:-1,correct:false,skipped:true};
  if(skipDrill){
    drillSkip++;
    drillForced-=1;
  }
  recomputeQuizScore();
  if(quizIdx+1>=activeQuiz.length){
    quizIdx=activeQuiz.length;
    saveQuizAttemptIfDone();
    render();
    playSfx('guitar');
    return;
  }
  quizIdx++;
  restoreQuizAnswerState(quizIdx);
  saveQuizProgress();
  render();
  if(!quizAnswered)startQuizPace();
};

window.nextQuizQuestion=()=>{
  if(!activeQuiz)return;
  if(quizIdx+1>=activeQuiz.length){
    if(!quizAnswered && !quizAnswers[quizIdx]){toast('Answer or Skip before finishing.');return}
    clearQuizPace();
    quizIdx=activeQuiz.length;
    recomputeQuizScore();
    saveQuizAttemptIfDone();
    render();
    playSfx('guitar');
    return;
  }
  quizIdx++;
  restoreQuizAnswerState(quizIdx);
  saveQuizProgress();
  render();
  if(!quizAnswered)startQuizPace();
};
window.prevQuizQuestion=()=>{
  if(!activeQuiz||quizIdx<=0)return;
  clearQuizPace();
  quizIdx--;
  restoreQuizAnswerState(quizIdx);
  saveQuizProgress();
  render();
  if(!quizAnswered)startQuizPace();
};
window.toggleQuizReview=()=>{
  if(!activeQuiz||!activeQuiz[quizIdx])return;
  const id=activeQuiz[quizIdx].id||('idx-'+quizIdx);
  if(quizReview.has(id))quizReview.delete(id);else quizReview.add(id);
  // persist review marks on questions in db if they have real ids
  const q=activeQuiz[quizIdx];
  if(q&&q.id){
    const bank=db.quizzes||[];
    const found=bank.find(x=>x.id===q.id);
    if(found){found.review=quizReview.has(id);save()}
  }
  render();
  toast(quizReview.has(id)?'Marked for review 🚩':'Review mark removed');
};

window.deleteAttempt=(id)=>{
  db.quizAttempts=(db.quizAttempts||[]).filter(a=>a.id!==id);
  save();
  render();
  toast('Attempt deleted.');
};

window.clearSavedQuizzes=()=>{
  if(!confirm('Delete all imported MCQs?'))return;
  db.quizzes=[];
  db.quizProgress={};
  activeQuiz=null;
  save();
  render();
  toast('Saved MCQs cleared.');
};

window.retestResult=(mistakeId,passed)=>{
  const m=db.mistakes.find(x=>x.id===mistakeId);
  if(m){
    m.fixStreak=m.fixStreak||0;
    if(passed){
      m.fixStreak++;
      if(m.fixStreak>=2){
        m.closed=true;
        m.closedAt=today();
        toast('2 clears in a row — mistake closed.');
      }else{
        toast('1 more clear needed before it closes (fix loop).');
      }
    }else{
      m.fixStreak=0;
      toast('Still open. Loop resets — try again after a short revision.');
    }
    save();
  }
  retestIdx++;
  render();
};

window.focusMistakeRetest=(id)=>{
  const open=db.mistakes.filter(x=>!x.closed);
  const i=open.findIndex(x=>x.id===id);
  if(i<0){toast('Mistake already closed or missing.');return}
  retestIdx=i;
  practiceTab='retest';
  navigate('practice');
  toast('Fix loop opened for this mistake.');
};

function practiceView(){
  title('Practice & Quiz');
  const qBank=db.quizzes||[];
  const attempts=db.quizAttempts||[];
  const openMistakes=db.mistakes.filter(m=>!m.closed);
  const safeRetestIdx=openMistakes.length?(retestIdx%openMistakes.length):0;
  const curRetest=openMistakes[safeRetestIdx];
  const attemptChapters=['All',...new Set(attempts.map(a=>a.chapter).filter(Boolean))];
  const filteredAttempts=(attemptChapterFilter==='All'?attempts:attempts.filter(a=>a.chapter===attemptChapterFilter)).slice().reverse();

  const countByMark=(arr,mk)=>arr.filter(q=>normalizeMark(q.mark||q.tag)===mk).length;
  const impCount=countByMark(qBank,'Imp');
  const easyCount=countByMark(qBank,'Easy');
  const medCount=countByMark(qBank,'Medium');
  const hardCount=countByMark(qBank,'Hard');

  const chapStatsMap={};
  attempts.forEach(a=>{
    const ch=a.chapter||'General Practice';
    if(!chapStatsMap[ch])chapStatsMap[ch]={chapter:ch,subject:a.subject||'Mixed',count:0,totalQ:0,rightQ:0};
    chapStatsMap[ch].count++;
    chapStatsMap[ch].totalQ+=(a.total||0);
    chapStatsMap[ch].rightQ+=(a.score||0);
  });
  const chapSummaryList=Object.values(chapStatsMap).map(x=>({...x,acc:x.totalQ?Math.round(x.rightQ/x.totalQ*100):0}));

  const sheetCount = PRACTICE_SHEET_CATALOG.reduce((n,s)=>n+(s.count||0),0);
  return `<div class="tabs">
    <button type="button" class="tab ${practiceTab==='sheets'?'active':''}" onclick="setPracticeTab('sheets')">Practice Sheets <b>${PRACTICE_SHEET_CATALOG.length}</b></button>
    <button type="button" class="tab ${practiceTab==='quiz'?'active':''}" onclick="setPracticeTab('quiz')">Bulk JSON MCQ Quiz <b>${qBank.length}</b></button>
    <button type="button" class="tab ${practiceTab==='attempts'?'active':''}" onclick="setPracticeTab('attempts')">Saved Attempts <b>${attempts.length}</b></button>
    <button type="button" class="tab ${practiceTab==='retest'?'active':''}" onclick="setPracticeTab('retest')">Mistake Re-Test <b>${openMistakes.length}</b></button>
    <button type="button" class="tab ${practiceTab==='skipdrill'?'active':''}" onclick="setPracticeTab('skipdrill')">Skip Drill</button>
  </div>

  
  ${practiceTab==='sheets' && !(activeQuiz)?`
    <div class="card" style="margin-bottom:14px">
      <div class="section-head" style="margin-top:0">
        <h2>Practice Sheets</h2>
        <small>CURATED NCERT / COACHING PACKS • SAME QUIZ RUNNER</small>
      </div>
      <p class="muted" style="font-size:12px;line-height:1.7;max-width:640px;margin:0 0 14px">Subject → Book → Chapter sheet pe click karo. Quiz structure Bulk Practice jaisa hi hai (keys 1–4, skip, review, pace, resume).</p>
      <div class="tabs three" style="margin-bottom:14px">
        ${['Physics','Chemistry','Biology'].map(s=>`<button type="button" class="tab ${practiceSheetSubject===s?'active':''}" onclick="setPracticeSheetSubject('${s}')">${s}</button>`).join('')}
      </div>
      ${(()=>{
        const subSheets = PRACTICE_SHEET_CATALOG.filter(s=>s.subject===practiceSheetSubject);
        if(!subSheets.length){
          return `<div class="empty">Is subject ke liye abhi koi sheet nahi. Baad mein JSON pack add hoga 🤝</div>`;
        }
        const books = [...new Set(subSheets.map(s=>s.book))];
        if(practiceSheetBook && !books.includes(practiceSheetBook)) practiceSheetBook = null;
        const activeBook = practiceSheetBook || books[0];
        const bookSheets = subSheets.filter(s=>s.book===activeBook);
        return `
          <div class="actions" style="flex-wrap:wrap;margin-bottom:12px;gap:6px">
            ${books.map(b=>`<button type="button" class="btn ${b===activeBook?'':'ghost'}" style="padding:6px 12px" onclick="setPracticeSheetBook('${esc(b)}')">${esc(b)}</button>`).join('')}
          </div>
          <div class="eyebrow" style="margin-bottom:8px">${esc(activeBook)} • ${bookSheets.length} sheet(s)</div>
          ${bookSheets.map(s=>{
            const qs = getPracticeSheetQuestions(s);
            const n = qs.length || s.count || 0;
            const counts = {Imp:0,Easy:0,Medium:0,Hard:0};
            qs.forEach(q=>{const m=normalizeMark(q.mark||q.tag);if(counts[m]!==undefined)counts[m]++});
            const progKey = 'sheet:'+s.id;
            const prog = (db.quizProgress||{})[progKey];
            const progNote = prog && prog.idx < (prog.ids||[]).length ? ` · ▶ Q${(prog.idx||0)+1}/${(prog.ids||[]).length}` : '';
            return `<div class="list-item" style="align-items:flex-start;flex-wrap:wrap">
              <div style="flex:1;min-width:180px">
                <b>${esc(s.chapter)}</b>
                <div class="muted" style="margin-top:3px">${esc(s.subject)} · ${esc(s.book)} · ${n} Q${progNote}</div>
                <div class="actions" style="margin-top:8px;flex-wrap:wrap;gap:5px">
                  <button type="button" class="btn" style="padding:5px 10px" onclick="startPracticeSheet('${s.id}','All')">All (${n})</button>
                  ${['Imp','Easy','Medium','Hard'].map(m=>{
                    const c=counts[m]||0;
                    if(!c) return `<button type="button" class="btn ghost" disabled style="padding:5px 10px;opacity:.4" title="Is sheet me abhi ${m} tagged Q nahi — quiz me TAG se change karo">${m} (0)</button>`;
                    return `<button type="button" class="btn ghost" style="padding:5px 10px;${markBadgeStyle(m)}" onclick="startPracticeSheet('${s.id}','${m}')">${m} (${c})</button>`;
                  }).join('')}
                </div>
                <p class="muted" style="font-size:10px;margin:6px 0 0;line-height:1.5">Tip: Easy/Medium/Hard ke liye quiz ke andar question pe <b>TAG</b> buttons use karo — count yahan update ho jayega.</p>
              </div>
            </div>`;
          }).join('')}
        `;
      })()}
    </div>
  `:''}

${practiceTab==='skipdrill'&&!(activeQuiz&&skipDrill)?`
    <div class="card">
      <h3>Negative marking drill (+4 / −1 / skip 0)</h3>
      <p class="muted" style="font-size:12px;line-height:1.7;max-width:560px">NEET mein har galat jawab −1. 50/50 pe attempt karna aksar score khaata hai. Is drill mein Skip allowed hai — end pe net marks vs “forced attempt” baseline dikhega.</p>
      <div class="actions" style="margin-top:12px">
        <button type="button" class="btn" onclick="startSkipDrill(10)">Start 10 Q</button>
        <button type="button" class="btn secondary" onclick="startSkipDrill(15)">15 Q</button>
        <button type="button" class="btn secondary" onclick="startSkipDrill(20)">20 Q</button>
      </div>
      <p class="muted" style="font-size:11px;margin-top:10px">Uses your imported MCQ bank (${qBank.length} available).</p>
    </div>
  `:''}

  ${practiceTab==='quiz'||(practiceTab==='skipdrill'&&activeQuiz&&skipDrill)?`
    <div class="two-col">
      <div class="card">
        <div class="section-head" style="margin-top:0">
          <h3>${activeQuiz && quizIdx < activeQuiz.length ? (skipDrill?`Skip Drill (${quizIdx+1}/${activeQuiz.length}) • Net ${drillNet}`:`Active Quiz (${quizIdx+1}/${activeQuiz.length}) • Score: ${quizScore}`) : activeQuiz && quizIdx >= activeQuiz.length ? (skipDrill?`Drill done • Net ${drillNet} (R${drillRight}/W${drillWrong}/S${drillSkip})`:'Quiz Completed & Saved!') : selectedQuizSubject ? `${selectedQuizSubject} — Select Chapter` : 'MCQ Quiz Runner'}</h3>
          <div class="actions" style="align-items:center">
            ${activeQuiz && quizIdx < activeQuiz.length ? `<span class="tag gold" style="font-size:11px">⏱ <b id="quizLiveClock">${fmtMMSS(quizElapsedSec)}</b> • ${Math.max(1,Math.round(quizElapsedSec/Math.max(quizIdx+(quizAnswered?1:0),1)))}s/Q</span>` : ''}
            ${activeQuiz && quizIdx < activeQuiz.length && getQuizPaceSec() ? `<span class="tag" style="font-size:11px;${quizPaceLeft<=10?'background:#4a1019;border-color:#ef4444;color:#fecaca':''}">⏳ <b id="quizPaceClock">${quizPaceLeft||getQuizPaceSec()}</b>s</span>` : ''}
            ${activeQuiz && quizIdx<activeQuiz.length && activeQuizKey ? `<button type="button" class="btn ghost" style="padding:5px 10px" onclick="restartActiveQuiz()">↺ Restart</button>` : ''}
            ${activeQuiz ? `<button type="button" class="btn ghost" style="padding:5px 10px" onclick="finishQuizEarly()" title="Submit attempt abhi">Submit quiz</button><button type="button" class="btn secondary" style="padding:5px 10px" onclick="exitActiveQuiz()">← Exit</button>` : selectedQuizSubject ? `<button type="button" class="btn ghost" style="padding:5px 10px" onclick="selectQuizSubject(null)">← Back</button>` : ''}
          </div>
        </div>
        ${!activeQuiz?`<div class="actions" style="margin-bottom:10px;flex-wrap:wrap;gap:6px;align-items:center">
          <span class="muted" style="font-size:11px">Pace / Q:</span>
          ${[0,45,60,90].map(s=>`<button type="button" class="btn ${getQuizPaceSec()===s?'':'ghost'}" style="padding:4px 9px;font-size:10px" onclick="setQuizPace(${s})">${s===0?'OFF':s+'s'}</button>`).join('')}
          <span class="muted" style="font-size:10px">• Keys: 1–4 select · Enter submit · S skip · N next · P prev</span>
        </div>`:''}

        ${activeQuiz && quizIdx < activeQuiz.length ? (()=>{
          const q=activeQuiz[quizIdx];
          const curMark=normalizeMark(q.mark||q.tag);
          return `<div>
            <div class="actions" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap">
              <div class="actions" style="gap:6px;align-items:center">
                <span class="tag blue">${esc(q.subject)} • ${esc(q.chapter)}</span>
                <span class="tag" style="${markBadgeStyle(curMark)}">TAG: ${esc(curMark)}</span>
              </div>
              <div class="actions" style="gap:5px">
                ${MARKS.map(mk=>`<button type="button" class="btn ${curMark===mk?'':'ghost'}" style="padding:4px 8px;font-size:10px;${curMark===mk?markBadgeStyle(mk):''}" onclick="setQuestionMark('${mk}')">${mk}</button>`).join('')}
              </div>
            </div>
            <p style="font-size:13px;font-weight:700;line-height:1.6;margin:10px 0 12px">${esc(q.q)}</p>
            ${q.img?`<div class="quiz-fig" style="margin:0 0 14px;text-align:center">
              <img src="${esc(resolveQuizImg(quizImgCandidates(q.img)[0]||q.img))}" alt="Figure"
                data-cands="${esc(quizImgCandidates(q.img).join('|'))}" data-i="0"
                style="max-width:min(100%,520px);max-height:360px;width:auto;height:auto;border-radius:10px;border:1px solid var(--line);background:#fff;display:inline-block"
                loading="eager" onerror="quizImgError(this)">
              <div hidden class="muted" style="font-size:11px;padding:10px;border:1px dashed var(--line);border-radius:8px;margin-top:6px">Figure load nahi hui.<br>Tried: <code style="font-size:10px">${esc(quizImgCandidates(q.img).join(' · '))}</code><br>GitHub pe image <b>root</b> ya <b>images/physics/</b> me honi chahiye.</div>
            </div>`:''}
            ${q.opts.map((opt,i)=>{
              let cls='opt-btn';
              let extraStyle='';
              if(quizAnswered && i===q.ans){
                cls+=' correct';
                extraStyle='background:#103827;border-color:#22c55e;color:#dcfce7';
              }else if(quizAnswered && i===quizPickedIdx && i!==q.ans){
                extraStyle='background:#4a1019;border-color:#ef4444;color:#fecaca';
              }else if(!quizAnswered && quizPickedIdx===i){
                extraStyle='background:var(--soft);border-color:var(--red);box-shadow:0 0 0 2px #c9273818';
              }
              return `<button type="button" class="${cls}" style="${extraStyle}" ${quizAnswered?'disabled':''} onclick="answerQuizOpt(${i})"><b>${String.fromCharCode(65+i)}.</b> <span>${esc(opt)}</span>${quizAnswered && i===q.ans ? ' <span style="margin-left:auto;font-size:10px;font-weight:800;color:#86efac">✓ TRUE ANSWER</span>' : quizAnswered && i===quizPickedIdx && i!==q.ans ? ' <span style="margin-left:auto;font-size:10px;font-weight:800;color:#fca5a5">✕ WRONG</span>' : (!quizAnswered && quizPickedIdx===i ? ' <span style="margin-left:auto;font-size:10px;font-weight:800;color:var(--red)">● SELECTED</span>' : '')}</button>`;
            }).join('')}
            ${(()=>{
              const qid=q.id||('idx-'+quizIdx);
              const isReview=quizReview.has(qid);
              const isSkipped=quizAnswered&&quizPickedIdx===-1;
              const didPick=quizAnswered&&quizPickedIdx!==-1&&quizPickedIdx!==null;
              return `
            <div class="actions" style="margin-top:10px;flex-wrap:wrap;gap:8px">
              ${!quizAnswered?`<button type="button" class="btn secondary" onclick="skipQuizQuestion()">⏭ Skip</button>`:''}
              <button type="button" class="btn ${isReview?'':'ghost'}" style="padding:6px 10px;${isReview?'background:#7c4a10;border-color:#f59e0b;color:#fde68a':''}" onclick="toggleQuizReview()">${isReview?'🚩 Review':'🚩 Mark for review'}</button>
              ${skipDrill&&!quizAnswered?`<span class="muted" style="font-size:11px">Net ${drillNet} • R${drillRight} W${drillWrong} S${drillSkip}</span>`:''}
            </div>
            ${isSkipped?`<div class="ai-reply-box" style="border-color:#64748b"><b>⏭ Skipped</b> — answer hidden. Previous pe wapas aake attempt kar sakte ho.</div>`:''}
            ${didPick?`<div class="ai-reply-box" style="${quizPickedIdx!==q.ans?'border-color:#ef4444':''}"><b>True Answer: ${String.fromCharCode(65+q.ans)}. ${esc(q.opts[q.ans])}</b> • Your pick: <b>${String.fromCharCode(65+quizPickedIdx)}</b> • Tag: <b>${esc(curMark)}</b>\n${esc(q.exp||'Review this concept before moving on.')}</div>
            ${whyForQuestionHTML(q)}`:''}
            <div class="actions" style="margin-top:12px;flex-wrap:wrap;justify-content:space-between">
              <button type="button" class="btn secondary" ${quizIdx<=0?'disabled style="opacity:.4"':''} onclick="prevQuizQuestion()">← Previous</button>
              <div class="actions" style="gap:8px;flex-wrap:wrap">
                ${!quizAnswered?`<button type="button" class="btn ghost" onclick="skipQuizQuestion()">Skip →</button>`:''}
                ${!quizAnswered?`<button type="button" class="btn" ${quizPickedIdx===null||quizPickedIdx<0?'disabled style="opacity:.45"':''} onclick="submitQuizAnswer()">Submit Answer</button>`:''}
                ${quizAnswered?`<button type="button" class="btn" onclick="nextQuizQuestion()">${quizIdx+1<activeQuiz.length?'Next Question →':'Finish & Save Attempt'}</button>`:''}
              </div>
            </div>`;
            })()}
          </div>`;
        })() : activeQuiz && quizIdx >= activeQuiz.length ? (()=>{
          const lastAtt=attempts[attempts.length-1];
          const avgS=lastAtt&&lastAtt.avgSec?lastAtt.avgSec:Math.max(1,Math.round(quizElapsedSec/Math.max(activeQuiz.length,1)));
          const skipCount=Object.values(quizAnswers).filter(a=>a&&(a.skipped||a.picked===-1)).length;
          const revCount=quizReview.size;
          return `<div class="card" style="background:#0c0c12;text-align:center;padding:24px">
            <div class="eyebrow">SAVED UNDER • ${esc(activeQuizMeta.chapter)}</div>
            <div style="font-size:36px;font-weight:800;margin:8px 0">${skipDrill?`${drillNet} net`:`${quizScore} / ${activeQuiz.length}`}</div>
            <div class="muted" style="font-size:12px;margin-bottom:6px">${skipCount?`⏭ ${skipCount} skipped • `:''}${revCount?`🚩 ${revCount} marked for review`:''}</div>
            <div class="muted" style="font-size:12px">${skipDrill?`Right ${drillRight} • Wrong ${drillWrong} • Skip ${drillSkip} • Forced-guess baseline ~${drillForced} (assumes skips would be wrong)`:`Accuracy: ${Math.round(quizScore/activeQuiz.length*100)}%`} • Time: ${fmtMMSS(quizElapsedSec)} (${avgS}s/Q)</div>
            ${skipDrill&&drillNet>drillForced?`<p style="color:#86efac;font-size:12px;margin-top:8px">Skipping saved ~${drillNet-drillForced} marks vs guessing every doubtful Q wrong.</p>`:''}
            <div class="actions" style="justify-content:center;margin-top:16px">
              ${quizWrongList.length && lastAtt ? `<button type="button" class="btn" style="background:#8f1e2b" onclick="retryAttemptWrongQuestions('${lastAtt.id}')">↺ Retry ${quizWrongList.length} Wrong Qs</button>` : ''}
              <button type="button" class="btn secondary" onclick="exitActiveQuiz()">← Back to Quiz Runner</button>
              <button type="button" class="btn ghost" onclick="setPracticeTab('attempts')">Saved Attempts</button>
            </div>
          </div>`;
        })() : selectedQuizSubject ? (()=>{
          const chList=getChaptersForSubject(selectedQuizSubject);
          const subBank=qBank.filter(x=>String(x.subject||'').trim().toLowerCase()===selectedQuizSubject.toLowerCase());
          return `<div>
            <div class="muted" style="margin-bottom:10px">Chapter select karke quiz start karein ya ${esc(selectedQuizSubject)} ke Imp / Hard / Easy / Medium questions filter karein.</div>
            <div class="actions" style="margin-bottom:14px;flex-wrap:wrap">
              <button type="button" class="btn" onclick="startSavedQuiz('${selectedQuizSubject}','All','All')">All ${esc(selectedQuizSubject)} (${subBank.length})</button>
              <button type="button" class="btn secondary" style="${markBadgeStyle('Imp')}" onclick="startSavedQuiz('${selectedQuizSubject}','All','Imp')">Imp (${countByMark(subBank,'Imp')})</button>
              <button type="button" class="btn secondary" style="${markBadgeStyle('Hard')}" onclick="startSavedQuiz('${selectedQuizSubject}','All','Hard')">Hard (${countByMark(subBank,'Hard')})</button>
              <button type="button" class="btn secondary" style="${markBadgeStyle('Medium')}" onclick="startSavedQuiz('${selectedQuizSubject}','All','Medium')">Medium (${countByMark(subBank,'Medium')})</button>
              <button type="button" class="btn secondary" style="${markBadgeStyle('Easy')}" onclick="startSavedQuiz('${selectedQuizSubject}','All','Easy')">Easy (${countByMark(subBank,'Easy')})</button>
            </div>
            <div style="max-height:320px;overflow:auto">
              ${chList.map(ch=>{
                const cnt=subBank.filter(x=>String(x.chapter||'').trim().toLowerCase()===ch.trim().toLowerCase()).length;
                const pg=(db.quizProgress||{})[quizKey(selectedQuizSubject,ch,'All')];
                const hasPg=pg&&pg.ids&&pg.idx<pg.ids.length;
                return `<div class="list-item">
                  <span><b>${esc(ch)}</b> <span class="tag ${cnt?'green':''}">${cnt} Qs ready</span>${hasPg?` <span class="tag gold">Q${pg.idx+1}/${pg.ids.length} saved</span>`:''}</span>
                  <span style="display:flex;gap:6px;align-items:center">${hasPg?`<button type="button" class="btn ghost" style="padding:5px 9px" title="Reset progress" data-sub="${esc(selectedQuizSubject)}" data-chap="${esc(ch)}" onclick="resetChapterProgress(this)">↺</button>`:''}<button type="button" class="btn ${cnt?'secondary':'ghost'}" style="padding:5px 10px" data-sub="${esc(selectedQuizSubject)}" data-chap="${esc(ch)}" onclick="launchChapterBtn(this)">${hasPg?'▶ Resume':'Start Chapter'}</button></span>
                </div>${topicsBlockHTML(selectedQuizSubject,ch,subBank)}`;
              }).join('')}
            </div>
          </div>`;
        })() : (()=>{
          const bankChapters=[...new Set(qBank.map(q=>q.chapter).filter(Boolean))];
          return `
            <div class="empty">Filter by Imp / Hard / Medium / Easy tags, select a subject first to open chapters, or start directly from saved chapters (${qBank.length} MCQs in bank).</div>
            <div class="actions" style="margin-top:8px;flex-wrap:wrap">
              <button type="button" class="btn secondary" onclick="startSavedQuiz('All','All','All')">Start All Saved (${qBank.length})</button>
              <button type="button" class="btn" style="${markBadgeStyle('Imp')}" onclick="startSavedQuiz('All','All','Imp')">Imp (${impCount})</button>
              <button type="button" class="btn" style="${markBadgeStyle('Hard')}" onclick="startSavedQuiz('All','All','Hard')">Hard (${hardCount})</button>
              <button type="button" class="btn" style="${markBadgeStyle('Medium')}" onclick="startSavedQuiz('All','All','Medium')">Medium (${medCount})</button>
              <button type="button" class="btn" style="${markBadgeStyle('Easy')}" onclick="startSavedQuiz('All','All','Easy')">Easy (${easyCount})</button>
            </div>
            <div class="actions" style="margin-top:10px;flex-wrap:wrap">
              <button type="button" class="btn" onclick="selectQuizSubject('Physics')">Physics Chapters →</button>
              <button type="button" class="btn" onclick="selectQuizSubject('Chemistry')">Chemistry Chapters →</button>
              <button type="button" class="btn" onclick="selectQuizSubject('Biology')">Biology Chapters →</button>
              ${qBank.length?`<button type="button" class="btn danger" onclick="clearSavedQuizzes()">Clear Bank</button>`:''}
            </div>
            ${bankChapters.length?`<div style="margin-top:14px"><div class="eyebrow" style="margin-bottom:6px">DIRECT CHAPTER SHORTCUTS</div><div class="actions" style="flex-wrap:wrap">${bankChapters.map(ch=>{
              const cQs=qBank.filter(x=>x.chapter===ch);
              const cSub=cQs[0]?.subject||'All';
              return `<button type="button" class="btn ghost" style="padding:5px 9px;font-size:10px" data-sub="${esc(cSub)}" data-chap="${esc(ch)}" onclick="launchChapterBtn(this)">${esc(ch)} (${cQs.length})</button>`;
            }).join('')}</div></div>`:''}
          `;
        })()}
      </div>

      <div class="card">
        <h3>Bulk JSON Import (No Manual Typing)</h3>
        <div class="field">
          <label>PASTE MCQ JSON ARRAY (TAG: "Imp" | "Easy" | "Medium" | "Hard")</label>
          <textarea id="bulkJsonInput" class="code-box" placeholder='[{"subject":"Biology","chapter":"Genetics","q":"...","opts":["A","B","C","D"],"ans":0,"mark":"Imp","exp":"..."}]'></textarea>
        </div>
        <div class="actions">
          <button type="button" class="btn" onclick="importBulkJson()">⚡ Import & Start Quiz</button>
          <button type="button" class="btn secondary" onclick="loadSampleJson()">Load Sample JSON</button>
        </div>
        <p class="muted" style="font-size:10px;line-height:1.6;margin-top:12px">Tip: PDF ya coaching sheet ko AI Tutor / Gemini / GPT mein dekar JSON banwayein, phir yahan paste karein.</p>
      </div>
    </div>
  ` : practiceTab==='attempts' ? `
    <div class="two-col">
      <div class="card">
        <div class="section-head" style="margin-top:0">
          <h3>Chapter-Wise Saved Attempts (${filteredAttempts.length})</h3>
          <select class="str-select" style="background:#14141d;color:#ddd" onchange="setAttemptChapterFilter(this.value)">
            ${attemptChapters.map(ch=>`<option value="${esc(ch)}" ${attemptChapterFilter===ch?'selected':''}>${ch==='All'?'All Chapters':ch}</option>`).join('')}
          </select>
        </div>
        ${filteredAttempts.length ? filteredAttempts.map(a=>{
          const markCounts={Imp:0,Easy:0,Medium:0,Hard:0};
          (a.marksSummary||[]).forEach(m=>{const nm=normalizeMark(m.mark||m.tag);if(markCounts[nm]!==undefined)markCounts[nm]++});
          const markBadges=MARKS.filter(k=>markCounts[k]>0).map(k=>`<span class="tag" style="${markBadgeStyle(k)}">${k}: ${markCounts[k]}</span>`).join(' ');
          const speedTag=a.avgSec?`<span class="tag blue">⏱ ${a.avgSec}s/Q</span>`:'';
          const wrongN=(a.wrongItems&&a.wrongItems.length)||0;
          return `<div class="list-item" style="align-items:flex-start;flex-wrap:wrap;gap:8px">
            <div style="flex:1;min-width:200px">
              <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                <b>${esc(a.chapter)}</b>
                <span class="tag blue">${esc(a.subject)}</span>
                <span class="tag green">${a.score}/${a.total} (${a.accuracy}%)</span>
                ${wrongN?`<span class="tag red">✕ ${wrongN} wrong</span>`:'<span class="tag green">100%</span>'}
                ${speedTag} ${markBadges}
              </div>
              <div class="muted" style="margin-top:4px;font-size:10px">${esc(a.date)}${a.elapsedSec?' • '+fmtMMSS(a.elapsedSec):''}</div>
              ${wrongN?`<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:#fca5a5">Missed ${wrongN} — expand</summary>
                <div style="margin-top:6px;font-size:11px;line-height:1.5;color:#fca5a5">${a.wrongItems.map((w,i)=>`<div style="padding:4px 0;border-bottom:1px solid #3a1520"><b>${i+1}.</b> ${esc((w.q||'').slice(0,90))}${ (w.q||'').length>90?'…':'' } <span class="muted">→</span> <b style="color:#86efac">${esc(w.correct||'')}</b></div>`).join('')}</div>
              </details>`:''}
            </div>
            <div class="actions" style="flex-shrink:0">
              ${wrongN?`<button type="button" class="btn danger" style="padding:5px 9px" onclick="retryAttemptWrongQuestions('${a.id}')">Retry (${wrongN})</button>`:''}
              ${a.chapter && a.chapter!=='Mixed Chapters' && qBank.some(q=>q.chapter===a.chapter)?`<button type="button" class="btn secondary" style="padding:5px 9px" data-sub="${esc(a.subject)}" data-chap="${esc(a.chapter)}" onclick="launchChapterBtn(this)">Re-Attempt</button>`:''}
              <button type="button" class="icon-btn" onclick="deleteAttempt('${a.id}')">×</button>
            </div>
          </div>`;
        }).join('') : '<div class="empty">Complete a quiz to save chapter-wise attempt history here.</div>'}
      </div>

      <div class="card">
        <h3>Chapter-Wise Accuracy Summary</h3>
        ${chapSummaryList.length ? chapSummaryList.map(cs=>`
          <div class="list-item" style="flex-direction:column;align-items:stretch;gap:6px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>${esc(cs.chapter)}</b>
              <span class="tag ${cs.acc>=75?'green':'gold'}">${cs.acc}% • ${cs.count} attempt(s)</span>
            </div>
            <div class="bar"><span style="width:${cs.acc}%"></span></div>
          </div>
        `).join('') : '<div class="empty">Chapter accuracy stats appear once you complete quizzes.</div>'}
      </div>
    </div>
  ` : `
    <div class="two-col">
      <div class="card">
        <h3>Mistake Re-Test Queue (${openMistakes.length} Open)</h3>
        ${curRetest ? `
          <span class="tag">${esc(curRetest.subject)} • ${esc(curRetest.chapter)} • ${curRetest.date}</span>
          <div style="margin-top:10px;font-size:12px;color:#777682">ERROR LOGGED:</div>
          <p style="font-size:13px;font-weight:700;line-height:1.6;margin:4px 0 12px">${esc(curRetest.error)}</p>
          ${curRetest.fix?`<div class="ai-reply-box"><b>True Answer & Fix:</b>\n${esc(curRetest.fix)}</div>`:''}
          <p class="muted" style="font-size:11px;margin-top:8px">Fix loop: 2× “Solved” in a row closes it (streak now ${curRetest.fixStreak||0}/2). Still Tricky resets the streak.</p>
          <div class="actions" style="margin-top:14px">
            <button type="button" class="btn" style="background:#1b6e4d" onclick="retestResult('${curRetest.id}',true)">✓ Solved (${(curRetest.fixStreak||0)+1}/2)</button>
            <button type="button" class="btn secondary" onclick="retestResult('${curRetest.id}',false)">↺ Still Tricky — Next</button>
          </div>
        ` : '<div class="empty">No open mistakes in Re-Test queue. Great job!</div>'}
      </div>
      <div class="card">
        <h3>Open Mistakes List</h3>
        ${openMistakes.length?openMistakes.slice().reverse().map(m=>`<div class="list-item"><div><b>${esc(m.chapter)}</b><div class="muted">${esc(m.subject)} • ${esc(m.error.slice(0,75))}</div></div><div class="actions"><span class="tag">${esc(m.type)}</span><button type="button" class="btn secondary" style="padding:4px 8px;font-size:10px" onclick="focusMistakeRetest('${m.id}')">Fix</button></div></div>`).join(''):'<div class="empty">All logged mistakes are fixed.</div>'}
      </div>
    </div>
  `}
  `;
}

window.buildTutorPrompt=(mode)=>{
  const sub=document.getElementById('aiSub')?.value||'Biology';
  const chap=document.getElementById('aiChap')?.value.trim()||'NCERT Chapter';
  const topic=document.getElementById('aiTopic')?.value.trim()||'High-yield NEET concepts & PYQs';
  const count=document.getElementById('aiCount')?.value||'10';
  let prompt='';
  if(mode==='json_quiz'){
    prompt=`Act as a NEET exam question maker for ${sub} (Chapter: "${chap}", Topic: "${topic}"). Create ${count} NCERT-aligned multiple choice questions. Return ONLY a valid JSON array in this exact schema with no extra text:\n[{"subject":"${sub}","chapter":"${chap}","q":"Question text","opts":["Option A","Option B","Option C","Option D"],"ans":0,"mark":"Imp","exp":"Short clear explanation"}]`;
  }else if(mode==='doubt'){
    prompt=`Explain "${topic}" from ${sub} (${chap}) for a NEET aspirant. Keep it crisp, highlight NCERT traps or common formula mistakes, and give 2 quick check questions at the end.`;
  }else{
    const openErrs=db.mistakes.filter(m=>!m.closed).slice(-5).map(m=>`- [${m.subject} - ${m.chapter}] ${m.error}`).join('\n') || '- Focus on NCERT exceptions and numerical speed.';
    prompt=`Here are my recent NEET mistakes:\n${openErrs}\n\nCreate a focused practice plan and 8 MCQs targeting these exact weak points in JSON format:\n[{"subject":"${sub}","chapter":"${chap}","q":"Question","opts":["A","B","C","D"],"ans":0,"mark":"Hard","exp":"Why this is right"}]`;
  }
  const box=document.getElementById('aiPromptBox');
  if(box)box.textContent=prompt;
  return prompt;
};

window.copyTutorPrompt=()=>{
  const txt=document.getElementById('aiPromptBox')?.textContent||'';
  if(!txt)return;
  navigator.clipboard?.writeText(txt).then(()=>toast('Prompt copied! Paste into Gemini, ChatGPT, or Claude.')).catch(()=>toast('Select and copy prompt from box.'));
};

window.saveGeminiKey=()=>{
  const inp=document.getElementById('geminiKeyInput');
  if(!inp)return;
  db.settings.geminiKey=inp.value.trim();
  save();
  toast(db.settings.geminiKey?'Gemini API key saved locally.':'API key cleared.');
};

window.runGeminiDirect=async()=>{
  const prompt=document.getElementById('aiPromptBox')?.textContent||'';
  if(!(db.settings.geminiKey||'').trim()){toast('Add a Gemini API key first or use Copy Prompt.');return}
  if(!prompt)return;
  aiOutput='Thinking...';
  render();
  try{
    aiOutput=await callGemini(prompt);
  }catch(e){
    const msg=String(e.message||e);
    aiOutput=msg==='NO_KEY'
      ?'Add a Gemini API key (Google AI Studio → free key).'
      :('Gemini error: '+msg+'\n\nYou can still Copy Prompt into ChatGPT / Claude.');
  }
  render();
};
window.importAiOutputAsQuiz=()=>{
  try{
    const cleaned=parseQuizJsonText(aiOutput||'');
    db.quizzes=db.quizzes||[];
    db.quizzes.push(...cleaned);
    save();
    const chapters=[...new Set(cleaned.map(x=>x.chapter))];
    beginQuizSession(cleaned,{subject:cleaned[0].subject||'Mixed',chapter:chapters.length===1?chapters[0]:'Mixed Chapters'});
    toast(`${cleaned.length} MCQs from AI → quiz started`);
  }catch(err){
    const why=String(err&&err.message||err);
    toast('Import fail: '+why);
    console.warn('importAiOutputAsQuiz',err);
  }
};

function aiTutorView(){
  title('AI Tutor');
  const defaultPrompt=`Act as a NEET exam question maker for Biology (Chapter: "Cell Cycle", Topic: "Meiosis"). Create 8 NCERT-aligned MCQs. Return ONLY a valid JSON array:\n[{"subject":"Biology","chapter":"Cell Cycle","q":"Question","opts":["A","B","C","D"],"ans":0,"mark":"Imp","exp":"Explanation"}]`;
  return `<div class="two-col">
    <div class="card">
      <h3>NEET Prompt & Quiz Builder</h3>
      <div class="form-grid">
        <div class="field"><label>SUBJECT</label><select id="aiSub"><option>Biology</option><option>Chemistry</option><option>Physics</option></select></div>
        <div class="field"><label>NO. OF MCQS</label><input id="aiCount" type="number" min="3" max="30" value="10"></div>
      </div>
      <div class="field"><label>CHAPTER</label><input id="aiChap" placeholder="e.g. Thermodynamics / Biomolecules"></div>
      <div class="field"><label>TOPIC / DOUBT / PDF CONTEXT</label><input id="aiTopic" placeholder="e.g. Exceptions, formulas, or paste topic name"></div>
      <div class="actions" style="margin-top:10px">
        <button type="button" class="btn" onclick="buildTutorPrompt('json_quiz')">Build Quiz JSON Prompt</button>
        <button type="button" class="btn secondary" onclick="buildTutorPrompt('doubt')">Build Doubt Prompt</button>
        <button type="button" class="btn ghost" onclick="buildTutorPrompt('mistake_fix')">Mistake-Based Quiz</button>
      </div>
      <div class="field" style="margin-top:14px">
        <label>GENERATED PROMPT (COPY TO GEMINI / GPT / CLAUDE OR RUN DIRECTLY)</label>
        <div id="aiPromptBox" class="prompt-preview">${esc(defaultPrompt)}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn secondary" onclick="copyTutorPrompt()">📋 Copy Prompt</button>
        <button type="button" class="btn" onclick="runGeminiDirect()">✦ Ask Gemini</button>
        ${aiOutput?`<button type="button" class="btn" style="background:#1b6e4d" onclick="importAiOutputAsQuiz()">📥 Import AI → Quiz</button>`:''}
      </div>
      ${aiOutput?`<div class="ai-reply-box">${esc(aiOutput)}</div>`:''}
    </div>

    <div class="card">
      <h3>Gemini key (sirf is device pe)</h3>
      <div class="field">
        <label>GEMINI API KEY</label>
        <input type="password" id="geminiKeyInput" value="${esc(db.settings.geminiKey||'')}" placeholder="AIza... from Google AI Studio">
      </div>
      <button type="button" class="btn secondary" onclick="saveGeminiKey()">Save Key</button>
      <p class="muted" style="font-size:10px;line-height:1.65;margin-top:14px">
        Free key: <b>aistudio.google.com</b> → Get API key → yahan paste → Save.<br>
        Key kabhi code/GitHub mein share mat karna. Vault card pe <b>⚡ Quiz</b> ab isi key se MCQ bana sakta hai.<br>
        Bina key ke: Copy Prompt → ChatGPT/Gemini web → JSON → Practice paste, ya yahan Import AI → Quiz.
      </p>
    </div>
  </div>`;
}

window.refreshMistakeChapterOptions=(subVal)=>{
  const sel=document.getElementById('mistakeChapterSelect');
  const inp=document.getElementById('mistakeChapterInput');
  if(!sel)return;
  const list=getChaptersForSubject(subVal||'Physics');
  sel.innerHTML=list.map(ch=>`<option value="${esc(ch)}">${esc(ch)}</option>`).join('');
  if(inp && !inp.value.trim() && list.length)inp.value=list[0];
};

window.onMistakeChapterPick=(val)=>{
  const inp=document.getElementById('mistakeChapterInput');
  if(inp)inp.value=val;
};

window.toggleMistakeGroup=el=>{const k=el.dataset.key;if(el.open)mistakeOpenGroups.add(k);else mistakeOpenGroups.delete(k)};
function mistakeItemHTML(m){
  const isWrongMcq=!m.closed && String(m.error||'').includes('Wrong MCQ');
  return `<div class="list-item" style="align-items:flex-start;${isWrongMcq?'background:#2a0d14;border:1px solid #8f1e2b':''}">
          <div>
            <b>${esc(m.chapter)}</b> ${isWrongMcq?'<span class="tag" style="background:#5e141f;color:#fca5a5;border-color:#ef4444">WRONG MCQ</span>':''}
            <div class="muted" style="margin:4px 0">${esc(m.subject)} • ${esc(m.type)}${m.whyNote?` (${esc(m.whyNote)})`:''} • ${m.date}</div>
            <div style="${isWrongMcq?'color:#fecaca;font-weight:600':''}">${esc(m.error)}</div>
            ${m.fix?`<div style="color:#86efac;margin-top:5px"><b>True Answer / Fix:</b> ${esc(m.fix)}</div>`:''}
            <div class="actions" style="margin-top:8px">
              ${!m.closed?`<button type="button" class="btn" style="padding:6px 10px" onclick="focusMistakeRetest('${m.id}')">↺ Fix loop</button>`:''}
              <button type="button" class="btn ${m.closed?'ghost':'secondary'}" style="padding:6px 10px" onclick="toggleMistake('${m.id}')">${m.closed?'↺ Reopen':'✓ Mark fixed'}</button>
              ${m.fileId?`<button type="button" class="btn ghost" style="padding:6px 10px" onclick="previewFile('${m.fileId}')">📎 View ${m.fileType==='application/pdf'?'PDF':'Screenshot'}</button>`:''}
            </div>
          </div>
          <button type="button" class="icon-btn" onclick="deleteMistake('${m.id}')">×</button>
        </div>`;
}
function mistakeGroupsHTML(ml){
  const g={};
  ml.slice().reverse().forEach(m=>{
    const ch=String(m.chapter||'General').trim()||'General';
    const k=mistakeTab+'|'+(m.subject||'')+'|'+ch.toLowerCase();
    (g[k]=g[k]||{key:k,subject:m.subject||'',chapter:ch,list:[]}).list.push(m);
  });
  const arr=Object.values(g).sort((a,b)=>b.list.length-a.list.length||a.chapter.localeCompare(b.chapter));
  return `<div class="muted" style="font-size:10px;margin-bottom:10px">${ml.length} ${mistakeTab==='open'?'wrong':'fixed'} • ${arr.length} chapters (chapter pe tap karke kholo)</div>`
    +arr.map(x=>`<details class="group" data-key="${esc(x.key)}" ${mistakeOpenGroups.has(x.key)?'open':''} ontoggle="toggleMistakeGroup(this)"><summary><span><b>📂 ${esc(x.chapter)}</b> <span class="muted" style="font-size:10px">${esc(x.subject)}</span></span><span class="tag ${mistakeTab==='open'?'':'green'}">${x.list.length} ${mistakeTab==='open'?'wrong':'fixed'}</span></summary><div class="group-body">${x.list.map(mistakeItemHTML).join('')}</div></details>`).join('');
}

function mistakes(){
  title('Mistake Hunter');
  const TYPE_LIST=['All','Calculation','Silly mistake','Concept gap','Lack of revision','Not reading properly','Formula recall','Misread question','Memory / NCERT','Time management','Untagged','Other'];
  const SUB_LIST=['All','Physics','Chemistry','Biology'];
  const mo=db.mistakes.filter(x=>!x.closed),mc=db.mistakes.filter(x=>x.closed);
  let ml=mistakeTab==='open'?mo:mc;
  if(mistakeSubjectFilter!=='All')ml=ml.filter(m=>String(m.subject||'')===mistakeSubjectFilter);
  if(mistakeTypeFilter!=='All'){
    ml=ml.filter(m=>{
      const t=m.type||'Untagged';
      if(mistakeTypeFilter==='Untagged')return !m.type||m.type==='Untagged';
      return t===mistakeTypeFilter;
    });
  }
  const typeCounts={};
  (mistakeTab==='open'?mo:mc).forEach(m=>{
    const t=m.type||'Untagged';
    typeCounts[t]=(typeCounts[t]||0)+1;
  });
  const initChapters=getChaptersForSubject('Physics');
  const reviewQs=(db.quizzes||[]).filter(q=>q.review);
  return `<div class="section-head"><h2>Turn errors into insight</h2><small>${db.mistakes.length} RECORDS</small></div>
  <div class="card" style="margin-bottom:14px">
    <div class="section-head" style="margin-top:0"><h3>Filter by type / subject</h3><small>CALCULATION • CONCEPT • …</small></div>
    <div class="actions" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">
      ${SUB_LIST.map(s=>`<button type="button" class="btn ${mistakeSubjectFilter===s?'':'ghost'}" style="padding:5px 10px;font-size:11px" onclick="setMistakeSubjectFilter('${s}')">${s}${s==='All'?'':''}</button>`).join('')}
    </div>
    <div class="actions" style="flex-wrap:wrap;gap:6px">
      ${TYPE_LIST.map(t=>{
        const c=t==='All'?(mistakeTab==='open'?mo:mc).length:(typeCounts[t]||0);
        return `<button type="button" class="btn ${mistakeTypeFilter===t?'':'ghost'}" style="padding:5px 10px;font-size:11px" onclick="setMistakeTypeFilter(${JSON.stringify(t)})">${t} <b>${c}</b></button>`;
      }).join('')}
    </div>
    <div class="actions" style="margin-top:12px;flex-wrap:wrap">
      <button type="button" class="btn" ${ml.length?'':'disabled style="opacity:.5"'} onclick="startMistakeTypeQuiz()">Practice filtered mistakes (${ml.length})</button>
      ${reviewQs.length?`<button type="button" class="btn secondary" onclick="startReviewMarkedQuiz()">🚩 Review marked Qs (${reviewQs.length})</button>`:''}
    </div>
  </div>
  <div class="two-col">
    <div class="card">
      <h3>Record a mistake</h3>
      <form id="mistakeForm">
        <div class="form-grid">
          <div class="field"><label>SUBJECT</label><select name="subject" id="mistakeSubSelect" onchange="refreshMistakeChapterOptions(this.value)"><option>Physics</option><option>Chemistry</option><option>Biology</option></select></div>
          <div class="field"><label>ERROR TYPE</label><select name="type"><option>Silly mistake</option><option>Concept gap</option><option>Lack of revision</option><option>Not reading properly</option><option>Calculation</option><option>Formula recall</option><option>Misread question</option><option>Memory / NCERT</option><option>Time management</option><option>Other</option></select></div>
        </div>
        <div class="field">
          <label>SELECT CHAPTER (ALL SUBJECTS SUPPORTED)</label>
          <select id="mistakeChapterSelect" onchange="onMistakeChapterPick(this.value)">
            ${initChapters.map(ch=>`<option value="${esc(ch)}">${esc(ch)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>CHAPTER / TOPIC (SELECTED OR CUSTOM)</label><input name="chapter" id="mistakeChapterInput" value="${esc(initChapters[0]||'')}" required placeholder="Chapter name"></div>
        <div class="field"><label>WHAT WENT WRONG?</label><textarea name="error" required placeholder="Describe the error briefly..."></textarea></div>
        <div class="field"><label>CORRECT APPROACH / TAKEAWAY</label><textarea name="fix" placeholder="What will you remember next time?"></textarea></div>
        <div class="field"><label>ATTACH QUESTION SCREENSHOT / PDF (OPTIONAL)</label><input type="file" name="attachment" accept="image/*,application/pdf"></div>
        <button type="submit" class="btn">＋ Save mistake</button>
      </form>
    </div>
    <div class="card">
      <h3>Learning log ${mistakeTypeFilter!=='All'||mistakeSubjectFilter!=='All'?`<span class="tag blue" style="font-size:10px">${mistakeSubjectFilter!=='All'?mistakeSubjectFilter+' • ':''}${mistakeTypeFilter!=='All'?mistakeTypeFilter:''}</span>`:''}</h3>
      ${tabsHTML(mistakeTab,mo.length,mc.length,'setMistakeTab')}
      ${ml.length?mistakeGroupsHTML(ml):`<div class="empty">${mistakeTab==='open'?'No open mistakes for this filter.':'Nothing closed yet for this filter.'}</div>`}
    </div>
  </div>`;
}
window.setMistakeTypeFilter=t=>{mistakeTypeFilter=t;render()};
window.setMistakeSubjectFilter=s=>{mistakeSubjectFilter=s;render()};
window.startMistakeTypeQuiz=()=>{
  let list=db.mistakes.filter(x=>!x.closed);
  if(mistakeSubjectFilter!=='All')list=list.filter(m=>String(m.subject||'')===mistakeSubjectFilter);
  if(mistakeTypeFilter!=='All'){
    list=list.filter(m=>{
      const t=m.type||'Untagged';
      if(mistakeTypeFilter==='Untagged')return !m.type||m.type==='Untagged';
      return t===mistakeTypeFilter;
    });
  }
  if(!list.length){toast('Is filter pe open mistake nahi hai.');return}
  const bank=db.quizzes||[];
  const rebuilt=[];
  list.forEach(m=>{
    const matched=bank.find(q=> (m.error||'').includes((q.q||'').slice(0,40)) );
    if(matched){rebuilt.push({...matched});return}
    // fallback synthetic card from mistake text
    rebuilt.push({
      id:crypto.randomUUID(),
      subject:m.subject||'Biology',
      chapter:m.chapter||'Mistake Practice',
      q: (m.error||'Revise this mistake').replace(/^Wrong MCQ\s*\[[^\]]*\]:\s*/,'').split('|')[0].trim() || 'Revise this concept',
      opts:['I remember now','Still confused','Need NCERT check','Re-attempt later'],
      ans:0,
      mark:'Hard',
      exp:m.fix||'Fix this error before next mock.',
      topic:m.type||''
    });
  });
  beginQuizSession(rebuilt,{subject:mistakeSubjectFilter==='All'?'Mixed':mistakeSubjectFilter,chapter:`Mistakes • ${mistakeTypeFilter}`});
  navigate('practice');
  toast(`${rebuilt.length} mistake-based Qs started`);
};
window.startReviewMarkedQuiz=()=>{
  const pool=(db.quizzes||[]).filter(q=>q.review);
  if(!pool.length){toast('Koi question review ke liye marked nahi.');return}
  beginQuizSession(pool.map(q=>({...q})),{subject:'Mixed',chapter:'🚩 Marked for Review'});
  navigate('practice');
  toast(`Review set: ${pool.length} Qs`);
};

window.deleteMistake=async(id)=>{
  const m=db.mistakes.find(x=>x.id===id);
  if(m&&m.fileId)await deleteStoredFile(m.fileId);
  db.mistakes=db.mistakes.filter(x=>x.id!==id);
  save();render();toast('Mistake removed.');
};

window.setVaultFilter=f=>{vaultFilter=f;vaultChapterFilter='All';render()};
window.setVaultChapterFilter=ch=>{vaultChapterFilter=ch;render()};
window.toggleVaultGroup=el=>{const k=el.dataset.key;if(el.open)vaultOpenGroups.add(k);else vaultOpenGroups.delete(k)};
function chapterOptionsHTML(sub,selected=''){
  const list=(sub&&sub!=='Formula / Notes')?getChaptersForSubject(sub):[];
  return '<option value="">— General (no chapter) —</option>'+list.map(ch=>`<option value="${esc(ch)}" ${ch===selected?'selected':''}>${esc(ch)}</option>`).join('');
}
window.refreshVaultChapters=sub=>{const sel=document.getElementById('vaultChapterSelect');if(sel)sel.innerHTML=chapterOptionsHTML(sub)};
window.openVaultLink=id=>{
  const v=(db.vault||[]).find(x=>x.id===id);
  if(v&&/^https?:\/\//i.test(v.link||''))window.open(v.link,'_blank','noopener');
};
window.openVaultItem=id=>{
  const v=(db.vault||[]).find(x=>x.id===id);
  if(!v)return;
  if(v.fileId)previewFile(v.fileId);else openVaultLink(id);
};
window.deleteVaultItem=async(id)=>{
  const item=(db.vault||[]).find(x=>x.id===id);
  if(item&&item.fileId)await deleteStoredFile(item.fileId);
  db.vault=(db.vault||[]).filter(x=>x.id!==id);
  save();render();toast('File removed from Study Vault.');
};

function vaultCardHTML(v){
  return `
          <div class="vault-card">
            <div class="vault-thumb" onclick="openVaultItem('${v.id}')">
              <div class="pdf-badge">${!v.fileId?'🔗 ONLINE LINK (DRIVE)':(v.fileType==='application/pdf'?'📄 PDF DOCUMENT':'🖼 SCREENSHOT / IMAGE')}<div style="font-size:9px;color:#8f8d99;margin-top:4px;text-align:center">Tap to open</div></div>
            </div>
            <div>
              <b style="font-size:12px;display:block">${esc(v.title)}</b>
              <div class="muted" style="font-size:10px;margin-top:3px">${esc(v.subject)}${v.chapter?' • '+esc(v.chapter):''} • ${esc(v.category)}</div>
            </div>
            <div class="actions" style="margin-top:auto;flex-wrap:wrap">
              <button type="button" class="btn secondary" style="flex:1;padding:6px" onclick="openVaultItem('${v.id}')">Open</button>
              <button type="button" class="btn" style="flex:1;padding:6px" onclick="vaultMakeQuiz('${v.id}')">⚡ Quiz</button>
              ${v.fileId&&v.link?`<button type="button" class="icon-btn" style="padding:5px 9px" title="Open Drive link" onclick="openVaultLink('${v.id}')">🔗</button>`:''}
              <button type="button" class="icon-btn" style="padding:5px 9px" onclick="deleteVaultItem('${v.id}')">×</button>
            </div>
          </div>
        `;
}

function vault(){
  title('Study Vault');
  const all=db.vault||[];
  const subjects4=['Physics','Chemistry','Biology','Formula / Notes'];
  const hasChapters=vaultFilter!=='All'&&vaultFilter!=='Formula / Notes';
  const chapList=hasChapters?getChaptersForSubject(vaultFilter):[];
  const cnt=ch=>all.filter(v=>v.subject===vaultFilter&&(v.chapter||'')===ch).length;
  const items=all.filter(v=>(vaultFilter==='All'||v.subject===vaultFilter)&&(vaultChapterFilter==='All'||(v.chapter||'')===vaultChapterFilter));
  const formSubject=subjects4.includes(vaultFilter)?vaultFilter:'Physics';
  const formChapter=hasChapters&&vaultChapterFilter!=='All'?vaultChapterFilter:'';
  const groups={};
  items.slice().reverse().forEach(v=>{const k=(v.subject||'')+'||'+(v.chapter||'');(groups[k]=groups[k]||{subject:v.subject||'',chapter:v.chapter||'',list:[]}).list.push(v)});
  const gl=Object.values(groups).sort((a,b)=>subjects4.indexOf(a.subject)-subjects4.indexOf(b.subject)||a.chapter.localeCompare(b.chapter));
  return `<div class="section-head">
    <h2>NEET Material, Screenshots & PDFs</h2>
    <div class="actions">
      ${['All','Physics','Chemistry','Biology','Formula / Notes'].map(f=>`<button type="button" class="btn ${vaultFilter===f?'':'secondary'}" style="padding:6px 10px" onclick="setVaultFilter('${f}')">${f}</button>`).join('')}
    </div>
  </div>
  <div class="two-col">
    <div class="card">
      <h3>Upload Study Material</h3>
      <form id="vaultForm">
        <div class="field"><label>TITLE / TOPIC NAME</label><input name="title" required placeholder="e.g. Organic Named Reactions Mindmap"></div>
        <div class="form-grid">
          <div class="field"><label>SUBJECT</label><select name="subject" onchange="refreshVaultChapters(this.value)">${subjects4.map(x=>`<option ${x===formSubject?'selected':''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label>CATEGORY</label><select name="category"><option>Screenshot / Diagram</option><option>Short Notes PDF</option><option>DPP / Question Bank</option><option>NCERT Highlight</option><option>KPP</option><option>Allen Module</option><option>Assignment</option><option>Question Bank</option><option>JEE Mains PYQ</option><option>NEET PYQ</option><option>Error Less Book</option></select></div>
        </div>
        <div class="field"><label>CHAPTER</label><select name="chapter" id="vaultChapterSelect">${chapterOptionsHTML(formSubject,formChapter)}</select></div>
        <div class="field"><label>SELECT IMAGE OR PDF</label><input type="file" name="file" accept="image/*,application/pdf"></div>
        <div class="field"><label>OR DRIVE / ONLINE LINK (OPTIONAL)</label><input name="link" type="url" placeholder="https://drive.google.com/..."></div>
        <button type="submit" class="btn">⬆ Save to Study Vault</button>
      </form>
      <p class="muted" style="font-size:10px;line-height:1.6;margin-top:14px">Files are stored offline inside your browser's IndexedDB so large PDFs and screenshots load instantly without slowing down the app.</p>
    </div>
    <div class="card">
      <h3>Saved Files (${items.length})</h3>
      ${items.length?`<div class="muted" style="font-size:10px;margin-bottom:10px">${items.length} files • ${gl.length} chapters (chapter pe tap karke files kholo)</div>`+gl.map(g=>{const k=(g.subject||'')+'||'+(g.chapter||'');return `<details class="group" data-key="${esc(k)}" ${vaultOpenGroups.has(k)?'open':''} ontoggle="toggleVaultGroup(this)"><summary><span><b>📘 ${esc(g.chapter||'General')}</b> <span class="muted" style="font-size:10px">${esc(g.subject)}</span></span><span class="tag green">${g.list.length} files</span></summary><div class="group-body" style="padding:12px"><div class="vault-grid">${g.list.map(vaultCardHTML).join('')}</div></div></details>`}).join(''):'<div class="empty">No screenshots or PDFs uploaded yet. Add your first formula sheet or question screenshot.</div>'}
    </div>
  </div>`;
}

const REV_STEPS=[['r3','+3d',3],['r7','+7d',7],['r21','+21d',21]];

function revisionScheduleDates(r){
  const base=r.date||today();
  const d3=r.r3||addDays(base,3);
  const d7=r.r7||addDays(base,7);
  const d21=r.r21||addDays(base,21);
  return {d3,d7,d21};
}

/** First milestone (+3 → +7 → +21) not yet marked done, with its due date and status. */
function revisionPending(r){
  const dates=revisionScheduleDates(r);
  const ms=r.milestones||{};
  const t=today();
  for(const [key,label,gap] of REV_STEPS){
    if(!ms[key]){
      const date=dates['d'+gap];
      return {key,label,gap,date,state:date<t?'red':date===t?'today':'upcoming',late:Math.max(0,daysBetween(date,t))};
    }
  }
  return null;
}

/** Entries whose current milestone is due today or overdue (red zone). Red zone first, oldest first. */
function dueRevisionsList(){
  return db.revisions
    .map(r=>({...r,pending:revisionPending(r)}))
    .filter(r=>r.pending&&(r.pending.state==='red'||r.pending.state==='today'))
    .map(r=>({...r,dueDates:[{key:r.pending.key,date:r.pending.date,label:r.pending.label}]}))
    .sort((a,b)=>a.pending.date.localeCompare(b.pending.date));
}

window.markRevisionDone=id=>{
  const r=db.revisions.find(x=>x.id===id);
  if(!r)return;
  const p=revisionPending(r);
  if(!p){toast('Is chapter ke teeno revisions complete hain 🎉');return}
  const t=today();
  if(p.date>t){toast(`Ye revision ${shortDate(p.date)} ko due hai.`);return}
  r.milestones=r.milestones||{};
  r.milestones[p.key]=t;
  r.lastRevised=t;
  let msg='Revision done ✅';
  if(p.state==='red'){
    // late: aage ki dates us din se re-base (3-7-21 rule done-date se)
    const moved=[];
    for(const [key,label,gap] of REV_STEPS){
      if(r.milestones[key])continue;
      r[key]=addDays(t,gap);
      moved.push(`${label} → ${shortDate(r[key])}`);
    }
    r.rebasedOn=t;
    msg=moved.length?`Red zone se bahar ✅ — aage ki dates aaj se: ${moved.join(', ')}`:'Red zone se bahar ✅ — revision cycle complete 🎉';
  }else{
    const n=revisionPending(r);
    msg=n?`Done ✅ — next ${n.label}: ${shortDate(n.date)}`:'Done ✅ — revision cycle complete 🎉';
  }
  save();
  render();
  toast(msg);
};

function revChipsHTML(r){
  const dates=revisionScheduleDates(r);
  const ms=r.milestones||{};
  const p=revisionPending(r);
  return REV_STEPS.map(([key,label,gap])=>{
    const d=dates['d'+gap];
    if(ms[key])return `<span class="tag green">${label} ✓ ${shortDate(ms[key])}</span>`;
    if(p&&p.key===key&&p.state==='red')return `<span class="tag red">${label} ☠ ${shortDate(d)}</span>`;
    if(p&&p.key===key&&p.state==='today')return `<span class="tag gold">${label} • aaj</span>`;
    return `<span class="tag">${label} • ${shortDate(d)}</span>`;
  }).join(' ');
}

function revDueRowHTML(r,red){
  const p=r.pending;
  const status=red?`${p.label} • due ${shortDate(p.date)} • <b style="color:#fca5a5">${p.late} din late ☠️</b>`:`${p.label} • due aaj`;
  return `<div class="list-item" style="align-items:flex-start"><div><b>${esc(r.chapter)}</b> <span class="tag blue">${esc(r.subject)}</span><div class="muted" style="margin-top:3px">Logged ${shortDate(r.date)} • ${status}</div></div><button type="button" class="btn" style="padding:6px 10px;white-space:nowrap" onclick="markRevisionDone('${r.id}')">✅ Done</button></div>`;
}

function revision(){
  title('Revision Log');
  const dueList=dueRevisionsList();
  const red=dueList.filter(r=>r.pending.state==='red');
  const dueToday=dueList.filter(r=>r.pending.state==='today');
  const hist=allRevs();
  return `<div class="section-head"><h2>Revision Tracker</h2><small>SPACED REVISION RECORD (+3 / +7 / +21 DAYS)</small></div>
  <div class="card red-zone" style="margin-bottom:14px">
    <div class="section-head" style="margin-top:0"><h3>🟥 Red Zone ☠️ (${red.length})</h3><span class="tag red">MISSED</span></div>
    <p class="muted" style="font-size:11px;margin-bottom:8px">Due date tak revision complete nahi hua to yaha aata hai. ✅ Done karte hi aage ki dates (+7 / +21) us din se re-set ho jati hain.</p>
    ${red.length?red.map(r=>revDueRowHTML(r,true)).join(''):'<div class="empty">Red zone clear hai 💪</div>'}
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="section-head" style="margin-top:0"><h3>Due Today (${dueToday.length})</h3><span class="tag gold">SPACED DUE</span></div>
    ${dueToday.length?dueToday.map(r=>revDueRowHTML(r,false)).join(''):'<div class="empty">Aaj koi revision due nahi.</div>'}
  </div>
  <div class="two-col"><div class="card"><h3>Log a revision session</h3><form id="revisionForm"><div class="field"><label>CHAPTER / TOPIC</label><input name="chapter" required placeholder="e.g. Human Reproduction"></div><div class="form-grid"><div class="field"><label>SUBJECT</label><select name="subject"><option>Biology</option><option>Chemistry</option><option>Physics</option></select></div><div class="field"><label>REVISION TYPE</label><select name="kind"><option>Short notes</option><option>NCERT</option><option>Active recall</option><option>Questions / PYQs</option><option>Full chapter</option></select></div></div><button class="btn">Save revision</button></form></div><div class="card"><h3>Revision history</h3>${hist.length?hist.slice(0,60).map(r=>{const rec=r.id?db.revisions.find(x=>x.id===r.id):db.revisions.find(x=>x.chapter===r.chapter&&x.date===r.date);const p=rec?revisionPending(rec):null;const isRed=p&&p.state==='red';return `<div class="list-item" style="align-items:flex-start"><div><b>${esc(r.chapter)}</b> ${isRed?'<span class="tag red">RED ZONE ☠️</span>':''}<div class="muted" style="margin:3px 0 5px">${esc(r.subject)} • ${esc(r.kind)}</div>${rec?revChipsHTML(rec):''}</div><span>${shortDate(r.date)}</span></div>`}).join(''):'<div class="empty">Your revision history will appear here.</div>'}</div></div>`;
}

window.autoCalcMockScore=()=>{
  const f=document.getElementById('testForm');
  if(!f)return;
  const p=Number(f.physics?.value||0);
  const c=Number(f.chemistry?.value||0);
  const b=Number(f.biology?.value||0);
  if(p>0 || c>0 || b>0){
    f.score.value=Math.min(720,p+c+b);
  }
};

function daysUntil(iso){
  const [y,m,d]=String(iso).split('-').map(Number);
  const t=new Date(y,(m||1)-1,d||1).getTime();
  const n=new Date();
  const t0=new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime();
  return Math.round((t-t0)/86400000);
}
function upcomingTestsHTML(){
  const list=(db.upcomingTests||[]).slice().sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
  const chip=n=>n<0?`<span class="tag">Passed ${-n}d ago</span>`:n===0?'<span class="tag">TODAY</span>':n===1?'<span class="tag gold">Tomorrow</span>':`<span class="tag blue">in ${n} days</span>`;
  return `<div class="section-head" style="margin-top:6px"><h2>Upcoming tests</h2><small>DATE • SYLLABUS</small></div>
  <div class="two-col" style="margin-bottom:22px">
    <div class="card">
      <h3>Add upcoming test</h3>
      <form id="upcomingForm">
        <div class="field"><label>TEST NAME</label><input name="name" required placeholder="e.g. Allen Part Test 03"></div>
        <div class="form-grid">
          <div class="field"><label>TEST DATE</label><input name="date" type="date" required></div>
          <div class="field"><label>TIME (OPTIONAL)</label><input name="time" type="time"></div>
        </div>
        <div class="field"><label>SYLLABUS / TOPICS (TEXT)</label><textarea name="syllabus" placeholder="e.g. Physics: Kinematics, Laws of Motion | Chem: Mole concept | Bio: Cell cycle"></textarea></div>
        <div class="field"><label>SYLLABUS FILE (IMAGE OR PDF, OPTIONAL)</label><input type="file" name="file" accept="image/*,application/pdf"></div>
        <button type="submit" class="btn">＋ Add upcoming test</button>
      </form>
    </div>
    <div class="card">
      <h3>Scheduled (${list.length})</h3>
      ${list.length?list.map(t=>`<div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div><b style="font-size:12px">${esc(t.name)}</b><div class="muted" style="font-size:10px;margin-top:3px">${dateText(t.date)}${t.time?' • '+esc(t.time):''}</div></div>
          ${chip(daysUntil(t.date))}
        </div>
        ${t.syllabus?`<div class="muted" style="font-size:11px;line-height:1.6;white-space:pre-wrap">${esc(t.syllabus)}</div>`:''}
        <div class="actions">
          ${t.fileId?`<button type="button" class="btn secondary" style="padding:6px 10px" onclick="previewFile('${t.fileId}')">📎 Open syllabus file</button>`:''}
          <button type="button" class="icon-btn" style="padding:5px 9px" onclick="deleteUpcomingTest('${t.id}')">×</button>
        </div>
      </div>`).join(''):'<div class="empty">No upcoming test added yet. Date aur syllabus daal do.</div>'}
    </div>
  </div>`;
}
window.deleteUpcomingTest=async id=>{
  const t=(db.upcomingTests||[]).find(x=>x.id===id);
  if(t&&t.fileId)await deleteStoredFile(t.fileId);
  db.upcomingTests=(db.upcomingTests||[]).filter(x=>x.id!==id);
  save();render();toast('Upcoming test removed.');
};

window.toggleTestAnalysis=id=>{const t=db.tests.find(x=>x.id===id);if(t){t.analysisDone=!t.analysisDone;save();render()}};
window.removeTest=async id=>{
  const t=db.tests.find(x=>x.id===id);
  if(t&&t.fileId)await deleteStoredFile(t.fileId);
  db.tests=db.tests.filter(x=>x.id!==id);
  save();render();toast('Record removed.');
};

function getMockPoolPreview(){
  const bank=db.quizzes||[];
  const openMistakes=db.mistakes.filter(m=>!m.closed);
  const subSet=new Set((mockBuild.subjects||[]).map(s=>s.toLowerCase()));
  const chapSet=new Set((mockBuild.chapters||[]).map(c=>String(c).trim()));
  const matchChap=q=>{
    if(!chapSet.size)return true; // empty = all
    return chapSet.has(String(q.chapter||'').trim());
  };
  const matchSub=q=>subSet.has(String(q.subject||'').trim().toLowerCase());
  let pool=[];
  if(mockBuild.source==='bank'||mockBuild.source==='both'){
    pool.push(...bank.filter(q=>matchSub(q)&&matchChap(q)));
  }
  if(mockBuild.source==='mistakes'||mockBuild.source==='both'){
    const fromMistakes=bank.filter(q=>{
      if(!matchSub(q)||!matchChap(q))return false;
      return openMistakes.some(m=>{
        const blob=`${m.error||''} ${m.fix||''}`;
        return blob.includes((q.q||'').slice(0,40));
      });
    });
    if(mockBuild.source==='mistakes')pool=fromMistakes;
    else{
      const ids=new Set(pool.map(q=>q.id));
      fromMistakes.forEach(q=>{if(!ids.has(q.id))pool.push(q)});
    }
  }
  const seen=new Set();
  pool=pool.filter(q=>{if(seen.has(q.id))return false;seen.add(q.id);return true});
  return pool;
}
function mockBuilderHTML(){
  const allSubs=['Physics','Chemistry','Biology'];
  const bank=db.quizzes||[];
  const chaptersAvailable=[...new Set(bank.filter(q=>mockBuild.subjects.map(s=>s.toLowerCase()).includes(String(q.subject||'').toLowerCase())).map(q=>String(q.chapter||'').trim()).filter(Boolean))].sort();
  const pool=getMockPoolPreview();
  const n=Math.min(mockBuild.count||45, pool.length);
  const selectedCh=mockBuild.chapters||[];
  const chapModeNote=selectedCh.length?`<span class="tag green">${selectedCh.length} chapter selected</span>`:`<span class="tag gold">All chapters (tap to pick specific)</span>`;
  return `<div class="card" style="margin-bottom:16px">
    <div class="section-head" style="margin-top:0"><h3>🎯 Build Mock from Question Bank</h3><small>SUBJECT → CHAPTER → SOURCE</small></div>
    <p class="muted" style="font-size:12px;line-height:1.6;margin-bottom:12px">Subject choose karo → chapters tap karke select/deselect → source → Start. Single chapter bhi select ho sakta hai.</p>
    <div class="field"><label>1. SUBJECTS</label>
      <div class="actions" style="flex-wrap:wrap;gap:8px">
        ${allSubs.map(s=>{
          const on=mockBuild.subjects.includes(s);
          return `<button type="button" class="btn ${on?'':'ghost'}" style="padding:6px 12px" onclick="toggleMockSubject('${s}')">${on?'✓ ':''}${s}</button>`;
        }).join('')}
      </div>
    </div>
    <div class="field"><label>2. CHAPTERS ${chapModeNote}</label>
      ${chaptersAvailable.length?`<div class="actions" style="flex-wrap:wrap;gap:6px;max-height:160px;overflow:auto">
        <button type="button" class="btn ghost" style="padding:4px 8px;font-size:11px" onclick="mockSelectAllChapters()">Select all</button>
        <button type="button" class="btn ghost" style="padding:4px 8px;font-size:11px" onclick="mockClearChapters()">Clear (use all)</button>
        ${chaptersAvailable.map(ch=>{
          const on=selectedCh.includes(ch);
          const cnt=bank.filter(q=>String(q.chapter||'').trim()===ch && mockBuild.subjects.map(s=>s.toLowerCase()).includes(String(q.subject||'').toLowerCase())).length;
          return `<button type="button" class="btn ${on?'':'ghost'}" style="padding:4px 9px;font-size:11px;${on?'border-color:#22c55e;background:#103827;color:#dcfce7':''}" onclick="toggleMockChapter(this.dataset.ch)" data-ch="${esc(ch)}">${on?'✓ ':''}${esc(ch)} <b style="opacity:.7">${cnt}</b></button>`;
        }).join('')}
      </div>`:'<div class="empty">Is subject ke liye bank me chapter nahi — pehle Practice me MCQ import karo.</div>'}
    </div>
    <div class="field"><label>3. QUESTION SOURCE</label>
      <div class="actions" style="flex-wrap:wrap;gap:8px">
        ${[['bank','Practice Quiz bank'],['mistakes','Mistake Hunter only'],['both','Bank + Mistakes']].map(([k,lab])=>
          `<button type="button" class="btn ${mockBuild.source===k?'':'ghost'}" style="padding:6px 12px" onclick="setMockSource('${k}')">${lab}</button>`
        ).join('')}
      </div>
    </div>
    <div class="form-grid">
      <div class="field"><label>QUESTION COUNT</label>
        <input type="number" min="5" max="200" value="${mockBuild.count}" onchange="setMockCount(this.value)" style="max-width:120px">
      </div>
      <div class="field"><label>AVAILABLE IN POOL</label>
        <div style="font-size:18px;font-weight:800;padding-top:6px">${pool.length} <span class="muted" style="font-size:12px;font-weight:500">→ will take ${n}</span></div>
      </div>
    </div>
    <div class="actions" style="margin-top:8px">
      <button type="button" class="btn" ${pool.length<3?'disabled style="opacity:.5"':''} onclick="startCustomMock()">Start Mock (${n} Qs)</button>
      <button type="button" class="btn secondary" onclick="navigate('practice')">Open Practice Bank</button>
    </div>
  </div>`;
}
window.toggleMockSubject=s=>{
  const i=mockBuild.subjects.indexOf(s);
  if(i>=0)mockBuild.subjects.splice(i,1);else mockBuild.subjects.push(s);
  mockBuild.chapters=mockBuild.chapters.filter(ch=>{
    const bank=db.quizzes||[];
    return bank.some(q=>q.chapter===ch && mockBuild.subjects.map(x=>x.toLowerCase()).includes(String(q.subject||'').toLowerCase()));
  });
  render();
};
window.toggleMockChapter=ch=>{
  ch=String(ch||'').trim();
  if(!ch)return;
  mockBuild.chapters=mockBuild.chapters||[];
  const i=mockBuild.chapters.indexOf(ch);
  if(i>=0)mockBuild.chapters.splice(i,1);
  else mockBuild.chapters.push(ch);
  render();
};
window.mockSelectAllChapters=()=>{
  const bank=db.quizzes||[];
  mockBuild.chapters=[...new Set(bank.filter(q=>mockBuild.subjects.map(s=>s.toLowerCase()).includes(String(q.subject||'').toLowerCase())).map(q=>String(q.chapter||'').trim()).filter(Boolean))];
  render();
};
window.mockClearChapters=()=>{mockBuild.chapters=[];render()};
window.setMockSource=s=>{mockBuild.source=s;render()};
window.setMockCount=v=>{mockBuild.count=Math.max(5,Math.min(200,parseInt(v,10)||45));render()};
window.startCustomMock=()=>{
  const pool=getMockPoolPreview();
  if(pool.length<3){toast('Kam se kam 3 questions chahiye. Bank me import karo ya chapters badlo.');return}
  const n=Math.min(mockBuild.count||45,pool.length);
  const picked=[...pool].sort(()=>Math.random()-0.5).slice(0,n);
  const subLabel=mockBuild.subjects.length===3?'Full':mockBuild.subjects.join('+');
  beginQuizSession(picked,{subject:subLabel,chapter:`Custom Mock • ${subLabel} (${n}Q)`});
  navigate('practice');
  toast(`Custom mock started: ${n} questions`);
};

function tests(){
  title('Mock Tests');
  let avg=db.tests.length?Math.round(db.tests.reduce((a,t)=>a+t.score,0)/db.tests.length):0;
  return `<div class="stats">${stat('TESTS TAKEN',db.tests.length,'Total recorded')}${stat('AVERAGE SCORE',avg,'Out of 720')}${stat('BEST SCORE',db.tests.length?Math.max(...db.tests.map(t=>t.score)):0,'Out of 720')}${stat('LATEST ACCURACY',db.tests.length?db.tests[db.tests.length-1].accuracy+'%':'—','As entered')}</div>${mockBuilderHTML()}${upcomingTestsHTML()}<div class="two-col"><div class="card"><h3>Record mock test</h3><form id="testForm" oninput="autoCalcMockScore()"><div class="field"><label>TEST NAME</label><input name="name" placeholder="e.g. Full syllabus test 04" required></div><div class="form-grid"><div class="field"><label>SCORE ( / 720 )</label><input name="score" type="number" min="0" max="720" required></div><div class="field"><label>ACCURACY (%)</label><input name="accuracy" type="number" min="0" max="100" placeholder="e.g. 72"></div></div><div class="form-grid"><div class="field"><label>PHYSICS</label><input name="physics" type="number" min="0" max="180" placeholder="Score"></div><div class="field"><label>CHEMISTRY</label><input name="chemistry" type="number" min="0" max="180" placeholder="Score"></div></div><div class="field"><label>BIOLOGY</label><input name="biology" type="number" min="0" max="360" placeholder="Score"></div><div class="field"><label>ATTACH TEST PAPER / ANALYSIS (IMAGE OR PDF, OPTIONAL)</label><input type="file" name="file" accept="image/*,application/pdf"></div><label style="display:flex;align-items:center;gap:8px;font-size:12px;margin:2px 0 14px"><input type="checkbox" name="analysisDone" style="width:auto"> Analysis done ✅</label><button class="btn">Save test</button></form></div><div class="card"><h3>Test history</h3>${db.tests.length?`<div class="table-wrap"><table><thead><tr><th>TEST</th><th>SCORE</th><th>P / C / B</th><th>ACCURACY</th><th>DATE</th><th>ANALYSIS</th><th></th></tr></thead><tbody>${db.tests.slice().reverse().map(t=>{const pcb=(t.physics||t.chemistry||t.biology)?`${t.physics||0} / ${t.chemistry||0} / ${t.biology||0}`:'—';return `<tr><td>${esc(t.name)}</td><td><b>${t.score}</b></td><td><span class="muted">${pcb}</span></td><td>${t.accuracy||'—'}%</td><td>${t.date}</td><td style="white-space:nowrap"><button type="button" class="tag ${t.analysisDone?'green':''}" style="cursor:pointer;${t.analysisDone?'':'background:#4a1019;color:#fca5a5;border-color:#ef4444'}" onclick="toggleTestAnalysis('${t.id}')">${t.analysisDone?'✅ Done':'● Pending'}</button>${t.fileId?` <button type="button" class="icon-btn" style="padding:3px 7px" title="Open file" onclick="previewFile('${t.fileId}')">📎</button>`:''}</td><td><button class="icon-btn" onclick="removeTest('${t.id}')">×</button></td></tr>`}).join('')}</tbody></table></div>${db.tests.slice().reverse().slice(0,3).map(t=>`<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><b style="font-size:11px">${esc(t.name)}</b><p class="muted" style="font-size:10px">${t.analysis?esc(t.analysis):(t.analysisDone?'Analysis done.':'Analysis pending.')}</p></div>`).join('')}`:'<div class="empty">No mock tests recorded yet.</div>'}</div></div>`;
}
function dayKeys(n){return Array.from({length:n},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(n-1-i));return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})}
function dayLabel(k){return new Date(k+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short'})}
function barChart(labels,vals,id){const W=420,H=170,pt=20,pb=26,n=vals.length,max=Math.max(...vals,1),bw=W/n;let o=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f04a5b"/><stop offset="1" stop-color="#7c1d2a"/></linearGradient></defs><line x1="0" x2="${W}" y1="${H-pb}" y2="${H-pb}" stroke="#272731"/>`;vals.forEach((v,i)=>{const h=(H-pt-pb)*v/max,x=i*bw+bw*.18,y=H-pb-h;o+=`<rect x="${x}" y="${y}" width="${bw*.64}" height="${v?Math.max(h,3):0}" rx="4" fill="url(#${id})"/>`;if(v)o+=`<text x="${x+bw*.32}" y="${y-5}" text-anchor="middle" class="cv">${v}</text>`;o+=`<text x="${x+bw*.32}" y="${H-9}" text-anchor="middle" class="cl">${esc(labels[i])}</text>`});return o+'</svg>'}
function lineChart(labels,vals,max){const W=420,H=190,pl=30,pr=12,pt=20,pb=26,n=vals.length,step=n>1?(W-pl-pr)/(n-1):0,X=i=>n>1?pl+i*step:W/2,Y=v=>pt+(H-pt-pb)*(1-v/max);let o=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`;[0,.25,.5,.75,1].forEach(f=>{const y=Y(max*f);o+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="#272731"/><text x="${pl-5}" y="${y+3}" text-anchor="end" class="cl">${Math.round(max*f)}</text>`});if(n>1)o+=`<polyline fill="none" stroke="#e33b4b" stroke-width="2.2" stroke-linejoin="round" points="${vals.map((v,i)=>X(i)+','+Y(v)).join(' ')}"/>`;vals.forEach((v,i)=>{o+=`<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="#09090d" stroke="#f04a5b" stroke-width="2"/><text x="${X(i)}" y="${Y(v)-9}" text-anchor="middle" class="cv">${v}</text><text x="${X(i)}" y="${H-9}" text-anchor="middle" class="cl">${esc(labels[i])}</text>`});return o+'</svg>'}
function hbars(items,unit=''){const max=Math.max(...items.map(x=>x.value),1);return items.map(x=>`<div class="progress-row"><div class="progress-meta"><span>${esc(x.label)}</span><span>${x.value}${unit}</span></div><div class="bar"><span style="width:${x.value/max*100}%"></span></div></div>`).join('')}
function dayFocusMins(dateKey){
  return db.sessions.filter(x=>x.date===dateKey).reduce((a,x)=>a+(x.minutes||0),0);
}
function dayTasksProgress(dateKey){
  const dayTasks=db.tasks.filter(t=>isDaily(t)&&t.date===dateKey);
  if(!dayTasks.length)return{total:0,done:0,pct:0};
  const done=dayTasks.filter(t=>t.done).length;
  return{total:dayTasks.length,done,pct:done/dayTasks.length};
}
/** A day counts toward streak if focus ≥ 6h (360 min) OR ≥60% of that day's missions are done. */
function dayQualifiesLive(dateKey){
  if(dayFocusMins(dateKey)>=360)return true;
  const p=dayTasksProgress(dateKey);
  return p.total>0 && p.pct>=0.6;
}
/** Once a day qualifies it stays locked in (db.streakDays) — adding/deleting missions later can't undo it.
 *  If today has no target / hasn't qualified yet, the streak shows up to yesterday (no reset to 0). */
function streak(){
  db.streakDays=db.streakDays||{};
  let changed=false;
  const q=k=>{
    if(db.streakDays[k])return true;
    if(dayQualifiesLive(k)){db.streakDays[k]=true;changed=true;return true}
    return false;
  };
  let d=new Date(),c=0;
  const key=()=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  if(!q(key()))d.setDate(d.getDate()-1);
  while(q(key())){c++;d.setDate(d.getDate()-1)}
  if(changed)save();
  return c;
}
function streakLabel(){
  return `D-${String(streak()).padStart(2,'0')}🔥`;
}
function updateStreakBadge(){
  const el=document.getElementById('streakBadge');
  if(el)el.textContent=streakLabel();
}
function dailyGoalsHTML(){
  db.settings=db.settings||{};
  const g=db.settings.dailyGoals||{mins:120,qs:40,missions:3};
  const mins=totalMinutes(), qs=totalQuestionsToday();
  const tasks=todayTasks(), done=tasks.filter(t=>t.done).length;
  const pct=(a,b)=>b?Math.min(100,Math.round(a/b*100)):0;
  const row=(label,cur,tgt,col)=>(
    `<div style="flex:1;min-width:120px">
      <div class="progress-meta"><span>${label}</span><span>${cur}/${tgt}</span></div>
      <div class="bar"><span style="width:${pct(cur,tgt)}%;background:${col}"></span></div>
    </div>`
  );
  return `<div class="card" style="margin-bottom:14px">
    <div class="section-head" style="margin-top:0"><h3>🎯 Daily Goals</h3>
      <button type="button" class="btn ghost" style="padding:4px 8px;font-size:10px" onclick="editDailyGoals()">Edit</button>
    </div>
    <div class="actions" style="gap:14px;flex-wrap:wrap;align-items:stretch">
      ${row('Focus min',mins,g.mins||120,'#e33b4b')}
      ${row('Questions',qs,g.qs||40,'#3b82f6')}
      ${row('Missions',done,g.missions||Math.max(tasks.length,1),'#22c55e')}
    </div>
  </div>`;
}
window.editDailyGoals=()=>{
  db.settings=db.settings||{};
  const g=db.settings.dailyGoals||{mins:120,qs:40,missions:3};
  const mins=parseInt(prompt('Daily focus minutes target?',g.mins),10);
  const qs=parseInt(prompt('Daily questions target?',g.qs),10);
  const missions=parseInt(prompt('Daily missions target?',g.missions),10);
  if([mins,qs,missions].some(x=>Number.isNaN(x)||x<0)){toast('Invalid goals');return}
  db.settings.dailyGoals={mins,qs,missions};
  save();render();toast('Daily goals updated');
};
function streakStripHTML(){
  const keys=[];
  for(let i=6;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    keys.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
  }
  db.streakDays=db.streakDays||{};
  // lock today's status if qualifies
  streak();
  const cells=keys.map(k=>{
    const ok=!!db.streakDays[k]||dayQualifiesLive(k);
    const lab=new Date(k+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short'});
    return `<div style="text-align:center;flex:1">
      <div style="width:28px;height:28px;margin:0 auto;border-radius:8px;display:grid;place-items:center;font-size:12px;background:${ok?'#103827':'#1a1a24'};border:1px solid ${ok?'#22c55e':'#333'}">${ok?'🔥':'·'}</div>
      <div class="muted" style="font-size:9px;margin-top:4px">${lab}</div>
    </div>`;
  }).join('');
  return `<div class="card" style="margin-bottom:14px">
    <div class="section-head" style="margin-top:0"><h3>🔥 7-day streak</h3><small>${streakLabel()} • 6h focus OR 60% missions</small></div>
    <div class="actions" style="justify-content:space-between">${cells}</div>
  </div>`;
}
function revisionQueueHTML(){
  let due=[];
  try{due=typeof dueRevisionsList==='function'?dueRevisionsList().slice(0,6):[]}catch(_){due=[]}
  if(!due.length){
    // fallback: analysis ticks incomplete high pyq or weak chapters
    const weak=[];
    for(const s of ['Physics','Chemistry','Biology']){
      (db.chapters[s]||[]).filter(c=>c.strength==='Weak'||c.strength==='weak').slice(0,2).forEach(c=>weak.push({subject:s,chapter:c.name,reason:'Marked weak'}));
    }
    if(!weak.length)return '';
    due=weak;
  }
  return `<div class="card" style="margin-bottom:14px">
    <div class="section-head" style="margin-top:0"><h3>📚 Revision queue</h3><small>SPACED + WEAK</small></div>
    ${due.map(r=>`<div class="list-item"><div><b>${esc(r.chapter||r.name||'')}</b><div class="muted">${esc(r.subject||'')} ${r.reason?('• '+esc(r.reason)):''}</div></div><button type="button" class="btn secondary" style="padding:4px 8px;font-size:10px" onclick="navigate('revision')">Open</button></div>`).join('')}
  </div>`;
}

const WHY_FIX={
  'Silly mistake':'Option elimination + last 10 sec double-check',
  'Concept gap':'Lecture/NCERT dobara + us topic ke 10 PYQs',
  'Lack of revision':'Revision Log me +3/+7/+21 schedule karo',
  'Not reading properly':'Question 2 baar padho, NOT/EXCEPT/incorrect underline karo',
  'Misread question':'Question 2 baar padho, keywords underline karo',
  'Calculation':'Rough work neat rakho + unit check',
  'Formula recall':'Formula flashcards roz 5 min',
  'Memory / NCERT':'NCERT line-by-line + active recall',
  'Time management':'Timed drills + skip rule',
  'Other':'Note padho, pattern dhundo',
  'Untagged':'Quiz me galat ke baad reason chip tap karo'
};
const WEAKISH_TYPES=['Concept gap','Lack of revision','Memory / NCERT','Formula recall'];
/** Open (unfixed) mistakes grouped by chapter, with the most common reason per chapter. */
function mistakeInsights(){
  const by={};
  for(const m of db.mistakes){
    if(m.closed)continue;
    const key=(m.subject||'')+'||'+(m.chapter||'General');
    const o=by[key]=by[key]||{sub:m.subject,chapter:m.chapter||'General',total:0,types:{}};
    const ty=m.type||'Untagged';
    o.total++;o.types[ty]=(o.types[ty]||0)+1;
  }
  return Object.values(by).map(o=>{
    const top=Object.entries(o.types).sort((a,b)=>b[1]-a[1])[0];
    return {...o,topType:top[0],topCount:top[1]};
  }).sort((a,b)=>b.total-a.total);
}
function mistakeInsightsHTML(){
  const open=db.mistakes.filter(m=>!m.closed);
  if(!open.length)return `<div class="card" style="margin-top:14px"><h3>Why you go wrong</h3><div class="empty">Open mistakes aate hi yaha reason-wise pattern dikhega.</div></div>`;
  const cnt={};open.forEach(m=>{const t=m.type||'Untagged';cnt[t]=(cnt[t]||0)+1});
  const rows=Object.entries(cnt).sort((a,b)=>b[1]-a[1]);
  const tagged=rows.filter(([k])=>k!=='Untagged');
  const top=tagged[0];
  const fixLine=top?`<p class="muted" style="font-size:11px;margin-top:12px;line-height:1.6">Sabse zyada: <b>${esc(top[0])}</b> (${top[1]}/${open.length}) → ${esc(WHY_FIX[top[0]]||'')}</p>`:`<p class="muted" style="font-size:11px;margin-top:12px">Abhi sab mistakes Untagged hain — quiz me galat ke baad reason chip tap karo.</p>`;
  const hot=mistakeInsights().filter(o=>o.total>=2).slice(0,6);
  return `<div class="grid2" style="margin-top:14px">
    <div class="card"><h3>Why you go wrong (open mistakes)</h3>${hbars(rows.map(([k,v])=>({label:k,value:v})))}${fixLine}</div>
    <div class="card"><h3>Chapter hotspots</h3>${hot.length?hot.map(o=>`<div class="list-item" style="align-items:flex-start"><div><b>${esc(o.chapter)}</b> <span class="tag blue">${esc(o.sub||'General')}</span><div class="muted" style="margin-top:3px">${o.total} open • mostly ${esc(o.topType)} (${o.topCount}) → ${esc(WHY_FIX[o.topType]||'')}</div></div></div>`).join(''):'<div class="empty">Jis chapter me 2+ open mistakes honge wo yaha aayega.</div>'}<p class="muted" style="font-size:10px;margin-top:10px;line-height:1.6">Concept gap / Revision / Memory / Formula wali 3+ mistakes wala chapter Weak backlog me bhi auto aa jata hai.</p></div>
  </div>`;
}

function analytics(){
  title('Analytics');
  const k7=dayKeys(7),lab=k7.map(dayLabel),focus7=k7.map(k=>db.sessions.filter(x=>x.date===k).reduce((a,x)=>a+x.minutes,0)),closed7=k7.map(k=>db.tasks.filter(t=>t.done&&(t.doneAt||t.date)===k).length);
  const totMin=db.sessions.reduce((a,x)=>a+x.minutes,0),totQ=db.sessions.reduce((a,x)=>a+(x.questions||0),0),closedAll=db.tasks.filter(t=>t.done).length,best=db.tests.length?Math.max(...db.tests.map(t=>t.score)):0;
  const last=db.tests.slice(-10),subs=['Physics','Chemistry','Biology'],subMax={Physics:180,Chemistry:180,Biology:360};
  const subAvg=subs.map(s=>{const arr=db.tests.filter(t=>t[s.toLowerCase()]>0);return{label:s,value:arr.length?Math.round(arr.reduce((a,t)=>a+t[s.toLowerCase()]/subMax[s]*100,0)/arr.length):0}});
  const mSub=subs.map(s=>({label:s,value:db.mistakes.filter(m=>m.subject===s).length}));
  const types=[...new Set(db.mistakes.map(m=>m.type))].map(t=>({label:t,value:db.mistakes.filter(m=>m.type===t).length})).sort((a,b)=>b.value-a.value);
  const fSub=['Physics','Chemistry','Biology'].map(s=>({label:s,value:db.sessions.filter(x=>x.subject===s).reduce((a,x)=>a+x.minutes,0)}));
  const sk=streak();
  return `<div class="stats">${stat('TOTAL FOCUS',`${Math.floor(totMin/60)}h ${totMin%60}m`,`${totQ} total MCQs logged`)}${stat('MISSIONS CLOSED',closedAll,'All time')}${stat('STREAK',`${sk} day${sk===1?'':'s'} 🔥`,'6h focus or 60% missions')}${stat('BEST SCORE',best,'Out of 720')}</div>
  <div class="grid2"><div class="card"><h3>Focus minutes — last 7 days</h3>${barChart(lab,focus7,'bar-f2')}</div><div class="card"><h3>Missions closed — last 7 days</h3>${barChart(lab,closed7,'bar-m')}</div></div>
  <div class="grid2" style="margin-top:14px"><div class="card"><h3>Mock test score trend</h3>${last.length?lineChart(last.map((t,i)=>'T'+(db.tests.length-last.length+i+1)),last.map(t=>t.score),720):'<div class="empty">Record a mock test to see your trend.</div>'}</div><div class="card"><h3>Subject-wise mock average (%)</h3>${db.tests.length?hbars(subAvg,'%'):'<div class="empty">Add subject scores in a mock test to see this.</div>'}<h3 style="margin-top:22px">Focus time by subject (min)</h3>${totMin?hbars(fSub):'<div class="empty">Log focus sessions to see this.</div>'}</div></div>
  <div class="grid2" style="margin-top:14px"><div class="card"><h3>Mistakes by subject</h3>${db.mistakes.length?hbars(mSub):'<div class="empty">No mistakes recorded yet.</div>'}</div><div class="card"><h3>Mistakes by type</h3>${types.length?hbars(types):'<div class="empty">No mistakes recorded yet.</div>'}<p class="muted" style="font-size:10px;margin-top:14px">Open: ${db.mistakes.filter(m=>!m.closed).length} • Fixed: ${db.mistakes.filter(m=>m.closed).length}</p></div></div>
  ${mistakeInsightsHTML()}
  <div class="grid2" style="margin-top:14px"><div class="card"><h3>Chapters done (%)</h3>${hbars(TRACK_ORDER.map(k=>({label:TRACK[k].label,value:covg(k,'done')})),'%')}</div><div class="card"><h3>Revision 1 completed (%)</h3>${hbars(TRACK_ORDER.map(k=>({label:TRACK[k].label,value:covg(k,'r1')})),'%')}</div></div>`;
}

const NEET_SYLLABUS={
  Physics:['Physics and Measurement','Kinematics','Laws of Motion','Work, Energy and Power','Rotational Motion','Gravitation','Properties of Solids and Liquids','Thermodynamics','Kinetic Theory of Gases','Oscillations and Waves','Electrostatics','Current Electricity','Magnetic Effects of Current and Magnetism','Electromagnetic Induction and Alternating Currents','Electromagnetic Waves','Optics','Dual Nature of Matter and Radiation','Atoms and Nuclei','Electronic Devices','Experimental Skills'],
  Chemistry:['Some Basic Concepts in Chemistry','Atomic Structure','Chemical Bonding and Molecular Structure','Chemical Thermodynamics','Solutions','Equilibrium','Redox Reactions and Electrochemistry','Chemical Kinetics','Classification of Elements and Periodicity in Properties','p-Block Elements','d- and f-Block Elements','Coordination Compounds','Purification and Characterisation of Organic Compounds','Some Basic Principles of Organic Chemistry','Hydrocarbons','Organic Compounds Containing Halogens','Organic Compounds Containing Oxygen','Organic Compounds Containing Nitrogen','Biomolecules','Principles Related to Practical Chemistry'],
  Biology:['The Living World','Biological Classification','Plant Kingdom','Animal Kingdom','Morphology of Flowering Plants','Anatomy of Flowering Plants','Floral Families (Malvaceae, Cruciferae, Leguminosae, Compositae, Gramineae)','Animal Tissues','Frog (Morphology and Anatomy)','Cell: The Unit of Life','Biomolecules and Enzymes','Cell Cycle and Cell Division','Photosynthesis in Higher Plants','Respiration in Plants','Plant Growth and Development','Breathing and Exchange of Gases','Body Fluids and Circulation','Excretory Products and Their Elimination','Locomotion and Movement','Neural Control and Coordination','Chemical Coordination and Integration','Sexual Reproduction in Flowering Plants','Human Reproduction','Reproductive Health','Principles of Inheritance and Variation','Molecular Basis of Inheritance','Evolution','Human Health and Disease','Microbes in Human Welfare','Biotechnology: Principles and Processes','Biotechnology and Its Applications','Organisms and Populations','Ecosystem','Biodiversity and Conservation']
};
function loadSyllabus(silent){let added=0;for(const sub of Object.keys(NEET_SYLLABUS)){const have=new Set((db.chapters[sub]||[]).map(c=>c.name.trim().toLowerCase()));db.chapters[sub]=db.chapters[sub]||[];for(const [i,name] of NEET_SYLLABUS[sub].entries())if(!have.has(name.toLowerCase())){db.chapters[sub].push({id:crypto.randomUUID(),name,done:false,strength:'Medium',weakTopics:'',...(sub==='Chemistry'?{branch:i<8?'Physical':i<12?'Inorganic':'Organic'}:{})});added++}}db.syllabusLoaded=true;save();if(!silent){render();toast(added?`${added} chapters added.`:'All syllabus chapters already added.')}return added}
window.loadSyllabus=loadSyllabus;

const TRACK_ORDER=['Physics','Physical','Inorganic','Organic','Biology'];
const CHEM_COLS=[['module','Module'],['dpp','DPP'],['pyqj','JEE Mains PYQ'],['pyqn','NEET PYQ'],['air','AIR Assignment']];
const TRACK={
  Physics:{label:'Physics',sub:'Physics',cols:[['module','Module'],['dpp','DPP'],['pyqj','PYQ JEE'],['pyqn','PYQ NEET']],rev:4},
  Physical:{label:'Physical Chem',sub:'Chemistry',branch:'Physical',cols:CHEM_COLS,rev:4},
  Inorganic:{label:'Inorganic Chem',sub:'Chemistry',branch:'Inorganic',cols:CHEM_COLS,rev:4},
  Organic:{label:'Organic Chem',sub:'Chemistry',branch:'Organic',cols:CHEM_COLS,rev:4},
  Biology:{label:'Biology',sub:'Biology',cols:[['punch','NCERT Punch 👊'],['module','Module'],['ncert','NCERT Line-by-Line']],rev:5}
};

function keepScroll(fn){const w=document.querySelector('.track-wrap'),x=w?w.scrollLeft:0,y=window.scrollY;fn();const n=document.querySelector('.track-wrap');if(n)n.scrollLeft=x;window.scrollTo(0,y)}
window.setTrackTab=k=>{trackTab=k;render()};
window.toggleCell=(id,key)=>{const cfg=TRACK[trackTab],c=(db.chapters[cfg.sub]||[]).find(x=>x.id===id);if(!c)return;if(key==='done')c.done=!c.done;else{c.t=c.t||{};if(c.t[key])delete c.t[key];else c.t[key]=today()}save();keepScroll(render)};
window.addTrackChapter=e=>{e.preventDefault();const cfg=TRACK[trackTab],name=e.target.chapter.value.trim();if(!name)return;const ch={id:crypto.randomUUID(),name,done:false,strength:'Medium',weakTopics:''};if(cfg.branch)ch.branch=cfg.branch;db.chapters[cfg.sub].push(ch);save();keepScroll(render);toast('Chapter added.')};
function allRevs(){const out=db.revisions.map(r=>({id:r.id,date:r.date,chapter:r.chapter,subject:r.subject,kind:r.kind,r3:r.r3,r7:r.r7,r21:r.r21}));for(const sub of Object.keys(db.chapters))for(const c of db.chapters[sub])for(const [k,d] of Object.entries(c.t||{}))if(/^r\d$/.test(k))out.push({date:d,chapter:c.name,subject:sub,kind:'Revision '+k.slice(1)});return out.sort((a,b)=>b.date.localeCompare(a.date))}
function covg(k,key){const l=tabChapters(TRACK[k]);return l.length?Math.round(l.filter(c=>key==='done'?c.done:(c.t||{})[key]).length/l.length*100):0}

/* Past ~10 years chapter/topic weightage (Ankur Sir style analysis + Biology research). Counts = PYQ frequency. */
const NEET_ANALYSIS={
  Physics:[
    {ch:'Current Electricity',n:46,topics:[['Combination of resistances',9],['Resistance and resistivity',7],['Electric power and heating effect',6],['Potentiometer',5],['Current, density and drift velocity',4],["Kirchhoff's laws",3],['Colour coding of resistance',3],['Wheatstone bridge',3],['Cell, battery and combinations',3],['Galvanometer, voltmeter, ammeter',2],['Meter bridge',1]]},
    {ch:'Semiconductor',n:42,topics:[['Semiconductor and PN junction diode',20],['Digital circuits',15],['Transistors',8]]},
    {ch:'Heat and Thermodynamics',n:40,topics:[['KTG and gas laws',14],['Thermodynamic processes',11],['Heat engine, Second law, Carnot',4],['Heat transfer',3],['Zeroth and First law',3],['Degree of freedom / equipartition',3],['Specific heat, calorimetry',2]]},
    {ch:'Matter, Fluids and Solids',n:39,topics:[['Mechanical properties of solids',10],["Fluid flow, Bernoulli, viscosity",8],['Surface tension, excess pressure, capillarity',8],['Stress-strain, thermal stress',5],["Pressure, density, Pascal, Archimedes",4],["Newton's law of cooling",4]]},
    {ch:'Atoms and Nuclei',n:38,topics:[["Bohr's model and hydrogen spectrum",17],['Nucleus and radioactivity',13],['Nuclear fission, fusion, binding energy',4],['Alpha scattering and Rutherford model',4]]},
    {ch:'Geometrical Optics',n:37,topics:[['Refraction, TIR and Prism',16],['Lenses',11],['Optical instruments',6],['Reflection of light',4]]},
    {ch:'Alternating Current',n:34,topics:[['AC circuits and power',25],['Growth and decay of current',4],['AC generator and transformer',4],['Quality factor',1]]},
    {ch:'Electrostatics',n:32,topics:[['Electric potential energy and potential',11],['Electric dipole',8],["Charges and Coulomb's law",5],['Electric flux and Gauss law',4],['Electric field and intensity',4]]},
    {ch:'Rotational Motion',n:31,topics:[['Moment of inertia',12],['Combined translational and rotational',7],['Torque',7],['Angular momentum',5]]},
    {ch:'Units and Dimensions',n:29,topics:[['Dimensions of physical quantities',13],['Errors in measurements',6],['Screw gauge',4],['Significant figures',3],['Vernier calipers',2],['Units of physical quantities',1]]},
    {ch:'Moving Charges and Magnetism',n:29,topics:[["Biot-Savart's law and magnetic field",9],["Ampere's circuital law",7],['Force and torque on conductor',6],['Motion of charged particle in B-field',5],['Magnetic moment',1],['Moving coil galvanometer',1]]},
    {ch:'Dual Nature of Radiation and Matter',n:28,topics:[['Photoelectric effect',12],['Matter waves',12],['Particle nature of light / photon',4]]},
    {ch:'Wave Optics',n:24,topics:[['Huygens principle and interference',13],['Polarisation',7],['Diffraction and Doppler of light',2],['Optical instruments',2]]},
    {ch:'Oscillations',n:21,topics:[['Mathematical representation of SHM',5],['Spring-mass system',5],['Simple pendulum',4],['Energy in SHM',3],['SHM basics',3],['Damped and forced oscillations',1]]},
    {ch:'Capacitor',n:20,topics:[['Capacitance and combinations',12],['Energy stored in capacitor',5],['Dielectrics',3]]},
    {ch:'Magnetism and Matter',n:20,topics:[['Bar magnet and earth magnetism',10],['Magnetic materials and hysteresis',6],['Magnetic properties of materials',4]]},
    {ch:'Work, Energy and Power',n:19,topics:[['Work-energy theorem',8],['Conservation of energy',6],['Power and collisions energy',5]]},
    {ch:'Laws of Motion',n:18,topics:[["Newton's laws and applications",10],['Friction',5],['Circular motion dynamics',3]]},
    {ch:'COM and Collision',n:17,topics:[['Centre of mass',8],['Collisions (elastic/inelastic)',7],['Impulse and momentum',2]]},
    {ch:'Motion in a Plane',n:16,topics:[['Projectile motion',10],['Relative velocity in 2D',4],['Uniform circular motion',2]]},
    {ch:'Waves',n:16,topics:[['Progressive waves and superposition',8],['Beats and Doppler',5],['Standing waves',3]]},
    {ch:'Motion in a Straight Line',n:15,topics:[['Kinematic equations',8],['Graphs of motion',5],['Relative velocity 1D',2]]},
    {ch:'EMW',n:15,topics:[['EM spectrum and properties',10],['Displacement current',5]]},
    {ch:'EMI',n:12,topics:[['Faraday and Lenz law',7],['Self and mutual inductance',5]]}
  ],
  Chemistry:[
    {ch:'Chemical Bonding',n:47,topics:[['Hybridization and VSEPR',20],['Molecular orbital theory',8],['Dipole moment',5],['Hydrogen bonding',3],['Bond parameters',3],['Covalent and coordinate bond',2],['Van der Waals forces',2],['Lewis theory',1],['Resonance',1],['Ionic bond',1]]},
    {ch:'GOC',n:44,topics:[['Isomerism',11],['IUPAC nomenclature',7],['Stability of intermediates',7],['Purification of organic compounds',7],['Electron displacement effects',3],['Acid and base strength',3],['Qualitative analysis of organics',3],['Aromaticity',2],['Attacking reagents',1]]},
    {ch:'Periodic Table',n:44,topics:[['Periodic trends (IE, EN, size)',20],['s,p,d,f block classification',12],['Electronic configuration patterns',8],['Anomalous behaviour',4]]},
    {ch:'P-Block Elements',n:41,topics:[['Group 15–18 compounds and trends',18],['Important reactions of p-block',12],['Oxides, hydrides, halides',8],['Interhalogen compounds',3]]},
    {ch:'Aldehyde Ketones and Carboxylic acid',n:38,topics:[['Reactions of aldehydes and ketones',17],['Preparation, properties of carboxylic acids',11],['Preparation methods for carbonyls',5],['Tests for aldehydes and ketones',2],['Aldehyde preparation methods',2],['Reactions involving aldehydes',1]]},
    {ch:'Coordination Compounds',n:34,topics:[['Nomenclature and isomerism',12],['Werner theory and ligands',8],['CFT and colour/magnetic properties',8],['Stability and applications',6]]},
    {ch:'Chemical Kinetics',n:29,topics:[['Arrhenius equation',8],['Integrated rate law equations',7],['Rate laws and rate constant',6],['Rate of reaction',5],['Methods to determine order',2],['Nuclear chemistry',1]]},
    {ch:'Electrochemistry',n:28,topics:[['Electrochemical series, cell, EMF',16],['Conductance and electrolysis',11],['Batteries, fuel cells, corrosion',1]]},
    {ch:'Hydrocarbons',n:28,topics:[['Reactions of alkenes',9],['Aromatic hydrocarbons',7],['Reactions of alkanes',3],['Reactions of alkynes',3],['Properties/prep of alkanes',2],['Properties/prep of alkenes',2],['Properties/prep of alkynes',2]]},
    {ch:'D and F Block Elements',n:28,topics:[['Transition metals properties',14],['Lanthanoids and actinoids',8],['KMnO4 / K2Cr2O7',6]]},
    {ch:'Thermodynamics',n:26,topics:[['Enthalpies and Hess law',6],['Fundamentals of thermodynamics',6],['First law of thermodynamics',6],['Entropy, free energy, spontaneity',6],['Second law of thermodynamics',2]]},
    {ch:'Structure of Atom',n:23,topics:[['Quantum numbers and orbitals',10],['Hydrogen spectrum',3],["Bohr's model",3],['Electronic configuration and nodes',2],['Quantum mechanical model',1],['Photoelectric effect',1],['De-Broglie hypothesis',1],['Heisenberg uncertainty',1],['Thomson and Rutherford models',1]]},
    {ch:'Mole Concept',n:22,topics:[['Mole concept basics',11],['Quantitative measures in equations',5],['Concentration terms',3],['Laws of chemical combination',2],['Significant figures',1]]},
    {ch:'Amines',n:22,topics:[['Diazonium salts and N-compounds',9],['Aromatic amines',8],['Aliphatic amines',5]]},
    {ch:'Alcohol Phenols and Ethers',n:21,topics:[['Alcohols — prep, properties, uses',8],['Phenols — prep, properties, uses',7],['Ethers — prep, properties, uses',6]]},
    {ch:'Ionic Equilibrium',n:19,topics:[['Solubility product and common ion',7],['pH, buffer and indicators',7],["Ostwald dilution and acid-base concepts",5]]},
    {ch:'Solutions',n:19,topics:[["Relative lowering of VP and Raoult's law",6],['Elevation in boiling point',4],['Osmotic pressure',3],['Depression in freezing point',3],["Henry's law",2],["Abnormal colligative / van't Hoff",1]]},
    {ch:'Haloalkanes and Haloarenes',n:19,topics:[['Haloalkanes',12],['Haloarenes',5],['Polyhalogen compounds',2]]},
    {ch:'Biomolecules',n:19,topics:[['Carbohydrates',8],['Proteins and enzymes',7],['Vitamins and nucleic acids',4]]},
    {ch:'Chemical Equilibrium',n:14,topics:[['Law of mass action and Kc/Kp',11],["Le Chatelier's principle",3]]},
    {ch:'Redox Reactions',n:11,topics:[['Oxidation number',4],['Types of redox reactions',3],['Balancing redox',2],['Oxidation and reduction',2]]}
  ],
  Biology:[
    {ch:'Molecular Basis of Inheritance',n:60,topics:[['DNA structure and replication',18],['Transcription and genetic code',14],['Translation and gene expression',12],['Human genome and DNA fingerprinting',8],['Operon and regulation',8]]},
    {ch:'Morphology of Flowering Plants',n:49,topics:[['Root, stem, leaf morphology',16],['Inflorescence and flower',14],['Fruit and seed',10],['Families (Fabaceae, Solanaceae, Liliaceae)',9]]},
    {ch:'Cell: The Unit of Life',n:44,topics:[['Cell organelles structure/function',18],['Plasma membrane and cell wall',10],['Prokaryotic vs eukaryotic',8],['Nucleus and chromosomes',8]]},
    {ch:'Sexual Reproduction in Flowering Plants',n:38,topics:[['Microsporogenesis and male gametophyte',12],['Megasporogenesis and female gametophyte',10],['Pollination and fertilization',10],['Endosperm and seed development',6]]},
    {ch:'Principles of Inheritance and Variation',n:37,topics:[['Mendelian laws and crosses',14],['Linkage, recombination, maps',8],['Sex determination and disorders',8],['Pedigree analysis',7]]},
    {ch:'Biotechnology: Principles and Processes',n:36,topics:[['Tools (enzymes, vectors, hosts)',14],['Recombinant DNA technology steps',12],['PCR, gel electrophoresis, bioreactors',10]]},
    {ch:'Plant Kingdom',n:35,topics:[['Algae and bryophytes',12],['Pteridophytes and gymnosperms',10],['Angiosperm life cycles',8],['Plant classification systems',5]]},
    {ch:'Animal Kingdom',n:35,topics:[['Non-chordates (Porifera to Echinodermata)',18],['Chordates overview',10],['Basis of classification',7]]},
    {ch:'Structural Organisation in Animals',n:35,topics:[['Animal tissues',16],['Cockroach / frog morphology',12],['Earthworm anatomy',7]]},
    {ch:'Biomolecules',n:33,topics:[['Proteins and amino acids',10],['Carbohydrates and lipids',8],['Enzymes and kinetics',8],['Nucleic acids and metabolites',7]]},
    {ch:'Biotechnology and Its Applications',n:31,topics:[['Bt crops and transgenic plants',10],['Gene therapy and molecular diagnosis',10],['Ethical issues and biopiracy',6],['Insulin, vaccines, transgenic animals',5]]},
    {ch:'Human Reproduction',n:31,topics:[['Male and female reproductive systems',12],['Gametogenesis',8],['Menstrual cycle and fertilization',7],['Pregnancy and parturition',4]]},
    {ch:'Human Health and Disease',n:30,topics:[['Infectious diseases and pathogens',12],['Immunity and vaccines',10],['Cancer, AIDS, drugs',8]]},
    {ch:'Cell Cycle and Cell Division',n:28,topics:[['Mitosis',10],['Meiosis',10],['Cell cycle regulation',8]]},
    {ch:'Chemical Coordination and Integration',n:28,topics:[['Endocrine glands and hormones',16],['Mechanism of hormone action',8],['Disorders of endocrine system',4]]},
    {ch:'Photosynthesis in Higher Plants',n:26,topics:[['Light reaction and pigments',10],['Calvin cycle and C4 pathway',10],['Factors affecting photosynthesis',6]]},
    {ch:'Human Physiology — Neural Control',n:24,topics:[['Neuron and synapse',10],['CNS and PNS',8],['Reflex and sense organs',6]]},
    {ch:'Ecology — Organisms and Populations',n:24,topics:[['Population attributes and growth',12],['Adaptations',6],['Interactions',6]]},
    {ch:'Ecosystem',n:22,topics:[['Energy flow and trophic levels',10],['Ecological pyramids and productivity',7],['Nutrient cycles',5]]},
    {ch:'Breathing and Exchange of Gases',n:20,topics:[['Respiratory organs and mechanism',10],['Gas transport and exchange',7],['Disorders of respiration',3]]},
    {ch:'Body Fluids and Circulation',n:20,topics:[['Blood composition and groups',8],['Heart structure and cardiac cycle',8],['ECG and disorders',4]]},
    {ch:'Excretory Products and Their Elimination',n:18,topics:[['Kidney and nephron',10],['Urine formation and regulation',6],['Disorders of excretory system',2]]},
    {ch:'Locomotion and Movement',n:16,topics:[['Skeletal muscle and contraction',10],['Joints and disorders',6]]},
    {ch:'Reproductive Health',n:16,topics:[['Contraception and STIs',8],['Infertility and ARTs',5],['Population control',3]]},
    {ch:'Evolution',n:16,topics:[['Theories and evidences of evolution',8],['Hardy-Weinberg and speciation',5],['Human evolution',3]]},
    {ch:'Microbes in Human Welfare',n:14,topics:[['Microbes in industry and sewage',8],['Biofertilizers and biocontrol',6]]},
    {ch:'Biodiversity and Conservation',n:14,topics:[['Biodiversity patterns and loss',8],['Conservation strategies',6]]},
    {ch:'Respiration in Plants',n:14,topics:[['Glycolysis and Krebs cycle',8],['Electron transport and fermentation',6]]},
    {ch:'Plant Growth and Development',n:12,topics:[['Plant hormones',8],['Photoperiodism and vernalisation',4]]}
  ]
};

window.setAnalysisTab=t=>{analysisTab=t;render()};
function analysisDoneKey(sub,ch,topic){return [sub,ch,topic].map(x=>String(x||'').trim().toLowerCase()).join('||')}
window.toggleAnalysisDone=(sub,ch,topic)=>{
  db.analysisDone=db.analysisDone||{};
  const k=analysisDoneKey(sub,ch,topic);
  if(db.analysisDone[k])delete db.analysisDone[k];
  else db.analysisDone[k]=today();
  save();render();
};
window.markChapterAnalysisDone=(sub,ch,force)=>{
  db.analysisDone=db.analysisDone||{};
  const block=(NEET_ANALYSIS[sub]||[]).find(x=>x.ch===ch);
  if(!block)return;
  const allDone=block.topics.every(([t])=>db.analysisDone[analysisDoneKey(sub,ch,t)]);
  const next=typeof force==='boolean'?force:!allDone;
  block.topics.forEach(([t])=>{
    const k=analysisDoneKey(sub,ch,t);
    if(next)db.analysisDone[k]=db.analysisDone[k]||today();
    else delete db.analysisDone[k];
  });
  save();render();
  toast(next?`${ch}: all topics ticked.`:`${ch}: ticks cleared.`);
};
function seedAnalysisTopicsToPractice(){
  db.topics=db.topics||{};
  let added=0;
  for(const sub of ['Physics','Chemistry','Biology']){
    for(const block of (NEET_ANALYSIS[sub]||[])){
      const key=topicKey(sub,block.ch);
      const list=db.topics[key]=db.topics[key]||[];
      const have=new Set(list.map(t=>t.toLowerCase()));
      for(const [t] of block.topics){
        if(!have.has(t.toLowerCase())){list.push(t);have.add(t.toLowerCase());added++}
      }
    }
  }
  if(added)save();
  return added;
}
window.seedAnalysisTopicsToPractice=()=>{
  const n=seedAnalysisTopicsToPractice();
  toast(n?`${n} high-yield topics Practice me add ho gaye.`:'Saare analysis topics pehle se Practice me hain.');
  if(current==='practice')render();
};

function analysisView(){
  title('NEET Analysis');
  const sub=analysisTab in NEET_ANALYSIS?analysisTab:'Physics';
  const list=NEET_ANALYSIS[sub]||[];
  db.analysisDone=db.analysisDone||{};
  let totalTopics=0,doneTopics=0,totalPyq=0;
  list.forEach(b=>{
    totalPyq+=b.n||0;
    b.topics.forEach(([t])=>{
      totalTopics++;
      if(db.analysisDone[analysisDoneKey(sub,b.ch,t)])doneTopics++;
    });
  });
  const pct=totalTopics?Math.round(doneTopics/totalTopics*100):0;
  return `<div class="stats">
    ${stat('SUBJECT',sub,'Past ~10 yrs PYQ map')}
    ${stat('CHAPTERS',list.length,'High-yield ordered')}
    ${stat('TOPICS DONE',`${doneTopics}/${totalTopics}`,`${pct}% ticked`)}
    ${stat('Σ PYQ SIGNAL',totalPyq,'Relative frequency')}
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="section-head" style="margin:0 0 10px"><h2>NEET chapter × topic weightage</h2><small>TICK WHEN DONE</small></div>
    <p class="muted" style="font-size:12px;line-height:1.6;margin:0 0 12px">Physics & Chemistry numbers follow last-10-years chapterwise analysis (Ankur Sir style). Biology is compiled from multi-year PYQ frequency research. Ye ranking relative hai — exact paper me count vary karta hai. Har topic ke saamne tick lagao jab complete / revise ho jaye.</p>
    <div class="tabs three">
      ${['Physics','Chemistry','Biology'].map(s=>`<button type="button" class="tab ${sub===s?'active':''}" onclick="setAnalysisTab('${s}')">${s}</button>`).join('')}
    </div>
    <div class="actions" style="margin-top:10px">
      <button type="button" class="btn secondary" onclick="seedAnalysisTopicsToPractice()">＋ High-yield topics → Practice</button>
      <span class="muted" style="font-size:11px">Practice & Quiz me chapter ke Topics list me add ho jayenge.</span>
    </div>
  </div>
  ${list.map(b=>{
    const done=b.topics.filter(([t])=>db.analysisDone[analysisDoneKey(sub,b.ch,t)]).length;
    const all=b.topics.length;
    const open=topicOpenGroups.has('an||'+sub+'||'+b.ch);
    return `<details class="group" data-key="an||${esc(sub)}||${esc(b.ch)}" ${open?'open':''} ontoggle="toggleTopicGroup(this)">
      <summary>
        <span><b>${esc(b.ch)}</b> <span class="tag gold">${b.n} PYQ</span> <span class="tag ${done===all&&all?'green':''}">${done}/${all} topics</span></span>
        <span class="muted" style="font-size:10px">${Math.round(done/all*100)||0}%</span>
      </summary>
      <div class="group-body" style="padding:4px 12px 12px">
        <div class="actions" style="margin:6px 0 8px">
          <button type="button" class="btn ghost" style="padding:4px 9px;font-size:10px" onclick='markChapterAnalysisDone(${JSON.stringify(sub)},${JSON.stringify(b.ch)})'>${done===all?'Clear all ticks':'Tick all topics'}</button>
        </div>
        ${b.topics.map(([t,n])=>{
          const k=analysisDoneKey(sub,b.ch,t);
          const isOn=!!db.analysisDone[k];
          const jsSub=JSON.stringify(sub),jsCh=JSON.stringify(b.ch),jsT=JSON.stringify(t);
          return `<div class="list-item" style="gap:10px">
            <label style="display:flex;align-items:center;gap:10px;flex:1;cursor:pointer;margin:0">
              <input type="checkbox" ${isOn?'checked':''} onchange='toggleAnalysisDone(${jsSub},${jsCh},${jsT})' style="width:16px;height:16px;accent-color:var(--red)">
              <span style="${isOn?'text-decoration:line-through;color:var(--muted)':''}">${esc(t)}</span>
            </label>
            <span class="tag ${n>=10?'gold':n>=5?'blue':''}">${n} Qs</span>
          </div>`;
        }).join('')}
      </div>
    </details>`;
  }).join('')}
  <div class="card" style="margin-top:14px">
    <h3>How to use</h3>
    <p class="muted" style="font-size:12px;line-height:1.7;margin:0">1) Subject tab choose karo → high PYQ chapters pehle. 2) Topic complete hone pe checkbox tick. 3) “High-yield topics → Practice” se same names Practice chapters me Topics list me aa jayenge — phir JSON import me <code>"topic"</code> field match karke topic quiz start kar sakte ho. 4) Existing dashboard / missions / mock lab bilkul same rahenge.</p>
  </div>`;
}

const LAB_KEYS=[['physics','Physics',45,180],['chemistry','Chemistry',45,180],['botany','Botany',45,180],['zoology','Zoology',45,180]];
function labList(){return (db.mockLabs||[]).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name))}
function labPart(a){return (a?.c||0)*4-(a?.w||0)}
function labTotals(m){
  let correct=0,wrong=0,score=0;
  for(const [k] of LAB_KEYS){correct+=m[k]?.c||0;wrong+=m[k]?.w||0;score+=labPart(m[k])}
  const attempted=correct+wrong, skipped=180-attempted;
  return {correct,wrong,attempted,skipped,score,accuracy:attempted?correct/attempted:0,burned:wrong,left:skipped*4};
}
function labMean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0}
function labProject(scores){
  if(!scores.length)return 0;
  if(scores.length===1)return scores[0];
  const n=scores.length; let sx=0,sy=0,sxy=0,sx2=0;
  scores.forEach((y,i)=>{sx+=i;sy+=y;sxy+=i*y;sx2+=i*i});
  const den=n*sx2-sx*sx; if(!den)return scores[n-1];
  const slope=(n*sxy-sx*sy)/den, intercept=(sy-slope*sx)/n;
  return Math.round(Math.max(0,Math.min(720,intercept+slope*n)));
}
function labBand(score){
  if(score>=700)return ['Top band','Historically the first few hundred to low thousands. Not an AIR.'];
  if(score>=670)return ['High competitive','Often a serious government-seat conversation. Cutoffs move.'];
  if(score>=640)return ['Competitive','State merit and stronger private options usually open here.'];
  if(score>=600)return ['Mid competitive','Counselling range. Government seats get tight for general.'];
  if(score>=550)return ['Building','A 40–70 mark jump changes the map more than another full pass.'];
  if(score>=500)return ['Foundation','The paper is readable. Selection still needs a subject jump.'];
  return ['Early','Accuracy before volume. Negatives are eating the paper.'];
}
function labGapPlan(lt,weak,target){
  if(!lt)return 'Log a paper to unlock a week plan.';
  const gap=Math.max(0,target-lt.score);
  if(gap===0)return `Target ${target} already cleared on the latest paper. Hold accuracy; protect ${weak?weak[1]:'Biology'} from silly wrongs.`;
  const lines=[`Gap ${gap} marks to ${target}.`];
  if(weak)lines.push(`Priority subject: ${weak[1]} — raise % before adding new chapters.`);
  if(lt.burned>5)lines.push(`Cut about ${Math.min(lt.burned,Math.ceil(gap/5))} avoidable wrongs first (+5 each if they flip).`);
  if(lt.accuracy<0.75)lines.push(`Accuracy ${Math.round(lt.accuracy*100)}% — skip 50/50 guesses this week; use Skip drill in Practice.`);
  else if(lt.skipped>8)lines.push(`Accuracy is usable — selectively attempt ${Math.min(lt.skipped,Math.ceil(gap/4))} high-confidence blanks only.`);
  lines.push('This week: auto weak-chapter missions + one full mock analysis in Mock Lab.');
  return lines.join(' ');
}
function labWeak(m){
  return LAB_KEYS.slice().sort((a,b)=>labPart(m[a[0]])/a[3]-labPart(m[b[0]])/b[3])[0];
}
window.setMockTarget=v=>{db.settings.mockTarget=Math.max(0,Math.min(720,parseInt(v,10)||0));save()};
window.setMockLabFocus=id=>{mockLabFocusId=id;render()};
window.setMockLabFix=v=>{mockLabFix=parseInt(v,10)||0;render()};
window.deleteMockLab=id=>{db.mockLabs=(db.mockLabs||[]).filter(x=>x.id!==id);if(mockLabFocusId===id)mockLabFocusId=null;save();render();toast('Paper removed.')};

function mockLabView(){
  title('Mock Lab');
  const list=labList();
  const scores=list.map(m=>labTotals(m).score);
  const latest=list.at(-1)||null;
  const prev=list.at(-2)||null;
  const lt=latest?labTotals(latest):null;
  const delta=latest&&prev?lt.score-labTotals(prev).score:0;
  const avg=Math.round(labMean(scores));
  const best=scores.length?Math.max(...scores):0;
  const projected=labProject(scores);
  const target=db.settings.mockTarget??650;
  const focused=list.find(m=>m.id===mockLabFocusId)||latest;
  const ft=focused?labTotals(focused):null;
  const weak=latest?labWeak(latest):null;
  const band=lt?labBand(lt.score):null;
  const flip=ft?Math.max(0,Math.min(ft.wrong,mockLabFix)):0;
  const flipped=ft?Math.min(720,ft.score+flip*5):0;
  const labels=list.map(m=>new Date(m.date+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}));
  return `<div class="stats">
    ${stat('LATEST',lt?lt.score:'—',latest?`${esc(latest.name)} · ${delta>=0?'+':''}${delta} vs previous`:'Log right and wrong')}
    ${stat('BEST',best||'—',`${list.length} papers`)}
    ${stat('MEAN',list.length?avg:'—','All Mock Lab papers')}
    ${stat('IF SLOPE HOLDS',list.length?projected:'—',lt?`${projected-lt.score>=0?'+':''}${projected-lt.score} from latest`:'Need a paper')}
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="section-head" style="margin:0 0 8px"><h2>Target</h2><small>OUT OF 720</small></div>
    <div class="actions" style="align-items:center">
      <input type="number" min="0" max="720" value="${target}" style="max-width:120px" onchange="setMockTarget(this.value)">
      <span class="muted">${lt?`Gap ${Math.max(0,target-lt.score)} marks`:'Set the score you are actually writing for.'}</span>
    </div>
  </div>
  ${list.length?`<div class="grid2">
    <div class="card"><h3>Score trend</h3>${lineChart(labels,scores,720)}<p class="muted" style="font-size:10px;margin-top:8px">Solid line is the paper. Not a 3-test average — that lives in the mean card.</p></div>
    <div class="card"><h3>Unofficial band</h3><p style="font-size:22px;font-weight:800;margin:8px 0 6px">${band[0]}</p><p class="muted" style="font-size:12px;line-height:1.6">${band[1]}</p>
      <div class="list-item"><span>Accuracy</span><b>${Math.round(lt.accuracy*100)}%</b></div>
      <div class="list-item"><span>Attempted</span><b>${lt.attempted} / 180</b></div>
      <div class="list-item"><span>Burned on wrongs</span><b style="color:var(--red)">−${lt.burned}</b></div>
      <div class="list-item"><span>Left blank</span><b>${lt.skipped} Q · up to ${lt.left}</b></div>
      <div class="list-item"><span>Softest subject</span><b>${weak[1]}</b></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px;border-color:#51212b">
    <h3>Rank gap plan (this week)</h3>
    <p style="font-size:13px;line-height:1.7;margin:8px 0 0">${esc(labGapPlan(lt,weak,target))}</p>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="card">
      <div class="section-head" style="margin-top:0"><h2>Subject split</h2>
        <select onchange="setMockLabFocus(this.value)" style="max-width:220px">${list.map(m=>`<option value="${m.id}" ${m.id===(focused&&focused.id)?'selected':''}>${esc(m.date)} · ${esc(m.name)}</option>`).join('')}</select>
      </div>
      ${LAB_KEYS.map(([k,label,cap,max])=>{const a=focused[k]||{c:0,w:0};const sc=labPart(a);const w=Math.max(0,Math.min(100,sc/max*100));return `<div class="progress-row"><div class="progress-meta"><span>${label}</span><span>${a.c} right · ${a.w} wrong · ${sc}/${max}</span></div><div class="bar"><span style="width:${w}%"></span></div></div>`}).join('')}
    </div>
    <div class="card">
      <h3>If wrongs become rights</h3>
      <p class="muted" style="font-size:12px;line-height:1.6">One converted mistake is 5 marks: you stop losing 1 and start gaining 4.</p>
      <p style="font-size:32px;font-weight:800;margin:10px 0 0">${flipped}</p>
      <p class="muted" style="font-size:12px">+${flipped-ft.score} if ${flip} wrongs flip · now ${ft.score} · ${ft.wrong} wrongs on this paper</p>
      <input class="lab-range" type="range" min="0" max="${Math.max(1,ft.wrong)}" value="${flip}" oninput="setMockLabFix(this.value)">
      <p class="muted" style="font-size:12px;margin-top:8px">${target-flipped>0?`${target-flipped} still short of ${target}.`:`That fix clears ${target} on this paper.`}</p>
      <p class="muted" style="font-size:12px;line-height:1.6;margin-top:10px">${lt.accuracy<0.75?`${weak[1]} is the softest percent, and accuracy is ${Math.round(lt.accuracy*100)}%. Cutting wrongs there moves the total faster than attempting the ${lt.skipped} left blank.`:`${Math.round(lt.accuracy*100)}% accuracy is usable. ${weak[1]} is still the drag.`}</p>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Papers</h3><div class="table-wrap"><table><thead><tr><th>PAPER</th><th>P</th><th>C</th><th>BOT</th><th>ZOO</th><th>SCORE</th><th>ACC</th><th></th></tr></thead><tbody>
    ${list.slice().reverse().map(m=>{const t=labTotals(m);return `<tr><td><b>${esc(m.name)}</b><div class="muted">${esc(m.date)}</div></td>${LAB_KEYS.map(([k])=>`<td>${labPart(m[k])}</td>`).join('')}<td><b>${t.score}</b></td><td>${Math.round(t.accuracy*100)}%</td><td><button class="icon-btn" onclick="deleteMockLab('${m.id}')">×</button></td></tr>`}).join('')}
  </tbody></table></div></div>`:'<div class="card"><div class="empty">No Mock Lab papers yet. Neeche right / wrong daalo — Physics aur Chemistry 45, Botany aur Zoology 45. +4 / −1.</div></div>'}
  <div class="card" style="margin-top:14px"><h3>Log a paper</h3>
    <form id="mockLabForm">
      <div class="form-grid">
        <div class="field"><label>NAME</label><input name="name" required placeholder="Full syllabus 10"></div>
        <div class="field"><label>DATE</label><input name="date" type="date" value="${today()}" required></div>
      </div>
      <div class="lab-grid">
        ${LAB_KEYS.map(([k,label,cap])=>`<fieldset class="sub-group-box" style="margin:0"><div class="sub-group-title">${label} · ${cap} Q</div><div class="form-grid"><div class="field"><label>RIGHT</label><input name="${k}C" inputmode="numeric" value="0"></div><div class="field"><label>WRONG</label><input name="${k}W" inputmode="numeric" value="0"></div></div></fieldset>`).join('')}
      </div>
      <button class="btn" style="margin-top:12px">Save paper</button>
    </form>
  </div>`;
}

function render(){
  try{
    const views={dashboard,missions,subjects,focus,practice:practiceView,analysis:analysisView,mistakes,revision,tests,mocklab:mockLabView,vault,aitutor:aiTutorView,analytics};
    const fn=views[current]||dashboard;
    const html=fn();
    const viewEl=document.getElementById('view');
    if(viewEl)viewEl.innerHTML=html;
    bindForms();
    updateTopFocusUI();
    try{updateStreakBadge()}catch(_){}
    if(current==='dashboard')startLiveCountdown();
    if(current==='practice' && practiceTab==='quiz' && activeQuiz && quizIdx<activeQuiz.length){
      startQuizStopwatch();
      if(!quizAnswered && getQuizPaceSec() && !quizPaceInterval)startQuizPace();
    }
    if(current==='focus'){
      const stBtn=document.getElementById('startTimer');
      const rsBtn=document.getElementById('resetTimer');
      if(stBtn)stBtn.onclick=startTimer;
      if(rsBtn)rsBtn.onclick=resetCurrentTimer;
      updateTimerDOM();
    }
  }catch(err){
    console.error('render failed',current,err);
    const viewEl=document.getElementById('view');
    if(viewEl)viewEl.innerHTML=`<div class="card"><h3>Screen load error</h3><p class="muted" style="font-size:12px;line-height:1.6">${esc(String(err&&err.message||err))}</p><div class="actions" style="margin-top:12px"><button type="button" class="btn" onclick="navigate('dashboard')">Reload Dashboard</button></div></div>`;
  }
}

function bindForms(){
  const bind=(id,fn)=>{const el=document.getElementById(id);if(el)el.onsubmit=async e=>{e.preventDefault();await fn(el)}};
  bind('taskForm',f=>{
    const remVal=(f.reminderAt?.value||'').trim();
    if(remVal&&('Notification' in window)&&Notification.permission==='default')requestBrowserNotifyPermission(false);
    const fMins=parseInt(f.focusMins?.value,10);
    const mType=f.missionType?.value||suggestMissionType(f.text.value)||'Practice';
    const stage=f.stage?.value||'today';
    const taskDate=stage==='today'&&remVal&&/^\d{4}-\d{2}-\d{2}/.test(remVal)?remVal.slice(0,10):today();
    db.tasks.push({
      id:crypto.randomUUID(),
      date:taskDate,
      stage,
      text:f.text.value.trim(),
      subject:f.subject.value,
      missionType:mType,
      done:false,
      ...(fMins>0?{focusMins:fMins}:{}),
      ...(remVal?{reminderAt:remVal,reminded:false}:{})
    });
    if(fMins>0 && !timerRunning){
      clearInterval(timerInterval);
      timerInitial=fMins*60;
      timerSeconds=fMins*60;
    }
    save();
    missionTab=stage;
    checkDueReminders();
    render();
    const where={open:'Open list',closed:'Closed list',today:'Today'}[stage];
    toast(fMins>0?`Mission (${mType}) & ${fMins}m focus saved → ${where}.`:`Mission (${mType}) added → ${where}.`);
  });
  bind('sessionForm',f=>{
    const mins=parseInt(f.minutes.value,10);
    const qs=parseInt(f.questions?.value,10)||0;
    if(!mins||mins<1){toast('Enter valid minutes.');return}
    db.sessions.push({id:crypto.randomUUID(),date:today(),subject:f.subject.value,minutes:mins,questions:qs,topic:f.topic.value.trim()});
    save();render();toast('Study session saved.');
  });
  bind('mistakeForm',async f=>{
    let fileMeta={};
    const fileInput=f.attachment.files[0];
    if(fileInput){
      const saved=await storeFile(fileInput);
      fileMeta={fileId:saved.id,fileName:saved.name,fileType:saved.type};
    }
    db.mistakes.push({id:crypto.randomUUID(),date:today(),subject:f.subject.value,type:f.type.value,chapter:f.chapter.value.trim(),error:f.error.value.trim(),fix:f.fix.value.trim(),...fileMeta});
    save();render();toast('Mistake recorded.');
  });
  bind('vaultForm',async f=>{
    const fileInput=f.file.files[0];
    const link=(f.link?.value||'').trim();
    if(link&&!/^https?:\/\//i.test(link)){toast('Link http:// ya https:// se shuru hona chahiye.');return}
    if(!fileInput&&!link){toast('File ya link me se kuch to daalo.');return}
    const saved=fileInput?await storeFile(fileInput):null;
    db.vault=db.vault||[];
    db.vault.push({id:crypto.randomUUID(),date:today(),title:f.title.value.trim(),subject:f.subject.value,chapter:(f.chapter&&f.chapter.value)||'',category:f.category.value,...(saved?{fileId:saved.id,fileName:saved.name,fileType:saved.type}:{}),...(link?{link}:{})});
    save();render();toast('Saved to Study Vault.');
  });
  bind('revisionForm',f=>{
    const d=today();
    db.revisions.push({id:crypto.randomUUID(),date:d,r3:addDays(d,3),r7:addDays(d,7),r21:addDays(d,21),chapter:f.chapter.value.trim(),subject:f.subject.value,kind:f.kind.value});
    save();render();toast('Revision logged (+3d / +7d / +21d scheduled).');
  });
  bind('upcomingForm',async f=>{
    let meta=null;
    const file=f.file.files[0];
    if(file){
      try{meta=await storeFile(file)}catch(_){toast('File save nahi hui, bina file ke save kar raha hoon.')}
    }
    db.upcomingTests=db.upcomingTests||[];
    db.upcomingTests.push({id:crypto.randomUUID(),name:f.name.value.trim(),date:f.date.value,time:f.time.value||'',syllabus:f.syllabus.value.trim(),...(meta?{fileId:meta.id,fileName:meta.name,fileType:meta.type}:{})});
    save();render();toast('Upcoming test added.');
  });
  bind('testForm',async f=>{
    const p=+f.physics.value||0,c=+f.chemistry.value||0,b=+f.biology.value||0;
    const manualScore=+f.score.value;
    const finalScore=(p||c||b)?(manualScore||p+c+b):manualScore;
    let meta=null;
    const file=f.file&&f.file.files[0];
    if(file){try{meta=await storeFile(file)}catch(_){toast('File save nahi hui, bina file ke save kar raha hoon.')}}
    db.tests.push({id:crypto.randomUUID(),date:today(),name:f.name.value.trim(),score:finalScore,accuracy:+f.accuracy.value||0,physics:p,chemistry:c,biology:b,analysis:'',analysisDone:!!(f.analysisDone&&f.analysisDone.checked),...(meta?{fileId:meta.id,fileName:meta.name,fileType:meta.type}:{})});
    save();render();toast('Mock test saved.');
  });
  bind('mockLabForm',f=>{
    const paper={id:crypto.randomUUID(),name:f.name.value.trim(),date:f.date.value||today()};
    for(const [k,label,cap] of LAB_KEYS){
      const c=Math.floor(Number(f[k+'C'].value)||0);
      const w=Math.floor(Number(f[k+'W'].value)||0);
      if(c<0||w<0||c+w>cap){toast(`${label}: right + wrong cannot pass ${cap}.`);return}
      paper[k]={c,w};
    }
    db.mockLabs=db.mockLabs||[];
    db.mockLabs.push(paper);
    mockLabFocusId=paper.id;
    save();render();toast('Mock Lab paper saved.');
  });
}

window.toggleTask=(id,v)=>{
  const t=db.tasks.find(x=>x.id===id);
  if(t){
    t.done=v;t.doneAt=v?today():null;
    if(!t.stage)t.stage='today';
  }
  save();render();
  if(t&&v)toast('Done ✅ — Done list me date ke saath add ho gaya.');
};
window.moveTask=(id,stage)=>{
  const t=db.tasks.find(x=>x.id===id);if(!t)return;
  t.stage=stage;
  if(stage==='today'){t.date=today();t.done=false;t.doneAt=null}
  save();render();
  toast(stage==='closed'?'Closed list me add 🎯':stage==='today'?'Aaj ke daily mission me add ✅':'Open list me wapas.');
};
window.setMissionTab=t=>{missionTab=t;render()};
window.setMistakeTab=t=>{mistakeTab=t;render()};
window.toggleMistake=id=>{let m=db.mistakes.find(x=>x.id===id);if(m){m.closed=!m.closed;m.closedAt=m.closed?today():null}save();render();toast(m&&m.closed?'Mistake closed.':'Mistake reopened.')};
window.deleteTask=id=>{db.tasks=db.tasks.filter(t=>t.id!==id);save();render();toast('Mission removed.')};
window.deleteChapter=(s,id)=>{if(!confirm('Delete this chapter and all its ticks and dates?'))return;db.chapters[s]=db.chapters[s].filter(x=>x.id!==id);save();keepScroll(render)};
window.removeItem=(list,id)=>{db[list]=db[list].filter(x=>x.id!==id);save();render();toast('Record removed.')};

const exportBtnEl=document.getElementById('exportBtn');
if(exportBtnEl)exportBtnEl.onclick=()=>{let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`igris-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast('Backup downloaded.')};
try{
  if(!db.syllabusLoaded&&Object.values(db.chapters||{}).every(a=>!(a&&a.length)))loadSyllabus(true);
}catch(e){console.warn('syllabus seed',e)}
try{
  if(!db.analysisTopicsSeeded){
    seedAnalysisTopicsToPractice();
    db.analysisTopicsSeeded=true;
    save();
  }
}catch(e){console.warn('analysis topic seed',e);db.analysisTopicsSeeded=true}
try{applyAppTheme()}catch(_){}
try{render()}catch(e){console.error('boot render',e)}
try{checkDueReminders()}catch(_){}
clearInterval(reminderInterval);
reminderInterval=setInterval(checkDueReminders,15000);
const importBtnEl=document.getElementById('importBtn');
const importFileEl=document.getElementById('importFile');
if(importBtnEl&&importFileEl)importBtnEl.onclick=()=>importFileEl.click();
if(importFileEl)importFileEl.onchange=e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d||!Array.isArray(d.tasks))throw new Error('bad');if(!confirm('Replace current data with this backup?')){e.target.value='';return}db={...seed(),...d};save();render();toast('Backup imported.')}catch(_){toast('Invalid backup file.')}e.target.value=''};r.readAsText(file)};

window.addEventListener('pagehide',()=>{
  try{flushMissionSession();saveQuizProgress();save()}catch(_){}
});
window.addEventListener('beforeunload',()=>{
  try{flushMissionSession();saveQuizProgress();save()}catch(_){}
});
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden){try{flushMissionSession();saveQuizProgress();save()}catch(_){}return}
  timerTick();
  checkDueReminders();
  const el=document.getElementById('timerFull');
  if(el&&!el.hidden&&'wakeLock' in navigator){try{wakeLock=await navigator.wakeLock.request('screen')}catch(_){}}
});


/* ===== Emoji fallback for old PCs/browsers that show ▯ boxes =====
   Only activates if the device can't draw color emoji. Uses Twemoji images (needs internet once; cached after). */
(function(){
  function colorEmojiOk(ch){
    try{
      const c=document.createElement('canvas');c.width=c.height=36;
      const x=c.getContext('2d');x.textBaseline='top';x.font='24px sans-serif';x.fillText(ch,2,2);
      const d=x.getImageData(0,0,36,36).data;
      for(let i=0;i<d.length;i+=4){
        if(d[i+3]>40&&(Math.abs(d[i]-d[i+1])>25||Math.abs(d[i+1]-d[i+2])>25))return true;
      }
      return false;
    }catch(e){return true} // can't test -> don't touch anything
  }
  function init(){
    if(colorEmojiOk('\u{1F600}')&&colorEmojiOk('\u{1F974}'))return; // emoji already fine here
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@twemoji/api@15.1.0/dist/twemoji.min.js';
    s.crossOrigin='anonymous';
    s.onload=start;
    document.head.appendChild(s);
  }
  const SKIP={SCRIPT:1,STYLE:1,TEXTAREA:1,SELECT:1,OPTION:1,TITLE:1,NOSCRIPT:1,INPUT:1};
  function escapeHtml(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function fixText(n){
    const p=n.parentNode;
    if(!p||SKIP[p.nodeName]||!window.twemoji||!twemoji.test(n.nodeValue))return;
    const box=document.createElement('span');
    box.innerHTML=twemoji.parse(escapeHtml(n.nodeValue),{folder:'svg',ext:'.svg',className:'emoji'});
    const frag=document.createDocumentFragment();
    while(box.firstChild)frag.appendChild(box.firstChild);
    p.replaceChild(frag,n);
  }
  function fixTree(root){
    if(!root||!root.isConnected)return;
    if(root.nodeType===3){fixText(root);return}
    if(root.nodeType!==1||SKIP[root.nodeName])return;
    const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null);
    const list=[];let n;
    while((n=w.nextNode()))list.push(n);
    list.forEach(fixText);
  }
  function start(){
    fixTree(document.body);
    const pending=new Set();let queued=false;
    const mo=new MutationObserver(muts=>{
      muts.forEach(m=>{
        if(m.type==='characterData')pending.add(m.target);
        else m.addedNodes.forEach(nd=>pending.add(nd));
      });
      if(queued)return;queued=true;
      requestAnimationFrame(()=>{
        queued=false;
        mo.disconnect();
        const items=Array.from(pending);pending.clear();
        items.forEach(fixTree);
        mo.observe(document.body,{childList:true,subtree:true,characterData:true});
      });
    });
    mo.observe(document.body,{childList:true,subtree:true,characterData:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
