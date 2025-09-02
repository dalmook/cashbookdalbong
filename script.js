// 꼬마 가계부 - 로컬스토리지 기반 멀티 아이 용돈/가계부
const STORE_KEY = "kiddyBudget_v1";
const KRW = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });

let store = loadStore();
let currentKidId = store.lastKidId || null;

const kidTabs = document.getElementById('kidTabs');
const kidModal = document.getElementById('kidModal');
const kidForm = document.getElementById('kidForm');
const kidModalTitle = document.getElementById('kidModalTitle');
const kidName = document.getElementById('kidName');
const kidEmoji = document.getElementById('kidEmoji');
const kidColor = document.getElementById('kidColor');
const kidWeekly = document.getElementById('kidWeekly');

const kidMenu = document.getElementById('kidMenu');
const kidEditBtn = document.getElementById('kidEdit');
const kidDeleteBtn = document.getElementById('kidDelete');
const kidCloseBtn = document.getElementById('kidClose');

const currentBalance = document.getElementById('currentBalance');
const monthIncome = document.getElementById('monthIncome');
const monthExpense = document.getElementById('monthExpense');
const weeklyAllowance = document.getElementById('weeklyAllowance');
const btnPayAllowance = document.getElementById('btnPayAllowance');

const txForm = document.getElementById('txForm');
const txDate = document.getElementById('txDate');
const txAmount = document.getElementById('txAmount');
const txCategory = document.getElementById('txCategory');
const txSticker = document.getElementById('txSticker');
const txNote = document.getElementById('txNote');
const txList = document.getElementById('txList');
const emptyState = document.getElementById('emptyState');

const filterMonth = document.getElementById('filterMonth');
const filterType = document.getElementById('filterType');
const filterCat = document.getElementById('filterCat');

const btnAddKid = document.getElementById('btnAddKid');
const btnExport = document.getElementById('btnExport');
const importFile = document.getElementById('importFile');
const btnAddDemo = document.getElementById('btnAddDemo');

txDate.valueAsDate = new Date();

function uid(prefix="id"){ return prefix + Math.random().toString(36).slice(2,9); }
function loadStore(){
  try{ const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return { kids:{}, transactions:{}, lastKidId:null };
    const obj = JSON.parse(raw); obj.kids ||= {}; obj.transactions ||= {}; return obj;
  }catch(e){ console.warn("스토어 로드 실패, 초기화", e); return { kids:{}, transactions:{}, lastKidId:null }; }
}
function saveStore(){ localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
function escapeHtml(s=""){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

function renderKidTabs(){
  kidTabs.innerHTML = "";
  const ids = Object.keys(store.kids);
  if(ids.length===0){
    const li = document.createElement('li');
    li.innerHTML = `<div class="kid-card"><div class="kid-avatar">➕</div><div class="kid-meta"><div class="kid-name">아직 아이가 없어요</div><div class="kid-sub">[+ 아이 추가]를 눌러 시작해요</div></div></div>`;
    kidTabs.appendChild(li); return;
  }
  ids.forEach(id=>{
    const k = store.kids[id];
    const li = document.createElement('li');
    li.innerHTML = `<div class="kid-card ${id===currentKidId?'active':''}" data-id="${id}">
      <div class="kid-avatar" style="background:${k.color||'#ffe3ef'}22;border-color:${k.color||'#ffe3ef'}">${k.emoji||'🐣'}</div>
      <div class="kid-meta"><div class="kid-name">${escapeHtml(k.name)}</div><div class="kid-sub">주간 용돈: ${KRW.format(k.weekly||0)}</div></div>
    </div>`;
    const card = li.querySelector('.kid-card');
    card.addEventListener('click',()=>selectKid(id));
    let t=null; card.addEventListener('pointerdown',e=>{ t=setTimeout(()=>openKidMenu(e.clientX,e.clientY,id),650); });
    card.addEventListener('pointerup',()=>clearTimeout(t));
    card.addEventListener('pointerleave',()=>clearTimeout(t));
    kidTabs.appendChild(li);
  });
}

function selectKid(id){ currentKidId=id; store.lastKidId=id; saveStore(); renderKidTabs(); renderOverview(); renderFilters(); renderTxList(); }
function kidBalance(id){ return (store.transactions[id]||[]).reduce((s,t)=> s+(t.type==='income'?t.amount:-t.amount),0); }

function renderOverview(){
  if(!currentKidId){
    currentBalance.textContent=KRW.format(0); monthIncome.textContent=KRW.format(0);
    monthExpense.textContent=KRW.format(0); weeklyAllowance.textContent=KRW.format(0); btnPayAllowance.disabled=true; return;
  }
  const kid = store.kids[currentKidId]; const arr = store.transactions[currentKidId]||[];
  const ym = new Date().toISOString().slice(0,7); let inc=0, exp=0;
  for(const t of arr){ if((t.date||'').startsWith(ym)){ if(t.type==='income') inc+=t.amount; else exp+=t.amount; } }
  currentBalance.textContent=KRW.format(kidBalance(currentKidId));
  monthIncome.textContent=KRW.format(inc); monthExpense.textContent=KRW.format(exp);
  weeklyAllowance.textContent=KRW.format(kid.weekly||0); btnPayAllowance.disabled=!kid.weekly;
}

function renderFilters(){
  filterMonth.innerHTML=""; const now=new Date();
  for(let i=0;i<12;i++){ const d=new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym=d.toISOString().slice(0,7); const opt=document.createElement('option');
    opt.value=ym; opt.textContent=`${d.getFullYear()}년 ${d.getMonth()+1}월`; filterMonth.appendChild(opt);
  } filterMonth.value=new Date().toISOString().slice(0,7);
}

function renderTxList(){
  txList.innerHTML=""; emptyState.style.display="none";
  if(!currentKidId){ emptyState.style.display="block"; return; }
  const arr=(store.transactions[currentKidId]||[]).slice().sort((a,b)=> b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
  const ym=filterMonth.value, tp=filterType.value, cat=filterCat.value; let count=0;
  for(const t of arr){
    if(ym && !(t.date||"").startsWith(ym)) continue;
    if(tp && t.type!==tp) continue;
    if(cat && t.category!==cat) continue;
    const li=document.createElement('li');
    const amtClass=t.type==='income'?'pos':'neg'; const sign=t.type==='income'?'+':'-';
    const emoji=t.sticker||(t.type==='income'?'🪙':'🍭'); const title=`${t.category} ${t.note?'· '+escapeHtml(t.note):''}`;
    li.className="tx-item"; li.innerHTML=`
      <div class="tx-main"><div class="tx-emoji">${emoji}</div>
        <div><div class="tx-title">${title}</div><div class="tx-sub">${t.date}</div></div></div>
      <div class="tx-actions"><div class="tx-amt ${amtClass}">${sign}${KRW.format(t.amount)}</div>
        <button class="icon-btn" data-act="edit" data-id="${t.id}" title="수정">✏️</button>
        <button class="icon-btn" data-act="del" data-id="${t.id}" title="삭제">🗑️</button></div>`;
    txList.appendChild(li); count++;
  }
  if(count===0) emptyState.style.display="block";
  txList.querySelectorAll('[data-act="del"]').forEach(b=> b.addEventListener('click',()=>delTx(b.dataset.id)));
  txList.querySelectorAll('[data-act="edit"]').forEach(b=> b.addEventListener('click',()=>editTx(b.dataset.id)));
}

document.getElementById('btnAddKid').addEventListener('click',()=>openKidModal());
function openKidModal(editId=null){
  kidModalTitle.textContent = editId? "아이 수정":"아이 추가";
  if(editId){
    const k=store.kids[editId]; kidName.value=k.name||""; kidEmoji.value=k.emoji||""; kidColor.value=k.color||"#ffd9e6"; kidWeekly.value=k.weekly||0;
    kidForm.dataset.editId=editId;
  }else{
    kidName.value=""; kidEmoji.value=""; kidColor.value="#ffd9e6"; kidWeekly.value=""; delete kidForm.dataset.editId;
  }
  if(typeof kidModal.showModal==='function') kidModal.showModal(); else alert('이 브라우저는 dialog를 지원하지 않아요.');
}
kidForm.addEventListener('submit',(e)=>{
  e.preventDefault(); const name=kidName.value.trim(); if(!name){ alert("이름을 입력해 주세요"); return; }
  const data={ name, emoji:(kidEmoji.value||"🐣").slice(0,2), color:kidColor.value||"#ffd9e6", weekly:Math.max(0, Number(kidWeekly.value||0)|0) };
  const editId=kidForm.dataset.editId;
  if(editId){ store.kids[editId]={...store.kids[editId], ...data}; saveStore(); kidModal.close(); renderKidTabs(); if(editId===currentKidId) renderOverview(); }
  else{ const id=uid("kid_"); store.kids[id]={id, ...data}; store.transactions[id]=[]; currentKidId=id; store.lastKidId=id; saveStore(); kidModal.close(); renderKidTabs(); selectKid(id); }
});

function openKidMenu(x,y,id){
  if(typeof kidMenu.showModal!=='function') return;
  kidMenu.showModal();
  kidEditBtn.onclick=()=>{ kidMenu.close(); openKidModal(id); };
  kidDeleteBtn.onclick=()=>{
    if(confirm("이 아이와 모든 거래 기록을 삭제할까요?")){
      delete store.kids[id]; delete store.transactions[id];
      if(currentKidId===id){ currentKidId=Object.keys(store.kids)[0]||null; store.lastKidId=currentKidId; }
      saveStore(); kidMenu.close(); renderKidTabs(); renderOverview(); renderTxList();
    }
  };
  kidCloseBtn.onclick=()=>kidMenu.close();
}

txForm.addEventListener('submit',(e)=>{
  e.preventDefault(); if(!currentKidId){ alert("먼저 아이를 추가해 주세요!"); return; }
  const type=txForm.type.value; const date=txDate.value||new Date().toISOString().slice(0,10);
  const amount=Math.max(0, Number(txAmount.value||0)); if(!amount){ alert("금액을 입력해 주세요."); return; }
  const category=txCategory.value||"기타"; const sticker=txSticker.value||""; const note=txNote.value.trim();
  const tx={ id:uid("tx_"), type, date, amount, category, sticker, note, createdAt:Date.now() };
  store.transactions[currentKidId].push(tx); saveStore(); txForm.reset(); txDate.valueAsDate=new Date(); renderOverview(); renderTxList();
});

function findTx(id){ return (store.transactions[currentKidId]||[]).find(t=>t.id===id); }
function delTx(id){ const arr=store.transactions[currentKidId]||[]; const i=arr.findIndex(t=>t.id===id); if(i>=0){ arr.splice(i,1); saveStore(); renderOverview(); renderTxList(); } }
function editTx(id){
  const t=findTx(id); if(!t) return;
  const newDate=prompt("날짜(YYYY-MM-DD)", t.date)||t.date;
  const newType=prompt("타입(income/expense)", t.type)||t.type;
  const newAmount=Number(prompt("금액(원)", t.amount)||t.amount);
  const newCat=prompt("분류", t.category)||t.category;
  const newNote=prompt("메모", t.note||"")||t.note;
  const newSticker=prompt("스티커(이모지)", t.sticker||"")||t.sticker;
  Object.assign(t, {date:newDate, type:newType, amount:newAmount, category:newCat, note:newNote, sticker:newSticker});
  saveStore(); renderOverview(); renderTxList();
}

filterMonth.addEventListener('change', renderTxList);
filterType.addEventListener('change', renderTxList);
filterCat.addEventListener('change', renderTxList);

document.getElementById('btnPayAllowance').addEventListener('click', ()=>{
  if(!currentKidId) return;
  const kid=store.kids[currentKidId]; const w=kid.weekly||0;
  if(!w){ alert("설정된 주간 용돈이 없어요. 아이 카드에서 [수정]으로 설정하세요!"); return; }
  const today=new Date().toISOString().slice(0,10);
  const tx={ id:uid("tx_"), type:"income", date:today, amount:w, category:"용돈", sticker:"🪙", note:"주간 용돈", createdAt:Date.now() };
  store.transactions[currentKidId].push(tx); saveStore(); renderOverview(); renderTxList();
});

btnExport.addEventListener('click', ()=>{
  const dataStr=JSON.stringify(store, null, 2);
  const blob=new Blob([dataStr], {type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url;
  const ts=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'); a.download=`kiddy-budget-${ts}.json`; a.click();
  URL.revokeObjectURL(url);
});

importFile.addEventListener('change', (e)=>{
  const f=e.target.files[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const obj=JSON.parse(reader.result);
      if(!obj.kids || !obj.transactions) throw new Error("형식 오류");
      store=obj; currentKidId=store.lastKidId||Object.keys(store.kids)[0]||null;
      saveStore(); renderKidTabs(); renderOverview(); renderFilters(); renderTxList(); alert("가져오기가 완료되었습니다!");
    }catch(err){ alert("가져오기에 실패했어요. JSON 형식을 확인해 주세요."); console.error(err); }
  };
  reader.readAsText(f, 'utf-8');
});

btnAddDemo.addEventListener('click', ()=>{
  if(Object.keys(store.kids).length>0 && !confirm("이미 데이터가 있어요. 그래도 데모 데이터를 합칠까요?")) return;
  const id1=uid("kid_"), id2=uid("kid_");
  store.kids[id1]={id:id1, name:"유겸", emoji:"🐰", color:"#ffd9e6", weekly:2000};
  store.kids[id2]={id:id2, name:"지안", emoji:"🦄", color:"#d9fff2", weekly:1500};
  store.transactions[id1]=[
    { id:uid("tx_"), type:"income", date:todayOffset(-3), amount:2000, category:"용돈", sticker:"🪙", note:"주간 용돈", createdAt:Date.now()-30000 },
    { id:uid("tx_"), type:"income", date:todayOffset(-2), amount:500, category:"미션보상", sticker:"⭐", note:"장난감 정리", createdAt:Date.now()-20000 },
    { id:uid("tx_"), type:"expense", date:todayOffset(-1), amount:1200, category:"간식", sticker:"🍪", note:"쿠키", createdAt:Date.now()-10000 },
  ];
  store.transactions[id2]=[
    { id:uid("tx_"), type:"income", date:todayOffset(-3), amount:1500, category:"용돈", sticker:"🪙", note:"주간 용돈", createdAt:Date.now()-35000 },
    { id:uid("tx_"), type:"expense", date:todayOffset(-2), amount:800, category:"학용품", sticker:"✏️", note:"색연필", createdAt:Date.now()-18000 },
  ];
  currentKidId=id1; store.lastKidId=id1; saveStore();
  renderKidTabs(); renderOverview(); renderFilters(); renderTxList(); alert("데모 데이터를 추가했어요!");
});
function todayOffset(delta=0){ const d=new Date(); d.setDate(d.getDate()+delta); return d.toISOString().slice(0,10); }

(function init(){
  renderKidTabs();
  if(!currentKidId){ currentKidId=Object.keys(store.kids)[0]||null; store.lastKidId=currentKidId; saveStore(); }
  renderOverview(); renderFilters(); renderTxList();
})();