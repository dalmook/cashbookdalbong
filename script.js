// === Firebase Firestore 전체공개 동기화 버전 (멤버 등록 없음) ===
// 1) Firebase Web App 생성 후 아래 config 교체
const firebaseConfig = {
  apiKey: "AIzaSyBdeGbRXw2m-dLmd5Twu52BHFJIeUOrU7E",
  authDomain: "cashdalbong.firebaseapp.com",
  projectId: "cashdalbong",
  appId: "1:221695589603:web:188fc0f7da29523b47d9d6",
};

// 2) 공유 공간 ID: URL ?space=... 우선, 없으면 localStorage/프롬프트
const SPACE_KEY = "kiddyBudget_spaceId";
const LOCAL_LAST = "kiddyBudget_lastKidId";

// ---- Firebase SDK (ESM CDN) ----
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, enableIndexedDbPersistence,
  collection, doc, getDoc, setDoc, addDoc, updateDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- DOM (기존 HTML 그대로) ----
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

const KRW = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const KRWfmt = (n) => KRW.format(n || 0);
function escapeHtml(s=""){ return s.replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function uidGen(prefix="id"){ return prefix + Math.random().toString(36).slice(2,9); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
txDate.valueAsDate = new Date();

// ---- Firebase init ----
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// 오프라인 캐시(옵션)
enableIndexedDbPersistence(db).catch(()=>{});

// ---- spaceId 준비 ----
let spaceId = new URL(location.href).searchParams.get("space")
  || localStorage.getItem(SPACE_KEY)
  || "";
async function ensureSpace(){
  if(!spaceId){
    spaceId = prompt("공유 공간 ID를 정해주세요(영문/숫자). 예: family-public", "family-public") || "";
    if(!spaceId) throw new Error("spaceId 필요");
  }
  localStorage.setItem(SPACE_KEY, spaceId);
  const spaceRef = doc(db, "spaces", spaceId);
  const snap = await getDoc(spaceRef);
  if(!snap.exists()){
    await setDoc(spaceRef, { createdAt: serverTimestamp(), name: spaceId });
  }
}

// ---- 상태 ----
let state = {
  kids: {},           // kidId -> kid doc
  transactions: {},   // kidId -> array of tx
  currentKidId: localStorage.getItem(LOCAL_LAST) || null,
};

// ---- 실시간 리스너 ----
let unsubKids = null, unsubTx = null;
function listenKids(){
  if(unsubKids) unsubKids();
  const colRef = collection(db, "spaces", spaceId, "kids");
  const q = query(colRef, orderBy("createdAt", "asc"));
  unsubKids = onSnapshot(q, (snap)=>{
    const kids = {};
    snap.forEach(docSnap=>{
      const d = docSnap.data();
      if(d.deleted) return;
      kids[docSnap.id] = { id: docSnap.id, ...d };
    });
    state.kids = kids;
    if(!state.currentKidId || !state.kids[state.currentKidId]){
      const first = Object.keys(state.kids)[0] || null;
      state.currentKidId = first;
      localStorage.setItem(LOCAL_LAST, state.currentKidId || "");
    }
    renderKidTabs(); renderOverview(); renderFilters(); renderTxList();
  });
}
function listenTransactions(){
  if(unsubTx) unsubTx();
  const colRef = collection(db, "spaces", spaceId, "transactions");
  const q = query(colRef, orderBy("date", "desc"), orderBy("createdAt", "desc"));
  unsubTx = onSnapshot(q, (snap)=>{
    const byKid = {};
    snap.forEach(docSnap=>{
      const t = docSnap.data();
      if(t.deleted) return;
      const kid = t.kidId;
      byKid[kid] ||= [];
      byKid[kid].push({ id: docSnap.id, ...t });
    });
    Object.keys(byKid).forEach(k=>{
      byKid[k].sort((a,b)=> (b.date||"").localeCompare(a.date||"") || (b.createdAt?.toMillis?.()||0) - (a.createdAt?.toMillis?.()||0));
    });
    state.transactions = byKid;
    renderOverview(); renderTxList();
  });
}

// ---- 렌더 ----
function renderKidTabs(){
  kidTabs.innerHTML = "";
  const ids = Object.keys(state.kids);
  if(ids.length===0){
    const li = document.createElement('li');
    li.innerHTML = `<div class="kid-card"><div class="kid-avatar">➕</div>
      <div class="kid-meta"><div class="kid-name">아직 아이가 없어요</div><div class="kid-sub">[+ 아이 추가]로 시작해요</div></div></div>`;
    kidTabs.appendChild(li); return;
  }
  ids.forEach(id=>{
    const k = state.kids[id];
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="kid-card ${id===state.currentKidId?'active':''}" data-id="${id}">
        <div class="kid-avatar" style="background:${k.color||'#ffe3ef'}22;border-color:${k.color||'#ffe3ef'}">${k.emoji||'🐣'}</div>
        <div class="kid-meta">
          <div class="kid-name">${escapeHtml(k.name||'')}</div>
          <div class="kid-sub">주간 용돈: ${KRWfmt(k.weekly||0)}</div>
        </div>
      </div>`;
    const card = li.querySelector('.kid-card');
    card.addEventListener('click',()=>selectKid(id));
    let t=null; card.addEventListener('pointerdown',e=>{ t=setTimeout(()=>openKidMenu(id),650); });
    card.addEventListener('pointerup',()=>clearTimeout(t));
    card.addEventListener('pointerleave',()=>clearTimeout(t));
    kidTabs.appendChild(li);
  });
}
function selectKid(id){
  state.currentKidId = id; localStorage.setItem(LOCAL_LAST, id);
  renderKidTabs(); renderOverview(); renderFilters(); renderTxList();
}
function kidBalance(id){
  const arr = state.transactions[id] || [];
  return arr.reduce((s,t)=> s + (t.type==='income' ? t.amount : -t.amount), 0);
}
function renderOverview(){
  const id = state.currentKidId;
  if(!id){ currentBalance.textContent=KRWfmt(0); monthIncome.textContent=KRWfmt(0); monthExpense.textContent=KRWfmt(0); weeklyAllowance.textContent=KRWfmt(0); btnPayAllowance.disabled=true; return; }
  const kid = state.kids[id];
  const ym = new Date().toISOString().slice(0,7);
  let inc=0, exp=0;
  (state.transactions[id]||[]).forEach(t=>{
    if((t.date||"").startsWith(ym)){ if(t.type==='income') inc+=t.amount; else exp+=t.amount; }
  });
  currentBalance.textContent = KRWfmt(kidBalance(id));
  monthIncome.textContent = KRWfmt(inc);
  monthExpense.textContent = KRWfmt(exp);
  weeklyAllowance.textContent = KRWfmt(kid?.weekly||0);
  btnPayAllowance.disabled = !(kid && kid.weekly);
}
function renderFilters(){
  filterMonth.innerHTML = "";
  const now = new Date();
  for(let i=0;i<12;i++){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = d.toISOString().slice(0,7);
    const opt = document.createElement('option');
    opt.value = ym; opt.textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
    filterMonth.appendChild(opt);
  }
  filterMonth.value = new Date().toISOString().slice(0,7);
}
function renderTxList(){
  txList.innerHTML = ""; emptyState.style.display = "none";
  const id = state.currentKidId;
  if(!id){ emptyState.style.display="block"; return; }
  const arr = (state.transactions[id]||[]).slice();
  const ym = filterMonth.value, tp = filterType.value, cat = filterCat.value;
  let count=0;
  for(const t of arr){
    if(ym && !(t.date||"").startsWith(ym)) continue;
    if(tp && t.type!==tp) continue;
    if(cat && t.category!==cat) continue;
    const li = document.createElement('li');
    const amtClass = t.type==='income'?'pos':'neg';
    const sign = t.type==='income'?'+':'-';
    const emoji = t.sticker || (t.type==='income'?'🪙':'🍭');
    const title = `${t.category} ${t.note? '· '+escapeHtml(t.note):''}`;
    li.className = "tx-item";
    li.innerHTML = `
      <div class="tx-main">
        <div class="tx-emoji">${emoji}</div>
        <div><div class="tx-title">${title}</div><div class="tx-sub">${t.date}</div></div>
      </div>
      <div class="tx-actions">
        <div class="tx-amt ${amtClass}">${sign}${KRWfmt(t.amount)}</div>
        <button class="icon-btn" title="수정" data-act="edit" data-id="${t.id}">✏️</button>
        <button class="icon-btn" title="삭제" data-act="del" data-id="${t.id}">🗑️</button>
      </div>`;
    txList.appendChild(li); count++;
  }
  if(count===0) emptyState.style.display="block";
  txList.querySelectorAll('[data-act="del"]').forEach(b=> b.addEventListener('click',()=> deleteTx(b.dataset.id)));
  txList.querySelectorAll('[data-act="edit"]').forEach(b=> b.addEventListener('click',()=> editTxPrompt(b.dataset.id)));
}

// ---- 아이 CRUD ----
btnAddKid.addEventListener('click', ()=> openKidModal());
function openKidModal(editId=null){
  kidModalTitle.textContent = editId? "아이 수정":"아이 추가";
  if(editId){
    const k = state.kids[editId];
    kidName.value = k?.name || "";
    kidEmoji.value = k?.emoji || "";
    kidColor.value = k?.color || "#ffd9e6";
    kidWeekly.value = k?.weekly || 0;
    kidForm.dataset.editId = editId;
  }else{
    kidName.value = ""; kidEmoji.value = ""; kidColor.value = "#ffd9e6"; kidWeekly.value = "";
    delete kidForm.dataset.editId;
  }
  if(typeof kidModal.showModal === 'function') kidModal.showModal();
  else alert('이 브라우저는 dialog를 지원하지 않아요.');
}

kidForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name = kidName.value.trim(); if(!name){ alert("이름을 입력해 주세요"); return; }
  const data = {
    name,
    emoji: (kidEmoji.value || "🐣").slice(0,2),
    color: kidColor.value || "#ffd9e6",
    weekly: Number(kidWeekly.value || 0),
    createdAt: serverTimestamp(),
    deleted: false,
  };
  try{
    if(kidForm.dataset.editId){
      await updateDoc(doc(db, "spaces", spaceId, "kids", kidForm.dataset.editId), data);
    }else{
      const newId = uidGen("kid_");
      await setDoc(doc(db, "spaces", spaceId, "kids", newId), data);
      state.currentKidId = newId; localStorage.setItem(LOCAL_LAST, newId);
    }
    kidModal.close();
  }catch(e){ console.error(e); alert("아이 저장 실패"); }
});

function openKidMenu(editId){
  if(typeof kidMenu.showModal !== 'function') return;
  kidMenu.showModal();
  kidEditBtn.onclick = ()=>{ kidMenu.close(); openKidModal(editId); };
  kidDeleteBtn.onclick = async ()=>{
    if(!confirm("이 아이와 모든 거래를 숨길까요? (복구 가능)")) return;
    try{
      await updateDoc(doc(db, "spaces", spaceId, "kids", editId), { deleted:true });
      kidMenu.close();
      const rest = Object.keys(state.kids).filter(id=> id!==editId);
      state.currentKidId = rest[0] || null;
      localStorage.setItem(LOCAL_LAST, state.currentKidId || "");
    }catch(e){ console.error(e); alert("삭제 실패"); }
  };
  kidCloseBtn.onclick = ()=> kidMenu.close();
}

// ---- 거래 CRUD ----
txForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const kidId = state.currentKidId;
  if(!kidId){ alert("먼저 아이를 선택/추가해 주세요!"); return; }
  const type = txForm.type.value; // income | expense
  const date = txDate.value || todayISO();
  const amount = Math.max(0, Number(txAmount.value||0));
  if(!amount){ alert("금액을 입력해 주세요."); return; }
  const category = txCategory.value || "기타";
  const sticker = txSticker.value || "";
  const note = (txNote.value||"").trim();
  try{
    await addDoc(collection(db, "spaces", spaceId, "transactions"), {
      kidId, type, date, amount, category, sticker, note,
      createdAt: serverTimestamp(), deleted:false
    });
    txForm.reset(); txDate.valueAsDate = new Date();
  }catch(e){ console.error(e); alert("저장 실패"); }
});

async function deleteTx(txId){
  if(!confirm("이 거래를 삭제할까요?")) return;
  try{
    await updateDoc(doc(db, "spaces", spaceId, "transactions", txId), { deleted:true });
  }catch(e){ console.error(e); alert("삭제 실패"); }
}
async function editTxPrompt(txId){
  const kidId = state.currentKidId;
  const tx = (state.transactions[kidId]||[]).find(t=> t.id===txId);
  if(!tx) return;
  const newDate = prompt("날짜(YYYY-MM-DD)", tx.date) || tx.date;
  const newType = prompt("타입(income/expense)", tx.type) || tx.type;
  const newAmount = Number(prompt("금액(원)", tx.amount) || tx.amount);
  const newCat = prompt("분류", tx.category) || tx.category;
  const newNote = prompt("메모", tx.note||"") || tx.note;
  const newSticker = prompt("스티커(이모지)", tx.sticker||"") || tx.sticker;
  try{
    await updateDoc(doc(db, "spaces", spaceId, "transactions", txId), {
      date: newDate, type: newType, amount: newAmount,
      category: newCat, note: newNote, sticker: newSticker
    });
  }catch(e){ console.error(e); alert("수정 실패"); }
}

// ---- 필터 & 용돈 지급 ----
filterMonth.addEventListener('change', renderTxList);
filterType.addEventListener('change', renderTxList);
filterCat.addEventListener('change', renderTxList);
btnPayAllowance.addEventListener('click', async ()=>{
  const id = state.currentKidId; if(!id) return;
  const kid = state.kids[id]; const w = kid?.weekly||0;
  if(!w){ alert("설정된 주간 용돈이 없어요."); return; }
  try{
    await addDoc(collection(db, "spaces", spaceId, "transactions"), {
      kidId:id, type:"income", date: todayISO(), amount:w, category:"용돈", sticker:"🪙", note:"주간 용돈",
      createdAt: serverTimestamp(), deleted:false
    });
  }catch(e){ console.error(e); alert("저장 실패"); }
});

// ---- 내보내기(백업) ----
btnExport.addEventListener('click', ()=>{
  const dataStr = JSON.stringify({ kids: state.kids, transactions: state.transactions }, null, 2);
  const blob = new Blob([dataStr], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.download = `kiddy-budget-export-${ts}.json`; a.click(); URL.revokeObjectURL(url);
});
importFile.addEventListener('change', ()=> alert("가져오기는 권장하지 않아요."));

// ---- 시작: space 만들고 리스너 연결 ----
(async function init(){
  try{
    await ensureSpace();
    listenKids();
    listenTransactions();
  }catch(e){
    console.error(e);
    alert("공유 공간 연결 실패: Firestore 규칙/프로젝트 설정을 확인하세요.");
  }
})();
