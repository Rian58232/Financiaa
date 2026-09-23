const KEY='meu-controle-v1';
const NOTIFY_KEY='meu-controle-browser-notifications';
const NOTIFIED_KEY='meu-controle-notified-v1';
const SUPABASE_URL='https://qbvaltltzjmryemxvasm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_2D_tPBDk171ltFsCaenQBg_LyiYmLmN';
const supabaseClient=window.supabase?.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
let cloudUser=null,cloudSaveTimer=null,cloudPollTimer=null,cloudChannel=null,lastCloudUpdatedAt='',lastLocalMutationAt=0,cloudDirty=false,cloudSaving=false,localRevision=0,remoteRefreshPending=false;
const CLIENT_INSTANCE_ID=(crypto?.randomUUID?.()||String(Date.now()+Math.random()));
const localTabChannel=('BroadcastChannel' in window)?new BroadcastChannel('meu-controle-local-sync-v1'):null;
const categories=['Alimentação','Faculdade','Transporte','Lazer','Jogos','Casa','Contas','Saúde','Compras','Outros'];
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmt=v=>brl.format((Number(v)||0)/100);
const today=()=>new Date().toISOString().slice(0,10);
const parseMoney=(s)=>Math.round(Number(String(s).replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,''))*100)||0;
const safeDay=(y,m,d)=>new Date(y,m,Math.min(d,new Date(y,m+1,0).getDate()));
const monthName=d=>d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
const shortDate=s=>new Date(s+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','');

let state=load();
let historyFilter='all', billFilter='all', calendarCursor=new Date();

function blankState(){return {transactions:[],cards:[],bills:[],paidInvoices:[],categories:[...categories]}}
function normalizeState(x){
  const base=blankState();
  if(!x||typeof x!=='object')return base;
  return {
    transactions:Array.isArray(x.transactions)?x.transactions:[],
    cards:Array.isArray(x.cards)?x.cards:[],
    bills:Array.isArray(x.bills)?x.bills:[],
    paidInvoices:Array.isArray(x.paidInvoices)?x.paidInvoices:[],
    categories:Array.isArray(x.categories)&&x.categories.length?x.categories:[...categories]
  };
}
function load(){
  try{const x=JSON.parse(localStorage.getItem(KEY));if(x)return normalizeState(x)}catch{}
  return blankState();
}
function persistLocal(){localStorage.setItem(KEY,JSON.stringify(state))}
function save(){
  // Atualização otimista: a interface muda AGORA, sem esperar internet/Supabase.
  persistLocal();
  lastLocalMutationAt=Date.now();
  localRevision++;
  cloudDirty=true;
  renderAll();
  try{localTabChannel?.postMessage({type:'state',sender:CLIENT_INSTANCE_ID,state,revision:localRevision})}catch{}
  queueCloudSave();
}
function setSyncStatus(mode,text){
  const el=document.querySelector('#syncStatus');if(!el)return;
  el.dataset.mode=mode;el.textContent=text||({online:'Sincronizado',syncing:'Sincronizando',offline:'Sem internet',error:'Falha ao sincronizar'}[mode]||'Nuvem');
}
function showAuthGate(show=true){const gate=document.querySelector('#authGate');if(gate)gate.classList.toggle('hidden',!show)}
function setAuthMessage(msg='',error=false){const el=document.querySelector('#authMessage');if(!el)return;el.textContent=msg;el.classList.toggle('error',!!error)}
async function pullCloudState(force=false){
  if(!supabaseClient||!cloudUser||!navigator.onLine)return;
  if(!force&&(cloudSaving||cloudDirty||Date.now()-lastLocalMutationAt<1200))return;
  try{
    const {data,error}=await supabaseClient.from('app_state').select('data,updated_at').eq('user_id',cloudUser.id).maybeSingle();
    if(error)throw error;
    if(!data){await pushCloudState(true);return}
    const stamp=data.updated_at||'';
    if(force||!lastCloudUpdatedAt||stamp>lastCloudUpdatedAt){state=normalizeState(data.data);persistLocal();lastCloudUpdatedAt=stamp;renderAll();try{localTabChannel?.postMessage({type:'state',sender:CLIENT_INSTANCE_ID,state,remote:true})}catch{}}
    setSyncStatus('online','Sincronizado');
  }catch(err){console.error('Cloud pull failed',err);setSyncStatus(navigator.onLine?'error':'offline')}
}
async function announceCloudChange(){
  if(!cloudChannel)return;
  try{await cloudChannel.send({type:'broadcast',event:'state-changed',payload:{sender:CLIENT_INSTANCE_ID,updated_at:lastCloudUpdatedAt}})}catch{}
}
async function pushCloudState(force=false){
  if(!supabaseClient||!cloudUser||!navigator.onLine||cloudSaving)return;
  if(!force&&!cloudDirty)return;
  const revisionAtStart=localRevision;
  // Snapshot evita uma alteração feita durante o request ser marcada por engano como já sincronizada.
  const snapshot=JSON.parse(JSON.stringify(state));
  cloudSaving=true;setSyncStatus('syncing','Sincronizando…');
  try{
    const payload={user_id:cloudUser.id,data:snapshot,updated_at:new Date().toISOString()};
    const {data,error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'}).select('updated_at').single();
    if(error)throw error;
    lastCloudUpdatedAt=data?.updated_at||payload.updated_at;
    cloudDirty=localRevision!==revisionAtStart;
    setSyncStatus('online',cloudDirty?'Salvando nova alteração…':'Sincronizado');
    await announceCloudChange();
  }catch(err){console.error('Cloud save failed',err);cloudDirty=true;setSyncStatus(navigator.onLine?'error':'offline')}
  finally{
    cloudSaving=false;
    if(cloudDirty)queueCloudSave(40);
    else if(remoteRefreshPending){remoteRefreshPending=false;setTimeout(()=>pullCloudState(true),60)}
  }
}
function queueCloudSave(delay=90){clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(()=>pushCloudState(),delay)}
function stopCloudSync(){clearInterval(cloudPollTimer);cloudPollTimer=null;if(cloudChannel&&supabaseClient){supabaseClient.removeChannel(cloudChannel).catch(()=>{});cloudChannel=null}}
function startCloudSync(){
  stopCloudSync();
  // Fallback raro. A sincronização normal acontece via Realtime Broadcast imediatamente.
  cloudPollTimer=setInterval(()=>{if(cloudDirty)pushCloudState();else pullCloudState()},20000);
  try{
    cloudChannel=supabaseClient
      .channel(`app-state-live-${cloudUser.id}`,{config:{broadcast:{self:false}}})
      .on('broadcast',{event:'state-changed'},()=>{
        if(cloudDirty||cloudSaving){remoteRefreshPending=true;return}
        pullCloudState(true);
      })
      // Se o projeto também estiver com Postgres Changes habilitado, aproveita sem depender dele.
      .on('postgres_changes',{event:'*',schema:'public',table:'app_state',filter:`user_id=eq.${cloudUser.id}`},payload=>{
        const stamp=payload.new?.updated_at||'';
        if(!stamp||stamp===lastCloudUpdatedAt)return;
        if(cloudDirty||cloudSaving){remoteRefreshPending=true;return}
        if(payload.new?.data){state=normalizeState(payload.new.data);lastCloudUpdatedAt=stamp;persistLocal();renderAll();setSyncStatus('online','Atualizado agora')}
        else pullCloudState(true);
      })
      .subscribe(status=>{if(status==='SUBSCRIBED')setSyncStatus('online','Sincronizado ao vivo')});
  }catch(err){console.warn('Realtime indisponível; usando fallback.',err)}
}
async function loadCloudForUser(user){
  cloudUser=user;showAuthGate(false);document.querySelector('#accountBtn')?.classList.remove('hidden');
  const email=document.querySelector('#accountEmail');if(email)email.textContent=user.email||'Conta conectada';
  setSyncStatus('syncing','Carregando…');
  try{
    const {data,error}=await supabaseClient.from('app_state').select('data,updated_at').eq('user_id',user.id).maybeSingle();
    if(error)throw error;
    if(data){state=normalizeState(data.data);lastCloudUpdatedAt=data.updated_at||'';cloudDirty=false;localRevision=0;persistLocal();renderAll()}
    else{cloudDirty=true;await pushCloudState(true)}
    startCloudSync();setSyncStatus('online','Sincronizado');
  }catch(err){console.error(err);setSyncStatus('error','Erro na nuvem');toast('Não consegui carregar a nuvem agora. Seus dados locais continuam salvos.')}
}
async function initCloud(){
  if(!supabaseClient){showAuthGate(true);setAuthMessage('Não foi possível carregar a conexão com a nuvem.',true);return}
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session?.user)await loadCloudForUser(session.user);else{showAuthGate(true);setSyncStatus('offline','Entrar para sincronizar')}
  supabaseClient.auth.onAuthStateChange((_event,session)=>{if(session?.user&&session.user.id!==cloudUser?.id)loadCloudForUser(session.user);if(!session?.user){cloudUser=null;stopCloudSync();showAuthGate(true);document.querySelector('#accountBtn')?.classList.add('hidden');setSyncStatus('offline','Entrar para sincronizar')}})
}
if(localTabChannel){
  localTabChannel.onmessage=e=>{
    const msg=e.data||{};
    if(msg.sender===CLIENT_INSTANCE_ID||msg.type!=='state'||!msg.state)return;
    if(cloudDirty||cloudSaving)return;
    state=normalizeState(msg.state);persistLocal();renderAll();
  };
}

async function signIn(){
  const email=document.querySelector('#authEmail').value.trim(),password=document.querySelector('#authPassword').value;
  if(!email||!password)return setAuthMessage('Digite e-mail e senha.',true);
  setAuthMessage('Entrando…');
  const {error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error)setAuthMessage(error.message==='Invalid login credentials'?'E-mail ou senha incorretos.':error.message,true);else setAuthMessage('');
}
async function signUp(){
  const email=document.querySelector('#authEmail').value.trim(),password=document.querySelector('#authPassword').value;
  if(!email||password.length<6)return setAuthMessage('Use um e-mail válido e senha com pelo menos 6 caracteres.',true);
  setAuthMessage('Criando conta…');
  const {data,error}=await supabaseClient.auth.signUp({email,password});
  if(error)return setAuthMessage(error.message,true);
  if(data.session)setAuthMessage('Conta criada. Entrando…');else setAuthMessage('Conta criada. Confirme o e-mail e depois toque em Entrar.');
}
async function signOut(){
  if(!supabaseClient)return;
  await pushCloudState();await supabaseClient.auth.signOut();stopCloudSync();cloudUser=null;lastCloudUpdatedAt='';cloudDirty=false;localStorage.removeItem(KEY);state=blankState();renderAll();document.querySelector('#accountDialog')?.close();showAuthGate(true);setSyncStatus('offline','Entrar para sincronizar');
}
function uid(){return crypto?.randomUUID?.() || String(Date.now()+Math.random())}
function toast(msg){const t=document.querySelector('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),1700)}
function toDate(s){return new Date(s+'T12:00:00')}
function startOfMonth(d=new Date()){return new Date(d.getFullYear(),d.getMonth(),1)}
function endOfMonth(d=new Date()){return new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59)}
function inMonth(s,d=new Date()){const x=toDate(s);return x>=startOfMonth(d)&&x<=endOfMonth(d)}
function monthKey(s){const d=toDate(s);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function currentMonthTransactions(){return state.transactions.filter(t=>inMonth(t.date));}
function totals(){const tx=currentMonthTransactions();const income=tx.filter(t=>t.type==='income').reduce((a,b)=>a+b.amount,0);const expense=tx.filter(t=>t.type==='expense').reduce((a,b)=>a+b.amount,0);const allIncome=state.transactions.filter(t=>t.type==='income').reduce((a,b)=>a+b.amount,0);const allExpense=state.transactions.filter(t=>t.type==='expense').reduce((a,b)=>a+b.amount,0);return{income,expense,balance:allIncome-allExpense,net:income-expense}}
function invoiceDueDate(card,purchaseDate){
  const y=purchaseDate.getFullYear(),m=purchaseDate.getMonth(),day=purchaseDate.getDate();
  let invoiceMonth=day>card.closeDay?m+1:m;
  if(card.dueDay<=card.closeDay) invoiceMonth+=1;
  return safeDay(y,invoiceMonth,card.dueDay)
}
function cardInvoices(card){
  const groups={};
  state.transactions.filter(t=>t.type==='expense'&&t.payment==='Cartão'&&t.cardId===card.id).forEach(t=>{
    const due=invoiceDueDate(card,toDate(t.date)).toISOString().slice(0,10);
    if(!groups[due])groups[due]={dueDate:due,amount:0,items:[]};
    groups[due].amount+=t.amount;groups[due].items.push(t);
  });
  return Object.values(groups).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
}
function invoiceKey(cardId,dueDate){return `${cardId}:${dueDate}`}
function isInvoicePaid(cardId,dueDate){return state.paidInvoices.includes(invoiceKey(cardId,dueDate))}
function relevantInvoice(card){
  const now0=new Date();now0.setHours(0,0,0,0);
  const invs=cardInvoices(card);
  const overdue=invs.find(i=>toDate(i.dueDate)<now0&&!isInvoicePaid(card.id,i.dueDate));
  if(overdue)return overdue;
  const future=invs.find(i=>toDate(i.dueDate)>=now0&&!isInvoicePaid(card.id,i.dueDate));
  if(future)return future;
  let due=safeDay(now0.getFullYear(),now0.getMonth(),card.dueDay);
  if(due<now0)due=safeDay(now0.getFullYear(),now0.getMonth()+1,card.dueDay);
  return {dueDate:due.toISOString().slice(0,10),amount:0,items:[]};
}
function cardInvoiceAmount(card,date=new Date()){
  return cardInvoices(card).filter(i=>toDate(i.dueDate).getMonth()===date.getMonth()&&toDate(i.dueDate).getFullYear()===date.getFullYear()).reduce((a,b)=>a+b.amount,0)
}
function cardOutstanding(card){
  return cardInvoices(card).filter(i=>!isInvoicePaid(card.id,i.dueDate)).reduce((sum,i)=>sum+i.amount,0);
}
function cardLimitInfo(card){
  const limit=Number(card.limit)||0,used=cardOutstanding(card),available=limit?Math.max(0,limit-used):0;
  const pct=limit?Math.min(100,Math.round((used/limit)*100)):0;
  return {limit,used,available,pct,over:limit>0&&used>limit};
}
function daysFromToday(dateString){
  const a=new Date();a.setHours(0,0,0,0);const b=toDate(dateString);b.setHours(0,0,0,0);return Math.round((b-a)/86400000);
}
function notificationItems(){
  const items=[];
  state.bills.filter(b=>!b.paid).forEach(b=>{
    const d=daysFromToday(b.dueDate);
    if(d<0)items.push({key:`bill:${b.id}:overdue`,level:'danger',title:`${b.description} venceu`,text:`${fmt(b.amount)} · venceu há ${Math.abs(d)} ${Math.abs(d)===1?'dia':'dias'}`});
    else if(d<=3)items.push({key:`bill:${b.id}:soon:${b.dueDate}`,level:d===0?'danger':'warn',title:d===0?`${b.description} vence hoje`:`${b.description} vence em ${d} ${d===1?'dia':'dias'}`,text:fmt(b.amount)});
  });
  state.cards.forEach(c=>{
    const inv=relevantInvoice(c),paid=isInvoicePaid(c.id,inv.dueDate),d=daysFromToday(inv.dueDate);
    if(inv.amount>0&&!paid){
      if(d<0)items.push({key:`invoice:${c.id}:${inv.dueDate}:overdue`,level:'danger',title:`Fatura ${c.name} vencida`,text:`${fmt(inv.amount)} · venceu há ${Math.abs(d)} ${Math.abs(d)===1?'dia':'dias'}`});
      else if(d<=3)items.push({key:`invoice:${c.id}:${inv.dueDate}:soon`,level:d===0?'danger':'warn',title:d===0?`Fatura ${c.name} vence hoje`:`Fatura ${c.name} vence em ${d} ${d===1?'dia':'dias'}`,text:fmt(inv.amount)});
    }
    const li=cardLimitInfo(c);
    if(li.limit>0&&li.pct>=80)items.push({key:`limit:${c.id}:${li.pct}`,level:li.over?'danger':'warn',title:li.over?`${c.name} passou do limite`:`${c.name} está em ${li.pct}% do limite`,text:`${fmt(li.used)} usados de ${fmt(li.limit)}`});
  });
  return items;
}
function renderNotifications(){
  const items=notificationItems();
  if(typeof notificationBadge!=='undefined'){
    notificationBadge.textContent=String(items.length);
    notificationBadge.classList.toggle('hidden',!items.length);
  }
  if(typeof notificationsBody!=='undefined')notificationsBody.innerHTML=items.length?`<div class="notification-list">${items.map(n=>`<div class="notification-item ${n.level}"><span class="notification-dot"></span><div><strong>${esc(n.title)}</strong><small>${esc(n.text)}</small></div></div>`).join('')}</div>`:`<div class="empty"><strong>Tudo tranquilo</strong>Nenhum aviso importante agora.</div>`;
  updateNotificationPermissionUI();
}
function updateNotificationPermissionUI(){
  if(typeof notificationPermissionText==='undefined'||typeof browserNotificationsToggle==='undefined')return;
  if(!('Notification' in window)){notificationPermissionText.textContent='Não disponível neste navegador';browserNotificationsToggle.disabled=true;return}
  const enabled=localStorage.getItem(NOTIFY_KEY)==='1'&&Notification.permission==='granted';
  notificationPermissionText.textContent=enabled?'Ativadas':Notification.permission==='denied'?'Bloqueadas pelo navegador':'Opcional';
  browserNotificationsToggle.textContent=enabled?'Desativar':'Ativar';
}
async function enableBrowserNotifications(){
  if(!('Notification' in window))return toast('Este navegador não oferece notificações.');
  if(localStorage.getItem(NOTIFY_KEY)==='1'&&Notification.permission==='granted'){
    localStorage.setItem(NOTIFY_KEY,'0');updateNotificationPermissionUI();return toast('Notificações do aparelho desativadas.');
  }
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){updateNotificationPermissionUI();return toast('Permissão de notificação não concedida.');}
  localStorage.setItem(NOTIFY_KEY,'1');updateNotificationPermissionUI();toast('Notificações do aparelho ativadas.');
  maybeSendBrowserNotifications(true);
}
async function showSystemNotification(title,body){
  try{
    if('serviceWorker' in navigator){
      const reg=await navigator.serviceWorker.ready;await reg.showNotification(title,{body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',tag:title,renotify:false});return;
    }
    new Notification(title,{body});
  }catch{}
}
function maybeSendBrowserNotifications(force=false){
  if(localStorage.getItem(NOTIFY_KEY)!=='1'||!('Notification' in window)||Notification.permission!=='granted')return;
  const items=notificationItems();let sent={};try{sent=JSON.parse(localStorage.getItem(NOTIFIED_KEY)||'{}')}catch{}
  const day=today();items.slice(0,3).forEach(n=>{const stamp=`${day}:${n.key}`;if(force||!sent[stamp]){showSystemNotification(n.title,n.text);sent[stamp]=1}});
  Object.keys(sent).filter(k=>!k.startsWith(day+':')).forEach(k=>delete sent[k]);localStorage.setItem(NOTIFIED_KEY,JSON.stringify(sent));
}
function billStatus(b){if(b.paid)return'paid';return toDate(b.dueDate)<new Date(new Date().setHours(0,0,0,0))?'overdue':'pending'}
function renderAll(){renderHeader();renderHome();renderHistory();renderCards();renderBills();renderCalendar();refreshSelects();renderNotifications();maybeSendBrowserNotifications();}
function renderHeader(){const h=new Date().getHours();document.querySelector('#greeting').textContent=h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';document.querySelector('#monthLabel').textContent=new Date().toLocaleDateString('pt-BR',{month:'long'});}
function renderHome(){
  const t=totals();
  balanceValue.textContent=fmt(t.balance);incomeMonth.textContent=fmt(t.income);expenseMonth.textContent=fmt(t.expense);monthNet.textContent=fmt(t.net);monthNet.className=t.net>=0?'positive':'negative';
  const overdue=state.bills.filter(b=>billStatus(b)==='overdue');
  const overdueInvoices=state.cards.map(c=>({card:c,inv:relevantInvoice(c)})).filter(x=>x.inv.amount>0&&toDate(x.inv.dueDate)<new Date(new Date().setHours(0,0,0,0))&&!isInvoicePaid(x.card.id,x.inv.dueDate));
  const overdueCount=overdue.length+overdueInvoices.length;const overdueValue=overdue.reduce((a,b)=>a+b.amount,0)+overdueInvoices.reduce((a,x)=>a+x.inv.amount,0);
  const ob=document.querySelector('#overdueBanner');
  if(overdueCount){ob.classList.remove('hidden');ob.innerHTML=`<strong>⚠ ${overdueCount} ${overdueCount===1?'pagamento vencido':'pagamentos vencidos'}</strong><div>${fmt(overdueValue)} em atraso</div>`}else ob.classList.add('hidden');
  const upcoming=[...state.bills.filter(b=>!b.paid).map(b=>({kind:'bill',name:b.description,amount:b.amount,date:b.dueDate,status:billStatus(b)})),...state.cards.map(c=>{const inv=relevantInvoice(c);return{kind:'card',name:c.name,amount:inv.amount,date:inv.dueDate,status:isInvoicePaid(c.id,inv.dueDate)?'paid':toDate(inv.dueDate)<new Date(new Date().setHours(0,0,0,0))?'overdue':'pending'}}).filter(x=>x.amount>0)].sort((a,b)=>toDate(a.date)-toDate(b.date)).slice(0,4);
  upcomingList.innerHTML=upcoming.length?upcoming.map(listRowUpcoming).join(''):`<div class="empty"><strong>Nada chegando agora</strong>Suas próximas contas aparecem aqui.</div>`;
  const recent=[...state.transactions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);recentTransactions.innerHTML=recent.length?recent.map(listRowTransaction).join(''):`<div class="empty"><strong>Nenhuma movimentação ainda</strong>Adicione sua primeira entrada ou gasto.</div>`;
  drawCharts();
}
function listRowUpcoming(x){return `<div class="list-item"><div class="item-icon">${x.kind==='card'?'▣':'◷'}</div><div class="item-main"><strong>${esc(x.name)}</strong><span>${x.status==='overdue'?'Vencido':'Vence'} ${shortDate(x.date)}</span></div><div class="item-value"><strong class="${x.status==='overdue'?'negative':''}">${fmt(x.amount)}</strong>${x.status==='overdue'?'<small class="negative">vencido</small>':''}</div></div>`}
function listRowTransaction(t){return `<div class="list-item" data-tx="${t.id}"><div class="item-icon">${t.type==='income'?'+':'−'}</div><div class="item-main"><strong>${esc(t.description)}</strong><span>${t.type==='income'?'Entrada':esc(t.payment||'Saída')} · ${shortDate(t.date)}</span></div><div class="item-value"><strong class="${t.type==='income'?'positive':'negative'}">${t.type==='income'?'+':'−'} ${fmt(t.amount)}</strong>${t.category?`<small>${esc(t.category)}</small>`:''}</div></div>`}
function renderHistory(){
  const q=(searchInput.value||'').toLowerCase().trim();let list=[...state.transactions].sort((a,b)=>b.date.localeCompare(a.date));
  if(historyFilter!=='all') list=list.filter(t=>historyFilter==='income'||historyFilter==='expense'?t.type===historyFilter:t.payment===historyFilter);
  if(q) list=list.filter(t=>`${t.description} ${t.payment||''} ${t.category||''}`.toLowerCase().includes(q));
  historyList.innerHTML=list.length?list.map(listRowTransaction).join(''):`<div class="empty"><strong>Nada encontrado</strong>Tente outro filtro ou registre uma movimentação.</div>`;
}
function renderCards(){
  cardsGrid.innerHTML=state.cards.length?state.cards.map(c=>{const inv=relevantInvoice(c),due=toDate(inv.dueDate),paid=isInvoicePaid(c.id,inv.dueDate),li=cardLimitInfo(c);let close=safeDay(due.getFullYear(),due.getMonth()-(c.dueDay<=c.closeDay?1:0),c.closeDay);return `<article class="credit-card" data-card="${c.id}"><div><div class="card-name">${esc(c.name)}</div><div class="card-status">${paid?'Fatura paga':toDate(inv.dueDate)<new Date(new Date().setHours(0,0,0,0))?'Fatura vencida':'Próxima fatura'}</div></div><div><div class="card-balance">${fmt(inv.amount)}</div>${li.limit?`<div class="limit-block"><div class="limit-line"><span>Disponível ${fmt(li.available)}</span><span>${li.pct}% usado</span></div><div class="limit-track"><i style="width:${li.pct}%"></i></div><div class="limit-total">Limite ${fmt(li.limit)}</div></div>`:''}<div class="card-meta"><span>Fecha ${close.getDate()}/${String(close.getMonth()+1).padStart(2,'0')}</span><span>Vence ${due.getDate()}/${String(due.getMonth()+1).padStart(2,'0')}</span></div></div></article>`}).join(''):`<div class="empty"><strong>Nenhum cartão</strong>Crie com nome, limite opcional, fechamento e vencimento.</div>`;
}
function renderBills(){
  let list=[...state.bills].sort((a,b)=>a.dueDate.localeCompare(b.dueDate));if(billFilter!=='all')list=list.filter(b=>billStatus(b)===billFilter);
  const stats={paid:0,pending:0,overdue:0};state.bills.forEach(b=>stats[billStatus(b)]+=b.amount);
  billStatusSummary.innerHTML=`<article class="metric-card"><span>Pago</span><strong>${fmt(stats.paid)}</strong></article><article class="metric-card"><span>Pendente</span><strong>${fmt(stats.pending)}</strong></article><article class="metric-card"><span>Vencido</span><strong class="negative">${fmt(stats.overdue)}</strong></article>`;
  billsList.innerHTML=list.length?list.map(b=>`<div class="list-item" data-bill="${b.id}"><div class="item-icon">◷</div><div class="item-main"><strong>${esc(b.description)}</strong><span>Vence ${shortDate(b.dueDate)}${b.recurring?' · mensal':''}</span></div><div class="item-value"><strong>${fmt(b.amount)}</strong><small class="status-pill ${billStatus(b)}">${billStatus(b)==='paid'?'Pago':billStatus(b)==='overdue'?'Vencido':'Pendente'}</small></div></div>`).join(''):`<div class="empty"><strong>Nenhuma conta aqui</strong>Adicione ou troque o filtro.</div>`;
}
function renderCalendar(){
  calendarMonth.textContent=monthName(calendarCursor);const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());let html='';
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const ds=d.toISOString().slice(0,10),outside=d.getMonth()!==m;const events=[];
    state.bills.filter(b=>b.dueDate===ds).forEach(b=>events.push({txt:`${b.description} ${fmt(b.amount)}`,cls:billStatus(b)==='overdue'?'overdue':''}));
    state.transactions.filter(t=>t.date===ds).slice(0,2).forEach(t=>events.push({txt:`${t.type==='income'?'+':'−'} ${t.description}`,cls:t.type==='income'?'income':''}));
    state.cards.forEach(c=>{if(d.getDate()===c.closeDay&&d.getMonth()===m)events.push({txt:`Fecha ${c.name}`,cls:''});if(d.getDate()===c.dueDay&&d.getMonth()===m)events.push({txt:`Fatura ${c.name}`,cls:''})});
    html+=`<div class="day-cell ${outside?'muted-day':''}"><div class="day-num">${d.getDate()}</div>${events.slice(0,3).map(e=>`<div class="cal-event ${e.cls}">${esc(e.txt)}</div>`).join('')}</div>`
  }calendarGrid.innerHTML=html;
}
function refreshSelects(){entryCategory.innerHTML=`<option value="">Sem categoria</option>`+state.categories.map(c=>`<option>${esc(c)}</option>`).join('');entryCard.innerHTML=state.cards.length?state.cards.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(''):`<option value="">Crie um cartão primeiro</option>`}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function drawCharts(){drawCashflow();drawCategory();drawPayment()}
function prepareCanvas(id){const c=document.getElementById(id),dpr=window.devicePixelRatio||1,r=c.getBoundingClientRect();c.width=Math.max(320,r.width*dpr);c.height=Math.max(220,r.height*dpr);const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return{c,ctx,w:r.width,h:r.height}}
function drawCashflow(){const {ctx,w,h}=prepareCanvas('cashflowChart');ctx.clearRect(0,0,w,h);const months=[];for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);months.push(d)}const data=months.map(d=>{const arr=state.transactions.filter(t=>inMonth(t.date,d));return{label:d.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),inc:arr.filter(t=>t.type==='income').reduce((a,b)=>a+b.amount,0),exp:arr.filter(t=>t.type==='expense').reduce((a,b)=>a+b.amount,0)}});const max=Math.max(100,...data.flatMap(x=>[x.inc,x.exp]));const pad={l:18,r:12,t:20,b:30},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;ctx.strokeStyle='#273044';ctx.lineWidth=1;for(let i=0;i<4;i++){const y=pad.t+ch*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke()}const x=i=>pad.l+cw*(i/(data.length-1||1));const y=v=>pad.t+ch-(v/max)*ch;function line(key,color){ctx.beginPath();data.forEach((d,i)=>{const px=x(i),py=y(d[key]);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.strokeStyle=color;ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();data.forEach((d,i)=>{ctx.beginPath();ctx.arc(x(i),y(d[key]),3.5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()})}line('inc','#53dfa0');line('exp','#ff6f87');ctx.font='11px system-ui';ctx.fillStyle='#8c96a8';ctx.textAlign='center';data.forEach((d,i)=>ctx.fillText(d.label,x(i),h-8));ctx.fillStyle='#53dfa0';ctx.textAlign='left';ctx.fillText('Entradas',18,12);ctx.fillStyle='#ff6f87';ctx.fillText('Saídas',82,12)}
function drawCategory(){const {ctx,w,h}=prepareCanvas('categoryChart');ctx.clearRect(0,0,w,h);const tx=currentMonthTransactions().filter(t=>t.type==='expense');const map={};tx.forEach(t=>map[t.category||'Sem categoria']=(map[t.category||'Sem categoria']||0)+t.amount);const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);barList(ctx,w,h,rows,'#7c5cff')}
function drawPayment(){const {ctx,w,h}=prepareCanvas('paymentChart');ctx.clearRect(0,0,w,h);const tx=currentMonthTransactions().filter(t=>t.type==='expense');const map={};tx.forEach(t=>map[t.payment||'Outro']=(map[t.payment||'Outro']||0)+t.amount);const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);barList(ctx,w,h,rows,'#56d7ff')}
function barList(ctx,w,h,rows,color){if(!rows.length){ctx.fillStyle='#8c96a8';ctx.font='13px system-ui';ctx.textAlign='center';ctx.fillText('Sem dados neste mês',w/2,h/2);return}const max=Math.max(...rows.map(x=>x[1]));rows.forEach((r,i)=>{const y=24+i*46;ctx.fillStyle='#8c96a8';ctx.font='12px system-ui';ctx.textAlign='left';ctx.fillText(r[0],8,y);ctx.fillStyle='#242b3a';roundRect(ctx,8,y+8,w-16,10,5);ctx.fill();ctx.fillStyle=color;roundRect(ctx,8,y+8,Math.max(8,(w-16)*(r[1]/max)),10,5);ctx.fill();ctx.fillStyle='#f4f7fb';ctx.textAlign='right';ctx.fillText(fmt(r[1]),w-8,y)})}
function roundRect(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath()}

function openEntry(type){closeSheet();entryForm.reset();entryType.value=type;entryDate.value=today();document.querySelector('[data-payment="Pix"]').click();entryTitle.textContent=type==='income'?'Adicionar entrada':'Adicionar gasto';expenseFields.classList.toggle('hidden',type==='income');entryDialog.showModal();setTimeout(()=>entryAmount.focus(),80)}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close())}
function closeSheet(){quickSheet.classList.add('hidden');sheetBackdrop.classList.add('hidden')}
function openSheet(){quickSheet.classList.remove('hidden');sheetBackdrop.classList.remove('hidden')}

entryForm.addEventListener('submit',e=>{e.preventDefault();const type=entryType.value,amount=parseMoney(entryAmount.value),desc=entryDescription.value.trim();if(!amount||!desc)return toast('Preencha valor e descrição.');const base={id:uid(),type,amount,description:desc,date:entryDate.value};if(type==='expense'){base.payment=document.querySelector('#paymentOptions .active')?.dataset.payment||'Pix';base.category=entryCategory.value;if(base.payment==='Cartão'){if(!entryCard.value)return toast('Crie ou escolha um cartão.');base.cardId=entryCard.value}const n=installmentToggle.checked?Number(installmentCount.value):1;if(n>1){const part=Math.floor(amount/n),rem=amount-part*n;for(let i=0;i<n;i++){const d=toDate(base.date);d.setMonth(d.getMonth()+i);state.transactions.push({...base,id:uid(),amount:part+(i<rem?1:0),description:`${desc} ${i+1}/${n}`,date:d.toISOString().slice(0,10),installment:{index:i+1,total:n}})}entryDialog.close();save();return toast('Compra parcelada adicionada.')}}state.transactions.push(base);entryDialog.close();save();toast(type==='income'?'Entrada adicionada.':'Gasto adicionado.')});

billForm.addEventListener('submit',e=>{e.preventDefault();const amount=parseMoney(billAmount.value),description=billDescription.value.trim();if(!amount||!description)return toast('Preencha valor e descrição.');state.bills.push({id:uid(),amount,description,dueDate:billDueDate.value,recurring:billRecurring.checked,paid:false});billDialog.close();save();billForm.reset();toast('Conta adicionada.')});
cardForm.addEventListener('submit',e=>{e.preventDefault();state.cards.push({id:uid(),name:cardName.value.trim(),limit:parseMoney(cardLimit.value),closeDay:Number(cardCloseDay.value),dueDay:Number(cardDueDay.value)});cardDialog.close();save();cardForm.reset();toast('Cartão adicionado.')});

function showTransaction(id){const t=state.transactions.find(x=>x.id===id);if(!t)return;editTitle.textContent=t.description;editBody.innerHTML=`<div class="detail-grid"><div class="detail-box"><span>Valor</span><strong class="${t.type==='income'?'positive':'negative'}">${t.type==='income'?'+':'−'} ${fmt(t.amount)}</strong></div><div class="detail-box"><span>Data</span><strong>${shortDate(t.date)}</strong></div>${t.type==='expense'?`<div class="detail-box"><span>Pagamento</span><strong>${esc(t.payment||'Outro')}</strong></div><div class="detail-box"><span>Categoria</span><strong>${esc(t.category||'Sem categoria')}</strong></div>`:''}</div><div class="modal-actions"><button class="danger-btn" data-delete-tx="${id}">Excluir</button></div>`;editDialog.showModal()}

function showCard(id){const c=state.cards.find(x=>x.id===id);if(!c)return;const inv=relevantInvoice(c),paid=isInvoicePaid(c.id,inv.dueDate),li=cardLimitInfo(c);editTitle.textContent=c.name;editBody.innerHTML=`<div class="detail-grid"><div class="detail-box"><span>Fatura</span><strong>${fmt(inv.amount)}</strong></div><div class="detail-box"><span>Vence</span><strong>${shortDate(inv.dueDate)}</strong></div>${li.limit?`<div class="detail-box"><span>Limite</span><strong>${fmt(li.limit)}</strong></div><div class="detail-box"><span>Disponível</span><strong class="${li.over?'negative':'positive'}">${fmt(li.available)}</strong></div>`:''}<div class="detail-box"><span>Fecha todo mês</span><strong>Dia ${c.closeDay}</strong></div><div class="detail-box"><span>Status</span><strong>${paid?'Paga':toDate(inv.dueDate)<new Date(new Date().setHours(0,0,0,0))?'Vencida':'Aberta'}</strong></div></div>${li.limit?`<div class="limit-block detail-limit"><div class="limit-line"><span>${fmt(li.used)} comprometidos</span><span>${li.pct}%</span></div><div class="limit-track"><i style="width:${li.pct}%"></i></div></div>`:''}${inv.items.length?`<div style="margin-top:14px" class="stack-list">${inv.items.map(listRowTransaction).join('')}</div>`:'<div class="empty" style="margin-top:14px"><strong>Sem compras nesta fatura</strong>Os gastos do cartão aparecerão aqui.</div>'}<div class="modal-actions">${!paid&&inv.amount>0?`<button class="success-btn" data-pay-invoice="${c.id}" data-due="${inv.dueDate}">Marcar como paga</button>`:''}<button class="danger-btn" data-delete-card="${c.id}">Excluir cartão</button></div>`;editDialog.showModal()}

function showBill(id){const b=state.bills.find(x=>x.id===id);if(!b)return;editTitle.textContent=b.description;editBody.innerHTML=`<div class="detail-grid"><div class="detail-box"><span>Valor</span><strong>${fmt(b.amount)}</strong></div><div class="detail-box"><span>Vencimento</span><strong>${shortDate(b.dueDate)}</strong></div></div><div class="modal-actions">${!b.paid?`<button class="success-btn" data-pay-bill="${id}">Marcar como paga</button>`:''}<button class="danger-btn" data-delete-bill="${id}">Excluir</button></div>`;editDialog.showModal()}

function switchView(name){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelector(`#view-${name}`).classList.add('active');document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));viewTitle.textContent={home:'Meu dinheiro',history:'Histórico',cards:'Cartões',bills:'Contas',calendar:'Calendário'}[name]||'Meu dinheiro';window.scrollTo({top:0,behavior:'smooth'})}

document.addEventListener('click',e=>{const open=e.target.closest('[data-open]');if(open){const type=open.dataset.open;if(type==='expense'||type==='income')openEntry(type);if(type==='bill'){closeSheet();billDueDate.value=today();billDialog.showModal()}return}const v=e.target.closest('[data-view]');if(v){switchView(v.dataset.view);return}if(e.target.closest('[data-close]')){closeDialogs();return}const tx=e.target.closest('[data-tx]');if(tx){showTransaction(tx.dataset.tx);return}const bl=e.target.closest('[data-bill]');if(bl){showBill(bl.dataset.bill);return}const cc=e.target.closest('[data-card]');if(cc){showCard(cc.dataset.card);return}if(e.target.matches('[data-delete-tx]')){if(confirm('Excluir este registro?')){state.transactions=state.transactions.filter(x=>x.id!==e.target.dataset.deleteTx);editDialog.close();save();toast('Registro excluído.')}return}if(e.target.matches('[data-pay-invoice]')){const key=invoiceKey(e.target.dataset.payInvoice,e.target.dataset.due);if(!state.paidInvoices.includes(key))state.paidInvoices.push(key);editDialog.close();save();toast('Fatura marcada como paga.');return}if(e.target.matches('[data-delete-card]')){if(confirm('Excluir este cartão? As movimentações ficam no histórico.')){state.cards=state.cards.filter(x=>x.id!==e.target.dataset.deleteCard);editDialog.close();save();toast('Cartão excluído.')}return}if(e.target.matches('[data-delete-bill]')){if(confirm('Excluir esta conta?')){state.bills=state.bills.filter(x=>x.id!==e.target.dataset.deleteBill);editDialog.close();save();toast('Conta excluída.')}return}if(e.target.matches('[data-pay-bill]')){const b=state.bills.find(x=>x.id===e.target.dataset.payBill);if(b){b.paid=true;editDialog.close();save();toast('Conta marcada como paga.')}return}});

fab.addEventListener('click',openSheet);quickAddTop.addEventListener('click',openSheet);sheetBackdrop.addEventListener('click',closeSheet);addCardBtn.addEventListener('click',()=>cardDialog.showModal());
notificationsBtn.addEventListener('click',()=>{renderNotifications();notificationsDialog.showModal()});
browserNotificationsToggle.addEventListener('click',enableBrowserNotifications);
document.querySelector('#authLoginBtn')?.addEventListener('click',signIn);
document.querySelector('#authSignupBtn')?.addEventListener('click',signUp);
document.querySelector('#authPassword')?.addEventListener('keydown',e=>{if(e.key==='Enter')signIn()});
document.querySelector('#accountBtn')?.addEventListener('click',()=>document.querySelector('#accountDialog')?.showModal());
document.querySelector('#logoutBtn')?.addEventListener('click',signOut);
window.addEventListener('online',()=>{setSyncStatus('syncing','Reconectando…');cloudDirty?pushCloudState():pullCloudState(true)});
window.addEventListener('offline',()=>setSyncStatus('offline','Sem internet'));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudUser)pullCloudState(true)});
searchInput.addEventListener('input',renderHistory);
historyFilters.addEventListener('click',e=>{if(!e.target.dataset.filter)return;historyFilter=e.target.dataset.filter;historyFilters.querySelectorAll('.chip').forEach(x=>x.classList.toggle('active',x===e.target));renderHistory()});
document.querySelector('.bill-filter-row').addEventListener('click',e=>{if(!e.target.dataset.billFilter)return;billFilter=e.target.dataset.billFilter;document.querySelectorAll('[data-bill-filter]').forEach(x=>x.classList.toggle('active',x===e.target));renderBills()});
paymentOptions.addEventListener('click',e=>{if(!e.target.dataset.payment)return;paymentOptions.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===e.target));cardSelectWrap.classList.toggle('hidden',e.target.dataset.payment!=='Cartão')});
installmentToggle.addEventListener('change',()=>installmentWrap.classList.toggle('hidden',!installmentToggle.checked));
prevMonth.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar()});nextMonth.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar()});
resetDemo.addEventListener('click',()=>{if(confirm('Limpar todos os dados sincronizados desta conta?')){state=blankState();save();toast('Dados apagados.')}});
window.addEventListener('resize',()=>{clearTimeout(window.__chartTimer);window.__chartTimer=setTimeout(drawCharts,120)});
if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').then(reg=>reg.update()).catch(()=>{});}

renderAll();
initCloud();
