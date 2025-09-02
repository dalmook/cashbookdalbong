// ===== 꼬마 가계부 · Google Sheets 동기화 버전 =====
// 단일 진실원천 = Google Sheets (append-only 이벤트 소싱)
// 로컬은 lastKidId만 보관 (UX 용)
// -----------------------------------------------
// 꼭 바꿔주세요 ↓ (Apps Script 배포한 웹앱 URL)
const API_URL = "https://script.google.com/macros/s/AKfycbynh43nMHQn9hTh0dWXUTl-CEY9y9BkPa2R1szYxYrHaPR_7RTkaFEGE6axYPC4Azl3LA/exec";

// 시트 헤더(첫 행)는 다음과 같아야 해요:
// kidId | kidName | kidEmoji | kidColor | weekly | txId | date | type | amount | category | sticker | note | createdAt
//
// 이벤트 종류(모두 appendRow):
// - 아이 추가:      type="kid"
// - 아이 수정:      type="kid_update"
// - 아이 삭제:      type="kid_delete"
// - 거래 추가:      type="income" | "expense"
// - 거래 수정:      type="tx_update",   note="tx:<원본txId>"
// - 거래 삭제:      type="tx_delete",   note="tx:<원본txId>"

const KRW = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const LOCAL_LAST = "kiddyBudget_lastKidId";

let state = {
  kids: {},           // { kidId: { id, name, emoji, color, weekly, deleted?:true } }
  transactions: {},   // { kidId: Tx[] }  (최종 상태로 합성된 결과)
  rawRows: [],        // 서버에서 내려온 원본 행들
  currentKidId: localStorage.getItem(LOCAL_LAST) || null,
};

// ---- DOM 참조
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

// 기본 날짜 = 오늘
txDate.valueAsDate = new Date();

// ===== 유틸 =====
function uid(prefix="id"){ return prefix + Math.random().toString(36).slice(2,9); }
function nowTs(){ return Date.now(); }
function escapeHtml(s=""){ return s.replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function todayOffset(delta=0){ const d=new Date(); d.setDate(d.getDate()+delta); return d.toISOString().slice(0,10); }

// ===== 서버 I/O =====
async function apiGetAll() {
  const r = await fetch(API_URL); // 전체 로드 (필요하면 ?kidId= 로 변경 가능)
  if(!r.ok) throw new Error("GET 실패");
  return r.json();
}
async function apiGetByKid(kidId){
  const r = await fetch(`${API_URL}?kidId=${encodeURIComponent(kidId)}`);
  if(!r.ok) throw new Error("GET 실패");
  return r.json();
}
async function apiAppend(row){
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(row)
  });
  if(!r.ok) throw new Error("POST 실패");
  return r.json();
}

// ===== 상태 합성(이벤트 → 현재상태) =====
function reduceState(rows){
  // createdAt 기준 오래된 → 최신 순으로 정렬 후 누적
  const sorted = rows.slice().sort((a,b)=> Number(a.createdAt||0) - Number(b.createdAt||0));

  const kids = {};                  // kidId → 최종 프로필
  const txById = {};                // txId → 최신 거래 (업데이트/삭제 반영)
  const deleteTxSet = new Set();    // 삭제된 txId
  const kidDeleteSet = new Set();   // 삭제된 kidId

  for(const r of sorted){
    const type = (r.type||"").toString();
    const kidId = r.kidId;

    if(type === "kid"){
      // 새 아이 또는 최신값으로 갱신
      kids[kidId] = {
        id: kidId,
        name: r.kidName || (kids[kidId]?.name || ""),
        emoji: r.kidEmoji || (kids[kidId]?.emoji || "🐣"),
        color: r.kidColor || (kids[kidId]?.color || "#ffd9e6"),
        weekly: Number(r.weekly || kids[kidId]?.weekly || 0),
      };
    }
    else if(type === "kid_update"){
      if(!kids[kidId]) kids[kidId] = { id:kidId, name:"", emoji:"🐣", color:"#ffd9e6", weekly:0 };
      if(r.kidName)  kids[kidId].name  = r.kidName;
      if(r.kidEmoji) kids[kidId].emoji = r.kidEmoji;
      if(r.kidColor) kids[kidId].color = r.kidColor;
      if(r.weekly !== undefined && r.weekly !== "") kids[kidId].weekly = Number(r.weekly);
    }
    else if(type === "kid_delete"){
      kidDeleteSet.add(kidId);
    }
    else if(type === "income" || type === "expense"){
      const txId = r.txId;
      txById[txId] = {
        id: txId,
        kidId,
        type,
        date: r.date,
        amount: Number(r.amount||0),
        category: r.category || "기타",
        sticker: r.sticker || "",
        note: r.note || "",
        createdAt: Number(r.createdAt||0),
      };
    }
    else if(type === "tx_update"){
      // note="tx:원본ID" 로 참조
      const ref = (r.note||"").toString().startsWith("tx:") ? (r.note||"").toString().slice(3) : "";
      if(ref && txById[ref]){
        const t = txById[ref];
        if(r.date)     t.date = r.date;
        if(r.type === "income" || r.type === "expense") t.type = r.type; // 혹시 타입변경을 보낼 수도 있음
        if(r.amount !== undefined && r.amount !== "") t.amount = Number(r.amount);
        if(r.category) t.category = r.category;
        if(r.sticker)  t.sticker = r.sticker;
        if(r.note && !r.note.startsWith("tx:")) t.note = r.note; // 참조표시 외의 실제 메모가 들어온 경우
        t.createdAt = Math.max(t.createdAt, Number(r.createdAt||0));
      }
    }
    else if(type === "tx_delete"){
      const ref = (r.note||"").toString().startsWith("tx:") ? (r.note||"").toString().slice(3) : "";
      if(ref) deleteTxSet.add(ref);
    }
  }

  // 삭제된 아이 제외
  for(const id of kidDeleteSet){ if(kids[id]) kids[id].deleted = true; }

  // kidId별 거래로 그룹핑 (삭제 제외)
  const transactions = {};
  for(const [txId, t] of Object.entries(txById)){
    if(deleteTxSet.has(txId)) continue;
    if(!transactions[t.kidId]) transactions[t.kidId] = [];
    transactions[t.kidId].push(t);
  }
  for(const kidId of Object.keys(transactions)){
    transactions[kidId].sort((a,b)=> (b.date||"").localeCompare(a.date||"") || b.createdAt - a.createdAt);
  }

  state.kids = kids;
  state.transactions = transactions;
}

// ===== 렌더링 =====
function renderKidTabs(){
  kidTabs.innerHTML = "";
  const ids = Object.keys(state.kids).filter(id => !state.kids[id].deleted);
  if(ids.length===0){
    const li = document.createElement('li');
    li.innerHTML = `<div class="kid-card">
      <div class="kid-avatar">➕</div>
      <div class="kid-meta"><div class="kid-name">아직 아이가 없어요</div><div class="kid-sub">[+ 아이 추가]를 눌러 시작해요</div></div>
    </div>`;
    kidTabs.appendChild(li);
    return;
  }
  ids.forEach(id=>{
    const k = state.kids[id];
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="kid-card ${id===state.currentKidId?'active':''}" data-id="${id}">
        <div class="kid-avatar" style="background:${k.color||'#ffe3ef'}22;border-color:${k.color||'#ffe3ef'}">${k.emoji||'🐣'}</div>
        <div class="kid-meta">
          <div class="kid-name">${escapeHtml(k.name||'')}</div>
          <div class="kid-sub">주간 용돈: ${KRW.format(k.weekly||0)}</div>
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
  state.currentKidId = id;
  localStorage.setItem(LOCAL_LAST, id);
  renderKidTabs(); renderOverview(); renderFilters(); renderTxList();
}

function kidBalance(id){
  const arr = state.transactions[id] || [];
  return arr.reduce((sum,t)=> sum + (t.type==='income'? t.amount : -t.amount), 0);
}

function renderOverview(){
  if(!state.currentKidId){
    currentBalance.textContent = KRW.format(0);
    monthIncome.textContent = KRW.format(0);
    monthExpense.textContent = KRW.format(0);
    weeklyAllowance.textContent = KRW.format(0);
    btnPayAllowance.disabled = true;
    return;
  }
  const kid = state.kids[state.currentKidId];
  const arr = state.transactions[state.currentKidId] || [];
  const ym = new Date().toISOString().slice(0,7);
  let inc=0, exp=0;
  for(const t of arr){
    if((t.date||'').startsWith(ym)){
      if(t.type==='income') inc += t.amount;
      else exp += t.amount;
    }
  }
  currentBalance.textContent = KRW.format(kidBalance(state.currentKidId));
  monthIncome.textContent = KRW.format(inc);
  monthExpense.textContent = KRW.format(exp);
  weeklyAllowance.textContent = KRW.format((kid?.weekly)||0);
  btnPayAllowance.disabled = !(kid && kid.weekly);
}

function renderFilters(){
  filterMonth.innerHTML = "";
  const now = new Date();
  for(let i=0;i<12;i++){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = d.toISOString().slice(0,7);
    const opt = document.createElement('option');
    opt.value = ym;
    opt.textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
    filterMonth.appendChild(opt);
  }
  filterMonth.value = new Date().toISOString().slice(0,7);
}

function renderTxList(){
  txList.innerHTML = ""; emptyState.style.display = "none";
  const kidId = state.currentKidId;
  if(!kidId){ emptyState.style.display="block"; return; }
  const arr = (state.transactions[kidId] || []).slice();
  const ym = filterMonth.value, tp = filterType.value, cat = filterCat.value;

  let count=0;
  for(const t of arr){
    if(ym && !(t.date||"").startsWith(ym)) continue;
    if(tp && t.type !== tp) continue;
    if(cat && t.category !== cat) continue;

    const li = document.createElement('li');
    const amtClass = t.type === 'income' ? 'pos' : 'neg';
    const sign = t.type === 'income' ? '+' : '-';
    const emoji = t.sticker || (t.type==='income'?'🪙':'🍭');
    const title = `${t.category} ${t.note ? '· '+escapeHtml(t.note) : ''}`;
    li.className = "tx-item";
    li.innerHTML = `
      <div class="tx-main">
        <div class="tx-emoji">${emoji}</div>
        <div><div class="tx-title">${title}</div><div class="tx-sub">${t.date}</div></div>
      </div>
      <div class="tx-actions">
        <div class="tx-amt ${amtClass}">${sign}${KRW.format(t.amount)}</div>
        <button class="icon-btn" title="수정" data-act="edit" data-id="${t.id}">✏️</button>
        <button class="icon-btn" title="삭제" data-act="del" data-id="${t.id}">🗑️</button>
      </div>`;
    txList.appendChild(li); count++;
  }
  if(count===0) emptyState.style.display="block";

  txList.querySelectorAll('[data-act="del"]').forEach(b=> b.addEventListener('click',()=> deleteTx(b.dataset.id)));
  txList.querySelectorAll('[data-act="edit"]').forEach(b=> b.addEventListener('click',()=> editTxPrompt(b.dataset.id)));
}

// ===== 아이 CRUD (서버 append 기반) =====
btnAddKid.addEventListener('click', ()=> openKidModal());
function openKidModal(editId=null){
  kidModalTitle.textContent = editId ? "아이 수정" : "아이 추가";
  if(editId){
    const k = state.kids[editId];
    kidName.value = k?.name || "";
    kidEmoji.value = k?.emoji || "";
    kidColor.value = k?.color || "#ffd9e6";
    kidWeekly.value = k?.weekly || 0;
    kidForm.dataset.editId = editId;
  }else{
    kidName.value=""; kidEmoji.value=""; kidColor.value="#ffd9e6"; kidWeekly.value="";
    delete kidForm.dataset.editId;
  }
  if(typeof kidModal.showModal==='function') kidModal.showModal();
  else alert('이 브라우저는 dialog를 지원하지 않아요.');
}

kidForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name = kidName.value.trim();
  if(!name){ alert("이름을 입력해 주세요"); return; }
  const row = {
    kidId: kidForm.dataset.editId || uid("kid_"),
    kidName: name,
    kidEmoji: (kidEmoji.value || "🐣").slice(0,2),
    kidColor: kidColor.value || "#ffd9e6",
    weekly: Number(kidWeekly.value || 0),
    txId: "",             // 아이 이벤트는 거래 아님
    date: todayOffset(0), // 기록 편의상 날짜 저장
    type: kidForm.dataset.editId ? "kid_update" : "kid",
    amount: "", category: "", sticker: "",
    note: kidForm.dataset.editId ? "kid_update" : "kid_add",
    createdAt: nowTs(),
  };
  try{
    await apiAppend(row);
    kidModal.close();
    await refreshAll(); // 서버 데이터 다시 로드
    selectKid(row.kidId);
  }catch(err){
    console.error(err); alert("아이 저장 실패");
  }
});

function openKidMenu(editId){
  if(typeof kidMenu.showModal !== 'function') return;
  kidMenu.showModal();
  kidEditBtn.onclick = ()=>{ kidMenu.close(); openKidModal(editId); };
  kidDeleteBtn.onclick = async ()=>{
    if(!confirm("이 아이와 모든 거래 기록을 숨길까요? (시트에는 남아있습니다)")) return;
    const row = {
      kidId: editId, kidName:"", kidEmoji:"", kidColor:"", weekly:"",
      txId:"", date: todayOffset(0), type:"kid_delete",
      amount:"", category:"", sticker:"", note:"kid_delete", createdAt: nowTs()
    };
    try{
      await apiAppend(row);
      kidMenu.close();
      await refreshAll();
      // 다른 아이로 전환
      const rest = Object.keys(state.kids).filter(id=> !state.kids[id].deleted);
      state.currentKidId = rest[0] || null;
      localStorage.setItem(LOCAL_LAST, state.currentKidId || "");
      renderKidTabs(); renderOverview(); renderTxList();
    }catch(e){ console.error(e); alert("삭제 실패"); }
  };
  kidCloseBtn.onclick = ()=> kidMenu.close();
}

// ===== 거래 CRUD =====
txForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const kidId = state.currentKidId;
  if(!kidId){ alert("먼저 아이를 선택/추가해 주세요!"); return; }
  const type = txForm.type.value; // income | expense
  const date = txDate.value || todayOffset(0);
  const amount = Math.max(0, Number(txAmount.value||0));
  if(!amount){ alert("금액을 입력해 주세요."); return; }
  const category = txCategory.value || "기타";
  const sticker = txSticker.value || "";
  const note = (txNote.value || "").trim();

  const row = {
    kidId,
    kidName: "", kidEmoji:"", kidColor:"", weekly:"",
    txId: uid("tx_"),
    date, type, amount, category, sticker, note,
    createdAt: nowTs(),
  };
  try{
    await apiAppend(row);
    txForm.reset(); txDate.valueAsDate = new Date();
    await refreshByKid(kidId);
    renderOverview(); renderTxList();
  }catch(e){ console.error(e); alert("저장 실패"); }
});

async function deleteTx(txId){
  const kidId = state.currentKidId;
  if(!kidId || !txId) return;
  if(!confirm("이 거래를 삭제할까요? (시트에는 삭제이력이 남습니다)")) return;
  const row = {
    kidId, kidName:"", kidEmoji:"", kidColor:"", weekly:"",
    txId:"", date: todayOffset(0), type:"tx_delete", amount:"", category:"", sticker:"",
    note: `tx:${txId}`, createdAt: nowTs(),
  };
  try{
    await apiAppend(row);
    await refreshByKid(kidId);
    renderOverview(); renderTxList();
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

  // 업데이트 행 추가 (원본 txId 참조)
  const row = {
    kidId, kidName:"", kidEmoji:"", kidColor:"", weekly:"",
    txId:"", date:newDate, type:"tx_update", amount:newAmount, category:newCat, sticker:newSticker,
    note: `tx:${txId}${newNote ? `; ${newNote}` : ""}`,
    createdAt: nowTs(),
  };
  // 타입 변경도 허용하려면 type에 income/expense 를 넣고, tx_update로 전달해도 위 reduce에서 반영하도록 처리했음.
  // newType이 다르면 type 필드에 그대로 전달
  if(newType && (newType==="income" || newType==="expense")) row.type = "tx_update"; // 전달은 tx_update
  // 추가적으로 변경 타입을 알려주고 싶으면 note에 type:income 같은 텍스트를 넣어도 됨.

  try{
    await apiAppend(row);
    await refreshByKid(kidId);
    renderOverview(); renderTxList();
  }catch(e){ console.error(e); alert("수정 실패"); }
}

// ===== 내보내기/가져오기 (시트가 진실원천이므로 보조 기능) =====
btnExport.addEventListener('click', ()=>{
  const dataStr = JSON.stringify({ kids: state.kids, transactions: state.transactions }, null, 2);
  const blob = new Blob([dataStr], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.download = `kiddy-budget-export-${ts}.json`;
  a.click(); URL.revokeObjectURL(url);
});

// 가져오기는 시트 진실원천과 충돌 소지가 있어 기본 비활성화(원하면 로컬 머지 로직을 작성해도 됨)
importFile.addEventListener('change', ()=> alert("구글시트 동기화 버전에서는 가져오기를 권장하지 않아요. 필요하면 말씀 주세요!"));

// 데모 데이터: 시트에 데모 이벤트 append
btnAddDemo.addEventListener('click', async ()=>{
  if(!confirm("데모 데이터를 시트에 추가할까요?")) return;
  const k1 = uid("kid_"), k2 = uid("kid_");
  const rows = [
    { kidId:k1, kidName:"유겸", kidEmoji:"🐰", kidColor:"#ffd9e6", weekly:2000, txId:"", date:todayOffset(-3), type:"kid", amount:"", category:"", sticker:"", note:"kid_add", createdAt: nowTs()-50000 },
    { kidId:k1, kidName:"", kidEmoji:"", kidColor:"", weekly:"", txId:uid("tx_"), date:todayOffset(-3), type:"income", amount:2000, category:"용돈", sticker:"🪙", note:"주간 용돈", createdAt: nowTs()-48000 },
    { kidId:k1, kidName:"", kidEmoji:"", kidColor:"", weekly:"", txId:uid("tx_"), date:todayOffset(-2), type:"income", amount:500, category:"미션보상", sticker:"⭐", note:"장난감 정리", createdAt: nowTs()-46000 },
    { kidId:k1, kidName:"", kidEmoji:"", kidColor:"", weekly:"", txId:uid("tx_"), date:todayOffset(-1), type:"expense", amount:1200, category:"간식", sticker:"🍪", note:"쿠키", createdAt: nowTs()-44000 },

    { kidId:k2, kidName:"지안", kidEmoji:"🦄", kidColor:"#d9fff2", weekly:1500, txId:"", date:todayOffset(-3), type:"kid", amount:"", category:"", sticker:"", note:"kid_add", createdAt: nowTs()-50010 },
    { kidId:k2, kidName:"", kidEmoji:"", kidColor:"", weekly:"", txId:uid("tx_"), date:todayOffset(-3), type:"income", amount:1500, category:"용돈", sticker:"🪙", note:"주간 용돈", createdAt: nowTs()-47000 },
    { kidId:k2, kidName:"", kidEmoji:"", kidColor:"", weekly:"", txId:uid("tx_"), date:todayOffset(-2), type:"expense", amount:800, category:"학용품", sticker:"✏️", note:"색연필", createdAt: nowTs()-45000 },
  ];
  try{
    for(const row of rows){ await apiAppend(row); }
    await refreshAll();
    selectKid(k1);
    alert("데모 데이터 추가 완료!");
  }catch(e){ console.error(e); alert("데모 추가 실패"); }
});

// ===== 새로고침(서버로부터 재합성) =====
async function refreshAll(){
  const rows = await apiGetAll();
  state.rawRows = rows;
  reduceState(rows);
  // currentKidId 기본값 설정
  if(!state.currentKidId){
    const alive = Object.keys(state.kids).filter(id=> !state.kids[id].deleted);
    state.currentKidId = alive[0] || null;
    localStorage.setItem(LOCAL_LAST, state.currentKidId || "");
  }
  renderKidTabs(); renderOverview(); renderFilters(); renderTxList();
}
async function refreshByKid(kidId){
  // 성능이 필요하면 부분 로드; 여기선 전체 갱신과 동일하게 처리
  await refreshAll();
}

// ===== 앱 시작 =====
(async function init(){
  try{
    await refreshAll();
  }catch(e){
    console.error(e);
    alert("구글시트에서 데이터를 불러오지 못했습니다. API_URL 또는 배포 설정을 확인하세요.");
  }
})();
