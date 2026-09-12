(() => {
  'use strict';

  const runtimeConfig = window.ALTITUDE_CONFIG || {};
  const SUPABASE_URL = String(runtimeConfig.SUPABASE_URL || '').trim();
  const SUPABASE_KEY = String(runtimeConfig.SUPABASE_ANON_KEY || '').trim();
  const APP_URL = String(runtimeConfig.APP_URL || window.location.origin + window.location.pathname).trim();
  const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR_PROJECT'));
  const STORAGE_KEY_BASE = 'altitude_os_v4_state';
  let supabase = null, currentUser = null, accountProfile = null, syncTimer = null, cloudHydrating = false;
  let storageKey = `${STORAGE_KEY_BASE}:demo`, syncState = supabaseConfigured ? 'idle' : 'local';
  let currentView = 'dashboard', currentPeriod = 'month', historyPeriod = 'month';

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const uid = (prefix='id') => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number(String(v ?? '').replace(/\s/g,'').replace(',','.'));
  const fmtMoney = (n,c='USD') => `${Number(n||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${c}`;
  const fmtPct = n => `${Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:1})}%`;
  const fmtR = n => `${n>0?'+':''}${Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2})}R`;
  const fmtDate = d => new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
  const fmtDateTime = d => new Date(d).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});

  const defaults = () => ({
    version:4,
    profile:{firstName:'',lastName:'',displayName:'',avatar:'',timezone:'Europe/Paris',experience:'',country:'France'},
    preferences:{theme:'midnight',density:'comfortable',textScale:'default',sidebarCollapsed:false},
    accounts:[{id:'acc_main',name:'Compte principal',broker:'',currency:'USD',balance:50,riskMode:'fixed',riskValue:10,active:true,color:'#2fd3a0'}],
    strategies:[],
    trades:[],
    weeklyReviews:{},
    rules:[],
    notes:[],
    resetHistory:[],
    onboardingDone:false
  });

  function mergeState(raw){
    const d=defaults(), s=raw||{};
    return {...d,...s,profile:{...d.profile,...(s.profile||{})},preferences:{...d.preferences,...(s.preferences||{})},accounts:Array.isArray(s.accounts)&&s.accounts.length?s.accounts:d.accounts,strategies:Array.isArray(s.strategies)?s.strategies:[],trades:Array.isArray(s.trades)?s.trades:[],weeklyReviews:s.weeklyReviews||{},rules:Array.isArray(s.rules)?s.rules:[],notes:Array.isArray(s.notes)?s.notes:[],resetHistory:Array.isArray(s.resetHistory)?s.resetHistory:[]};
  }
  function load(){try{const raw=localStorage.getItem(storageKey);return raw?mergeState(JSON.parse(raw)):defaults()}catch{return defaults()}}
  let state=load();

  async function loadSupabaseClient(){
    if(!supabaseConfigured) return null;
    if(supabase) return supabase;
    try{const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');supabase=mod.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});return supabase}catch(e){console.warn(e);syncState='local';return null}
  }
  function save(){
    try{localStorage.setItem(storageKey,JSON.stringify(state))}catch(e){console.warn(e)}
    if(currentUser&&supabase&&!cloudHydrating) scheduleCloudSave();
    applyPreferences(); updateSyncBadge();
  }
  function scheduleCloudSave(){
    clearTimeout(syncTimer);syncState='syncing';updateSyncBadge();
    syncTimer=setTimeout(async()=>{try{const {error}=await supabase.from('user_states').upsert({user_id:currentUser.id,state,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error;syncState='synced'}catch(e){console.warn(e);syncState='error'}updateSyncBadge()},500);
  }
  async function hydrateCloudState(){
    if(!currentUser||!supabase)return; cloudHydrating=true;syncState='syncing';updateSyncBadge();
    try{const {data,error}=await supabase.from('user_states').select('state').eq('user_id',currentUser.id).maybeSingle();if(error)throw error;if(data?.state){state=mergeState(data.state);localStorage.setItem(storageKey,JSON.stringify(state))}else await supabase.from('user_states').upsert({user_id:currentUser.id,state,updated_at:new Date().toISOString()},{onConflict:'user_id'});syncState='synced'}catch(e){console.warn(e);state=load();syncState='error'}finally{cloudHydrating=false;applyPreferences();updateSyncBadge()}
  }
  function updateSyncBadge(){const el=$('#sync-badge');if(!el)return;const m={synced:['● Synchronisé','ok'],syncing:['◌ Enregistrement…','warn'],error:['! Erreur de sync','warn'],local:['Mode local','warn'],idle:['Cloud prêt','']};const [t,c]=m[syncState]||m.local;el.textContent=t;el.className=`sync-badge ${c}`}

  function applyPreferences(){
    document.documentElement.dataset.theme=state.preferences.theme||'midnight';
    document.documentElement.style.fontSize=state.preferences.textScale==='small'?'13px':state.preferences.textScale==='large'?'15px':'14px';
    const sb=$('#sidebar'); if(sb) sb.classList.toggle('collapsed',!!state.preferences.sidebarCollapsed);
    renderThemeMini();
  }

  function primaryAccount(){return state.accounts.find(a=>a.active)||state.accounts[0]}
  function accountById(id){return state.accounts.find(a=>a.id===id)}
  function strategyById(id){return state.strategies.find(s=>s.id===id)}
  function openTrades(){return state.trades.filter(t=>t.status==='open')}
  function closedTrades(){return state.trades.filter(t=>t.status==='closed')}
  function accountRiskUSD(acc){if(!acc)return 0;return acc.riskMode==='percent'?(Number(acc.balance)||0)*(Number(acc.riskValue)||0)/100:Number(acc.riskValue)||0}
  function totalBalance(){return state.accounts.reduce((a,b)=>a+(Number(b.balance)||0),0)}

  function rangeFor(period, ref=new Date()){
    const end=new Date(ref); end.setHours(23,59,59,999); let start=new Date(end);
    if(period==='week'){const day=(start.getDay()+6)%7;start.setDate(start.getDate()-day);start.setHours(0,0,0,0)}
    else if(period==='month'){start=new Date(end.getFullYear(),end.getMonth(),1)}
    else if(period==='quarter'){const q=Math.floor(end.getMonth()/3)*3;start=new Date(end.getFullYear(),q,1)}
    else if(period==='year'){start=new Date(end.getFullYear(),0,1)}
    else if(period==='7d'){start=new Date(end);start.setDate(start.getDate()-6);start.setHours(0,0,0,0)}
    else if(period==='30d'){start=new Date(end);start.setDate(start.getDate()-29);start.setHours(0,0,0,0)}
    else {start=new Date(0)}
    return {start,end};
  }
  function tradesInPeriod(period='month',accountId='all'){
    const {start,end}=rangeFor(period);return state.trades.filter(t=>{const d=new Date(t.closedAt||t.openedAt);return d>=start&&d<=end&&(accountId==='all'||t.accountId===accountId)})
  }
  function statsFor(trades){
    const c=trades.filter(t=>t.status==='closed'), wins=c.filter(t=>t.resultR>0), losses=c.filter(t=>t.resultR<0), be=c.filter(t=>t.resultR===0);
    const pnl=c.reduce((s,t)=>s+(Number(t.pnl)||0),0), totalR=c.reduce((s,t)=>s+(Number(t.resultR)||0),0), grossWin=wins.reduce((s,t)=>s+Math.max(0,Number(t.pnl)||0),0), grossLoss=Math.abs(losses.reduce((s,t)=>s+Math.min(0,Number(t.pnl)||0),0));
    return {closed:c.length,wins:wins.length,losses:losses.length,be:be.length,pnl,totalR,winRate:c.length?wins.length/c.length*100:0,avgR:c.length?totalR/c.length:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0)}
  }
  function equitySeries(trades=closedTrades(), accountId='all'){
    const list=trades.filter(t=>accountId==='all'||t.accountId===accountId).slice().sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt));let v=0;return list.map(t=>(v+=Number(t.pnl)||0));
  }

  function toast(message,type='info'){const stack=$('#toast-stack');if(!stack)return;const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;stack.appendChild(el);setTimeout(()=>el.remove(),type==='error'?6500:3800)}
  function showModal(html,large=false){const back=$('#modal-backdrop'),m=$('#modal');m.className=`modal${large?' large':''}`;m.innerHTML=html;back.hidden=false;$$('[data-close-modal]',m).forEach(b=>b.onclick=hideModal);setTimeout(()=>m.querySelector('input,select,textarea,button')?.focus(),30)}
  function hideModal(){$('#modal-backdrop').hidden=true;$('#modal').innerHTML=''}
  function confirmDialog({title,text,confirmLabel='Confirmer',danger=false,onConfirm}){showModal(`<div class="modal-head"><div><div class="modal-title">${esc(title)}</div><div class="modal-sub">${esc(text)}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirm-dialog">${esc(confirmLabel)}</button></div>`);$('#confirm-dialog').onclick=()=>{hideModal();onConfirm?.()}}

  function setView(name){currentView=name;$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));$$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));renderView(name);if(innerWidth<620)$('#sidebar')?.classList.remove('mobile-open')}
  function renderAll(){['dashboard','accounts','strategies','journal','history','productivity','weekly','rules','profile','settings'].forEach(renderView);renderProfileMini();renderThemeMini();updateSyncBadge()}
  function renderView(name){const fn={dashboard:renderDashboard,accounts:renderAccounts,strategies:renderStrategies,journal:renderJournal,history:renderHistory,productivity:renderProductivity,weekly:renderWeekly,rules:renderRules,profile:renderProfile,settings:renderSettings}[name];fn?.()}

  function displayName(){return state.profile.firstName||state.profile.displayName||accountProfile?.display_name||currentUser?.user_metadata?.display_name||'Trader'}
  function initials(){const n=`${state.profile.firstName||''} ${state.profile.lastName||''}`.trim()||displayName();return n.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'AO'}
  function avatarHtml(size=''){return `<div class="avatar ${size}">${state.profile.avatar?`<img src="${state.profile.avatar}" alt="">`:esc(initials())}</div>`}
  function renderProfileMini(){const el=$('#profile-mini');if(!el)return;el.innerHTML=`${avatarHtml()}<div><strong>${esc(displayName())}</strong><span>${esc(accountProfile?.plan||'Compte')}</span></div>`;el.onclick=()=>setView('profile')}
  function renderThemeMini(){const el=$('#theme-mini');if(!el)return;const themes=['midnight','summit','obsidian','glacier','carbon'];el.innerHTML=themes.map(t=>`<button class="theme-dot ${state.preferences.theme===t?'active':''}" data-mini-theme="${t}" title="${t}"></button>`).join('');$$('[data-mini-theme]',el).forEach(b=>b.onclick=()=>{state.preferences.theme=b.dataset.miniTheme;save();renderAll()})}

  function pageHead(title,sub,actions=''){return `<div class="page-head"><div><div class="page-title">${esc(title)}</div><div class="page-sub">${esc(sub)}</div></div><div class="page-actions">${actions}</div></div>`}
  function periodTabs(active=currentPeriod,attr='data-period'){return `<div class="period-tabs">${[['week','Semaine'],['month','Mois'],['quarter','Trimestre'],['year','Année']].map(([v,l])=>`<button class="${active===v?'active':''}" ${attr}="${v}">${l}</button>`).join('')}</div>`}
  function lineChart(values){
    if(!values.length)return `<div class="empty" style="height:180px;display:grid;place-items:center">Aucune donnée pour cette période.</div>`;
    const w=640,h=180,p=12,min=Math.min(0,...values),max=Math.max(1,...values),span=max-min||1;const pts=values.map((v,i)=>`${p+(i/(Math.max(values.length-1,1)))*(w-p*2)},${h-p-((v-min)/span)*(h-p*2)}`).join(' ');
    return `<svg class="line-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--success)" stop-opacity=".25"/><stop offset="1" stop-color="var(--success)" stop-opacity="0"/></linearGradient></defs>${[.25,.5,.75].map(r=>`<line class="chart-grid-line" x1="0" x2="${w}" y1="${h*r}" y2="${h*r}"/>`).join('')}<polygon class="chart-area" points="${p},${h-p} ${pts} ${w-p},${h-p}"/><polyline class="chart-line" points="${pts}"/></svg>`
  }
  function bars(trades){const c=trades.filter(t=>t.status==='closed').slice(-26);if(!c.length)return `<div class="empty" style="height:130px">Aucun trade clôturé.</div>`;const max=Math.max(1,...c.map(t=>Math.abs(Number(t.resultR)||0)));return `<div class="performance-bars">${c.map(t=>`<span class="bar ${(t.resultR||0)<0?'neg':''}" style="height:${24+Math.abs(t.resultR||0)/max*80}px" title="${fmtR(t.resultR)}"></span>`).join('')}</div>`}

  function renderDashboard(){
    const el=$('#view-dashboard');if(!el)return;const acc=primaryAccount(), periodTrades=tradesInPeriod(currentPeriod), st=statsFor(periodTrades), allSt=statsFor(closedTrades()), open=openTrades(), recent=state.trades.slice(0,5), series=equitySeries(periodTrades.filter(t=>t.status==='closed'));
    const risk=accountRiskUSD(acc), activeStrategies=state.strategies.filter(s=>s.active).length;
    el.innerHTML=`<div class="hero-panel"><div class="hero-meta">${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div><p class="eyebrow">ESPACE DE TRAVAIL</p><h1>Bonsoir, ${esc(displayName())}.</h1><p>${open.length?`${open.length} position${open.length>1?'s':''} ouverte${open.length>1?'s':''}. Vérifiez vos sorties avant de préparer un nouveau trade.`:'Votre desk est à jour. Préparez votre prochain trade avec votre propre plan.'}</p></div>
      <div class="grid metric-grid">
        ${metric('Solde total',fmtMoney(totalBalance(),acc?.currency||'USD'),`${state.accounts.length} compte${state.accounts.length>1?'s':''}`)}
        ${metric('Risque actuel',acc?`${acc.riskMode==='percent'?fmtPct(acc.riskValue):fmtMoney(acc.riskValue,acc.currency)}`:'—',acc?`${fmtMoney(risk,acc.currency)} sur ${acc.name}`:'Aucun compte')}
        ${metric('PnL période',fmtMoney(st.pnl,acc?.currency||'USD'),`${st.totalR>=0?'+':''}${st.totalR.toFixed(2)} R`,st.pnl>=0)}
        ${metric('Taux de réussite',st.closed?fmtPct(st.winRate):'—',`${st.closed} trade${st.closed>1?'s':''} clôturé${st.closed>1?'s':''}`)}
      </div>
      <div class="dashboard-columns"><div class="stack">
        <div class="card"><div class="card-head"><div><div class="card-title">Performance</div><div class="page-sub">Évolution du PnL cumulé</div></div>${periodTabs()}</div>${lineChart(series)}<div class="grid metric-grid" style="margin-top:8px">${smallMetric('R moyen',st.closed?st.avgR.toFixed(2):'—')}${smallMetric('Profit factor',Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—'))}${smallMetric('Trades',st.closed)}${smallMetric('Stratégies actives',activeStrategies)}</div></div>
        <div class="card"><div class="card-head"><div class="card-title">Derniers trades</div><button class="btn btn-ghost" id="dash-all-trades">Voir le journal</button></div>${recent.length?tradeRows(recent,true):`<div class="empty"><strong>Votre journal est vide.</strong>Votre premier trade apparaîtra ici.</div>`}</div>
      </div><div class="stack">
        <div class="card"><div class="card-head"><div class="card-title">Positions ouvertes</div><span class="pill">${open.length}</span></div>${open.length?open.map(openPositionCompact).join(''):`<div class="empty"><strong>Aucune position ouverte.</strong>Vous pouvez préparer un nouveau trade.</div>`}</div>
        <div class="card"><div class="card-head"><div class="card-title">Mes comptes</div><button class="btn btn-ghost" id="dash-manage-accounts">Gérer</button></div>${state.accounts.slice(0,4).map(a=>`<div class="account-row" style="grid-template-columns:1fr .8fr 22px"><div><span class="account-dot" style="background:${a.color||'var(--success)'}"></span><span class="row-main">${esc(a.name)}</span><div class="row-sub">${esc(a.broker||'Courtier non renseigné')}</div></div><div class="mono" style="text-align:right">${fmtMoney(a.balance,a.currency)}</div><span>${a.active?'★':''}</span></div>`).join('')}<button class="btn" id="dash-add-account" style="width:100%;margin-top:9px">+ Ajouter un compte</button></div>
        <div class="card"><div class="card-head"><div class="card-title">Répartition</div><span class="page-sub">Tous trades clôturés</span></div><div style="display:grid;grid-template-columns:160px 1fr;align-items:center;gap:16px"><div class="donut" style="--win:${allSt.closed?allSt.wins/allSt.closed*100:0}%;--loss:${allSt.closed?allSt.losses/allSt.closed*100:0}%"><div class="donut-center"><div><strong>${allSt.closed}</strong><span>trades</span></div></div></div><div class="stack" style="gap:8px"><span><b class="up">${allSt.wins}</b> gagnants</span><span><b class="down">${allSt.losses}</b> perdants</span><span><b>${allSt.be}</b> break-even</span></div></div></div>
      </div></div>`;
    $$('[data-period]').forEach(b=>b.onclick=()=>{currentPeriod=b.dataset.period;renderDashboard()});$('#dash-all-trades')?.addEventListener('click',()=>setView('journal'));$('#dash-manage-accounts')?.addEventListener('click',()=>setView('accounts'));$('#dash-add-account')?.addEventListener('click',()=>openAccountModal());$$('[data-open-trade]').forEach(b=>b.onclick=()=>openCloseTradeModal(b.dataset.openTrade));
  }
  function metric(label,value,sub,positive=true){return `<div class="card metric-card"><div class="metric-top"><div class="card-label">${esc(label)}</div></div><div class="card-value" style="margin-top:16px">${value}</div><div class="metric-change ${positive?'up':''}">${esc(sub)}</div></div>`}
  function smallMetric(label,value){return `<div><div class="card-label">${esc(label)}</div><div class="mono" style="margin-top:4px;font-size:14px;font-weight:700">${value}</div></div>`}
  function openPositionCompact(t){const acc=accountById(t.accountId);return `<div class="account-row" style="grid-template-columns:1fr .65fr auto"><div><div class="row-main">${esc(t.asset)} <span class="pill ${t.direction==='BUY'?'success':'danger'}">${t.direction}</span></div><div class="row-sub">${esc(acc?.name||'Compte')} · ${esc(strategyById(t.strategyId)?.name||'Sans stratégie')}</div></div><div class="mono">${fmtMoney(t.realizedPnl||0,acc?.currency||'USD')}</div><button class="btn" data-open-trade="${t.id}">Gérer</button></div>`}

  function renderAccounts(){
    const el=$('#view-accounts');if(!el)return;const primary=primaryAccount();
    el.innerHTML=`${pageHead('Comptes de trading','Gérez plusieurs comptes, leur solde et leur risque indépendamment.','<button class="btn btn-primary" id="add-account">+ Ajouter un compte</button>')}<div class="card" style="margin-bottom:12px"><div class="account-summary"><div><div class="card-label">Capital total</div><div class="account-balance-total">${fmtMoney(totalBalance(),primary?.currency||'USD')}</div></div><div><div class="card-label">Comptes</div><div class="card-value">${state.accounts.length}</div></div><div><div class="card-label">Compte actif</div><div class="row-main">${esc(primary?.name||'—')}</div></div></div></div><div class="grid">${state.accounts.map(a=>`<div class="card"><div class="account-row"><div><div class="row-main"><span class="account-dot" style="background:${a.color||'var(--success)'}"></span>${esc(a.name)} ${a.active?'<span class="pill success">Actif</span>':''}</div><div class="row-sub">${esc(a.broker||'Courtier non renseigné')}</div></div><div><div class="row-sub">Solde</div><div class="mono">${fmtMoney(a.balance,a.currency)}</div></div><div><div class="row-sub">Risque / trade</div><div class="mono">${a.riskMode==='percent'?fmtPct(a.riskValue):fmtMoney(a.riskValue,a.currency)}</div></div><button class="btn" data-edit-account="${a.id}">•••</button></div></div>`).join('')}</div>`;
    $('#add-account').onclick=()=>openAccountModal();$$('[data-edit-account]').forEach(b=>b.onclick=()=>openAccountModal(b.dataset.editAccount));
  }
  function openAccountModal(id=null){
    const a=id?accountById(id):null;showModal(`<div class="modal-head"><div><div class="modal-title">${a?'Modifier le compte':'Ajouter un compte'}</div><div class="modal-sub">Le risque et le solde de ce compte alimentent automatiquement les calculs.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Nom du compte</label><input id="acc-name" value="${esc(a?.name||'')}"></div><div class="field"><label>Courtier / Prop firm</label><input id="acc-broker" value="${esc(a?.broker||'')}"></div><div class="field"><label>Devise</label><select id="acc-currency"><option>USD</option><option>EUR</option><option>GBP</option></select></div><div class="field"><label>Solde actuel</label><input id="acc-balance" inputmode="decimal" value="${a?.balance??''}"></div><div class="field"><label>Mode de risque</label><select id="acc-risk-mode"><option value="fixed">Montant fixe</option><option value="percent">Pourcentage du solde</option></select></div><div class="field"><label>Risque par trade</label><input id="acc-risk" inputmode="decimal" value="${a?.riskValue??10}"></div></div><label class="check-row"><input type="checkbox" id="acc-active" ${a?.active?'checked':''}><span>Définir comme compte principal</span></label><div class="modal-footer">${a?'<button class="btn btn-danger" id="delete-account-item">Supprimer</button>':''}<button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-account">Enregistrer</button></div>`);
    $('#acc-currency').value=a?.currency||'USD';$('#acc-risk-mode').value=a?.riskMode||'fixed';
    $('#save-account').onclick=()=>{const name=$('#acc-name').value.trim(),balance=num($('#acc-balance').value),risk=num($('#acc-risk').value);if(!name||!Number.isFinite(balance)||!Number.isFinite(risk)||risk<0){toast('Vérifiez le nom, le solde et le risque.','error');return}if($('#acc-active').checked)state.accounts.forEach(x=>x.active=false);const obj={id:a?.id||uid('acc'),name,broker:$('#acc-broker').value.trim(),currency:$('#acc-currency').value,balance,riskMode:$('#acc-risk-mode').value,riskValue:risk,active:$('#acc-active').checked||(!a&&!state.accounts.some(x=>x.active)),color:a?.color||['#2fd3a0','#4aa4ff','#a565ff','#e7ad4d'][state.accounts.length%4]};if(a)Object.assign(a,obj);else state.accounts.push(obj);save();hideModal();renderAll();toast('Compte enregistré.','success')};
    $('#delete-account-item')?.addEventListener('click',()=>{if(state.accounts.length<=1){toast('Conservez au moins un compte de trading.','error');return}confirmDialog({title:'Supprimer ce compte ?',text:'Les trades historiques resteront dans le journal mais ce compte ne sera plus disponible pour de nouveaux trades.',confirmLabel:'Supprimer',danger:true,onConfirm:()=>{state.accounts=state.accounts.filter(x=>x.id!==id);if(!state.accounts.some(x=>x.active))state.accounts[0].active=true;save();renderAll();toast('Compte supprimé.','success')}})});
  }

  function renderStrategies(){
    const el=$('#view-strategies');if(!el)return;
    el.innerHTML=`${pageHead('Stratégies','Votre méthode vous appartient. ALTITUDE OS ne fournit aucune stratégie préchargée.','<button class="btn btn-primary" id="new-strategy">+ Nouvelle stratégie</button>')}<div class="card" style="margin-bottom:12px"><div class="card-title">Principe</div><div class="page-sub" style="line-height:1.65;margin-top:7px">Créez vos propres conditions d’entrée, confirmations, règles de risque et critères de sortie. Lors d’un nouveau trade, ALTITUDE OS vous demandera de confirmer votre checklist avant d’accéder au calcul de risque.</div></div>${state.strategies.length?`<div class="grid">${state.strategies.map(s=>`<div class="card"><div class="strategy-row"><div><div class="row-main">${esc(s.name)} ${s.active?'<span class="pill success">Active</span>':''}</div><div class="row-sub">${esc(s.description||'Aucune description')}</div></div><div><div class="row-sub">Règles</div><div class="mono">${strategyRules(s).length}</div></div><div><div class="row-sub">Utilisée</div><div class="mono">${state.trades.filter(t=>t.strategyId===s.id).length}×</div></div><button class="btn" data-edit-strategy="${s.id}">•••</button></div></div>`).join('')}</div>`:`<div class="card empty"><strong>Aucune stratégie configurée.</strong>Créez votre première stratégie pour activer la confirmation avant trade.<br><button class="btn btn-primary" id="empty-new-strategy" style="margin-top:14px">Créer une stratégie</button></div>`}`;
    $('#new-strategy').onclick=()=>openStrategyModal();$('#empty-new-strategy')?.addEventListener('click',()=>openStrategyModal());$$('[data-edit-strategy]').forEach(b=>b.onclick=()=>openStrategyModal(b.dataset.editStrategy));
  }
  function strategyRules(s){return [...(s.entryRules||[]),...(s.confirmations||[]),...(s.riskRules||[]),...(s.exitRules||[])]}
  function openStrategyModal(id=null){
    const s=id?strategyById(id):{name:'',description:'',entryRules:[],confirmations:[],riskRules:[],exitRules:[],active:true};
    showModal(`<div class="modal-head"><div><div class="modal-title">${id?'Modifier la stratégie':'Nouvelle stratégie'}</div><div class="modal-sub">Définissez uniquement vos propres règles. Aucune règle n’est inventée par ALTITUDE OS.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Nom</label><input id="strat-name" value="${esc(s.name)}" placeholder="Ex. Breakout London"></div><div class="field"><label>Description</label><input id="strat-desc" value="${esc(s.description||'')}" placeholder="Une phrase pour reconnaître ce plan"></div></div><div class="strategy-builder">${ruleEditor('Conditions d’entrée','entryRules',s.entryRules)}${ruleEditor('Confirmations','confirmations',s.confirmations)}${ruleEditor('Règles de risque','riskRules',s.riskRules)}${ruleEditor('Validation & sortie','exitRules',s.exitRules)}</div><label class="check-row" style="margin-top:12px"><input id="strat-active" type="checkbox" ${s.active?'checked':''}><span>Stratégie active et disponible lors d’un nouveau trade</span></label><div class="modal-footer">${id?'<button class="btn btn-danger" id="delete-strategy">Supprimer</button>':''}<button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-strategy">Enregistrer</button></div>`,true);
    const working={entryRules:[...(s.entryRules||[])],confirmations:[...(s.confirmations||[])],riskRules:[...(s.riskRules||[])],exitRules:[...(s.exitRules||[])]};
    function bindRuleEditors(){$$('[data-add-rule]').forEach(b=>b.onclick=()=>{const key=b.dataset.addRule,input=$(`[data-rule-input="${key}"]`),v=input.value.trim();if(v){working[key].push(v);input.value='';refreshRules(key)}});$$('[data-remove-rule]').forEach(b=>b.onclick=()=>{const [key,idx]=b.dataset.removeRule.split(':');working[key].splice(Number(idx),1);refreshRules(key)})}
    function refreshRules(key){const box=$(`[data-rule-list="${key}"]`);box.innerHTML=working[key].map((r,i)=>`<div class="rule-line"><span>${esc(r)}</span><button data-remove-rule="${key}:${i}">×</button></div>`).join('')||'<div class="row-sub">Aucune règle</div>';bindRuleEditors()}
    ['entryRules','confirmations','riskRules','exitRules'].forEach(refreshRules);
    $('#save-strategy').onclick=()=>{const name=$('#strat-name').value.trim();if(!name){toast('Donnez un nom à la stratégie.','error');return}const obj={id:s.id||uid('strat'),name,description:$('#strat-desc').value.trim(),...working,active:$('#strat-active').checked,createdAt:s.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};if(id)Object.assign(s,obj);else state.strategies.push(obj);save();hideModal();renderAll();toast('Stratégie enregistrée.','success')};
    $('#delete-strategy')?.addEventListener('click',()=>confirmDialog({title:'Supprimer cette stratégie ?',text:'Les trades historiques qui l’utilisent resteront conservés.',confirmLabel:'Supprimer',danger:true,onConfirm:()=>{state.strategies=state.strategies.filter(x=>x.id!==id);save();renderAll();toast('Stratégie supprimée.','success')}}));
  }
  function ruleEditor(title,key,rules=[]){return `<div class="rule-block"><h4>${esc(title)}</h4><div class="rule-list" data-rule-list="${key}"></div><div class="new-rule-row"><input class="input" data-rule-input="${key}" placeholder="Ajouter une règle…"><button class="btn" data-add-rule="${key}">+</button></div></div>`}

  function renderJournal(){
    const el=$('#view-journal');if(!el)return;const recent=state.trades.slice().sort((a,b)=>new Date(b.openedAt)-new Date(a.openedAt));
    el.innerHTML=`${pageHead('Journal','Toutes vos positions, ouvertes ou clôturées.','<button class="btn btn-primary" id="journal-new">+ Nouveau trade</button>')}<div class="card">${recent.length?tradeRows(recent,false):`<div class="empty"><strong>Aucun trade.</strong>Le journal se construit au fil de vos positions.</div>`}</div>`;$('#journal-new').onclick=openNewTrade;$$('[data-trade-id]').forEach(b=>b.onclick=()=>openTradeDetails(b.dataset.tradeId));
  }
  function tradeRows(trades,compact=false){return `<div class="history-row row-head"><span>Date</span><span>Actif</span><span>Direction</span><span>Compte</span><span>PnL</span><span>R</span><span>Statut</span><span></span></div>${trades.map(t=>{const a=accountById(t.accountId);return `<div class="history-row"><span>${fmtDate(t.openedAt)}</span><span class="row-main">${esc(t.asset)}</span><span class="${t.direction==='BUY'?'up':'down'}">${t.direction}</span><span>${esc(a?.name||'Compte supprimé')}</span><span class="mono ${(t.pnl||0)>=0?'up':'down'}">${t.status==='open'?'—':fmtMoney(t.pnl,a?.currency||'USD')}</span><span class="mono">${t.status==='open'?'—':fmtR(t.resultR)}</span><span><span class="pill ${t.status==='open'?'':'success'}">${t.status==='open'?'Ouvert':'Clôturé'}</span></span><button class="btn" data-trade-id="${t.id}">${t.status==='open'?'Gérer':'Voir'}</button></div>`}).join('')}`}

  function openNewTrade(){
    if(!state.accounts.length){toast('Ajoutez d’abord un compte de trading.','error');setView('accounts');return}
    if(!state.strategies.some(s=>s.active)){toast('Créez au moins une stratégie active.','error');setView('strategies');return}
    const acc=primaryAccount(),strats=state.strategies.filter(s=>s.active);
    showModal(`<div class="modal-head"><div><div class="modal-title">Préparer un trade</div><div class="modal-sub">Étape 1 sur 2 · Contexte et plan</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Compte</label><select id="trade-account">${state.accounts.map(a=>`<option value="${a.id}" ${a.id===acc?.id?'selected':''}>${esc(a.name)} · ${fmtMoney(a.balance,a.currency)}</option>`).join('')}</select></div><div class="field"><label>Stratégie</label><select id="trade-strategy">${strats.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Actif / marché</label><input id="trade-asset" placeholder="Ex. XAUUSD, BTCUSD, NAS100"></div><div class="field"><label>Direction</label><select id="trade-direction"><option value="BUY">Long / BUY</option><option value="SELL">Short / SELL</option></select></div></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="trade-next">Continuer</button></div>`);
    $('#trade-next').onclick=()=>{const asset=$('#trade-asset').value.trim().toUpperCase();if(!asset){toast('Renseignez l’actif.','error');return}const draft={accountId:$('#trade-account').value,strategyId:$('#trade-strategy').value,asset,direction:$('#trade-direction').value};openStrategyConfirmation(draft)}
  }
  function openStrategyConfirmation(draft){
    const s=strategyById(draft.strategyId),rules=strategyRules(s);showModal(`<div class="modal-head"><div><div class="modal-title">Confirmer votre stratégie</div><div class="modal-sub">${esc(s?.name||'Stratégie')} · ${esc(draft.asset)} · ${draft.direction}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="strategy-confirm"><div class="card-title">Checklist personnelle</div><div class="page-sub" style="margin:5px 0 12px">Cochez uniquement ce que vous avez réellement vérifié.</div><div class="checklist">${rules.length?rules.map((r,i)=>`<label class="check-row"><input type="checkbox" data-strategy-check="${i}"><span>${esc(r)}</span></label>`).join(''):`<div class="empty">Cette stratégie ne contient aucune règle. Ajoutez des règles avant de l’utiliser.</div>`}</div></div><div class="modal-footer"><button class="btn" id="back-trade">Retour</button><button class="btn btn-primary" id="strategy-confirm-next" ${rules.length?'disabled':''}>Calculer le risque</button></div>`);
    const next=$('#strategy-confirm-next');$$('[data-strategy-check]').forEach(c=>c.onchange=()=>{next.disabled=!$$('[data-strategy-check]').every(x=>x.checked)});$('#back-trade').onclick=()=>{hideModal();setTimeout(openNewTrade,0)};next.onclick=()=>openRiskTrade(draft)
  }
  function openRiskTrade(draft){
    const a=accountById(draft.accountId),riskUSD=accountRiskUSD(a);showModal(`<div class="modal-head"><div><div class="modal-title">Risque & niveaux</div><div class="modal-sub">${esc(a?.name||'Compte')} · risque actuel ${fmtMoney(riskUSD,a?.currency||'USD')}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid three"><div class="field"><label>Entrée</label><input id="trade-entry" inputmode="decimal"></div><div class="field"><label>Stop loss</label><input id="trade-sl" inputmode="decimal"></div><div class="field"><label>Take profit</label><input id="trade-tp" inputmode="decimal"></div></div><div id="risk-live"></div><div class="field" style="margin-top:12px"><label>Note avant trade (facultatif)</label><textarea id="trade-note" rows="3" placeholder="Contexte, émotion, détail à retenir…"></textarea></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="create-trade" disabled>Créer la position</button></div>`);
    ['trade-entry','trade-sl','trade-tp'].forEach(id=>$(`#${id}`).oninput=()=>updateNewTradeRisk(draft));
  }
  function updateNewTradeRisk(draft){
    const a=accountById(draft.accountId),entry=num($('#trade-entry').value),sl=num($('#trade-sl').value),tp=num($('#trade-tp').value),riskUSD=accountRiskUSD(a),riskDist=Math.abs(entry-sl),reward=draft.direction==='BUY'?tp-entry:entry-tp,correct=draft.direction==='BUY'?(sl<entry&&tp>entry):(sl>entry&&tp<entry),rr=correct&&riskDist>0?reward/riskDist:0,units=riskDist>0?riskUSD/riskDist:0,valid=[entry,sl,tp].every(Number.isFinite)&&correct&&riskDist>0&&reward>0;
    $('#risk-live').innerHTML=`<div class="risk-preview"><div class="risk-box"><span>Risque</span><strong>${fmtMoney(riskUSD,a?.currency||'USD')}</strong></div><div class="risk-box"><span>R:R prévu</span><strong>${valid?`1:${rr.toFixed(2)}`:'—'}</strong></div><div class="risk-box"><span>Taille indicative</span><strong>${valid?units.toFixed(4):'—'}</strong></div><div class="risk-box"><span>Gain au TP</span><strong>${valid?fmtMoney(riskUSD*rr,a?.currency||'USD'):'—'}</strong></div></div>`;
    const btn=$('#create-trade');btn.disabled=!valid;btn.onclick=valid?()=>{const t={id:uid('trade'),accountId:draft.accountId,strategyId:draft.strategyId,asset:draft.asset,direction:draft.direction,entry,sl,tp,plannedRR:Number(rr.toFixed(3)),riskUSD:Number(riskUSD.toFixed(2)),openedAt:new Date().toISOString(),status:'open',remainingPct:100,partialExits:[],realizedPnl:0,pnl:0,resultR:null,note:$('#trade-note').value.trim(),capitalBefore:a.balance,capitalAfter:null};state.trades.unshift(t);save();hideModal();renderAll();toast('Position créée dans le journal.','success');setView('journal')}:null;
  }

  function openTradeDetails(id){const t=state.trades.find(x=>x.id===id);if(!t)return;const a=accountById(t.accountId),s=strategyById(t.strategyId);showModal(`<div class="modal-head"><div><div class="modal-title">${esc(t.asset)} · ${t.direction}</div><div class="modal-sub">${fmtDateTime(t.openedAt)} · ${esc(a?.name||'Compte supprimé')} · ${esc(s?.name||'Stratégie supprimée')}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="grid metric-grid">${smallMetric('Entrée',t.entry)}${smallMetric('SL',t.sl)}${smallMetric('TP',t.tp)}${smallMetric('Risque',fmtMoney(t.riskUSD,a?.currency||'USD'))}</div><div class="card" style="margin-top:12px"><div class="card-title">État</div><div class="page-sub" style="margin-top:7px">${t.status==='open'?`${t.remainingPct}% de la position reste ouverte. PnL déjà réalisé : ${fmtMoney(t.realizedPnl||0,a?.currency||'USD')}`:`Clôturé ${fmtDateTime(t.closedAt)} · ${fmtMoney(t.pnl,a?.currency||'USD')} · ${fmtR(t.resultR)}`}</div>${t.note?`<div style="margin-top:12px">${esc(t.note)}</div>`:''}</div>${t.partialExits?.length?`<div class="card" style="margin-top:12px"><div class="card-title">Sorties</div>${t.partialExits.map(e=>`<div class="account-row" style="grid-template-columns:1fr .6fr .6fr"><div>${fmtDateTime(e.at)}<div class="row-sub">${esc(e.reason)}</div></div><div class="mono">${e.percent}%</div><div class="mono ${e.pnl>=0?'up':'down'}">${fmtMoney(e.pnl,a?.currency||'USD')}</div></div>`).join('')}</div>`:''}<div class="modal-footer">${t.status==='open'?'<button class="btn btn-primary" id="manage-open-trade">Gérer la sortie</button>':''}</div>`);$('#manage-open-trade')?.addEventListener('click',()=>openCloseTradeModal(id))}

  function openCloseTradeModal(id){
    const t=state.trades.find(x=>x.id===id);if(!t||t.status!=='open')return;const a=accountById(t.accountId);showModal(`<div class="modal-head"><div><div class="modal-title">Gérer la sortie</div><div class="modal-sub">${esc(t.asset)} · ${t.direction} · ${t.remainingPct}% restant</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Prix de sortie</label><input id="exit-price" inputmode="decimal" placeholder="Prix réellement exécuté"></div><div class="field"><label>Part à clôturer</label><select id="exit-percent">${[25,50,75,100].filter(x=>x<=t.remainingPct).map(x=>`<option value="${x}" ${x===t.remainingPct?'selected':''}>${x}%</option>`).join('')}<option value="${t.remainingPct}">Tout le restant (${t.remainingPct}%)</option></select></div><div class="field"><label>Raison</label><select id="exit-reason"><option>Sortie manuelle avant TP</option><option>Take Profit</option><option>Stop Loss</option><option>Break-even</option><option>Sortie partielle planifiée</option><option>Invalidation du setup</option><option>Autre</option></select></div><div class="field"><label>PnL réel (facultatif)</label><input id="exit-pnl-override" inputmode="decimal" placeholder="Laisser vide pour calcul automatique"></div></div><div id="exit-preview"></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="confirm-exit" disabled>Enregistrer la sortie</button></div>`);
    ['exit-price','exit-percent','exit-pnl-override'].forEach(id=>$(`#${id}`).oninput=()=>updateExitPreview(t));$('#exit-percent').onchange=()=>updateExitPreview(t);
  }
  function updateExitPreview(t){const a=accountById(t.accountId),price=num($('#exit-price').value),pct=num($('#exit-percent').value),overrideRaw=$('#exit-pnl-override').value.trim(),override=overrideRaw?num(overrideRaw):null,riskDist=Math.abs(t.entry-t.sl),rMult=Number.isFinite(price)&&riskDist>0?(t.direction==='BUY'?(price-t.entry):(t.entry-price))/riskDist:NaN,autoPnl=Number.isFinite(rMult)?t.riskUSD*rMult*(pct/100):NaN,pnl=Number.isFinite(override)?override:autoPnl,valid=Number.isFinite(price)&&pct>0&&pct<=t.remainingPct&&Number.isFinite(pnl);$('#exit-preview').innerHTML=`<div class="risk-preview"><div class="risk-box"><span>R réalisé</span><strong>${Number.isFinite(rMult)?rMult.toFixed(2):'—'}</strong></div><div class="risk-box"><span>PnL sortie</span><strong class="${pnl>=0?'up':'down'}">${valid?fmtMoney(pnl,a?.currency||'USD'):'—'}</strong></div><div class="risk-box"><span>Restant après</span><strong>${valid?`${t.remainingPct-pct}%`:'—'}</strong></div><div class="risk-box"><span>Solde après</span><strong>${valid?fmtMoney((a?.balance||0)+pnl,a?.currency||'USD'):'—'}</strong></div></div>`;const btn=$('#confirm-exit');btn.disabled=!valid;btn.onclick=valid?()=>applyExit(t,{price,pct,pnl,rMult,reason:$('#exit-reason').value}):null}
  function applyExit(t,{price,pct,pnl,rMult,reason}){const a=accountById(t.accountId);t.partialExits=t.partialExits||[];t.partialExits.push({at:new Date().toISOString(),price,percent:pct,pnl:Number(pnl.toFixed(2)),r:Number(rMult.toFixed(3)),reason});t.realizedPnl=Number(((t.realizedPnl||0)+pnl).toFixed(2));t.remainingPct=Math.max(0,t.remainingPct-pct);if(a)a.balance=Number((Number(a.balance||0)+pnl).toFixed(2));if(t.remainingPct<=0){t.status='closed';t.closedAt=new Date().toISOString();t.pnl=t.realizedPnl;t.resultR=Number((t.pnl/t.riskUSD).toFixed(3));t.capitalAfter=a?.balance??null}else{t.pnl=t.realizedPnl}save();hideModal();renderAll();toast(t.status==='closed'?'Position clôturée.':'Sortie partielle enregistrée.','success')}

  function renderHistory(){
    const el=$('#view-history');if(!el)return;const trades=tradesInPeriod(historyPeriod);
    el.innerHTML=`${pageHead('Historique','Explorez vos résultats par période sans mélanger toutes les données.',periodTabs(historyPeriod,'data-history-period'))}<div class="card"><div class="card-head"><div><div class="card-title">${labelPeriod(historyPeriod)}</div><div class="page-sub">${trades.length} trade${trades.length>1?'s':''}</div></div><button class="btn" id="export-history">Exporter CSV</button></div>${trades.length?tradeRows(trades,false):`<div class="empty"><strong>Aucune donnée sur cette période.</strong>Changez de période ou ajoutez de nouveaux trades.</div>`}</div>`;$$('[data-history-period]').forEach(b=>b.onclick=()=>{historyPeriod=b.dataset.historyPeriod;renderHistory()});$('#export-history').onclick=()=>exportCSV(trades)
  }
  function labelPeriod(p){return {week:'Cette semaine',month:'Ce mois',quarter:'Ce trimestre',year:'Cette année'}[p]||'Historique'}
  function exportCSV(trades){const rows=[['date','actif','direction','compte','strategie','entry','sl','tp','pnl','R','statut'],...trades.map(t=>[t.openedAt,t.asset,t.direction,accountById(t.accountId)?.name||'',strategyById(t.strategyId)?.name||'',t.entry,t.sl,t.tp,t.pnl,t.resultR,t.status])];const csv=rows.map(r=>r.map(x=>`"${String(x??'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`altitude-history-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url)}

  function renderProductivity(){
    const el=$('#view-productivity');if(!el)return;const trades=tradesInPeriod(currentPeriod),st=statsFor(trades),series=equitySeries(trades.filter(t=>t.status==='closed')),heat=Array.from({length:48},(_,i)=>{const t=trades.filter(x=>x.status==='closed')[i%Math.max(1,trades.length)];return t?(t.resultR>1?'pos2':t.resultR>0?'pos1':t.resultR<-.5?'neg2':'neg1'):''});
    el.innerHTML=`${pageHead('Productivité','Mesurez la régularité de votre exécution et de vos résultats.',periodTabs())}<div class="grid metric-grid">${metric('PnL',fmtMoney(st.pnl,primaryAccount()?.currency||'USD'),fmtR(st.totalR),st.pnl>=0)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} gains / ${st.losses} pertes`)}${metric('R moyen',st.closed?st.avgR.toFixed(2):'—','Par trade clôturé')}${metric('Profit factor',Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—'),'Gains bruts / pertes brutes')}</div><div class="two-col" style="margin-top:12px"><div class="card"><div class="card-head"><div class="card-title">Courbe de progression</div><span class="page-sub">PnL cumulé</span></div>${lineChart(series)}</div><div class="card"><div class="card-head"><div class="card-title">Régularité</div><span class="page-sub">Intensité par trade</span></div><div class="heatmap">${heat.map(c=>`<span class="heat-cell ${c}"></span>`).join('')}</div><div class="page-sub" style="margin-top:12px">Plus la couleur est intense, plus le résultat absolu du trade est important.</div></div></div><div class="card" style="margin-top:12px"><div class="card-head"><div class="card-title">Résultats trade par trade</div></div>${bars(trades)}</div>`;$$('[data-period]').forEach(b=>b.onclick=()=>{currentPeriod=b.dataset.period;renderProductivity()})
  }

  function currentWeekKey(){const r=rangeFor('week');return r.start.toISOString().slice(0,10)}
  function renderWeekly(){
    const el=$('#view-weekly');if(!el)return;const key=currentWeekKey(),review=state.weeklyReviews[key]||{summary:'',lesson:'',rule:'',completed:false},weekTrades=tradesInPeriod('week').filter(t=>t.status==='closed');
    el.innerHTML=`${pageHead('Revue hebdomadaire','Prenez du recul sur votre semaine sans mélanger résultat et qualité.')}<div class="detail-grid"><div class="card"><div class="card-head"><div class="card-title">Semaine en cours</div><span class="pill">${weekTrades.length} trade${weekTrades.length>1?'s':''}</span></div>${weekTrades.length?tradeRows(weekTrades,true):'<div class="empty">Aucun trade clôturé cette semaine.</div>'}</div><div class="card"><div class="field"><label>Bilan de la semaine</label><textarea id="review-summary" rows="5">${esc(review.summary)}</textarea></div><div class="field"><label>Leçon principale</label><textarea id="review-lesson" rows="4">${esc(review.lesson)}</textarea></div><div class="field"><label>Règle à retenir</label><textarea id="review-rule" rows="3">${esc(review.rule)}</textarea></div><button class="btn btn-primary" id="save-review" style="width:100%">Valider la revue</button></div></div>`;$('#save-review').onclick=()=>{const summary=$('#review-summary').value.trim(),lesson=$('#review-lesson').value.trim(),rule=$('#review-rule').value.trim();state.weeklyReviews[key]={summary,lesson,rule,completed:Boolean(summary&&lesson&&rule),updatedAt:new Date().toISOString()};if(rule&&!state.rules.some(r=>r.text===rule))state.rules.unshift({id:uid('rule'),text:rule,status:'active',createdAt:new Date().toISOString(),sourceWeek:key});save();renderAll();toast('Revue enregistrée.','success')}
  }

  function renderRules(){const el=$('#view-rules');if(!el)return;el.innerHTML=`${pageHead('Règles & notes','Votre mémoire de trading personnelle.','<button class="btn btn-primary" id="add-note">+ Ajouter une note</button>')}<div class="two-col"><div class="card"><div class="card-head"><div class="card-title">Règles</div><span class="pill">${state.rules.length}</span></div>${state.rules.length?state.rules.map((r,i)=>`<div class="account-row" style="grid-template-columns:36px 1fr auto"><div class="mono">${String(i+1).padStart(2,'0')}</div><div><div class="row-main">${esc(r.text)}</div><div class="row-sub">${fmtDate(r.createdAt)} · ${esc(r.status)}</div></div><button class="btn" data-rule-toggle="${r.id}">${r.status==='active'?'Archiver':'Activer'}</button></div>`).join(''):'<div class="empty">Les règles créées pendant vos revues apparaîtront ici.</div>'}</div><div class="card"><div class="card-head"><div class="card-title">Notes</div><span class="pill">${state.notes.length}</span></div>${state.notes.length?state.notes.map(n=>`<div class="account-row" style="grid-template-columns:1fr auto"><div><div class="row-main">${esc(n.title)}</div><div class="row-sub">${esc(n.text)}</div></div><button class="btn" data-note-delete="${n.id}">×</button></div>`).join(''):'<div class="empty">Aucune note personnelle.</div>'}</div></div>`;$('#add-note').onclick=()=>showModal(`<div class="modal-head"><div><div class="modal-title">Nouvelle note</div></div><button class="close-btn" data-close-modal>×</button></div><div class="field"><label>Titre</label><input id="note-title"></div><div class="field"><label>Note</label><textarea id="note-text" rows="6"></textarea></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-note">Enregistrer</button></div>`);setTimeout(()=>{$('#save-note')?.addEventListener('click',()=>{const title=$('#note-title').value.trim(),text=$('#note-text').value.trim();if(!title||!text)return;state.notes.unshift({id:uid('note'),title,text,createdAt:new Date().toISOString()});save();hideModal();renderAll();toast('Note enregistrée.','success')})},0);$$('[data-rule-toggle]').forEach(b=>b.onclick=()=>{const r=state.rules.find(x=>x.id===b.dataset.ruleToggle);r.status=r.status==='active'?'archived':'active';save();renderRules()});$$('[data-note-delete]').forEach(b=>b.onclick=()=>{state.notes=state.notes.filter(n=>n.id!==b.dataset.noteDelete);save();renderRules()})}

  function renderProfile(){const el=$('#view-profile');if(!el)return;el.innerHTML=`${pageHead('Profil','Vos informations personnelles et votre identité dans ALTITUDE OS.')}<div class="card"><div class="profile-hero">${avatarHtml()}<div class="profile-meta"><h2>${esc(displayName())}</h2><p>${esc(currentUser?.email||'Mode démo local')} · ${esc(accountProfile?.plan||'Compte')}</p><button class="btn" id="change-avatar" style="margin-top:10px">Changer la photo</button><input type="file" id="avatar-file" accept="image/*" hidden></div></div><div class="form-grid" style="margin-top:24px"><div class="field"><label>Prénom</label><input id="profile-first" value="${esc(state.profile.firstName)}"></div><div class="field"><label>Nom</label><input id="profile-last" value="${esc(state.profile.lastName)}"></div><div class="field"><label>Nom affiché</label><input id="profile-display" value="${esc(state.profile.displayName)}"></div><div class="field"><label>Pays</label><input id="profile-country" value="${esc(state.profile.country)}"></div><div class="field"><label>Fuseau horaire</label><input id="profile-timezone" value="${esc(state.profile.timezone)}"></div><div class="field"><label>Expérience</label><select id="profile-experience"><option value="">Non renseigné</option><option>Débutant</option><option>Intermédiaire</option><option>Avancé</option><option>Professionnel</option></select></div></div><button class="btn btn-primary" id="save-profile">Enregistrer le profil</button></div>`;$('#profile-experience').value=state.profile.experience||'';$('#save-profile').onclick=()=>{state.profile={...state.profile,firstName:$('#profile-first').value.trim(),lastName:$('#profile-last').value.trim(),displayName:$('#profile-display').value.trim(),country:$('#profile-country').value.trim(),timezone:$('#profile-timezone').value.trim(),experience:$('#profile-experience').value};save();renderAll();toast('Profil mis à jour.','success')};$('#change-avatar').onclick=()=>$('#avatar-file').click();$('#avatar-file').onchange=async e=>{const f=e.target.files?.[0];if(f){state.profile.avatar=await imageToDataUrl(f);save();renderAll();toast('Photo de profil mise à jour.','success')}}}
  function imageToDataUrl(file){return new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');const s=Math.min(img.width,img.height),sx=(img.width-s)/2,sy=(img.height-s)/2;ctx.drawImage(img,sx,sy,s,s,0,0,256,256);res(c.toDataURL('image/jpeg',.78))};img.onerror=rej;img.src=reader.result};reader.onerror=rej;reader.readAsDataURL(file)})}

  function renderSettings(){const el=$('#view-settings');if(!el)return;el.innerHTML=`${pageHead('Paramètres','Apparence, données et sécurité.')}<div class="settings-grid"><div class="card settings-nav"><button class="active">Apparence</button><button>Préférences</button><button>Données</button><button>Sécurité</button></div><div class="stack"><div class="card"><div class="card-head"><div><div class="card-title">Apparence</div><div class="page-sub">Cinq environnements, une seule identité ALTITUDE OS.</div></div></div><div class="grid" style="grid-template-columns:repeat(5,1fr)">${['midnight','summit','obsidian','glacier','carbon'].map(t=>`<button class="card" data-theme-choice="${t}" style="padding:10px;cursor:pointer;text-align:left;${state.preferences.theme===t?'border-color:var(--accent)':''}"><div class="theme-dot" data-theme="${t}" style="margin-bottom:10px"></div><div class="row-main" style="text-transform:capitalize">${t}</div></button>`).join('')}</div><div class="form-grid" style="margin-top:14px"><div class="field"><label>Densité</label><select id="pref-density"><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select></div><div class="field"><label>Taille du texte</label><select id="pref-text"><option value="small">Petite</option><option value="default">Standard</option><option value="large">Grande</option></select></div></div></div><div class="card"><div class="card-title">Données</div><div class="page-sub" style="margin:6px 0 14px">Vous pouvez exporter vos données ou remettre votre espace à zéro. La remise à zéro est irréversible.</div><div class="page-actions"><button class="btn" id="export-json">Exporter JSON</button><button class="btn btn-danger" id="reset-all">Remettre à zéro</button></div></div><div class="card"><div class="card-title">Sécurité</div><div class="page-sub" style="margin:6px 0 14px">${currentUser?'Compte cloud connecté.':'Mode démo local.'}</div><div class="page-actions"><button class="btn" id="sign-out">Se déconnecter</button>${currentUser?'<button class="btn btn-danger" id="delete-cloud-account">Supprimer mon compte</button>':''}</div></div></div></div>`;$('#pref-density').value=state.preferences.density;$('#pref-text').value=state.preferences.textScale;$$('[data-theme-choice]').forEach(b=>b.onclick=()=>{state.preferences.theme=b.dataset.themeChoice;save();renderAll();toast('Thème appliqué.','success')});$('#pref-density').onchange=e=>{state.preferences.density=e.target.value;save()};$('#pref-text').onchange=e=>{state.preferences.textScale=e.target.value;save()};$('#export-json').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`altitude-os-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url)};$('#reset-all').onclick=()=>confirmDialog({title:'Remettre ALTITUDE OS à zéro ?',text:'Comptes de trading, stratégies, trades, historiques, revues, règles et notes seront effacés. Votre compte de connexion restera actif.',confirmLabel:'Tout remettre à zéro',danger:true,onConfirm:()=>{const keepProfile=state.profile,keepPreferences=state.preferences;state=defaults();state.profile=keepProfile;state.preferences=keepPreferences;state.resetHistory=[{at:new Date().toISOString()}];save();renderAll();toast('Espace remis à zéro.','success')}});$('#sign-out').onclick=signOut;$('#delete-cloud-account')?.addEventListener('click',deleteCloudAccount)}

  function renderOpenPositionSelectors(){/* reserved */}

  function ensureCommandPalette(){
    let back=$('#command-backdrop');

    if(!back){
      back=document.createElement('div');
      back.className='command-backdrop';
      back.id='command-backdrop';
      back.hidden=true;
      back.setAttribute('aria-hidden','true');

      back.innerHTML=
        '<div class="command-palette" role="dialog" aria-modal="true">' +
        '<input id="command-input" autocomplete="off" placeholder="Rechercher ou lancer une action…">' +
        '<div id="command-results"></div>' +
        '</div>';

      document.body.appendChild(back);

      back.addEventListener('click',e=>{
        if(e.target===back) closeCommands();
      });

      $('#command-input')?.addEventListener('input',e=>{
        renderCommands(e.target.value);
      });
    }

    return {
      back,
      input:$('#command-input')
    };
  }

  function ensureCommandPalette(){
    let back=$('#command-backdrop');

    if(!back){
      back=document.createElement('div');
      back.className='command-backdrop';
      back.id='command-backdrop';
      back.hidden=true;
      back.setAttribute('aria-hidden','true');

      back.innerHTML=
        '<div class="command-palette" role="dialog" aria-modal="true">' +
        '<input id="command-input" autocomplete="off" placeholder="Rechercher ou lancer une action…">' +
        '<div id="command-results"></div>' +
        '</div>';

      document.body.appendChild(back);

      back.addEventListener('click',e=>{
        if(e.target===back) closeCommands();
      });

      $('#command-input')?.addEventListener('input',e=>{
        renderCommands(e.target.value);
      });
    }

    return {
      back,
      input:$('#command-input')
    };
  }

  function openCommandPalette(){
    const {back,input}=ensureCommandPalette();

    document.body.classList.add('command-open');
    back.hidden=false;
    back.setAttribute('aria-hidden','false');

    if(input){
      input.value='';
      renderCommands('');
      setTimeout(()=>input.focus(),10);
    }
  }

  function renderCommands(q=''){
    const actions=[
      ['Nouveau trade','Créer une position',()=>{closeCommands();openNewTrade()}],
      ['Tableau de bord','Navigation',()=>{closeCommands();setView('dashboard')}],
      ['Comptes','Navigation',()=>{closeCommands();setView('accounts')}],
      ['Stratégies','Navigation',()=>{closeCommands();setView('strategies')}],
      ['Journal','Navigation',()=>{closeCommands();setView('journal')}],
      ['Historique','Navigation',()=>{closeCommands();setView('history')}],
      ['Productivité','Navigation',()=>{closeCommands();setView('productivity')}],
      ['Profil','Navigation',()=>{closeCommands();setView('profile')}],
      ['Paramètres','Navigation',()=>{closeCommands();setView('settings')}]
    ];

    const results=$('#command-results');
    if(!results) return;

    const f=actions.filter(a=>
      a[0].toLowerCase().includes(q.toLowerCase())
    );

    results.innerHTML=
      f.map((a,i)=>
        `<div class="command-item" data-cmd="${i}">
          <span>${esc(a[0])}</span>
          <span>${esc(a[1])}</span>
        </div>`
      ).join('')
      || '<div class="empty">Aucun résultat</div>';

    $$('[data-cmd]').forEach(b=>{
      b.onclick=()=>f[Number(b.dataset.cmd)][2]();
    });
  }

  function closeCommands(){
    document.body.classList.remove('command-open');

    const back=$('#command-backdrop');
    const input=$('#command-input');

    if(back){
      back.hidden=true;
      back.setAttribute('aria-hidden','true');
    }

    if(input){
      input.value='';
      input.blur();
    }

    const results=$('#command-results');
    if(results) results.innerHTML='';
  }

  let authMode='login';
  function authMessage(msg,type='success'){return msg?`<div class="auth-msg ${type}">${esc(msg)}</div>`:''}
  function showAuth(mode='login',message='',type='success'){
    authMode=mode;$('#auth-screen').hidden=false;$('#app-shell').hidden=true;
    $('#auth-content').innerHTML=`<div class="eyebrow">ALTITUDE OS</div><div class="auth-title">${mode==='signup'?'Créer votre espace':'Connexion'}</div><div class="auth-sub">${mode==='signup'?'Un espace privé pour vos comptes, vos stratégies et votre journal.':'Retrouvez votre desk et vos données synchronisées.'}</div><div class="auth-tabs"><button class="auth-tab ${mode==='login'?'active':''}" data-auth-tab="login">Connexion</button><button class="auth-tab ${mode==='signup'?'active':''}" data-auth-tab="signup">Créer un compte</button></div>${!supabaseConfigured?authMessage('Supabase n’est pas configuré. Le mode démo reste disponible.','error'):''}${authMessage(message,type)}${mode==='signup'?'<div class="auth-field"><label>Nom affiché</label><input id="auth-name" autocomplete="name"></div>':''}<div class="auth-field"><label>Email</label><input id="auth-email" type="email" autocomplete="email"></div><div class="auth-field"><label>Mot de passe</label><input id="auth-password" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}"></div><div class="auth-actions"><button class="btn btn-primary" id="auth-submit">${mode==='signup'?'Créer mon espace':'Se connecter'}</button>${mode==='login'&&supabaseConfigured?'<button class="auth-link" id="forgot-password">Mot de passe oublié ?</button>':''}</div><div class="auth-divider">OU</div><button class="btn" id="demo-mode" style="width:100%">Continuer en démo locale</button>`;
    $$('[data-auth-tab]').forEach(b=>b.onclick=()=>showAuth(b.dataset.authTab));$('#auth-submit').onclick=submitAuth;$('#demo-mode').onclick=enterDemo;$('#forgot-password')?.addEventListener('click',resetPassword)
  }
  async function submitAuth(){if(!supabaseConfigured){showAuth(authMode,'Configurez Supabase ou utilisez le mode démo.','error');return}const email=$('#auth-email').value.trim(),password=$('#auth-password').value;if(!email||password.length<8){showAuth(authMode,'Renseignez un email valide et un mot de passe d’au moins 8 caractères.','error');return}if(authMode==='signup'){const displayName=$('#auth-name').value.trim()||email.split('@')[0],{data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo:APP_URL}});if(error){showAuth('signup',translateAuth(error.message),'error');return}if(data.session)await startUser(data.user);else showAuth('login','Compte créé. Vérifiez votre email puis connectez-vous.')}else{const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error){showAuth('login',translateAuth(error.message),'error');return}await startUser(data.user)}}
  function translateAuth(m){const map={'Invalid login credentials':'Email ou mot de passe incorrect.','Email not confirmed':'Confirmez votre email avant de vous connecter.','User already registered':'Un compte existe déjà avec cet email.'};return map[m]||m}
  async function resetPassword(){const email=$('#auth-email').value.trim();if(!email){showAuth('login','Saisissez votre email puis recommencez.','error');return}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:APP_URL});showAuth('login',error?translateAuth(error.message):'Email de réinitialisation envoyé.',error?'error':'success')}
  async function enterDemo(){closeCommands();currentUser=null;accountProfile={plan:'DEMO'};storageKey=`${STORAGE_KEY_BASE}:demo`;state=load();syncState='local';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;if(!state.profile.firstName)state.profile.firstName='Trader';applyPreferences();renderAll();setView('dashboard')}
  async function startUser(user){if(!user)return;closeCommands();currentUser=user;storageKey=`${STORAGE_KEY_BASE}:${user.id}`;state=load();if(supabase){try{const {data}=await supabase.from('profiles').select('display_name,plan').eq('id',user.id).maybeSingle();accountProfile=data||{display_name:user.user_metadata?.display_name||'',plan:'free'}}catch{accountProfile={plan:'free'}}await hydrateCloudState()}if(!state.profile.displayName)state.profile.displayName=accountProfile?.display_name||user.user_metadata?.display_name||'';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;applyPreferences();renderAll();setView('dashboard')}
  async function signOut(){if(currentUser&&supabase)await supabase.auth.signOut();currentUser=null;showAuth('login')}
  async function deleteCloudAccount(){confirmDialog({title:'Supprimer définitivement votre compte ?',text:'Cette action supprimera votre compte ALTITUDE OS et ses données cloud. Elle est irréversible.',confirmLabel:'Supprimer mon compte',danger:true,onConfirm:async()=>{try{const {data}=await supabase.auth.getSession();const token=data.session?.access_token;const res=await fetch(`${SUPABASE_URL}/functions/v1/delete-account`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});if(!res.ok)throw new Error('Suppression impossible');localStorage.removeItem(storageKey);await supabase.auth.signOut();currentUser=null;showAuth('login','Compte supprimé.','success')}catch(e){toast(e.message||'Suppression impossible.','error')}}})}

  function finishLaunch(){setTimeout(()=>$('#launch-screen')?.classList.add('leaving'),1000);setTimeout(()=>{const x=$('#launch-screen');if(x)x.style.display='none'},1500)}
  async function boot(){
    closeCommands();
    applyPreferences();
    if(supabaseConfigured){const client=await loadSupabaseClient();if(client){const {data}=await client.auth.getSession();if(data.session?.user)await startUser(data.session.user);else showAuth('login');client.auth.onAuthStateChange(async(event,session)=>{if(event==='SIGNED_IN'&&session?.user&&session.user.id!==currentUser?.id)await startUser(session.user);if(event==='SIGNED_OUT'&&currentUser){currentUser=null;showAuth('login')}})}else showAuth('login','Le service cloud n’a pas pu charger.','error')}else showAuth('login');finishLaunch()
  }

  closeCommands();window.addEventListener('pageshow',()=>closeCommands());$('#new-trade-global').onclick=openNewTrade;$('#command-search').onclick=openCommandPalette;$('#sidebar-toggle').onclick=()=>{$('#sidebar').classList.toggle('mobile-open')};$$('.nav-item[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommandPalette()}if(e.key==='Escape'){hideModal();closeCommands()}if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&e.key.toLowerCase()==='n'){e.preventDefault();openNewTrade()}});
  boot().catch(e=>{console.error(e);showAuth('login','Une erreur est survenue au démarrage.','error');finishLaunch()});
})();
