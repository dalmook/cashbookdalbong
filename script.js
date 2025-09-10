// === Firebase Firestore 전체공개 동기화 (실시간+낙관적 렌더+월필터 개선) ===
const firebaseConfig = {
  apiKey: "AIzaSyBdeGbRXw2m-dLmd5Twu52BHFJIeUOrU7E",
  authDomain: "cashdalbong.firebaseapp.com",
  projectId: "cashdalbong",
  appId: "1:221695589603:web:188fc0f7da29523b47d9d6",
};

const SPACE_KEY = "dalbong";
const LOCAL_LAST = "kiddyBudget_lastKidId";

// SDK (ESM)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  collection, doc, getDoc, setDoc, addDoc, updateDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// DOM
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

const KRW = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const KRWfmt = (n) => KRW.format(n || 0);
function escapeHtml(s=""){ return s.replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function uidGen(prefix="id"){ return prefix + Math.random().toString(36).slice(2,9); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
txDate.valueAsDate = new Date();

// 날짜 정규화: Timestamp/Date/string 모두 "YYYY-MM-DD" 로 변환
function normalizeDateString(d){
  if(!d) return "";
  // Firestore Timestamp?
  if (typeof d === "object" && typeof d.toDate === "function") {
    return d.toDate().toISOString().slice(0,10);
  }
  // JS Date?
  if (d instanceof Date) return d.toISOString().slice(0,10);
  // string: 허용 가능한 포맷 시도
  const str = String(d).trim();
  // "2025-9-2" -> pad
  // 8자리 숫자 yyyymmdd -> YYYY-MM-DD
  if (/^\d{8}$/.test(str)) {
  const y = str.slice(0,4), m = str.slice(4,6), day = str.slice(6,8);
  return `${y}-${m}-${day}`;
  }
  // YYYY/M/D -> YYYY-MM-DD
  const mSlash = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (mSlash) {
  const [_, y, mo, da] = mSlash;
  return `${y}-${mo.padStart(2,'0')}-${da.padStart(2,'0')}`;
  }
  const m = str.match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = m[1].length===2 ? `20${m[1]}` : m[1];
    const mm = m[2].padStart(2,'0');
    const dd = m[3].padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  // 이미 ISO형 "YYYY-MM-DD" 시작이면 앞 10자리만
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0,10);
  // 마지막 수단: Date로 파싱
  const d2 = new Date(str);
  if(!isNaN(d2)) return d2.toISOString().slice(0,10);
  return "";
}

// Firebase init (+ 권장 캐시 방식)
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});

// space
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

// 상태
let state = {
  kids: {},           // kidId -> kid doc
  transactions: {},   // kidId -> array of tx
  currentKidId: localStorage.getItem(LOCAL_LAST) || null,
};

// 실시간 리스너
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
  // 인덱스 없다면 orderBy("date","desc") 하나만 써도 됩니다.
  const q = query(colRef, orderBy("date", "desc"));
  unsubTx = onSnapshot(q, (snap)=>{
    const byKid = {};
    snap.forEach(docSnap=>{
      const t = docSnap.data();
      if(t.deleted) return;
      const kid = t.kidId;
      // 날짜 정규화 보관
      const normDate = normalizeDateString(t.date);
      byKid[kid] ||= [];
      byKid[kid].push({ id: docSnap.id, ...t, date: normDate });
    });
    // 보조 정렬(createdAt) - 클라이언트에서
    Object.keys(byKid).forEach(k=>{
      byKid[k].sort((a,b)=>
        (b.date||"").localeCompare(a.date||"") ||
        ((a.createdAt?.toMillis?.()||0) < (b.createdAt?.toMillis?.()||0) ? 1 : -1)
      );
    });
    state.transactions = byKid;
    renderOverview(); renderTxList();
  });
}

// 렌더
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
  return arr.reduce((s,t)=> s + (t.type==='income' ? (t.amount||0) : -(t.amount||0)), 0);
}
function renderOverview(){
  const id = state.currentKidId;
  if(!id){ currentBalance.textContent=KRWfmt(0); monthIncome.textContent=KRWfmt(0); monthExpense.textContent=KRWfmt(0); weeklyAllowance.textContent=KRWfmt(0); btnPayAllowance.disabled=true; return; }
  const kid = state.kids[id];
  const ym = new Date().toISOString().slice(0,7); // YYYY-MM
  let inc=0, exp=0;
  (state.transactions[id]||[]).forEach(t=>{
    const d = normalizeDateString(t.date);
    if((d||"").startsWith(ym)){
      if(t.type==='income') inc += (t.amount||0);
      else exp += (t.amount||0);
    }
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
  for(let i=0;i<18;i++){ // 최근 18개월
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = d.toISOString().slice(0,7);
    const opt = document.createElement('option');
    opt.value = ym; opt.textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
    filterMonth.appendChild(opt);
  }
  // 기본값: 현재월
  filterMonth.value = new Date().toISOString().slice(0,7);
}
function renderTxList(){
  txList.innerHTML = ""; emptyState.style.display = "none";
  const id = state.currentKidId;
  if(!id){ emptyState.style.display="block"; return; }
  const ym = filterMonth.value;                 // "YYYY-MM"
  const tp = filterType.value;
  const cat = filterCat.value;

  const arr = (state.transactions[id]||[])
    .filter(t=>{
      const d = normalizeDateString(t.date);
      const monthEq = d ? d.slice(0,7) === ym : false;
      if (ym && !monthEq) return false;
      if (tp && t.type !== tp) return false;
      if (cat && t.category !== cat) return false;
      return true;
    });

  if(arr.length===0){ emptyState.style.display="block"; return; }

  for(const t of arr){
    const amtClass = t.type==='income'?'pos':'neg';
    const sign = t.type==='income'?'+':'-';
    const emoji = t.sticker || (t.type==='income'?'🪙':'🍭');
    const title = `${t.category} ${t.note? '· '+escapeHtml(t.note):''}`;
    const li = document.createElement('li');
    li.className = "tx-item";
    li.innerHTML = `
      <div class="tx-main">
        <div class="tx-emoji">${emoji}</div>
        <div><div class="tx-title">${title}</div><div class="tx-sub">${normalizeDateString(t.date)}</div></div>
      </div>
      <div class="tx-actions">
        <div class="tx-amt ${amtClass}">${sign}${KRWfmt(t.amount)}</div>
        <button class="icon-btn" title="수정" data-act="edit" data-id="${t.id}">✏️</button>
        <button class="icon-btn" title="삭제" data-act="del" data-id="${t.id}">🗑️</button>
      </div>`;
    txList.appendChild(li);
  }
  txList.querySelectorAll('[data-act="del"]').forEach(b=> b.addEventListener('click',()=> deleteTx(b.dataset.id)));
  txList.querySelectorAll('[data-act="edit"]').forEach(b=> b.addEventListener('click',()=> editTxPrompt(b.dataset.id)));
}

// 아이 CRUD (낙관적 렌더 포함)
document.getElementById('btnAddKid').addEventListener('click', ()=> openKidModal());
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
      const kidId = kidForm.dataset.editId;
      // 낙관적 적용
      state.kids[kidId] = { ...(state.kids[kidId]||{id:kidId}), ...data };
      renderKidTabs(); renderOverview();
      await updateDoc(doc(db, "spaces", spaceId, "kids", kidId), data);
    }else{
      const newId = uidGen("kid_");
      state.kids[newId] = { id:newId, ...data };
      state.currentKidId = newId; localStorage.setItem(LOCAL_LAST, newId);
      renderKidTabs(); renderOverview();
      await setDoc(doc(db, "spaces", spaceId, "kids", newId), data);
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
      // 낙관적
      if(state.kids[editId]) state.kids[editId].deleted = true;
      if(state.currentKidId === editId){
        const rest = Object.keys(state.kids).filter(id=> id!==editId && !state.kids[id].deleted);
        state.currentKidId = rest[0] || null;
        localStorage.setItem(LOCAL_LAST, state.currentKidId || "");
      }
      renderKidTabs(); renderOverview(); renderTxList();
      await updateDoc(doc(db, "spaces", spaceId, "kids", editId), { deleted:true });
      kidMenu.close();
    }catch(e){ console.error(e); alert("삭제 실패"); }
  };
  kidCloseBtn.onclick = ()=> kidMenu.close();
}

// 거래 CRUD (낙관적 렌더)
txForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const kidId = state.currentKidId;
  if(!kidId){ alert("먼저 아이를 선택/추가해 주세요!"); return; }
  const type = txForm.type.value;
  const date = normalizeDateString(txDate.value || todayISO());
  const amount = Math.max(0, Number(txAmount.value||0));
  if(!amount){ alert("금액을 입력해 주세요."); return; }
  const category = txCategory.value || "기타";
  const sticker = txSticker.value || "";
  const note = (txNote.value||"").trim();

  try{
    // 낙관적 추가
    const tempId = uidGen("tx_");
    state.transactions[kidId] ||= [];
    state.transactions[kidId].unshift({ id: tempId, kidId, type, date, amount, category, sticker, note, createdAt: new Date() });
    renderOverview(); renderTxList();

    txForm.reset(); txDate.valueAsDate = new Date();

    // 실제 저장
    const ref = await addDoc(collection(db, "spaces", spaceId, "transactions"), {
      kidId, type, date, amount, category, sticker, note,
      createdAt: serverTimestamp(), deleted:false
    });
    // 낙관적 ID는 스냅샷이 들어오면 대체되므로 추가 조치 불필요
  }catch(e){ console.error(e); alert("저장 실패"); }
});

async function deleteTx(txId){
  if(!confirm("이 거래를 삭제할까요?")) return;
  try{
    // 낙관적 제거
    const kidId = state.currentKidId;
    if(state.transactions[kidId]){
      state.transactions[kidId] = state.transactions[kidId].filter(t=> t.id !== txId);
      renderOverview(); renderTxList();
    }
    await updateDoc(doc(db, "spaces", spaceId, "transactions", txId), { deleted:true });
  }catch(e){ console.error(e); alert("삭제 실패"); }
}
async function editTxPrompt(txId){
  const kidId = state.currentKidId;
  const tx = (state.transactions[kidId]||[]).find(t=> t.id===txId);
  if(!tx) return;
  const newDate = normalizeDateString(prompt("날짜(YYYY-MM-DD)", normalizeDateString(tx.date)) || normalizeDateString(tx.date));
  const newType = prompt("타입(income/expense)", tx.type) || tx.type;
  const newAmount = Number(prompt("금액(원)", tx.amount) || tx.amount);
  const newCat = prompt("분류", tx.category) || tx.category;
  const newNote = prompt("메모", tx.note||"") || tx.note;
  const newSticker = prompt("스티커(이모지)", tx.sticker||"") || tx.sticker;
  try{
    // 낙관적 수정
    Object.assign(tx, { date:newDate, type:newType, amount:newAmount, category:newCat, note:newNote, sticker:newSticker });
    renderOverview(); renderTxList();
    await updateDoc(doc(db, "spaces", spaceId, "transactions", txId), {
      date:newDate, type:newType, amount:newAmount, category:newCat, note:newNote, sticker:newSticker
    });
  }catch(e){ console.error(e); alert("수정 실패"); }
}

// 필터 & 용돈
filterMonth.addEventListener('change', renderTxList);
filterType.addEventListener('change', renderTxList);
filterCat.addEventListener('change', renderTxList);
btnPayAllowance.addEventListener('click', async ()=>{
  const id = state.currentKidId; if(!id) return;
  const kid = state.kids[id]; const w = kid?.weekly||0;
  if(!w){ alert("설정된 주간 용돈이 없어요."); return; }
  try{
    // 낙관적
    const tempId = uidGen("tx_");
    state.transactions[id] ||= [];
    state.transactions[id].unshift({ id: tempId, kidId:id, type:"income", date: todayISO(), amount:w, category:"용돈", sticker:"🪙", note:"주간 용돈", createdAt:new Date() });
    renderOverview(); renderTxList();

    await addDoc(collection(db, "spaces", spaceId, "transactions"), {
      kidId:id, type:"income", date: todayISO(), amount:w, category:"용돈", sticker:"🪙", note:"주간 용돈",
      createdAt: serverTimestamp(), deleted:false
    });
  }catch(e){ console.error(e); alert("저장 실패"); }
});

// 시작
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
