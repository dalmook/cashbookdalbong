// === Firebase Firestore 전체공개 동기화 (모바일 UX 강화판) ===
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
const filterSearch = document.getElementById('filterSearch');

const badgeIncome = document.getElementById('badgeIncome');
const badgeExpense = document.getElementById('badgeExpense');
const badgeNet = document.getElementById('badgeNet');

const fabAdd = document.getElementById('fabAdd');
const btnExportCsv = document.getElementById('btnExportCsv');
const btnUndo = document.getElementById('btnUndo');

const KRW = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const KRWfmt = (n) => KRW.format(n || 0);
function escapeHtml(s=""){ return s.replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function uidGen(prefix="id"){ return prefix + Math.random().toString(36).slice(2,9); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
txDate.valueAsDate = new Date();

// 로컬 타임존 기준 YYYY-MM
function ymLocal(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  return `${y}-${m}`;
}
// 날짜를 다양한 입력값 → "YYYY-MM-DD" 로 정규화
function normalizeDateString(d){
  if(!d) return "";
  if (typeof d === "object" && typeof d.toDate === "function") {
    return d.toDate().toISOString().slice(0,10);
  }
  if (d instanceof Date) return d.toISOString().slice(0,10);
  const str = String(d).trim();
  if (/^\d{8}$/.test(str)) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
  const mSlash = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (mSlash) return `${mSlash[1]}-${mSlash[2].padStart(2,'0')}-${mSlash[3].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0,10);
  const d2 = new Date(str);
  if(!isNaN(d2)) return d2.toISOString().slice(0,10);
  return "";
}

// Firebase init (+ 권장 캐시)
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

// 간단 Undo 스택(최근 1건)
let lastAction = null;

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
  if (typeof unsubTx === "function") unsubTx();
  const colRef = collection(db, "spaces", spaceId, "transactions");
  const qy = query(colRef, orderBy("date", "desc"));
  unsubTx = onSnapshot(qy, (snap)=>{
    const byKid = {};
    snap.forEach(docSnap=>{
      const t = docSnap.data();
      if (t.deleted) return;
      const kid = t.kidId;
      const normDate = normalizeDateString(t.date);
      byKid[kid] ||= [];
      byKid[kid].push({
        id: docSnap.id,
        ...t,
        date: normDate,
      });
    });
    Object.keys(byKid).forEach(k=>{
      byKid[k].sort((a,b)=>
        (b.date||"").localeCompare(a.date||"") ||
        ((a.createdAt?.toMillis?.()||0) < (b.createdAt?.toMillis?.()||0) ? 1 : -1)
      );
    });
    state.transactions = byKid;
    renderOverview();
    renderTxList();
  }, (err)=>console.error("onSnapshot(transactions) error:", err));
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
    let t=null; card.addEventListener('pointerdown',()=>{ t=setTimeout(()=>openKidMenu(id),650); });
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
  if(!id){
    currentBalance.textContent=KRWfmt(0);
    monthIncome.textContent=KRWfmt(0);
    monthExpense.textContent=KRWfmt(0);
    weeklyAllowance.textContent=KRWfmt(0);
    btnPayAllowance.disabled=true; 
    return;
  }
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
  for(let i=0;i<18;i++){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = ymLocal(d);                 // ✅ 로컬 기준 YYYY-MM
    const opt = document.createElement('option');
    opt.value = ym;
    opt.textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
    filterMonth.appendChild(opt);
  }
  filterMonth.value = ymLocal(new Date());  // ✅ 기본값도 로컬 기준
}
function monthlyTotals(kidId, ym){
  let inc=0, exp=0;
  (state.transactions[kidId]||[]).forEach(t=>{
    const d = normalizeDateString(t.date);
    if(d && d.slice(0,7)===ym){
      if(t.type==='income') inc += (t.amount||0); else exp += (t.amount||0);
    }
  });
  return {inc, exp, net: inc-exp};
}
function renderBadges(){
  const kidId = state.currentKidId;
  const ym = filterMonth.value;
  if(!kidId || !ym){ badgeIncome.textContent = "+0"; badgeExpense.textContent="-0"; badgeNet.textContent="=0"; return;}
  const {inc, exp, net} = monthlyTotals(kidId, ym);
  badgeIncome.textContent = `+${KRWfmt(inc)}`;
  badgeExpense.textContent = `-${KRWfmt(exp)}`;
  badgeNet.textContent = `=${KRWfmt(net)}`;
}
function renderTxList(){
  txList.innerHTML = "";
  emptyState.style.display = "none";

  const kidId = state.currentKidId;
  if (!kidId) {
    emptyState.style.display = "block";
    renderBadges();
    return;
  }
  const ym = filterMonth.value;
  const tp = filterType.value;
  const cat = filterCat.value;
  const q = (filterSearch.value||"").trim().toLowerCase();

  const filtered = (state.transactions[kidId] || []).filter(t=>{
    const d = normalizeDateString(t.date);
    const monthEq = d ? d.slice(0,7) === ym : false;
    if (ym && !monthEq) return false;
    if (tp && t.type !== tp) return false;
    if (cat && t.category !== cat) return false;
    if (q){
      const hay = `${t.category||""} ${t.note||""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderBadges();

  if (filtered.length === 0) {
    emptyState.style.display = "block";
    return;
  }

  // 날짜별 그룹 타이틀 + 러닝밸런스(월 기준)
  const startBalance = (()=> {
    // 해당 월 시작일 이전까지의 누적 잔액
    const monthStart = ym + "-01";
    const all = state.transactions[kidId] || [];
    let bal = 0;
    for(const t of all){
      const d = normalizeDateString(t.date);
      if (d && d < monthStart){
        bal += (t.type==='income' ? (t.amount||0) : -(t.amount||0));
      }
    }
    return bal;
  })();

  let running = startBalance;
  let currentDate = null;

  for (const t of filtered) {
    const dstr = normalizeDateString(t.date);
    if (currentDate !== dstr){
      currentDate = dstr;
      const hdr = document.createElement("li");
      hdr.className = "tx-sep";
      hdr.innerHTML = `<div class="tx-sep-line"></div><div class="tx-sep-date">${dstr}</div>`;
      txList.appendChild(hdr);
    }

    const amt = t.amount||0;
    running += (t.type==='income' ? amt : -amt);

    const amtClass = t.type === "income" ? "pos" : "neg";
    const sign = t.type === "income" ? "+" : "-";
    const emoji = t.sticker || (t.type === "income" ? "🪙" : "🍭");
    const title = `${t.category} ${t.note ? "· " + escapeHtml(t.note) : ""}`;

    const li = document.createElement("li");
    li.className = "tx-item";
    li.innerHTML = `
      <div class="tx-main">
        <div class="tx-emoji">${emoji}</div>
        <div>
          <div class="tx-title">${title}</div>
          <div class="tx-sub">${dstr}</div>
        </div>
      </div>
      <div class="tx-actions">
        <div class="tx-amt ${amtClass}">${sign}${KRWfmt(amt)}</div>
        <div class="tx-run">잔:${KRWfmt(running)}</div>
        <button class="icon-btn" title="수정" data-act="edit" data-id="${t.id}">✏️</button>
        <button class="icon-btn" title="삭제" data-act="del" data-id="${t.id}">🗑️</button>
      </div>
    `;
    // 오늘 날짜 강조
    if (dstr === todayISO()) li.classList.add('today');
    txList.appendChild(li);
  }

  // 액션 바인딩
  txList.querySelectorAll('[data-act="del"]').forEach(b=>{
    b.addEventListener('click', ()=> deleteTx(b.dataset.id));
  });
  txList.querySelectorAll('[data-act="edit"]').forEach(b=>{
    b.addEventListener('click', ()=> editTxPrompt(b.dataset.id));
  });
}

// 아이 CRUD
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
      lastAction = { type:'kidUpdate', kidId, before: {...state.kids[kidId]} };
      state.kids[kidId] = { ...(state.kids[kidId]||{id:kidId}), ...data };
      renderKidTabs(); renderOverview();
      await updateDoc(doc(db, "spaces", spaceId, "kids", kidId), data);
    }else{
      const newId = uidGen("kid_");
      lastAction = null; // 새 추가는 undo 미지원
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
      lastAction = { type:'kidSoftDelete', kidId: editId, before: {...state.kids[editId]} };
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

// 거래 CRUD
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
    const tempId = uidGen("tx_");
    const optimistic = { id: tempId, kidId, type, date, amount, category, sticker, note, createdAt: new Date() };
    state.transactions[kidId] ||= [];
    state.transactions[kidId].unshift(optimistic);
    lastAction = { type:'addTx', kidId, tempId, tx: optimistic };
    renderOverview(); renderTxList();

    txForm.reset(); txDate.valueAsDate = new Date();

    await addDoc(collection(db, "spaces", spaceId, "transactions"), {
      kidId, type, date, amount, category, sticker, note,
      createdAt: serverTimestamp(), deleted:false
    });
  }catch(e){ console.error(e); alert("저장 실패"); }
});
async function deleteTx(txId){
  if(!confirm("이 거래를 삭제할까요?")) return;
  try{
    const kidId = state.currentKidId;
    const target = (state.transactions[kidId]||[]).find(t=> t.id===txId);
    lastAction = { type:'delTx', kidId, backup: target ? {...target}:null };
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
  const before = {...tx};
  const newDate = normalizeDateString(prompt("날짜(YYYY-MM-DD)", normalizeDateString(tx.date)) || normalizeDateString(tx.date));
  const newType = (prompt("타입(income/expense)", tx.type) || tx.type).trim();
  const newAmount = Number(prompt("금액(원)", tx.amount) || tx.amount);
  const newCat = prompt("분류", tx.category) || tx.category;
  const newNote = prompt("메모", tx.note||"") || tx.note;
  const newSticker = prompt("스티커(이모지)", tx.sticker||"") || tx.sticker;
  try{
    Object.assign(tx, { date:newDate, type:newType, amount:newAmount, category:newCat, note:newNote, sticker:newSticker });
    lastAction = { type:'editTx', kidId, id: txId, before };
    renderOverview(); renderTxList();
    await updateDoc(doc(db, "spaces", spaceId, "transactions", txId), {
      date:newDate, type:newType, amount:newAmount, category:newCat, note:newNote, sticker:newSticker
    });
  }catch(e){ console.error(e); alert("수정 실패"); }
}

// 필터/검색/버튼
filterMonth.addEventListener('change', renderTxList);
filterType.addEventListener('change', renderTxList);
filterCat.addEventListener('change', renderTxList);
filterSearch.addEventListener('input', renderTxList);

btnPayAllowance.addEventListener('click', async ()=>{
  const id = state.currentKidId; if(!id) return;
  const kid = state.kids[id]; const w = kid?.weekly||0;
  if(!w){ alert("설정된 주간 용돈이 없어요."); return; }
  try{
    const tempId = uidGen("tx_");
    const optimistic = { id: tempId, kidId:id, type:"income", date: todayISO(), amount:w, category:"용돈", sticker:"🪙", note:"주간 용돈", createdAt:new Date() };
    state.transactions[id] ||= [];
    state.transactions[id].unshift(optimistic);
    lastAction = { type:'addTx', kidId:id, tempId, tx: optimistic };
    renderOverview(); renderTxList();

    await addDoc(collection(db, "spaces", spaceId, "transactions"), {
      kidId:id, type:"income", date: todayISO(), amount:w, category:"용돈", sticker:"🪙", note:"주간 용돈",
      createdAt: serverTimestamp(), deleted:false
    });
  }catch(e){ console.error(e); alert("저장 실패"); }
});

// 빠른 금액 버튼
document.querySelectorAll('.quick-amt button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const inc = Number(btn.dataset.amt||0);
    const cur = Number(txAmount.value||0);
    txAmount.value = cur + inc;
    txAmount.focus();
  });
});

// 빠른 카테고리 칩
document.getElementById('quickCats').addEventListener('click', (e)=>{
  const b = e.target.closest('button[data-cat]');
  if(!b) return;
  txCategory.value = b.dataset.cat;
  txSticker.value = b.dataset.stk || "";
  txNote.focus();
});

// FAB → 입력 폼으로 스크롤
fabAdd.addEventListener('click', ()=>{
  txForm.scrollIntoView({behavior:'smooth', block:'start'});
  txAmount.focus();
});

// CSV 내보내기(현재 아이+월)
btnExportCsv.addEventListener('click', ()=>{
  const kidId = state.currentKidId; if(!kidId) return alert("아이를 먼저 선택하세요.");
  const ym = filterMonth.value;
  const rows = [["date","type","amount","category","sticker","note"]];
  (state.transactions[kidId]||[]).forEach(t=>{
    const d = normalizeDateString(t.date);
    if (d && d.slice(0,7)===ym){
      rows.push([d, t.type, t.amount||0, t.category||"", t.sticker||"", (t.note||"").replaceAll('"','""')]);
    }
  });
  const csv = rows.map(r=> r.map(v=> `"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const kidName = state.kids[kidId]?.name || "kid";
  a.download = `allowance_${kidName}_${ym}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// 간단 Undo (최근 1건)
btnUndo.addEventListener('click', async ()=>{
  if(!lastAction) return;
  try{
    const act = lastAction; lastAction = null;
    if (act.type === 'addTx'){
      // 낙관적으로 넣었던 temp 항목 제거
      const arr = state.transactions[act.kidId]||[];
      state.transactions[act.kidId] = arr.filter(t=> t.id !== act.tempId);
      renderOverview(); renderTxList();
      // 서버에 이미 저장되었을 수 있으므로 별도 서버조치 없음
    }else if (act.type === 'delTx' && act.backup){
      // 삭제되기 전 백업을 다시 넣어줌(클라이언트만)
      state.transactions[act.kidId] ||= [];
      state.transactions[act.kidId].unshift(act.backup);
      renderOverview(); renderTxList();
    }else if (act.type === 'editTx'){
      const arr = state.transactions[act.kidId]||[];
      const idx = arr.findIndex(x=> x.id===act.id);
      if (idx>=0){ arr[idx] = {...arr[idx], ...act.before}; }
      renderOverview(); renderTxList();
    }else if (act.type === 'kidSoftDelete'){
      const k = act.before || {};
      state.kids[act.kidId] = k;
      if(!state.currentKidId) state.currentKidId = act.kidId;
      renderKidTabs(); renderOverview(); renderTxList();
    }else if (act.type === 'kidUpdate'){
      const k = act.before || {};
      state.kids[act.kidId] = k;
      renderKidTabs(); renderOverview();
    }
  }catch(e){ console.error(e); }
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
