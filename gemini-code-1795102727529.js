const KEY='igris-neet-v1';
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const seed=()=>({
  tasks:[],
  chapters:{Physics:[],Chemistry:[],Biology:[]},
  sessions:[],
  mistakes:[],
  revisions:[],
  tests:[],
  vault:[],
  quizzes:[],
  quizAttempts:[],
  settings:{name:'IGRIS',currentRank:'4 Lakh',upcomingRank:'10k',geminiKey:''}
});

let db=load(), current='dashboard', missionTab='open', mistakeTab='open', practiceTab='quiz', trackTab='Physics', strengthFilter='All', vaultFilter='All', attemptChapterFilter='All';
let timerSeconds=25*60, timerInitial=25*60, timerRunning=false, timerInterval=null, clockInterval=null;
let activeQuiz=null, activeQuizMeta={subject:'All',chapter:'All'}, quizIdx=0, quizScore=0, quizAnswered=false, quizWrongList=[], retestIdx=0, aiOutput='';

const SAMPLE_JSON=JSON.stringify([
  {
    "subject":"Biology",
    "chapter":"Cell Cycle and Cell Division",
    "q":"Crossing over takes place between non-sister chromatids of homologous chromosomes during which stage of meiosis I?",
    "opts":["Leptotene","Pachytene","Diplotene","Diakinesis"],
    "ans":1,
    "exp":"Recombination nodules appear during Pachytene where crossing over occurs between non-sister chromatids."
  },
  {
    "subject":"Physics",
    "chapter":"Laws of Motion",
    "q":"A block of mass 5 kg rests on a horizontal surface (mu = 0.2). What horizontal force is just sufficient to move it? (g = 10 m/s^2)",
    "opts":["5 N","10 N","15 N","20 N"],
    "ans":1,
    "exp":"Limiting friction f_max = mu * N = 0.2 * (5 * 10) = 10 N."
  }
],null,2);

function load(){
  try{
    const parsed=JSON.parse(localStorage.getItem(KEY)||'{}');
    const base=seed();
    return {...base,...parsed,settings:{...base.settings,...(parsed.settings||{})}};
  }catch(e){return seed()}
}
function save(){localStorage.setItem(KEY,JSON.stringify(db));}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(s){let t=document.getElementById('toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}
function dateText(d=today()){return new Date(d+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}

/* Global Zen Mode */
window.toggleZenMode=force=>{
  const next=typeof force==='boolean'?force:!document.body.classList.contains('zen-mode');
  document.body.classList.toggle('zen-mode',next);
  toast(next?'Full view enabled (Sidebar hidden).':'Sidebar restored.');
};
document.getElementById('zenBtn').onclick=()=>toggleZenMode();

/* Dedicated Full-Display Timer Mode */
window.toggleTimerFullscreen=open=>{
  const overlay=document.getElementById('timerFullscreen');
  overlay.classList.toggle('open',open);
  updateTimerDOM();
  if(open && document.documentElement.requestFullscreen && !document.fullscreenElement){
    document.documentElement.requestFullscreen().catch(()=>{});
  }else if(!open && document.fullscreenElement){
    document.exitFullscreen().catch(()=>{});
  }
};
window.resetCurrentTimer=()=>setTimer(Math.round(timerInitial/60)||25);

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(document.getElementById('timerFullscreen').classList.contains('open'))toggleTimerFullscreen(false);
    else if(document.body.classList.contains('zen-mode'))toggleZenMode(false);
  }
});

/* IndexedDB Helper for Screenshots & PDFs */
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
  const dataUrl=await new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=()=>rej(r.error);
    r.readAsDataURL(file);
  });
  const idb=await openFilesDB();
  await new Promise((res,rej)=>{
    const tx=idb.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).put({id,name:file.name,type:file.type,dataUrl});
    tx.oncomplete=res;
    tx.onerror=()=>rej(tx.error);
  });
  return {id,name:file.name,type:file.type};
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
  const idb=await openFilesDB();
  const tx=idb.transaction(STORE_NAME,'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
}
window.previewFile=async(fileId)=>{
  const rec=await getStoredFile(fileId);
  if(!rec){toast('File not found in local vault.');return}
  document.getElementById('previewTitle').textContent=rec.name;
  const body=document.getElementById('previewBody');
  body.innerHTML=rec.type==='application/pdf'?`<iframe src="${rec.dataUrl}"></iframe>`:`<img src="${rec.dataUrl}" alt="${esc(rec.name)}">`;
  document.getElementById('previewModal').classList.add('open');
};
window.closePreview=()=>{
  document.getElementById('previewModal').classList.remove('open');
  document.getElementById('previewBody').innerHTML='';
};

document.getElementById('dateChip').textContent=dateText();
document.getElementById('menuBtn').onclick=()=>document.getElementById('sidebar').classList.toggle('open');
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>navigate(b.dataset.view));

function navigate(v){
  current=v;
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  document.getElementById('sidebar').classList.remove('open');
  render();
}
function title(s){document.getElementById('viewTitle').textContent=s}
function stat(label,value,note){return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`}
function progress(label,done,total){let p=total?Math.round(done/total*100):0;return `<div class="progress-row"><div class="progress-meta"><span>${label}</span><span>${p}%</span></div><div class="bar"><span style="width:${p}%"></span></div></div>`}
function todayTasks(){return db.tasks.filter(t=>t.date===today())}
function totalMinutes(){return db.sessions.filter(s=>s.date===today()).reduce((a,s)=>a+s.minutes,0)}
function totalQuestionsToday(){return db.sessions.filter(s=>s.date===today()).reduce((a,s)=>a+(s.questions||0),0)}
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

function weakChaptersList(){
  const out=[];
  for(const sub of Object.keys(db.chapters)){
    for(const c of db.chapters[sub]){
      if(c.strength==='Weak'||(c.weakTopics&&c.weakTopics.trim())){
        out.push({sub,name:c.name,weakTopics:c.weakTopics||''});
      }
    }
  }
  return out;
}

function dashboard(){
  title('Dashboard');
  let tasks=todayTasks(),done=tasks.filter(t=>t.done).length,mins=totalMinutes(),qCount=totalQuestionsToday(),openMistakes=db.mistakes.filter(m=>!m.closed).length;
  const curRank=esc(db.settings.currentRank||'4 Lakh'), upRank=esc(db.settings.upcomingRank||'10k');
  const weakList=weakChaptersList().slice(0,4);
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
  <div class="stats">
    ${stat('MISSIONS COMPLETED',`${done}/${tasks.length}`,'Today’s task progress')}
    ${stat('FOCUS TIME',`${Math.floor(mins/60)}h ${mins%60}m`,`${qCount} Qs logged today`)}
    ${stat('OPEN MISTAKES',openMistakes,`${db.mistakes.length} total tracked`)}
    ${stat('SAVED ATTEMPTS',(db.quizAttempts||[]).length,`${(db.quizzes||[]).length} MCQs in bank`)}
  </div>
  <div class="two-col">
    <div>
      <div class="section-head"><h2>Today's Missions</h2><small>${dateText()}</small></div>
      <div class="card">
        ${tasks.length?tasks.map(taskHTML).join(''):'<div class="empty">No missions added yet. Create your first daily target.</div>'}
        <div class="actions" style="margin-top:12px"><button class="btn" onclick="navigate('missions')">Manage missions</button></div>
      </div>
      <div class="section-head"><h2>Focus — last 7 days</h2><small>MINUTES</small></div>
      <div class="card">${barChart(dayKeys(7).map(dayLabel),dayKeys(7).map(k=>db.sessions.filter(x=>x.date===k).reduce((a,x)=>a+x.minutes,0)),'bar-focus')}</div>
      <div class="section-head"><h2>Subject Progress</h2><small>CHAPTERS MARKED COMPLETE</small></div>
      <div class="card">${['Physics','Chemistry','Biology'].map(s=>progress(s,db.chapters[s].filter(c=>c.done).length,db.chapters[s].length)).join('')||'No chapters yet'}</div>
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
      <div class="section-head"><h2>Weak Radar</h2><small>PRIORITY CHAPTERS</small></div>
      <div class="card">
        ${weakList.length?weakList.map(w=>`<div class="list-item"><div><b>${esc(w.name)}</b><div class="muted">${esc(w.sub)}${w.weakTopics?' • '+esc(w.weakTopics):''}</div></div><span class="tag">WEAK</span></div>`).join(''):'<div class="empty">Mark chapters as Weak in Subject HQ to track priority areas here.</div>'}
      </div>
      <div class="section-head"><h2>Recent Activity</h2><small>LATEST RECORDS</small></div>
      <div class="card">${recentActivity()}</div>
    </div>
  </div>`;
}

function taskHTML(t){const old=!t.done&&t.date<today()?`<span class="tag gold">${dateText(t.date)}</span>`:'';return `<label class="task ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="toggleTask('${t.id}',this.checked)"><span class="task-text">${esc(t.text)}</span>${old}<small>${esc(t.subject||'GENERAL')}</small><button class="icon-btn" style="padding:3px 7px" onclick="deleteTask('${t.id}')">×</button></label>`}
function recentActivity(){let items=[...db.sessions.map(x=>({date:x.date,text:`Focus session • ${x.subject} • ${x.minutes} min${x.questions?' • '+x.questions+' Qs':''}`})),...db.tests.map(x=>({date:x.date,text:`Mock test • ${x.name} • ${x.score} marks`})),...(db.quizAttempts||[]).map(x=>({date:x.date,text:`Quiz (${x.chapter}) • ${x.score}/${x.total} (${x.accuracy}%)`})),...allRevs().slice(0,5).map(x=>({date:x.date,text:`Revision • ${x.chapter} (${x.kind})`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);return items.length?items.map(x=>`<div class="list-item"><span>${esc(x.text)}</span><span class="muted">${x.date}</span></div>`).join(''):'<div class="empty">Your activity will appear here as you use IGRIS.</div>'}
function tabsHTML(cur,open,closed,fn){return `<div class="tabs"><button type="button" class="tab ${cur==='open'?'active':''}" onclick="${fn}('open')">Open <b>${open}</b></button><button type="button" class="tab ${cur==='closed'?'active':''}" onclick="${fn}('closed')">Closed <b>${closed}</b></button></div>`}

function missions(){
  title('Daily Missions');
  const open=db.tasks.filter(t=>!t.done).sort((a,b)=>a.date.localeCompare(b.date)),closed=db.tasks.filter(t=>t.done).sort((a,b)=>(b.doneAt||b.date).localeCompare(a.doneAt||a.date)),tt=todayTasks(),td=tt.filter(t=>t.done).length,list=missionTab==='open'?open:closed;
  const empty=missionTab==='open'?'No open missions. Add a task to begin.':'No closed missions yet. Complete one to see it here.';
  return `<div class="section-head"><h2>Mission Board</h2><small>${dateText()} • ${td}/${tt.length} TODAY</small></div>
  <div class="two-col">
    <div class="card"><h3>Your missions</h3>${tabsHTML(missionTab,open.length,closed.length,'setMissionTab')}${list.length?list.map(taskHTML).join(''):`<div class="empty">${empty}</div>`}<div style="margin-top:12px">${progress('TODAY’S COMPLETION',td,tt.length)}</div></div>
    <div class="card"><h3>Deploy a new mission</h3>
      <form id="taskForm">
        <div class="field"><label>TASK DESCRIPTION</label><input name="text" placeholder="e.g. Revise NLM notes + 30 MCQs" required></div>
        <div class="field"><label>SUBJECT</label><select name="subject"><option>General</option><option>Physics</option><option>Chemistry</option><option>Biology</option></select></div>
        <button class="btn">＋ Add mission</button>
      </form>
      <p class="muted" style="font-size:10px;line-height:1.6;margin-top:16px">Open missions carry over until you close them.</p>
    </div>
  </div>`;
}

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
        <option value="Strong" ${strengthFilter==='Strong'?'selected':''}>🟢 Strong (${allList.filter(c=>c.strength==='Strong').length})</option>
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

/* Focus Room with Flip Clock, Custom Time, Full-Display Mode & Questions Solved Log */
function timerParts(sec){
  const h=Math.floor(sec/3600);
  const m=Math.floor((sec%3600)/60);
  const s=sec%60;
  return {h:pad2(h),m:pad2(m),s:pad2(s)};
}

function focus(){
  title('Focus Room');
  const {h,m,s}=timerParts(timerSeconds);
  return `<div class="section-head"><h2>Deep Work Protocol</h2><small>FLIP TIMER • FULL-DISPLAY MODE • CLEAN LOG</small></div>
  <div class="two-col">
    <div class="card timer-wrap">
      <div class="timer-top-bar">
        <div class="timer-state" id="timerState">${timerRunning?'FOCUS SESSION ACTIVE':'READY WHEN YOU ARE'}</div>
        <button type="button" class="btn secondary" style="padding:6px 10px" onclick="toggleTimerFullscreen(true)">⛶ Full Display</button>
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
      <p class="muted" style="font-size:10px;margin-top:10px">Sessions are only saved when a timer finishes OR when you manually click "Save session" on the right.</p>
    </div>
    <div class="card">
      <h3>Log a completed study session</h3>
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
      <div class="section-head"><h2>Today's sessions</h2><small>${totalMinutes()} MIN • ${totalQuestionsToday()} Qs</small></div>
      ${db.sessions.filter(s=>s.date===today()).map(s=>`<div class="list-item"><span>${esc(s.subject)} — ${esc(s.topic||'Study session')}${s.questions?` <span class="tag blue">${s.questions} Qs</span>`:''}</span><div style="display:flex;align-items:center;gap:8px"><b>${s.minutes}m</b><button type="button" class="icon-btn" style="padding:2px 6px" onclick="removeItem('sessions','${s.id}')">×</button></div></div>`).join('')||'<div class="empty">No sessions logged today.</div>'}
    </div>
  </div>`;
}

function updateTimerDOM(){
  const {h,m,s}=timerParts(timerSeconds);
  const eh=document.getElementById('tHrs'),em=document.getElementById('tMins'),es=document.getElementById('tSecs');
  if(eh)eh.textContent=h;
  if(em)em.textContent=m;
  if(es)es.textContent=s;
  const fh=document.getElementById('fsHrs'),fm=document.getElementById('fsMins'),fs=document.getElementById('fsSecs');
  if(fh)fh.textContent=h;
  if(fm)fm.textContent=m;
  if(fs)fs.textContent=s;
  const btnText=timerRunning?'Pause':'Start focus';
  const b1=document.getElementById('startTimer'),b2=document.getElementById('fsStartBtn');
  if(b1)b1.textContent=btnText;
  if(b2)b2.textContent=btnText;
}
window.setTimer=m=>{
  clearInterval(timerInterval);
  timerRunning=false;
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
function startTimer(){
  timerRunning=!timerRunning;
  const st=document.getElementById('timerState'),fst=document.getElementById('fsTimerState');
  if(timerRunning){
    if(st)st.textContent='FOCUS SESSION ACTIVE';
    if(fst)fst.textContent='DEEP FOCUS ACTIVE';
    timerInterval=setInterval(()=>{
      timerSeconds--;
      updateTimerDOM();
      if(timerSeconds<=0){
        clearInterval(timerInterval);
        timerRunning=false;
        const completedMins=Math.max(1,Math.round(timerInitial/60));
        db.sessions.push({id:crypto.randomUUID(),date:today(),subject:'Focus Timer',minutes:completedMins,questions:0,topic:'Completed flip timer session'});
        save();
        toggleTimerFullscreen(false);
        toast(`Focus complete! ${completedMins} min session logged.`);
        render();
      }
    },1000);
  }else{
    clearInterval(timerInterval);
    if(st)st.textContent='PAUSED';
    if(fst)fst.textContent='SESSION PAUSED';
  }
  updateTimerDOM();
}

/* Practice & Quiz Section: Bulk JSON MCQ Quiz + Chapter-Wise Saved Attempts + Mistake Re-Test */
window.setPracticeTab=t=>{practiceTab=t;render()};
window.setAttemptChapterFilter=ch=>{attemptChapterFilter=ch;render()};

window.loadSampleJson=()=>{
  const ta=document.getElementById('bulkJsonInput');
  if(ta){ta.value=SAMPLE_JSON;toast('Sample NEET JSON loaded.')}
};

window.importBulkJson=()=>{
  const ta=document.getElementById('bulkJsonInput');
  if(!ta||!ta.value.trim()){toast('Paste JSON first.');return}
  try{
    let raw=ta.value.trim();
    raw=raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/,'');
    const arr=JSON.parse(raw);
    if(!Array.isArray(arr)||!arr.length)throw new Error('Empty');
    const cleaned=[];
    for(const item of arr){
      if(!item.q || !Array.isArray(item.opts) || item.opts.length<2)continue;
      let ansIdx=0;
      if(typeof item.ans==='number')ansIdx=Math.max(0,Math.min(item.opts.length-1,item.ans));
      else if(typeof item.ans==='string'){
        const letterMap={'A':0,'B':1,'C':2,'D':3};
        const up=item.ans.trim().toUpperCase();
        if(up in letterMap)ansIdx=letterMap[up];
        else{
          const found=item.opts.findIndex(o=>o.trim().toLowerCase()===item.ans.trim().toLowerCase());
          ansIdx=found>=0?found:0;
        }
      }
      cleaned.push({
        id:crypto.randomUUID(),
        subject:item.subject||'Biology',
        chapter:item.chapter||'General Practice',
        q:String(item.q).trim(),
        opts:item.opts.map(o=>String(o)),
        ans:ansIdx,
        exp:String(item.exp||'').trim()
      });
    }
    if(!cleaned.length)throw new Error('No valid MCQs');
    db.quizzes=db.quizzes||[];
    db.quizzes.push(...cleaned);
    save();
    const chapters=[...new Set(cleaned.map(x=>x.chapter))];
    activeQuiz=cleaned;
    activeQuizMeta={subject:cleaned[0].subject||'Mixed',chapter:chapters.length===1?chapters[0]:'Mixed Chapters'};
    quizIdx=0;
    quizScore=0;
    quizAnswered=false;
    quizWrongList=[];
    render();
    toast(`${cleaned.length} MCQs imported & quiz started!`);
  }catch(err){
    toast('Invalid JSON format. Check brackets and commas.');
  }
};

window.startSavedQuiz=(subFilter='All',chapFilter='All')=>{
  const pool=(db.quizzes||[]).filter(q=>(subFilter==='All'||q.subject===subFilter)&&(chapFilter==='All'||q.chapter===chapFilter));
  if(!pool.length){toast('No saved MCQs for this filter.');return}
  activeQuiz=pool.slice();
  activeQuizMeta={subject:subFilter,chapter:chapFilter==='All'?'All Chapters':chapFilter};
  quizIdx=0;
  quizScore=0;
  quizAnswered=false;
  quizWrongList=[];
  render();
};

function saveQuizAttemptIfDone(){
  if(!activeQuiz||!activeQuiz.length)return;
  const total=activeQuiz.length;
  const acc=Math.round(quizScore/total*100);
  db.quizAttempts=db.quizAttempts||[];
  db.quizAttempts.push({
    id:crypto.randomUUID(),
    date:today(),
    subject:activeQuizMeta.subject||'Mixed',
    chapter:activeQuizMeta.chapter||'General Practice',
    score:quizScore,
    total,
    accuracy:acc,
    wrongItems:quizWrongList.slice()
  });
  save();
  toast(`Attempt saved under ${activeQuizMeta.chapter}!`);
}

window.answerQuizOpt=(choiceIdx)=>{
  if(quizAnswered||!activeQuiz||!activeQuiz[quizIdx])return;
  quizAnswered=true;
  const curQ=activeQuiz[quizIdx];
  const isCorrect=choiceIdx===curQ.ans;
  if(isCorrect)quizScore++;
  else{
    quizWrongList.push({q:curQ.q,picked:curQ.opts[choiceIdx],correct:curQ.opts[curQ.ans],exp:curQ.exp||''});
    const exists=db.mistakes.some(m=>!m.closed && m.error.includes(curQ.q.slice(0,45)));
    if(!exists){
      db.mistakes.push({
        id:crypto.randomUUID(),
        date:today(),
        subject:curQ.subject||'Biology',
        type:'Concept gap',
        chapter:curQ.chapter||'Quiz Practice',
        error:`Wrong MCQ: ${curQ.q} (Picked: ${curQ.opts[choiceIdx]})`,
        fix:curQ.exp||`Correct answer is ${curQ.opts[curQ.ans]}.`
      });
      save();
      toast('Wrong MCQ auto-added to Mistake Hunter.');
    }
  }
  if(quizIdx+1>=activeQuiz.length)saveQuizAttemptIfDone();
  render();
};

window.nextQuizQuestion=()=>{
  quizIdx++;
  quizAnswered=false;
  render();
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
  activeQuiz=null;
  save();
  render();
  toast('Saved MCQs cleared.');
};

window.retestResult=(mistakeId,passed)=>{
  const m=db.mistakes.find(x=>x.id===mistakeId);
  if(m){
    if(passed){m.closed=true;m.closedAt=today()}
    save();
  }
  retestIdx++;
  render();
  toast(passed?'Mistake marked Fixed!':'Kept in Open Mistakes for next round.');
};

function practiceView(){
  title('Practice & Quiz');
  const qBank=db.quizzes||[];
  const attempts=db.quizAttempts||[];
  const openMistakes=db.mistakes.filter(m=>!m.closed);
  const safeRetestIdx=openMistakes.length?(retestIdx%openMistakes.length):0;
  const curRetest=openMistakes[safeRetestIdx];
  const quizChapters=[...new Set(qBank.map(q=>q.chapter).filter(Boolean))];
  const attemptChapters=['All',...new Set(attempts.map(a=>a.chapter).filter(Boolean))];
  const filteredAttempts=(attemptChapterFilter==='All'?attempts:attempts.filter(a=>a.chapter===attemptChapterFilter)).slice().reverse();

  return `<div class="tabs">
    <button type="button" class="tab ${practiceTab==='quiz'?'active':''}" onclick="setPracticeTab('quiz')">Bulk JSON MCQ Quiz <b>${qBank.length}</b></button>
    <button type="button" class="tab ${practiceTab==='attempts'?'active':''}" onclick="setPracticeTab('attempts')">Saved Attempts <b>${attempts.length}</b></button>
    <button type="button" class="tab ${practiceTab==='retest'?'active':''}" onclick="setPracticeTab('retest')">Mistake Re-Test <b>${openMistakes.length}</b></button>
  </div>

  ${practiceTab==='quiz'?`
    <div class="two-col">
      <div class="card">
        <h3>${activeQuiz && quizIdx < activeQuiz.length ? `Active Quiz (${quizIdx+1}/${activeQuiz.length}) • Score: ${quizScore}` : activeQuiz && quizIdx >= activeQuiz.length ? 'Quiz Completed & Saved!' : 'MCQ Quiz Runner'}</h3>
        ${activeQuiz && quizIdx < activeQuiz.length ? (()=>{
          const q=activeQuiz[quizIdx];
          return `<div>
            <span class="tag blue">${esc(q.subject)} • ${esc(q.chapter)}</span>
            <p style="font-size:13px;font-weight:700;line-height:1.6;margin:10px 0 12px">${esc(q.q)}</p>
            ${q.opts.map((opt,i)=>{
              let cls='opt-btn';
              if(quizAnswered && i===q.ans)cls+=' correct';
              return `<button type="button" class="${cls}" ${quizAnswered?'disabled':''} onclick="answerQuizOpt(${i})"><b>${String.fromCharCode(65+i)}.</b> <span>${esc(opt)}</span></button>`;
            }).join('')}
            ${quizAnswered?`<div class="ai-reply-box"><b>Correct Answer: ${String.fromCharCode(65+q.ans)}. ${esc(q.opts[q.ans])}</b>\n${esc(q.exp||'Review this concept before moving on.')}</div>
            <div class="actions" style="margin-top:12px"><button type="button" class="btn" onclick="nextQuizQuestion()">${quizIdx+1<activeQuiz.length?'Next Question →':'Finish & Save Attempt'}</button></div>`:''}
          </div>`;
        })() : activeQuiz && quizIdx >= activeQuiz.length ? `
          <div class="card" style="background:#0c0c12;text-align:center;padding:24px">
            <div class="eyebrow">SAVED UNDER • ${esc(activeQuizMeta.chapter)}</div>
            <div style="font-size:36px;font-weight:800;margin:8px 0">${quizScore} / ${activeQuiz.length}</div>
            <div class="muted" style="font-size:12px">Accuracy: ${Math.round(quizScore/activeQuiz.length*100)}% • Check "Saved Attempts" tab for chapter history.</div>
            <div class="actions" style="justify-content:center;margin-top:16px">
              <button type="button" class="btn" onclick="activeQuiz=null;quizIdx=0;render()">Import New Batch</button>
              <button type="button" class="btn secondary" onclick="setPracticeTab('attempts')">View Saved Attempts</button>
            </div>
          </div>
        ` : `
          <div class="empty">Paste JSON MCQs on the right to start immediately, or launch from your saved question bank (${qBank.length} saved).</div>
          <div class="actions" style="margin-top:8px">
            <button type="button" class="btn secondary" onclick="startSavedQuiz('All','All')">Start All Saved (${qBank.length})</button>
            <button type="button" class="btn ghost" onclick="startSavedQuiz('Physics','All')">Physics</button>
            <button type="button" class="btn ghost" onclick="startSavedQuiz('Chemistry','All')">Chemistry</button>
            <button type="button" class="btn ghost" onclick="startSavedQuiz('Biology','All')">Biology</button>
            ${qBank.length?`<button type="button" class="btn danger" onclick="clearSavedQuizzes()">Clear Bank</button>`:''}
          </div>
          ${quizChapters.length?`<div style="margin-top:16px"><div class="eyebrow" style="margin-bottom:8px">START BY CHAPTER</div><div class="actions">${quizChapters.map(ch=>`<button type="button" class="btn ghost" style="padding:6px 10px" onclick="startSavedQuiz('All',${JSON.stringify(ch)})">${esc(ch)} (${qBank.filter(x=>x.chapter===ch).length})</button>`).join('')}</div></div>`:''}
        `}
      </div>

      <div class="card">
        <h3>Bulk JSON Import (No Manual Typing)</h3>
        <div class="field">
          <label>PASTE MCQ JSON ARRAY</label>
          <textarea id="bulkJsonInput" class="code-box" placeholder='[{"subject":"Biology","chapter":"Genetics","q":"...","opts":["A","B","C","D"],"ans":0,"exp":"..."}]'></textarea>
        </div>
        <div class="actions">
          <button type="button" class="btn" onclick="importBulkJson()">⚡ Import & Start Quiz</button>
          <button type="button" class="btn secondary" onclick="loadSampleJson()">Load Sample JSON</button>
        </div>
        <p class="muted" style="font-size:10px;line-height:1.6;margin-top:12px">Tip: PDF ya coaching sheet ko AI Tutor / Gemini / GPT mein dekar JSON banwayein, phir yahan paste karein.</p>
      </div>
    </div>
  ` : practiceTab==='attempts' ? `
    <div class="card">
      <div class="section-head" style="margin-top:0">
        <h3>Chapter-Wise Saved Attempts (${filteredAttempts.length})</h3>
        <select class="str-select" style="background:#14141d;color:#ddd" onchange="setAttemptChapterFilter(this.value)">
          ${attemptChapters.map(ch=>`<option value="${esc(ch)}" ${attemptChapterFilter===ch?'selected':''}>${ch==='All'?'All Chapters':ch}</option>`).join('')}
        </select>
      </div>
      ${filteredAttempts.length ? filteredAttempts.map(a=>`
        <div class="list-item" style="align-items:flex-start">
          <div>
            <b>${esc(a.chapter)}</b> <span class="tag blue">${esc(a.subject)}</span> <span class="tag green">${a.score}/${a.total} (${a.accuracy}%)</span>
            <div class="muted" style="margin-top:4px">Attempted on ${esc(a.date)}</div>
            ${a.wrongItems && a.wrongItems.length ? `<div style="margin-top:6px;font-size:11px;color:#f2a0a8">Missed ${a.wrongItems.length} Q(s): ${a.wrongItems.map(w=>esc(w.q.slice(0,55))).join(' • ')}</div>`:`<div style="margin-top:5px;font-size:11px;color:#7bd5a9">100% accuracy on attempted questions!</div>`}
          </div>
          <div class="actions">
            ${a.chapter && a.chapter!=='Mixed Chapters' && qBank.some(q=>q.chapter===a.chapter)?`<button type="button" class="btn secondary" style="padding:5px 9px" onclick="startSavedQuiz('All',${JSON.stringify(a.chapter)})">Re-Attempt</button>`:''}
            <button type="button" class="icon-btn" onclick="deleteAttempt('${a.id}')">×</button>
          </div>
        </div>
      `).join('') : '<div class="empty">Complete a quiz to save chapter-wise attempt history here.</div>'}
    </div>
  ` : `
    <div class="two-col">
      <div class="card">
        <h3>Mistake Re-Test Queue (${openMistakes.length} Open)</h3>
        ${curRetest ? `
          <span class="tag">${esc(curRetest.subject)} • ${esc(curRetest.chapter)} • ${curRetest.date}</span>
          <div style="margin-top:10px;font-size:12px;color:#777682">ERROR LOGGED:</div>
          <p style="font-size:13px;font-weight:700;line-height:1.6;margin:4px 0 12px">${esc(curRetest.error)}</p>
          ${curRetest.fix?`<div class="ai-reply-box"><b>Your Takeaway / Fix:</b>\n${esc(curRetest.fix)}</div>`:''}
          <div class="actions" style="margin-top:14px">
            <button type="button" class="btn" style="background:#1b6e4d" onclick="retestResult('${curRetest.id}',true)">✓ Solved — Mark Fixed</button>
            <button type="button" class="btn secondary" onclick="retestResult('${curRetest.id}',false)">↺ Still Tricky — Next</button>
          </div>
        ` : '<div class="empty">No open mistakes in Re-Test queue. Great job!</div>'}
      </div>
      <div class="card">
        <h3>Open Mistakes List</h3>
        ${openMistakes.length?openMistakes.slice().reverse().map(m=>`<div class="list-item"><div><b>${esc(m.chapter)}</b><div class="muted">${esc(m.subject)} • ${esc(m.error.slice(0,75))}</div></div><span class="tag">${esc(m.type)}</span></div>`).join(''):'<div class="empty">All logged mistakes are fixed.</div>'}
      </div>
    </div>
  `}
  `;
}

/* AI Tutor Section: One-Click Prompt Builder + Optional Gemini BYOK Runner */
window.buildTutorPrompt=(mode)=>{
  const sub=document.getElementById('aiSub')?.value||'Biology';
  const chap=document.getElementById('aiChap')?.value.trim()||'NCERT Chapter';
  const topic=document.getElementById('aiTopic')?.value.trim()||'High-yield NEET concepts & PYQs';
  const count=document.getElementById('aiCount')?.value||'10';
  let prompt='';
  if(mode==='json_quiz'){
    prompt=`Act as a NEET exam question maker for ${sub} (Chapter: "${chap}", Topic: "${topic}"). Create ${count} NCERT-aligned multiple choice questions. Return ONLY a valid JSON array in this exact schema with no extra text:\n[{"subject":"${sub}","chapter":"${chap}","q":"Question text","opts":["Option A","Option B","Option C","Option D"],"ans":0,"exp":"Short clear explanation"}]`;
  }else if(mode==='doubt'){
    prompt=`Explain "${topic}" from ${sub} (${chap}) for a NEET aspirant. Keep it crisp, highlight NCERT traps or common formula mistakes, and give 2 quick check questions at the end.`;
  }else{
    const openErrs=db.mistakes.filter(m=>!m.closed).slice(-5).map(m=>`- [${m.subject} - ${m.chapter}] ${m.error}`).join('\n') || '- Focus on NCERT exceptions and numerical speed.';
    prompt=`Here are my recent NEET mistakes:\n${openErrs}\n\nCreate a focused practice plan and 8 MCQs targeting these exact weak points in JSON format:\n[{"subject":"${sub}","chapter":"${chap}","q":"Question","opts":["A","B","C","D"],"ans":0,"exp":"Why this is right"}]`;
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
  const key=(db.settings.geminiKey||'').trim();
  const prompt=document.getElementById('aiPromptBox')?.textContent||'';
  if(!key){toast('Add a Gemini API key first or use Copy Prompt.');return}
  if(!prompt)return;
  aiOutput='Thinking...';
  render();
  try{
    const res=await fetch(`[https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$){encodeURIComponent(key)}`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})
    });
    const data=await res.json();
    aiOutput=data?.candidates?.[0]?.content?.parts?.[0]?.text || data?.error?.message || 'No response received.';
  }catch(e){
    aiOutput='Network error while contacting Gemini API. You can still use Copy Prompt with any AI chat.';
  }
  render();
};

function aiTutorView(){
  title('AI Tutor');
  const defaultPrompt=`Act as a NEET exam question maker for Biology (Chapter: "Cell Cycle", Topic: "Meiosis"). Create 8 NCERT-aligned MCQs. Return ONLY a valid JSON array:\n[{"subject":"Biology","chapter":"Cell Cycle","q":"Question","opts":["A","B","C","D"],"ans":0,"exp":"Explanation"}]`;
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
        <button type="button" class="btn" onclick="runGeminiDirect()">✦ Ask Gemini (BYOK)</button>
      </div>
      ${aiOutput?`<div class="ai-reply-box">${esc(aiOutput)}</div>`:''}
    </div>

    <div class="card">
      <h3>Optional Direct API Key (Stored Only in Browser)</h3>
      <div class="field">
        <label>GEMINI API KEY (OPTIONAL)</label>
        <input type="password" id="geminiKeyInput" value="${esc(db.settings.geminiKey||'')}" placeholder="AIza...">
      </div>
      <button type="button" class="btn secondary" onclick="saveGeminiKey()">Save Key</button>
      <p class="muted" style="font-size:10px;line-height:1.65;margin-top:14px">
        1. Bina API key ke bhi aap <b>Copy Prompt</b> karke Gemini, ChatGPT, ya Claude se JSON MCQ banwa sakte hain.<br>
        2. Phir us JSON ko <b>Practice & Quiz</b> tab mein paste karte hi turant test shuru ho jayega.
      </p>
    </div>
  </div>`;
}

/* Mistake Hunter with Image/PDF Attachment */
function mistakes(){
  title('Mistake Hunter');
  const mo=db.mistakes.filter(x=>!x.closed),mc=db.mistakes.filter(x=>x.closed),ml=mistakeTab==='open'?mo:mc;
  return `<div class="section-head"><h2>Turn errors into insight</h2><small>${db.mistakes.length} RECORDS</small></div>
  <div class="two-col">
    <div class="card">
      <h3>Record a mistake</h3>
      <form id="mistakeForm">
        <div class="form-grid">
          <div class="field"><label>SUBJECT</label><select name="subject"><option>Physics</option><option>Chemistry</option><option>Biology</option></select></div>
          <div class="field"><label>ERROR TYPE</label><select name="type"><option>Concept gap</option><option>Calculation</option><option>Formula recall</option><option>Misread question</option><option>Memory / NCERT</option><option>Time management</option></select></div>
        </div>
        <div class="field"><label>CHAPTER / TOPIC</label><input name="chapter" required placeholder="Chapter name"></div>
        <div class="field"><label>WHAT WENT WRONG?</label><textarea name="error" required placeholder="Describe the error briefly..."></textarea></div>
        <div class="field"><label>CORRECT APPROACH / TAKEAWAY</label><textarea name="fix" placeholder="What will you remember next time?"></textarea></div>
        <div class="field"><label>ATTACH QUESTION SCREENSHOT / PDF (OPTIONAL)</label><input type="file" name="attachment" accept="image/*,application/pdf"></div>
        <button type="submit" class="btn">＋ Save mistake</button>
      </form>
    </div>
    <div class="card">
      <h3>Learning log</h3>
      ${tabsHTML(mistakeTab,mo.length,mc.length,'setMistakeTab')}
      ${ml.length?ml.slice().reverse().map(m=>`
        <div class="list-item" style="align-items:flex-start">
          <div>
            <b>${esc(m.chapter)}</b>
            <div class="muted" style="margin:4px 0">${esc(m.subject)} • ${esc(m.type)} • ${m.date}</div>
            <div>${esc(m.error)}</div>
            ${m.fix?`<div style="color:#8bd5aa;margin-top:5px">Takeaway: ${esc(m.fix)}</div>`:''}
            <div class="actions" style="margin-top:8px">
              <button type="button" class="btn ${m.closed?'ghost':'secondary'}" style="padding:6px 10px" onclick="toggleMistake('${m.id}')">${m.closed?'↺ Reopen':'✓ Mark fixed'}</button>
              ${m.fileId?`<button type="button" class="btn ghost" style="padding:6px 10px" onclick="previewFile('${m.fileId}')">📎 View ${m.fileType==='application/pdf'?'PDF':'Screenshot'}</button>`:''}
            </div>
          </div>
          <button type="button" class="icon-btn" onclick="deleteMistake('${m.id}')">×</button>
        </div>
      `).join(''):`<div class="empty">${mistakeTab==='open'?'No open mistakes. Add one after your next practice session.':'Nothing closed yet.'}</div>`}
    </div>
  </div>`;
}

window.deleteMistake=async(id)=>{
  const m=db.mistakes.find(x=>x.id===id);
  if(m&&m.fileId)await deleteStoredFile(m.fileId);
  db.mistakes=db.mistakes.filter(x=>x.id!==id);
  save();render();toast('Mistake removed.');
};

/* Study Vault Sidebar View */
window.setVaultFilter=f=>{vaultFilter=f;render()};
window.deleteVaultItem=async(id)=>{
  const item=(db.vault||[]).find(x=>x.id===id);
  if(item&&item.fileId)await deleteStoredFile(item.fileId);
  db.vault=(db.vault||[]).filter(x=>x.id!==id);
  save();render();toast('File removed from Study Vault.');
};

function vault(){
  title('Study Vault');
  const items=(db.vault||[]).filter(v=>vaultFilter==='All'||v.subject===vaultFilter);
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
          <div class="field"><label>SUBJECT</label><select name="subject"><option>Physics</option><option>Chemistry</option><option>Biology</option><option>Formula / Notes</option></select></div>
          <div class="field"><label>CATEGORY</label><select name="category"><option>Screenshot / Diagram</option><option>Short Notes PDF</option><option>DPP / Question Bank</option><option>NCERT Highlight</option></select></div>
        </div>
        <div class="field"><label>SELECT IMAGE OR PDF</label><input type="file" name="file" accept="image/*,application/pdf" required></div>
        <button type="submit" class="btn">⬆ Save to Study Vault</button>
      </form>
      <p class="muted" style="font-size:10px;line-height:1.6;margin-top:14px">Files are stored offline inside your browser's IndexedDB so large PDFs and screenshots load instantly without slowing down the app.</p>
    </div>
    <div class="card">
      <h3>Saved Files (${items.length})</h3>
      ${items.length?`<div class="vault-grid">
        ${items.slice().reverse().map(v=>`
          <div class="vault-card">
            <div class="vault-thumb" onclick="previewFile('${v.fileId}')">
              <div class="pdf-badge">${v.fileType==='application/pdf'?'📄 PDF DOCUMENT':'🖼 SCREENSHOT / IMAGE'}<div style="font-size:9px;color:#8f8d99;margin-top:4px;text-align:center">Tap to open</div></div>
            </div>
            <div>
              <b style="font-size:12px;display:block">${esc(v.title)}</b>
              <div class="muted" style="font-size:10px;margin-top:3px">${esc(v.subject)} • ${esc(v.category)}</div>
            </div>
            <div class="actions" style="margin-top:auto">
              <button type="button" class="btn secondary" style="flex:1;padding:6px" onclick="previewFile('${v.fileId}')">Open</button>
              <button type="button" class="icon-btn" style="padding:5px 9px" onclick="deleteVaultItem('${v.id}')">×</button>
            </div>
          </div>
        `).join('')}
      </div>`:'<div class="empty">No screenshots or PDFs uploaded yet. Add your first formula sheet or question screenshot.</div>'}
    </div>
  </div>`;
}

function revision(){title('Revision Log');return `<div class="section-head"><h2>Revision Tracker</h2><small>SPACED REVISION RECORD</small></div><div class="two-col"><div class="card"><h3>Log a revision session</h3><form id="revisionForm"><div class="field"><label>CHAPTER / TOPIC</label><input name="chapter" required placeholder="e.g. Human Reproduction"></div><div class="form-grid"><div class="field"><label>SUBJECT</label><select name="subject"><option>Biology</option><option>Chemistry</option><option>Physics</option></select></div><div class="field"><label>REVISION TYPE</label><select name="kind"><option>Short notes</option><option>NCERT</option><option>Active recall</option><option>Questions / PYQs</option><option>Full chapter</option></select></div></div><button class="btn">Save revision</button></form></div><div class="card"><h3>Revision history</h3>${allRevs().length?allRevs().slice(0,60).map(r=>`<div class="list-item"><div><b>${esc(r.chapter)}</b><div class="muted">${esc(r.subject)} • ${esc(r.kind)}</div></div><span>${shortDate(r.date)}</span></div>`).join(''):'<div class="empty">Your revision history will appear here.</div>'}</div></div></div>`}
function tests(){title('Mock Tests');let avg=db.tests.length?Math.round(db.tests.reduce((a,t)=>a+t.score,0)/db.tests.length):0;return `<div class="stats">${stat('TESTS TAKEN',db.tests.length,'Total recorded')}${stat('AVERAGE SCORE',avg,'Out of 720')}${stat('BEST SCORE',db.tests.length?Math.max(...db.tests.map(t=>t.score)):0,'Out of 720')}${stat('LATEST ACCURACY',db.tests.length?db.tests[db.tests.length-1].accuracy+'%':'—','As entered')}</div><div class="two-col"><div class="card"><h3>Record mock test</h3><form id="testForm"><div class="field"><label>TEST NAME</label><input name="name" placeholder="e.g. Full syllabus test 04" required></div><div class="form-grid"><div class="field"><label>SCORE ( / 720 )</label><input name="score" type="number" min="0" max="720" required></div><div class="field"><label>ACCURACY (%)</label><input name="accuracy" type="number" min="0" max="100" placeholder="e.g. 72"></div></div><div class="form-grid"><div class="field"><label>PHYSICS</label><input name="physics" type="number" min="0" max="180" placeholder="Score"></div><div class="field"><label>CHEMISTRY</label><input name="chemistry" type="number" min="0" max="180" placeholder="Score"></div></div><div class="field"><label>BIOLOGY</label><input name="biology" type="number" min="0" max="360" placeholder="Score"></div><div class="field"><label>ANALYSIS / NEXT ACTION</label><textarea name="analysis" placeholder="What needs attention before the next test?"></textarea></div><button class="btn">Save test</button></form></div><div class="card"><h3>Test history</h3>${db.tests.length?`<div class="table-wrap"><table><thead><tr><th>TEST</th><th>SCORE</th><th>ACCURACY</th><th>DATE</th><th></th></tr></thead><tbody>${db.tests.slice().reverse().map(t=>`<tr><td>${esc(t.name)}</td><td><b>${t.score}</b></td><td>${t.accuracy||'—'}%</td><td>${t.date}</td><td><button class="icon-btn" onclick="removeItem('tests','${t.id}')">×</button></td></tr>`).join('')}</tbody></table></div>${db.tests.slice().reverse().slice(0,3).map(t=>`<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><b style="font-size:11px">${esc(t.name)}</b><p class="muted" style="font-size:10px">${esc(t.analysis||'No analysis added.')}</p></div>`).join('')}`:'<div class="empty">No mock tests recorded yet.</div>'}</div></div>`}
function dayKeys(n){return Array.from({length:n},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(n-1-i));return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})}
function dayLabel(k){return new Date(k+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short'})}
function barChart(labels,vals,id){const W=420,H=170,pt=20,pb=26,n=vals.length,max=Math.max(...vals,1),bw=W/n;let o=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f04a5b"/><stop offset="1" stop-color="#7c1d2a"/></linearGradient></defs><line x1="0" x2="${W}" y1="${H-pb}" y2="${H-pb}" stroke="#272731"/>`;vals.forEach((v,i)=>{const h=(H-pt-pb)*v/max,x=i*bw+bw*.18,y=H-pb-h;o+=`<rect x="${x}" y="${y}" width="${bw*.64}" height="${v?Math.max(h,3):0}" rx="4" fill="url(#${id})"/>`;if(v)o+=`<text x="${x+bw*.32}" y="${y-5}" text-anchor="middle" class="cv">${v}</text>`;o+=`<text x="${x+bw*.32}" y="${H-9}" text-anchor="middle" class="cl">${esc(labels[i])}</text>`});return o+'</svg>'}
function lineChart(labels,vals,max){const W=420,H=190,pl=30,pr=12,pt=20,pb=26,n=vals.length,step=n>1?(W-pl-pr)/(n-1):0,X=i=>n>1?pl+i*step:W/2,Y=v=>pt+(H-pt-pb)*(1-v/max);let o=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`;[0,.25,.5,.75,1].forEach(f=>{const y=Y(max*f);o+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="#272731"/><text x="${pl-5}" y="${y+3}" text-anchor="end" class="cl">${Math.round(max*f)}</text>`});if(n>1)o+=`<polyline fill="none" stroke="#e33b4b" stroke-width="2.2" stroke-linejoin="round" points="${vals.map((v,i)=>X(i)+','+Y(v)).join(' ')}"/>`;vals.forEach((v,i)=>{o+=`<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="#09090d" stroke="#f04a5b" stroke-width="2"/><text x="${X(i)}" y="${Y(v)-9}" text-anchor="middle" class="cv">${v}</text><text x="${X(i)}" y="${H-9}" text-anchor="middle" class="cl">${esc(labels[i])}</text>`});return o+'</svg>'}
function hbars(items,unit=''){const max=Math.max(...items.map(x=>x.value),1);return items.map(x=>`<div class="progress-row"><div class="progress-meta"><span>${esc(x.label)}</span><span>${x.value}${unit}</span></div><div class="bar"><span style="width:${x.value/max*100}%"></span></div></div>`).join('')}
function streak(){const days=new Set([...db.sessions.map(x=>x.date),...db.tasks.filter(t=>t.done).map(t=>t.doneAt||t.date)]);let d=new Date(),c=0;const key=()=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');if(!days.has(key()))d.setDate(d.getDate()-1);while(days.has(key())){c++;d.setDate(d.getDate()-1)}return c}

function analytics(){
  title('Analytics');
  const k7=dayKeys(7),lab=k7.map(dayLabel),focus7=k7.map(k=>db.sessions.filter(x=>x.date===k).reduce((a,x)=>a+x.minutes,0)),closed7=k7.map(k=>db.tasks.filter(t=>t.done&&(t.doneAt||t.date)===k).length);
  const totMin=db.sessions.reduce((a,x)=>a+x.minutes,0),totQ=db.sessions.reduce((a,x)=>a+(x.questions||0),0),closedAll=db.tasks.filter(t=>t.done).length,best=db.tests.length?Math.max(...db.tests.map(t=>t.score)):0;
  const last=db.tests.slice(-10),subs=['Physics','Chemistry','Biology'],subMax={Physics:180,Chemistry:180,Biology:360};
  const subAvg=subs.map(s=>{const arr=db.tests.filter(t=>t[s.toLowerCase()]>0);return{label:s,value:arr.length?Math.round(arr.reduce((a,t)=>a+t[s.toLowerCase()]/subMax[s]*100,0)/arr.length):0}});
  const mSub=subs.map(s=>({label:s,value:db.mistakes.filter(m=>m.subject===s).length}));
  const types=[...new Set(db.mistakes.map(m=>m.type))].map(t=>({label:t,value:db.mistakes.filter(m=>m.type===t).length})).sort((a,b)=>b.value-a.value);
  const fSub=['Physics','Chemistry','Biology'].map(s=>({label:s,value:db.sessions.filter(x=>x.subject===s).reduce((a,x)=>a+x.minutes,0)}));
  return `<div class="stats">${stat('TOTAL FOCUS',`${Math.floor(totMin/60)}h ${totMin%60}m`,`${totQ} total MCQs logged`)}${stat('MISSIONS CLOSED',closedAll,'All time')}${stat('STREAK',`${streak()} day${streak()===1?'':'s'}`,'Focus or mission daily')}${stat('BEST SCORE',best,'Out of 720')}</div>
  <div class="grid2"><div class="card"><h3>Focus minutes — last 7 days</h3>${barChart(lab,focus7,'bar-f2')}</div><div class="card"><h3>Missions closed — last 7 days</h3>${barChart(lab,closed7,'bar-m')}</div></div>
  <div class="grid2" style="margin-top:14px"><div class="card"><h3>Mock test score trend</h3>${last.length?lineChart(last.map((t,i)=>'T'+(db.tests.length-last.length+i+1)),last.map(t=>t.score),720):'<div class="empty">Record a mock test to see your trend.</div>'}</div><div class="card"><h3>Subject-wise mock average (%)</h3>${db.tests.length?hbars(subAvg,'%'):'<div class="empty">Add subject scores in a mock test to see this.</div>'}<h3 style="margin-top:22px">Focus time by subject (min)</h3>${totMin?hbars(fSub):'<div class="empty">Log focus sessions to see this.</div>'}</div></div>
  <div class="grid2" style="margin-top:14px"><div class="card"><h3>Mistakes by subject</h3>${db.mistakes.length?hbars(mSub):'<div class="empty">No mistakes recorded yet.</div>'}</div><div class="card"><h3>Mistakes by type</h3>${types.length?hbars(types):'<div class="empty">No mistakes recorded yet.</div>'}<p class="muted" style="font-size:10px;margin-top:14px">Open: ${db.mistakes.filter(m=>!m.closed).length} • Fixed: ${db.mistakes.filter(m=>m.closed).length}</p></div></div>
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
function allRevs(){const out=db.revisions.map(r=>({date:r.date,chapter:r.chapter,subject:r.subject,kind:r.kind}));for(const sub of Object.keys(db.chapters))for(const c of db.chapters[sub])for(const [k,d] of Object.entries(c.t||{}))if(/^r\d$/.test(k))out.push({date:d,chapter:c.name,subject:sub,kind:'Revision '+k.slice(1)});return out.sort((a,b)=>b.date.localeCompare(a.date))}
function covg(k,key){const l=tabChapters(TRACK[k]);return l.length?Math.round(l.filter(c=>key==='done'?c.done:(c.t||{})[key]).length/l.length*100):0}

function render(){
  let html={dashboard,missions,subjects,focus,practice:practiceView,mistakes,revision,tests,vault,aitutor:aiTutorView,analytics}[current]();
  document.getElementById('view').innerHTML=html;
  bindForms();
  if(current==='dashboard')startLiveCountdown();
  if(current==='focus'){
    document.getElementById('startTimer').onclick=startTimer;
    document.getElementById('resetTimer').onclick=resetCurrentTimer;
    updateTimerDOM();
  }
}

function bindForms(){
  const bind=(id,fn)=>{const el=document.getElementById(id);if(el)el.onsubmit=async e=>{e.preventDefault();await fn(el)}};
  bind('taskForm',f=>{db.tasks.push({id:crypto.randomUUID(),date:today(),text:f.text.value.trim(),subject:f.subject.value,done:false});save();render();toast('Mission added.')});
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
    if(!fileInput)return;
    const saved=await storeFile(fileInput);
    db.vault=db.vault||[];
    db.vault.push({id:crypto.randomUUID(),date:today(),title:f.title.value.trim(),subject:f.subject.value,category:f.category.value,fileId:saved.id,fileName:saved.name,fileType:saved.type});
    save();render();toast('Saved to Study Vault.');
  });
  bind('revisionForm',f=>{db.revisions.push({id:crypto.randomUUID(),date:today(),chapter:f.chapter.value.trim(),subject:f.subject.value,kind:f.kind.value});save();render();toast('Revision logged.')});
  bind('testForm',f=>{db.tests.push({id:crypto.randomUUID(),date:today(),name:f.name.value.trim(),score:+f.score.value,accuracy:+f.accuracy.value||0,physics:+f.physics.value||0,chemistry:+f.chemistry.value||0,biology:+f.biology.value||0,analysis:f.analysis.value.trim()});save();render();toast('Mock test saved.')});
}

window.toggleTask=(id,v)=>{let t=db.tasks.find(x=>x.id===id);if(t){t.done=v;t.doneAt=v?today():null}save();render()};
window.setMissionTab=t=>{missionTab=t;render()};
window.setMistakeTab=t=>{mistakeTab=t;render()};
window.toggleMistake=id=>{let m=db.mistakes.find(x=>x.id===id);if(m){m.closed=!m.closed;m.closedAt=m.closed?today():null}save();render();toast(m&&m.closed?'Mistake closed.':'Mistake reopened.')};
window.deleteTask=id=>{db.tasks=db.tasks.filter(t=>t.id!==id);save();render();toast('Mission removed.')};
window.deleteChapter=(s,id)=>{if(!confirm('Delete this chapter and all its ticks and dates?'))return;db.chapters[s]=db.chapters[s].filter(x=>x.id!==id);save();keepScroll(render)};
window.removeItem=(list,id)=>{db[list]=db[list].filter(x=>x.id!==id);save();render();toast('Record removed.')};

document.getElementById('exportBtn').onclick=()=>{let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`igris-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast('Backup downloaded.')};
if(!db.syllabusLoaded&&Object.values(db.chapters).every(a=>!a.length))loadSyllabus(true);
render();
document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
document.getElementById('importFile').onchange=e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d||!Array.isArray(d.tasks))throw new Error('bad');if(!confirm('Replace current data with this backup?')){e.target.value='';return}db={...seed(),...d};save();render();toast('Backup imported.')}catch(_){toast('Invalid backup file.')}e.target.value=''};r.readAsText(file)};