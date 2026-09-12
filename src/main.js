(() => {
  'use strict';

  const runtimeConfig = window.ALTITUDE_CONFIG || {};
  const SUPABASE_URL = String(runtimeConfig.SUPABASE_URL || '').trim();
  const SUPABASE_KEY = String(runtimeConfig.SUPABASE_ANON_KEY || '').trim();
  const APP_URL = String(runtimeConfig.APP_URL || window.location.origin + window.location.pathname).trim();
  const BILLING_ENABLED = Boolean(runtimeConfig.BILLING_ENABLED);
  const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR_PROJECT'));
  const STORAGE_KEY_BASE = 'altitude_os_v4_state';
  let supabase = null, currentUser = null, accountProfile = null, syncTimer = null, cloudHydrating = false;
  let storageKey = `${STORAGE_KEY_BASE}:demo`, syncState = supabaseConfigured ? 'idle' : 'local';
  let currentView = 'dashboard', dashboardPeriod = 'month', historyPeriod = 'month', historyAnchor = new Date(), productivityPeriod = 'month', productivityAccount = 'all';
  let journalFilters = {query:'',account:'all',strategy:'all',status:'all',result:'all',sort:'newest'};
  let journalPage=1, historyPage=1; const PAGE_SIZE=20;
  let rulesStatus='all', rulesQuery='';
  let historyFilters = {query:'',account:'all',strategy:'all',result:'all',sort:'newest'};

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
    version:5,
    profile:{firstName:'',lastName:'',displayName:'',avatar:'',country:'France',city:'',timezone:'Europe/Paris',language:'fr',experience:'',tradingStyle:'',bio:''},
    preferences:{theme:'midnight',density:'comfortable',textScale:'default',sidebarCollapsed:false,weekStart:'monday',confirmStrategy:true},
    accounts:[{id:'acc_main',name:'Compte principal',broker:'',accountType:'personal',currency:'USD',initialBalance:50,balance:50,riskMode:'fixed',riskValue:10,active:true,color:'#2fd3a0',balanceAdjustments:[],createdAt:new Date().toISOString()}],
    strategies:[],
    trades:[],
    weeklyReviews:{},
    rules:[],
    notes:[],
    resetHistory:[],
    onboardingDone:false
  });

  function mergeState(raw){
    const d=defaults(), src=raw||{};
    const merged={
      ...d,...src,
      profile:{...d.profile,...(src.profile||{})},
      preferences:{...d.preferences,...(src.preferences||{})},
      weeklyReviews:src.weeklyReviews||{},
      rules:Array.isArray(src.rules)?src.rules:[],
      notes:Array.isArray(src.notes)?src.notes:[],
      resetHistory:Array.isArray(src.resetHistory)?src.resetHistory:[]
    };
    merged.accounts=(Array.isArray(src.accounts)&&src.accounts.length?src.accounts:d.accounts).map((a,i)=>({
      id:a.id||uid('acc'),
      name:a.name||`Compte ${i+1}`,
      broker:a.broker||'',
      accountType:a.accountType||'personal',
      currency:a.currency||'USD',
      initialBalance:Number.isFinite(Number(a.initialBalance))?Number(a.initialBalance):Number(a.balance||0),
      balance:Number(a.balance||0),
      riskMode:a.riskMode==='percent'?'percent':'fixed',
      riskValue:Number(a.riskValue??10),
      active:Boolean(a.active ?? i===0),
      color:a.color||['#2fd3a0','#4aa4ff','#a565ff','#e7ad4d'][i%4],
      balanceAdjustments:Array.isArray(a.balanceAdjustments)?a.balanceAdjustments:[],
      createdAt:a.createdAt||new Date().toISOString()
    }));
    if(!merged.accounts.some(a=>a.active)&&merged.accounts[0]) merged.accounts[0].active=true;
    merged.strategies=(Array.isArray(src.strategies)?src.strategies:[]).map(st=>({
      id:st.id||uid('strat'),name:st.name||'Stratégie',description:st.description||'',
      marketScope:st.marketScope||'',timeframe:st.timeframe||'',tags:Array.isArray(st.tags)?st.tags:[],
      entryRules:Array.isArray(st.entryRules)?st.entryRules:[],confirmations:Array.isArray(st.confirmations)?st.confirmations:[],
      riskRules:Array.isArray(st.riskRules)?st.riskRules:[],exitRules:Array.isArray(st.exitRules)?st.exitRules:[],
      active:Boolean(st.active ?? true),archived:Boolean(st.archived),createdAt:st.createdAt||new Date().toISOString(),updatedAt:st.updatedAt||st.createdAt||new Date().toISOString()
    }));
    merged.trades=(Array.isArray(src.trades)?src.trades:[]).map(t=>({
      ...t,
      status:t.status||'closed',
      remainingPct:Number.isFinite(Number(t.remainingPct))?Number(t.remainingPct):(t.status==='open'?100:0),
      partialExits:Array.isArray(t.partialExits)?t.partialExits:[],
      realizedPnl:Number(t.realizedPnl||0),pnl:Number(t.pnl||0),
      resultR:t.resultR===null||t.resultR===undefined?null:Number(t.resultR),
      plannedRR:Number(t.plannedRR||0),riskUSD:Number(t.riskUSD||0),positionSize:Number(t.positionSize||0),initialSl:Number(t.initialSl??t.sl??0),initialTp:Number(t.initialTp??t.tp??0),riskDistance:Number(t.riskDistance??Math.abs(Number(t.entry||0)-Number(t.initialSl??t.sl??0))),
      quality:t.quality||'unrated',review:t.review||{reviewed:false,lesson:'',mistake:'',emotion:'',updatedAt:null},
      strategySnapshot:t.strategySnapshot||null,modifications:Array.isArray(t.modifications)?t.modifications:[],media:t.media||{before:null,after:null}
    }));
    return merged;
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
    document.documentElement.dataset.density=state.preferences.density||'comfortable';
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
  function balancesByCurrency(){const map={};state.accounts.forEach(a=>map[a.currency]=(map[a.currency]||0)+(Number(a.balance)||0));return map}
  function totalBalanceLabel(){const entries=Object.entries(balancesByCurrency());if(!entries.length)return '—';return entries.map(([c,v])=>fmtMoney(v,c)).join(' · ')}
  function hasPremiumAccess(){
    if(!BILLING_ENABLED) return true;
    const plan=String(accountProfile?.plan||'free').toLowerCase();
    return ['pro','premium','lifetime','admin','demo'].includes(plan);
  }
  function strategyNameForTrade(t){return t.strategySnapshot?.name||strategyById(t.strategyId)?.name||'Stratégie supprimée'}
  function tradeResult(t){if(t.status==='open')return 'open';const r=Number(t.resultR);return r>0?'win':r<0?'loss':'be'}
  function qualityLabel(q){return q==='good'?'Bon trade':q==='bad'?'Mauvais trade':'Non évalué'}
  function weekStartIndex(){return state.preferences.weekStart==='saturday'?6:state.preferences.weekStart==='sunday'?0:1}
  function startOfWeek(ref){const d=new Date(ref);d.setHours(0,0,0,0);const target=weekStartIndex();const delta=(d.getDay()-target+7)%7;d.setDate(d.getDate()-delta);return d}
  function shiftPeriod(ref,period,delta){const d=new Date(ref);if(period==='week')d.setDate(d.getDate()+delta*7);else if(period==='month')d.setMonth(d.getMonth()+delta);else if(period==='quarter')d.setMonth(d.getMonth()+delta*3);else if(period==='year')d.setFullYear(d.getFullYear()+delta);return d}
  function periodTitle(period,ref=new Date()){
    const {start,end}=rangeFor(period,ref);
    if(period==='week')return `${start.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})} – ${end.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})}`;
    if(period==='month')return start.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    if(period==='quarter')return `T${Math.floor(start.getMonth()/3)+1} ${start.getFullYear()}`;
    if(period==='year')return String(start.getFullYear());
    return 'Historique';
  }
  function sortTrades(list,sort='newest'){
    const a=[...list];
    if(sort==='oldest')a.sort((x,y)=>new Date(x.openedAt)-new Date(y.openedAt));
    else if(sort==='pnl-desc')a.sort((x,y)=>(Number(y.pnl)||0)-(Number(x.pnl)||0));
    else if(sort==='pnl-asc')a.sort((x,y)=>(Number(x.pnl)||0)-(Number(y.pnl)||0));
    else if(sort==='r-desc')a.sort((x,y)=>(Number(y.resultR)||0)-(Number(x.resultR)||0));
    else a.sort((x,y)=>new Date(y.openedAt)-new Date(x.openedAt));
    return a;
  }
  function filterTrades(list,filters){
    const q=String(filters.query||'').trim().toLowerCase();
    return sortTrades(list.filter(t=>{
      const account=accountById(t.accountId),strategy=strategyNameForTrade(t),res=tradeResult(t);
      if(filters.account!=='all'&&t.accountId!==filters.account)return false;
      if(filters.strategy!=='all'&&t.strategyId!==filters.strategy)return false;
      if(filters.status!=='all'&&t.status!==filters.status)return false;
      if(filters.result!=='all'&&res!==filters.result)return false;
      if(q&&!`${t.asset} ${t.direction} ${account?.name||''} ${strategy} ${t.note||''}`.toLowerCase().includes(q))return false;
      return true;
    }),filters.sort);
  }
  function downloadFile(name,content,type='application/json'){
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)
  }
  function paginate(list,page,size=PAGE_SIZE){const pages=Math.max(1,Math.ceil(list.length/size)),safe=Math.min(Math.max(1,page),pages);return {items:list.slice((safe-1)*size,safe*size),page:safe,pages,total:list.length}}
  function pagerHtml(meta,prefix){if(meta.pages<=1)return '';return `<div class="pager"><button class="btn" data-${prefix}-page="${meta.page-1}" ${meta.page<=1?'disabled':''}>←</button><span>Page ${meta.page} / ${meta.pages}</span><button class="btn" data-${prefix}-page="${meta.page+1}" ${meta.page>=meta.pages?'disabled':''}>→</button></div>`}
  function blobToDataUrl(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob)})}
  function compressTradeImage(file,maxWidth=1800,quality=.82){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,maxWidth/img.width),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);c.toBlob(b=>b?res(b):rej(new Error('Compression impossible')),'image/jpeg',quality)};img.onerror=rej;img.src=r.result};r.onerror=rej;r.readAsDataURL(file)})}
  async function uploadTradeMedia(tradeId,kind,file){
    const t=state.trades.find(x=>x.id===tradeId);if(!t||!file)return;try{toast('Compression de la capture…');const blob=await compressTradeImage(file);t.media=t.media||{before:null,after:null};if(currentUser&&supabase){const path=`${currentUser.id}/${tradeId}/${kind}.jpg`;const {error}=await supabase.storage.from('trade-media').upload(path,blob,{contentType:'image/jpeg',upsert:true});if(error)throw error;t.media[kind]={type:'storage',path}}else{t.media[kind]={type:'data',dataUrl:await blobToDataUrl(blob)}}save();toast('Capture enregistrée.','success');openTradeDetails(tradeId)}catch(e){console.warn(e);toast(e.message||'Impossible d’enregistrer la capture.','error')}}
  async function mediaUrl(ref){if(!ref)return null;if(ref.type==='data')return ref.dataUrl||null;if(ref.type==='storage'&&supabase){const {data,error}=await supabase.storage.from('trade-media').createSignedUrl(ref.path,3600);if(error)return null;return data?.signedUrl||null}return null}
  async function hydrateTradeMedia(t){for(const kind of ['before','after']){const img=$(`#trade-media-${kind}`),empty=$(`#trade-media-${kind}-empty`);if(!img)continue;const url=await mediaUrl(t.media?.[kind]);if(url){img.src=url;img.hidden=false;if(empty)empty.hidden=true}else{img.hidden=true;if(empty)empty.hidden=false}}}

  function nextAction(){
    if(!state.accounts.length)return {title:'Créer un compte de trading',sub:'Ajoutez votre premier compte avant de journaliser une position.',action:'accounts'};
    if(!state.strategies.some(s=>s.active&&!s.archived))return {title:'Configurer votre stratégie',sub:'ALTITUDE OS vérifiera ensuite votre checklist avant chaque trade.',action:'strategies'};
    const open=openTrades();if(open.length)return {title:`Gérer ${open.length} position${open.length>1?'s':''} ouverte${open.length>1?'s':''}`,sub:'Enregistrez une sortie partielle, une clôture ou un ajustement.',action:'journal'};
    const key=currentWeekKey(),review=state.weeklyReviews[key];if(closedTrades().length&&review&&!review.completed)return {title:'Continuer la revue hebdomadaire',sub:'Transformez vos trades en règles actionnables.',action:'weekly'};
    return {title:'Préparer un nouveau trade',sub:'Choisissez un compte, votre stratégie et confirmez votre plan.',action:'new-trade'};
  }
  function drawdownSeries(trades){let equity=0,peak=0;return trades.filter(t=>t.status==='closed').slice().sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt)).map(t=>{equity+=Number(t.pnl)||0;peak=Math.max(peak,equity);return equity-peak})}
  function strategyBreakdown(trades){
    const map=new Map();trades.filter(t=>t.status==='closed').forEach(t=>{const key=t.strategyId||'none',x=map.get(key)||{name:strategyNameForTrade(t),trades:[],pnl:0,r:0};x.trades.push(t);x.pnl+=Number(t.pnl)||0;x.r+=Number(t.resultR)||0;map.set(key,x)});return [...map.values()].sort((a,b)=>b.pnl-a.pnl)
  }


  function rangeFor(period, ref=new Date()){
    const end=new Date(ref); let start;
    if(period==='week'){
      start=startOfWeek(ref);end.setTime(start.getTime());end.setDate(end.getDate()+6);end.setHours(23,59,59,999);
    }else if(period==='month'){
      start=new Date(ref.getFullYear(),ref.getMonth(),1);end.setFullYear(ref.getFullYear(),ref.getMonth()+1,0);end.setHours(23,59,59,999);
    }else if(period==='quarter'){
      const q=Math.floor(ref.getMonth()/3)*3;start=new Date(ref.getFullYear(),q,1);end.setFullYear(ref.getFullYear(),q+3,0);end.setHours(23,59,59,999);
    }else if(period==='year'){
      start=new Date(ref.getFullYear(),0,1);end.setFullYear(ref.getFullYear(),11,31);end.setHours(23,59,59,999);
    }else if(period==='7d'){
      end.setHours(23,59,59,999);start=new Date(end);start.setDate(start.getDate()-6);start.setHours(0,0,0,0);
    }else if(period==='30d'){
      end.setHours(23,59,59,999);start=new Date(end);start.setDate(start.getDate()-29);start.setHours(0,0,0,0);
    }else {start=new Date(0);end.setHours(23,59,59,999)}
    return {start,end};
  }

  function tradesInPeriod(period='month',accountId='all',ref=new Date()){
    if(period==='last20'){
      return closedTrades().filter(t=>accountId==='all'||t.accountId===accountId).slice().sort((a,b)=>new Date(b.closedAt||b.openedAt)-new Date(a.closedAt||a.openedAt)).slice(0,20).reverse();
    }
    if(period==='all')return state.trades.filter(t=>accountId==='all'||t.accountId===accountId);
    const {start,end}=rangeFor(period,ref);return state.trades.filter(t=>{const d=new Date(t.closedAt||t.openedAt);return d>=start&&d<=end&&(accountId==='all'||t.accountId===accountId)})
  }

  function statsFor(trades){
    const c=trades.filter(t=>t.status==='closed'),wins=c.filter(t=>Number(t.resultR)>0),losses=c.filter(t=>Number(t.resultR)<0),be=c.filter(t=>Number(t.resultR)===0);
    const pnl=c.reduce((s,t)=>s+(Number(t.pnl)||0),0),totalR=c.reduce((s,t)=>s+(Number(t.resultR)||0),0),grossWin=wins.reduce((s,t)=>s+Math.max(0,Number(t.pnl)||0),0),grossLoss=Math.abs(losses.reduce((s,t)=>s+Math.min(0,Number(t.pnl)||0),0));
    let equity=0,peak=0,maxDD=0,winStreak=0,lossStreak=0,bestWin=0,worstLoss=0;
    c.slice().sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt)).forEach(t=>{equity+=Number(t.pnl)||0;peak=Math.max(peak,equity);maxDD=Math.min(maxDD,equity-peak);if(Number(t.resultR)>0){winStreak++;lossStreak=0;bestWin=Math.max(bestWin,winStreak)}else if(Number(t.resultR)<0){lossStreak++;winStreak=0;worstLoss=Math.max(worstLoss,lossStreak)}else{winStreak=lossStreak=0}});
    const rated=c.filter(t=>t.quality==='good'||t.quality==='bad'),good=rated.filter(t=>t.quality==='good').length;
    return {closed:c.length,wins:wins.length,losses:losses.length,be:be.length,pnl,totalR,winRate:c.length?wins.length/c.length*100:0,avgR:c.length?totalR/c.length:0,expectancyR:c.length?totalR/c.length:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),maxDrawdown:maxDD,bestWinStreak:bestWin,worstLossStreak:worstLoss,qualityRate:rated.length?good/rated.length*100:null,rated:rated.length}
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
  function periodTabs(active=dashboardPeriod,attr='data-period'){
    return `<div class="period-tabs">${[['week','Semaine'],['month','Mois'],['quarter','Trimestre'],['year','Année']].map(([v,l])=>`<button class="${active===v?'active':''}" ${attr}="${v}">${l}</button>`).join('')}</div>`
  }

  function lineChart(values){
    if(!values.length)return `<div class="empty" style="height:180px;display:grid;place-items:center">Aucune donnée pour cette période.</div>`;
    const w=640,h=180,p=12,min=Math.min(0,...values),max=Math.max(1,...values),span=max-min||1;const pts=values.map((v,i)=>`${p+(i/(Math.max(values.length-1,1)))*(w-p*2)},${h-p-((v-min)/span)*(h-p*2)}`).join(' ');
    return `<svg class="line-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--success)" stop-opacity=".25"/><stop offset="1" stop-color="var(--success)" stop-opacity="0"/></linearGradient></defs>${[.25,.5,.75].map(r=>`<line class="chart-grid-line" x1="0" x2="${w}" y1="${h*r}" y2="${h*r}"/>`).join('')}<polygon class="chart-area" points="${p},${h-p} ${pts} ${w-p},${h-p}"/><polyline class="chart-line" points="${pts}"/></svg>`
  }
  function bars(trades){const c=trades.filter(t=>t.status==='closed').slice(-26);if(!c.length)return `<div class="empty" style="height:130px">Aucun trade clôturé.</div>`;const max=Math.max(1,...c.map(t=>Math.abs(Number(t.resultR)||0)));return `<div class="performance-bars">${c.map(t=>`<span class="bar ${(t.resultR||0)<0?'neg':''}" style="height:${24+Math.abs(t.resultR||0)/max*80}px" title="${fmtR(t.resultR)}"></span>`).join('')}</div>`}

  function renderDashboard(){
    const el=$('#view-dashboard');if(!el)return;
    const acc=primaryAccount(),periodTrades=tradesInPeriod(dashboardPeriod),st=statsFor(periodTrades),open=openTrades(),recent=sortTrades(state.trades,'newest').slice(0,6),series=equitySeries(periodTrades.filter(t=>t.status==='closed')),action=nextAction(),risk=accountRiskUSD(acc);
    el.innerHTML=`
      <div class="dashboard-welcome">
        <div><p class="eyebrow">ALTITUDE OS · ${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</p><h1>Bonsoir, ${esc(displayName())}.</h1><p class="dashboard-intro">Un espace calme pour exécuter votre plan, mesurer vos décisions et progresser.</p></div>
        <button class="next-action" id="dashboard-next-action"><span>PROCHAINE ACTION</span><strong>${esc(action.title)}</strong><small>${esc(action.sub)}</small></button>
      </div>
      <div class="dashboard-primary">
        <section class="card account-focus">
          <div class="card-head"><div><div class="card-label">Compte principal</div><div class="card-title">${esc(acc?.name||'Aucun compte')}</div></div><button class="btn btn-ghost" id="dash-manage-accounts">Gérer</button></div>
          <div class="account-focus-balance">${acc?fmtMoney(acc.balance,acc.currency):'—'}</div>
          <div class="account-focus-meta">
            <div><span>Risque / trade</span><strong>${acc?(acc.riskMode==='percent'?`${fmtPct(acc.riskValue)} · ${fmtMoney(risk,acc.currency)}`:fmtMoney(acc.riskValue,acc.currency)):'—'}</strong></div>
            <div><span>PnL ${dashboardPeriod==='week'?'semaine':dashboardPeriod==='month'?'mois':dashboardPeriod==='quarter'?'trimestre':'année'}</span><strong class="${st.pnl>=0?'up':'down'}">${fmtMoney(st.pnl,acc?.currency||'USD')}</strong></div>
            <div><span>Win rate</span><strong>${st.closed?fmtPct(st.winRate):'—'}</strong></div>
            <div><span>Qualité</span><strong>${st.qualityRate===null?'—':fmtPct(st.qualityRate)}</strong></div>
          </div>
        </section>
        <section class="card open-focus">
          <div class="card-head"><div><div class="card-label">En cours</div><div class="card-title">Positions ouvertes</div></div><span class="pill">${open.length}</span></div>
          ${open.length?open.slice(0,3).map(openPositionCompact).join(''):`<div class="quiet-empty">Aucune position ouverte.<br><span>Votre prochaine position commencera par votre checklist.</span></div>`}
          <button class="btn btn-primary" id="dash-new-trade" style="width:100%;margin-top:12px">+ Préparer un trade</button>
        </section>
      </div>
      <div class="dashboard-secondary">
        <section class="card performance-calm"><div class="card-head"><div><div class="card-title">Progression</div><div class="page-sub">PnL cumulé · uniquement vos trades clôturés</div></div>${periodTabs(dashboardPeriod,'data-dashboard-period')}</div>${lineChart(series)}<div class="stat-line"><span><b>${st.closed}</b> trades</span><span><b>${st.closed?st.avgR.toFixed(2):'—'}</b> R moyen</span><span><b>${Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—')}</b> profit factor</span><span><b>${fmtMoney(st.maxDrawdown,acc?.currency||'USD')}</b> drawdown max</span></div></section>
        <section class="card"><div class="card-head"><div><div class="card-title">Derniers trades</div><div class="page-sub">Les plus récents, tous comptes confondus</div></div><button class="btn btn-ghost" id="dash-all-trades">Voir le journal</button></div>${recent.length?tradeRows(recent,true):`<div class="quiet-empty">Votre journal est encore vide.</div>`}</section>
      </div>`;
    $$('[data-dashboard-period]').forEach(b=>b.onclick=()=>{dashboardPeriod=b.dataset.dashboardPeriod;renderDashboard()});
    $('#dash-manage-accounts')?.addEventListener('click',()=>setView('accounts'));$('#dash-all-trades')?.addEventListener('click',()=>setView('journal'));$('#dash-new-trade')?.addEventListener('click',openNewTrade);$('#dashboard-next-action')?.addEventListener('click',()=>action.action==='new-trade'?openNewTrade():setView(action.action));$$('[data-open-trade]').forEach(b=>b.onclick=()=>openCloseTradeModal(b.dataset.openTrade));$$('[data-trade-id]').forEach(b=>b.onclick=()=>openTradeDetails(b.dataset.tradeId));
  }

  function metric(label,value,sub,positive=true){return `<div class="card metric-card"><div class="metric-top"><div class="card-label">${esc(label)}</div></div><div class="card-value" style="margin-top:16px">${value}</div><div class="metric-change ${positive?'up':''}">${esc(sub)}</div></div>`}
  function smallMetric(label,value){return `<div><div class="card-label">${esc(label)}</div><div class="mono" style="margin-top:4px;font-size:14px;font-weight:700">${value}</div></div>`}
  function openPositionCompact(t){const acc=accountById(t.accountId);return `<div class="account-row" style="grid-template-columns:1fr .65fr auto"><div><div class="row-main">${esc(t.asset)} <span class="pill ${t.direction==='BUY'?'success':'danger'}">${t.direction}</span></div><div class="row-sub">${esc(acc?.name||'Compte')} · ${esc(strategyById(t.strategyId)?.name||'Sans stratégie')}</div></div><div class="mono">${fmtMoney(t.realizedPnl||0,acc?.currency||'USD')}</div><button class="btn" data-open-trade="${t.id}">Gérer</button></div>`}

  function renderAccounts(){
    const el=$('#view-accounts');if(!el)return;const primary=primaryAccount();
    el.innerHTML=`${pageHead('Comptes de trading','Chaque compte conserve son propre solde, son risque et son historique.','<button class="btn btn-primary" id="add-account">+ Ajouter un compte</button>')}
      <div class="account-summary card"><div><span>Capital total</span><strong>${totalBalanceLabel()}</strong></div><div><span>Comptes</span><strong>${state.accounts.length}</strong></div><div><span>Compte actif</span><strong>${esc(primary?.name||'—')}</strong></div></div>
      <div class="account-cards">${state.accounts.map(a=>{const ast=statsFor(state.trades.filter(t=>t.accountId===a.id));return `<article class="card account-card"><div class="card-head"><div><div class="row-main"><span class="account-dot" style="background:${a.color}"></span>${esc(a.name)} ${a.active?'<span class="pill success">Principal</span>':''}</div><div class="row-sub">${esc(a.broker||'Courtier non renseigné')} · ${a.accountType==='prop'?'Prop firm':a.accountType==='demo'?'Démo':'Personnel'}</div></div><button class="btn" data-edit-account="${a.id}">Modifier</button></div><div class="account-balance-total">${fmtMoney(a.balance,a.currency)}</div><div class="account-card-stats"><span>Risque <b>${a.riskMode==='percent'?`${fmtPct(a.riskValue)} (${fmtMoney(accountRiskUSD(a),a.currency)})`:fmtMoney(a.riskValue,a.currency)}</b></span><span>PnL journal <b class="${ast.pnl>=0?'up':'down'}">${fmtMoney(ast.pnl,a.currency)}</b></span><span>Trades <b>${ast.closed}</b></span></div>${a.balanceAdjustments.length?`<div class="row-sub">Dernier ajustement : ${fmtDateTime(a.balanceAdjustments.at(-1).at)} · ${a.balanceAdjustments.at(-1).delta>=0?'+':''}${fmtMoney(a.balanceAdjustments.at(-1).delta,a.currency)}</div>`:''}</article>`}).join('')}</div>`;
    $('#add-account').onclick=()=>openAccountModal();$$('[data-edit-account]').forEach(b=>b.onclick=()=>openAccountModal(b.dataset.editAccount));
  }

  function openAccountModal(id=null){
    const a=id?accountById(id):null;
    showModal(`<div class="modal-head"><div><div class="modal-title">${a?'Modifier le compte':'Ajouter un compte'}</div><div class="modal-sub">Le solde et le risque alimentent automatiquement les prochains calculs. Les anciens trades gardent leur risque historique.</div></div><button class="close-btn" data-close-modal>×</button></div>
      <div class="form-grid"><div class="field"><label>Nom du compte</label><input id="acc-name" value="${esc(a?.name||'')}"></div><div class="field"><label>Courtier / Prop firm</label><input id="acc-broker" value="${esc(a?.broker||'')}"></div><div class="field"><label>Type</label><select id="acc-type"><option value="personal">Personnel</option><option value="prop">Prop firm</option><option value="demo">Démo</option></select></div><div class="field"><label>Devise</label><select id="acc-currency"><option>USD</option><option>EUR</option><option>GBP</option><option>CHF</option><option>CAD</option></select></div><div class="field"><label>Solde actuel</label><input id="acc-balance" inputmode="decimal" value="${a?.balance??''}"></div><div class="field"><label>Mode de risque</label><select id="acc-risk-mode"><option value="fixed">Montant fixe</option><option value="percent">Pourcentage du solde</option></select></div><div class="field"><label>Risque par trade</label><input id="acc-risk" inputmode="decimal" value="${a?.riskValue??10}"></div>${a?'<div class="field"><label>Motif si le solde change</label><input id="acc-adjust-reason" placeholder="Dépôt, retrait, correction…"></div>':''}</div>
      <label class="check-row"><input type="checkbox" id="acc-active" ${a?.active?'checked':''}><span>Définir comme compte principal</span></label>
      <div class="modal-footer">${a?'<button class="btn btn-danger" id="delete-account-item">Supprimer</button>':''}<button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-account">Enregistrer</button></div>`);
    $('#acc-currency').value=a?.currency||'USD';$('#acc-risk-mode').value=a?.riskMode||'fixed';$('#acc-type').value=a?.accountType||'personal';
    $('#save-account').onclick=()=>{const name=$('#acc-name').value.trim(),balance=num($('#acc-balance').value),risk=num($('#acc-risk').value);if(!name||!Number.isFinite(balance)||balance<0||!Number.isFinite(risk)||risk<0){toast('Vérifiez le nom, le solde et le risque.','error');return}if($('#acc-active').checked)state.accounts.forEach(x=>x.active=false);const oldBalance=Number(a?.balance||0);const obj={id:a?.id||uid('acc'),name,broker:$('#acc-broker').value.trim(),accountType:$('#acc-type').value,currency:$('#acc-currency').value,initialBalance:a?.initialBalance??balance,balance,riskMode:$('#acc-risk-mode').value,riskValue:risk,active:$('#acc-active').checked||(!a&&!state.accounts.some(x=>x.active)),color:a?.color||['#2fd3a0','#4aa4ff','#a565ff','#e7ad4d'][state.accounts.length%4],balanceAdjustments:[...(a?.balanceAdjustments||[])],createdAt:a?.createdAt||new Date().toISOString()};if(a&&Math.abs(balance-oldBalance)>.000001)obj.balanceAdjustments.push({at:new Date().toISOString(),from:oldBalance,to:balance,delta:Number((balance-oldBalance).toFixed(2)),reason:$('#acc-adjust-reason').value.trim()||'Ajustement manuel'});if(a)Object.assign(a,obj);else state.accounts.push(obj);save();hideModal();renderAll();toast('Compte enregistré.','success')};
    $('#delete-account-item')?.addEventListener('click',()=>{if(state.accounts.length<=1){toast('Conservez au moins un compte de trading.','error');return}if(openTrades().some(t=>t.accountId===id)){toast('Clôturez les positions ouvertes de ce compte avant de le supprimer.','error');return}confirmDialog({title:'Supprimer ce compte ?',text:'Les trades historiques seront conservés avec le nom mémorisé dans leurs données, mais le compte ne sera plus disponible.',confirmLabel:'Supprimer',danger:true,onConfirm:()=>{state.accounts=state.accounts.filter(x=>x.id!==id);if(!state.accounts.some(x=>x.active)&&state.accounts[0])state.accounts[0].active=true;save();renderAll();toast('Compte supprimé.','success')}})});
  }

  function renderStrategies(){
    const el=$('#view-strategies');if(!el)return;
    if(!hasPremiumAccess()){el.innerHTML=`${pageHead('Stratégies','Le Strategy Builder est inclus dans ALTITUDE OS Premium.')}<div class="card premium-gate"><p class="eyebrow">PREMIUM</p><h2>Construisez votre propre méthode.</h2><p>Configurez vos conditions d’entrée, confirmations, risque et sorties. ALTITUDE OS ne fournit aucune stratégie de trading.</p><button class="btn btn-primary" disabled>Abonnement Premium requis</button></div>`;return}
    const list=state.strategies.filter(s=>!s.archived);
    el.innerHTML=`${pageHead('Stratégies','Votre méthode vous appartient. ALTITUDE OS ne fournit aucune stratégie préchargée.','<button class="btn btn-primary" id="new-strategy">+ Nouvelle stratégie</button>')}<div class="strategy-intro card"><div><p class="eyebrow">STRATEGY BUILDER</p><h2>Transformez votre plan en checklist.</h2><p>À chaque nouveau trade, vous devrez confirmer vos propres règles avant d’accéder au calcul de risque.</p></div><div class="strategy-count"><strong>${list.length}</strong><span>stratégie${list.length>1?'s':''}</span></div></div>${list.length?`<div class="grid">${list.map(st=>`<div class="card"><div class="strategy-row"><div><div class="row-main">${esc(st.name)} ${st.active?'<span class="pill success">Active</span>':'<span class="pill">Inactive</span>'}</div><div class="row-sub">${esc(st.description||'Aucune description')}</div>${st.marketScope||st.timeframe?`<div class="row-sub">${esc(st.marketScope||'Tous marchés')} ${st.timeframe?'· '+esc(st.timeframe):''}</div>`:''}</div><div><div class="row-sub">Règles</div><div class="mono">${strategyRules(st).length}</div></div><div><div class="row-sub">Trades</div><div class="mono">${state.trades.filter(t=>t.strategyId===st.id).length}</div></div><button class="btn" data-edit-strategy="${st.id}">Modifier</button></div></div>`).join('')}</div>`:`<div class="card quiet-empty"><strong>Aucune stratégie configurée.</strong><span>Créez votre méthode, puis ALTITUDE OS vous demandera de la confirmer avant chaque position.</span><button class="btn btn-primary" id="empty-new-strategy">Créer ma stratégie</button></div>`}`;
    $('#new-strategy').onclick=()=>openStrategyModal();$('#empty-new-strategy')?.addEventListener('click',()=>openStrategyModal());$$('[data-edit-strategy]').forEach(b=>b.onclick=()=>openStrategyModal(b.dataset.editStrategy));
  }

  function strategyRules(s){return [...(s.entryRules||[]),...(s.confirmations||[]),...(s.riskRules||[]),...(s.exitRules||[])]}
  function openStrategyModal(id=null){
    const original=id?strategyById(id):null,s=original||{name:'',description:'',marketScope:'',timeframe:'',tags:[],entryRules:[],confirmations:[],riskRules:[],exitRules:[],active:true};
    showModal(`<div class="modal-head"><div><div class="modal-title">${id?'Modifier la stratégie':'Nouvelle stratégie'}</div><div class="modal-sub">Définissez uniquement vos règles. ALTITUDE OS n’invente aucun signal.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Nom</label><input id="strat-name" value="${esc(s.name)}" placeholder="Ex. Breakout London"></div><div class="field"><label>Description</label><input id="strat-desc" value="${esc(s.description||'')}" placeholder="Une phrase pour reconnaître ce plan"></div><div class="field"><label>Marchés concernés</label><input id="strat-market" value="${esc(s.marketScope||'')}" placeholder="Ex. XAUUSD, NAS100"></div><div class="field"><label>Unité(s) de temps</label><input id="strat-timeframe" value="${esc(s.timeframe||'')}" placeholder="Ex. H1 / M15 / M5"></div></div><div class="strategy-builder">${ruleEditor('Conditions d’entrée','entryRules',s.entryRules)}${ruleEditor('Confirmations','confirmations',s.confirmations)}${ruleEditor('Règles de risque','riskRules',s.riskRules)}${ruleEditor('Validation & sortie','exitRules',s.exitRules)}</div><label class="check-row"><input id="strat-active" type="checkbox" ${s.active?'checked':''}><span>Disponible pour de nouveaux trades</span></label><div class="modal-footer">${id?'<button class="btn" id="archive-strategy">Archiver</button>':''}<button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-strategy">Enregistrer</button></div>`,true);
    const working={entryRules:[...(s.entryRules||[])],confirmations:[...(s.confirmations||[])],riskRules:[...(s.riskRules||[])],exitRules:[...(s.exitRules||[])]};
    function bindRuleEditors(){$$('[data-add-rule]').forEach(b=>b.onclick=()=>{const key=b.dataset.addRule,input=$(`[data-rule-input="${key}"]`),v=input.value.trim();if(v){working[key].push(v);input.value='';refreshRules(key)}});$$('[data-remove-rule]').forEach(b=>b.onclick=()=>{const [key,idx]=b.dataset.removeRule.split(':');working[key].splice(Number(idx),1);refreshRules(key)})}
    function refreshRules(key){const box=$(`[data-rule-list="${key}"]`);box.innerHTML=working[key].map((r,i)=>`<div class="rule-line"><span>${esc(r)}</span><button data-remove-rule="${key}:${i}">×</button></div>`).join('')||'<div class="row-sub">Aucune règle</div>';bindRuleEditors()}
    ['entryRules','confirmations','riskRules','exitRules'].forEach(refreshRules);
    $('#save-strategy').onclick=()=>{const name=$('#strat-name').value.trim();if(!name){toast('Donnez un nom à la stratégie.','error');return}const obj={id:s.id||uid('strat'),name,description:$('#strat-desc').value.trim(),marketScope:$('#strat-market').value.trim(),timeframe:$('#strat-timeframe').value.trim(),tags:s.tags||[],...working,active:$('#strat-active').checked,archived:false,createdAt:s.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};if(id)Object.assign(original,obj);else state.strategies.push(obj);save();hideModal();renderAll();toast('Stratégie enregistrée.','success')};
    $('#archive-strategy')?.addEventListener('click',()=>confirmDialog({title:'Archiver cette stratégie ?',text:'Elle disparaîtra des nouveaux trades, mais restera attachée à l’historique existant.',confirmLabel:'Archiver',onConfirm:()=>{original.archived=true;original.active=false;save();renderAll();toast('Stratégie archivée.','success')}}));
  }

  function ruleEditor(title,key,rules=[]){return `<div class="rule-block"><h4>${esc(title)}</h4><div class="rule-list" data-rule-list="${key}"></div><div class="new-rule-row"><input class="input" data-rule-input="${key}" placeholder="Ajouter une règle…"><button class="btn" data-add-rule="${key}">+</button></div></div>`}

  function renderJournal(){
    const el=$('#view-journal');if(!el)return;const filtered=filterTrades(state.trades,journalFilters),pg=paginate(filtered,journalPage);journalPage=pg.page;
    el.innerHTML=`${pageHead('Journal','Vos positions récentes et votre exécution, sans mélanger avec les archives par période.','<button class="btn btn-primary" id="journal-new">+ Nouveau trade</button>')}
      <div class="card filter-bar"><input id="journal-query" class="input" placeholder="Rechercher actif, note, compte…" value="${esc(journalFilters.query)}"><select id="journal-account"><option value="all">Tous les comptes</option>${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><select id="journal-strategy"><option value="all">Toutes les stratégies</option>${state.strategies.map(st=>`<option value="${st.id}">${esc(st.name)}</option>`).join('')}</select><select id="journal-status"><option value="all">Ouverts + clôturés</option><option value="open">Ouverts</option><option value="closed">Clôturés</option></select><select id="journal-result"><option value="all">Tous résultats</option><option value="win">Gagnants</option><option value="loss">Perdants</option><option value="be">Break-even</option></select><select id="journal-sort"><option value="newest">Plus récents</option><option value="oldest">Plus anciens</option><option value="pnl-desc">PnL décroissant</option><option value="r-desc">R décroissant</option></select></div>
      <div class="card"><div class="card-head"><div><div class="card-title">Trades</div><div class="page-sub">${filtered.length} résultat${filtered.length>1?'s':''}</div></div></div>${pg.items.length?tradeRows(pg.items,false):`<div class="quiet-empty">Aucun trade ne correspond à ces filtres.</div>`}${pagerHtml(pg,'journal')}</div>`;
    $('#journal-new').onclick=openNewTrade;$('#journal-account').value=journalFilters.account;$('#journal-strategy').value=journalFilters.strategy;$('#journal-status').value=journalFilters.status;$('#journal-result').value=journalFilters.result;$('#journal-sort').value=journalFilters.sort;
    $('#journal-query').oninput=e=>{journalFilters.query=e.target.value;journalPage=1;renderJournal()};['account','strategy','status','result','sort'].forEach(k=>$(`#journal-${k}`).onchange=e=>{journalFilters[k]=e.target.value;journalPage=1;renderJournal()});$$('[data-journal-page]').forEach(b=>b.onclick=()=>{journalPage=Number(b.dataset.journalPage);renderJournal()});$$('[data-trade-id]').forEach(b=>b.onclick=()=>openTradeDetails(b.dataset.tradeId));
  }

  function tradeRows(trades,compact=false){
    return `<div class="history-row row-head"><span>Date</span><span>Actif</span><span>Direction</span><span>Compte</span><span>PnL</span><span>R</span><span>Qualité</span><span></span></div>${trades.map(t=>{const a=accountById(t.accountId);return `<div class="history-row"><span>${fmtDate(t.openedAt)}</span><span><b class="row-main">${esc(t.asset)}</b><small class="row-sub">${esc(strategyNameForTrade(t))}</small></span><span class="${t.direction==='BUY'?'up':'down'}">${t.direction}</span><span>${esc(a?.name||t.accountNameSnapshot||'Compte supprimé')}</span><span class="mono ${t.status==='open'?'':(t.pnl||0)>=0?'up':'down'}">${t.status==='open'?'Ouvert':fmtMoney(t.pnl,a?.currency||t.currencySnapshot||'USD')}</span><span class="mono">${t.status==='open'?'—':fmtR(t.resultR)}</span><span>${t.status==='open'?'<span class="pill">En cours</span>':`<span class="pill ${t.quality==='good'?'success':t.quality==='bad'?'danger':''}">${qualityLabel(t.quality)}</span>`}</span><button class="btn" data-trade-id="${t.id}">${t.status==='open'?'Gérer':'Voir'}</button></div>`}).join('')}`
  }

  function openNewTrade(){
    if(!state.accounts.length){toast('Ajoutez d’abord un compte de trading.','error');setView('accounts');return}
    const strats=state.strategies.filter(st=>st.active&&!st.archived&&strategyRules(st).length);
    if(!strats.length){toast('Créez au moins une stratégie active contenant des règles.','error');setView('strategies');return}
    const acc=primaryAccount();showModal(`<div class="modal-head"><div><div class="modal-title">Préparer un trade</div><div class="modal-sub">Étape 1 sur 3 · Compte, marché et plan</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Compte</label><select id="trade-account">${state.accounts.map(a=>`<option value="${a.id}" ${a.id===acc?.id?'selected':''}>${esc(a.name)} · ${fmtMoney(a.balance,a.currency)}</option>`).join('')}</select></div><div class="field"><label>Stratégie</label><select id="trade-strategy">${strats.map(st=>`<option value="${st.id}">${esc(st.name)}</option>`).join('')}</select></div><div class="field"><label>Actif / marché</label><input id="trade-asset" placeholder="Ex. XAUUSD, BTCUSD, NAS100"></div><div class="field"><label>Direction</label><select id="trade-direction"><option value="BUY">Long / BUY</option><option value="SELL">Short / SELL</option></select></div></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="trade-next">Continuer</button></div>`);
    $('#trade-next').onclick=()=>{const asset=$('#trade-asset').value.trim().toUpperCase();if(!asset){toast('Renseignez l’actif.','error');return}const strategy=strategyById($('#trade-strategy').value);const draft={accountId:$('#trade-account').value,strategyId:strategy.id,asset,direction:$('#trade-direction').value,strategySnapshot:{id:strategy.id,name:strategy.name,description:strategy.description,entryRules:[...strategy.entryRules],confirmations:[...strategy.confirmations],riskRules:[...strategy.riskRules],exitRules:[...strategy.exitRules]}};openStrategyConfirmation(draft)}
  }

  function openStrategyConfirmation(draft){
    const st=draft.strategySnapshot,groups=[['Conditions d’entrée',st.entryRules],['Confirmations',st.confirmations],['Risque',st.riskRules],['Sortie',st.exitRules]],rules=groups.flatMap(([group,items])=>items.map(text=>({group,text})));
    showModal(`<div class="modal-head"><div><div class="modal-title">Confirmer votre stratégie</div><div class="modal-sub">Étape 2 sur 3 · ${esc(st.name)} · ${esc(draft.asset)} · ${draft.direction}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="checklist">${groups.map(([group,items])=>items.length?`<div class="check-group"><div class="eyebrow">${esc(group)}</div>${items.map((r,i)=>`<label class="check-row"><input type="checkbox" data-strategy-check><span>${esc(r)}</span></label>`).join('')}</div>`:'').join('')}</div><div class="modal-footer"><button class="btn" id="back-trade">Retour</button><button class="btn btn-primary" id="strategy-confirm-next" disabled>Calculer le risque</button></div>`);
    const next=$('#strategy-confirm-next');$$('[data-strategy-check]').forEach(c=>c.onchange=()=>{next.disabled=!$$('[data-strategy-check]').every(x=>x.checked)});$('#back-trade').onclick=()=>{hideModal();setTimeout(openNewTrade,0)};next.onclick=()=>openRiskTrade(draft)
  }

  function openRiskTrade(draft){
    const a=accountById(draft.accountId),riskUSD=accountRiskUSD(a);showModal(`<div class="modal-head"><div><div class="modal-title">Risque & niveaux</div><div class="modal-sub">Étape 3 sur 3 · ${esc(a?.name||'Compte')} · risque par défaut ${fmtMoney(riskUSD,a?.currency||'USD')}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Entrée</label><input id="trade-entry" inputmode="decimal"></div><div class="field"><label>Stop loss</label><input id="trade-sl" inputmode="decimal"></div><div class="field"><label>Take profit</label><input id="trade-tp" inputmode="decimal"></div><div class="field"><label>Risque pour ce trade</label><input id="trade-risk-override" inputmode="decimal" value="${riskUSD.toFixed(2)}"><small>Vous pouvez l’ajuster sans modifier le risque par défaut du compte.</small></div></div><div id="risk-live"></div><div class="field"><label>Note avant trade</label><textarea id="trade-note" rows="3" placeholder="Contexte, émotion, détail à retenir…"></textarea></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="create-trade" disabled>Créer la position</button></div>`);
    ['trade-entry','trade-sl','trade-tp','trade-risk-override'].forEach(id=>$(`#${id}`).oninput=()=>updateNewTradeRisk(draft));
  }

  function updateNewTradeRisk(draft){
    const a=accountById(draft.accountId),entry=num($('#trade-entry').value),sl=num($('#trade-sl').value),tp=num($('#trade-tp').value),riskUSD=num($('#trade-risk-override').value),riskDist=Math.abs(entry-sl),reward=draft.direction==='BUY'?tp-entry:entry-tp,correct=draft.direction==='BUY'?(sl<entry&&tp>entry):(sl>entry&&tp<entry),rr=correct&&riskDist>0?reward/riskDist:0,units=riskDist>0?riskUSD/riskDist:0,valid=[entry,sl,tp,riskUSD].every(Number.isFinite)&&riskUSD>0&&correct&&riskDist>0&&reward>0;
    $('#risk-live').innerHTML=`<div class="risk-preview"><div class="risk-box"><span>Risque</span><strong>${valid?fmtMoney(riskUSD,a?.currency||'USD'):'—'}</strong></div><div class="risk-box"><span>R:R prévu</span><strong>${valid?`1:${rr.toFixed(2)}`:'—'}</strong></div><div class="risk-box"><span>Taille indicative</span><strong>${valid?units.toFixed(4):'—'}</strong></div><div class="risk-box"><span>Gain au TP</span><strong>${valid?fmtMoney(riskUSD*rr,a?.currency||'USD'):'—'}</strong></div></div>`;
    const btn=$('#create-trade');btn.disabled=!valid;btn.onclick=valid?()=>{const t={id:uid('trade'),accountId:draft.accountId,accountNameSnapshot:a.name,currencySnapshot:a.currency,strategyId:draft.strategyId,strategySnapshot:draft.strategySnapshot,asset:draft.asset,direction:draft.direction,entry,sl,tp,initialSl:sl,initialTp:tp,riskDistance:Number(riskDist.toFixed(8)),plannedRR:Number(rr.toFixed(3)),riskUSD:Number(riskUSD.toFixed(2)),positionSize:Number(units.toFixed(6)),openedAt:new Date().toISOString(),status:'open',remainingPct:100,partialExits:[],realizedPnl:0,pnl:0,resultR:null,quality:'unrated',review:{reviewed:false,lesson:'',mistake:'',emotion:'',updatedAt:null},note:$('#trade-note').value.trim(),capitalBefore:a.balance,capitalAfter:null,modifications:[]};state.trades.unshift(t);save();hideModal();renderAll();toast('Position créée dans le journal.','success');setView('journal')}:null;
  }

  function openTradeDetails(id){
    const t=state.trades.find(x=>x.id===id);if(!t)return;const a=accountById(t.accountId),currency=a?.currency||t.currencySnapshot||'USD';
    showModal(`<div class="modal-head"><div><div class="modal-title">${esc(t.asset)} · ${t.direction}</div><div class="modal-sub">${fmtDateTime(t.openedAt)} · ${esc(a?.name||t.accountNameSnapshot||'Compte supprimé')} · ${esc(strategyNameForTrade(t))}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="grid metric-grid">${smallMetric('Entrée',t.entry)}${smallMetric('SL',t.sl)}${smallMetric('TP',t.tp)}${smallMetric('Risque',fmtMoney(t.riskUSD,currency))}</div><div class="card" style="margin-top:12px"><div class="card-title">État de la position</div><div class="page-sub">${t.status==='open'?`${t.remainingPct}% de la position initiale reste ouverte · PnL réalisé ${fmtMoney(t.realizedPnl||0,currency)}`:`Clôturée ${fmtDateTime(t.closedAt)} · ${fmtMoney(t.pnl,currency)} · ${fmtR(t.resultR)} · ${qualityLabel(t.quality)}`}</div>${t.note?`<div class="trade-note">${esc(t.note)}</div>`:''}</div>
      <div class="trade-media-grid"><div class="card trade-media-card"><div class="card-head"><div><div class="card-title">Avant le trade</div><div class="page-sub">Contexte / setup</div></div><label class="btn">Ajouter<input type="file" accept="image/*" data-media-upload="before" hidden></label></div><div class="trade-media-frame"><div id="trade-media-before-empty" class="trade-media-empty">Aucune capture</div><img id="trade-media-before" hidden alt="Capture avant trade"></div></div><div class="card trade-media-card"><div class="card-head"><div><div class="card-title">Après le trade</div><div class="page-sub">Résultat / gestion</div></div><label class="btn">Ajouter<input type="file" accept="image/*" data-media-upload="after" hidden></label></div><div class="trade-media-frame"><div id="trade-media-after-empty" class="trade-media-empty">Aucune capture</div><img id="trade-media-after" hidden alt="Capture après trade"></div></div></div>
      ${t.partialExits?.length?`<div class="card" style="margin-top:12px"><div class="card-title">Historique des sorties</div>${t.partialExits.map(e=>`<div class="account-row" style="grid-template-columns:1fr .55fr .6fr"><div>${fmtDateTime(e.at)}<div class="row-sub">${esc(e.reason)}${e.note?' · '+esc(e.note):''}</div></div><div class="mono">${e.percent}%</div><div class="mono ${e.pnl>=0?'up':'down'}">${fmtMoney(e.pnl,currency)}</div></div>`).join('')}</div>`:''}${t.modifications?.length?`<div class="card" style="margin-top:12px"><div class="card-title">Modifications</div>${t.modifications.map(m=>`<div class="row-sub" style="padding:6px 0">${fmtDateTime(m.at)} · SL ${m.sl} · TP ${m.tp}${m.note?' · '+esc(m.note):''}</div>`).join('')}</div>`:''}${t.status==='closed'&&t.review?.reviewed?`<div class="card" style="margin-top:12px"><div class="card-title">Revue du trade</div><p>${esc(t.review.lesson||'')}</p>${t.review.mistake?`<div class="row-sub">Erreur / point à corriger : ${esc(t.review.mistake)}</div>`:''}</div>`:''}<div class="modal-footer">${t.status==='open'?'<button class="btn" id="edit-open-trade">Modifier SL / TP</button><button class="btn btn-primary" id="manage-open-trade">Enregistrer une sortie</button>':'<button class="btn btn-primary" id="review-closed-trade">Évaluer ce trade</button>'}</div>`,true);
    $$('[data-media-upload]').forEach(input=>input.onchange=e=>uploadTradeMedia(id,input.dataset.mediaUpload,e.target.files?.[0]));hydrateTradeMedia(t);$('#manage-open-trade')?.addEventListener('click',()=>openCloseTradeModal(id));$('#edit-open-trade')?.addEventListener('click',()=>openEditTradeModal(id));$('#review-closed-trade')?.addEventListener('click',()=>openTradeReviewModal(id));
  }

  function openEditTradeModal(id){
    const t=state.trades.find(x=>x.id===id);if(!t||t.status!=='open')return;showModal(`<div class="modal-head"><div><div class="modal-title">Modifier la position</div><div class="modal-sub">Les changements sont historisés et n’effacent pas le plan initial.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Stop loss actuel</label><input id="edit-trade-sl" inputmode="decimal" value="${t.sl}"></div><div class="field"><label>Take profit actuel</label><input id="edit-trade-tp" inputmode="decimal" value="${t.tp}"></div><div class="field" style="grid-column:1/-1"><label>Note de modification</label><input id="edit-trade-note" placeholder="Ex. sécurisation, plan ajusté…"></div></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-trade-edit">Enregistrer</button></div>`);$('#save-trade-edit').onclick=()=>{const sl=num($('#edit-trade-sl').value),tp=num($('#edit-trade-tp').value);if(!Number.isFinite(sl)||!Number.isFinite(tp)){toast('Vérifiez SL et TP.','error');return}t.sl=sl;t.tp=tp;t.modifications=t.modifications||[];t.modifications.push({at:new Date().toISOString(),sl,tp,note:$('#edit-trade-note').value.trim()});save();hideModal();renderAll();toast('Position mise à jour.','success')}
  }
  function openTradeReviewModal(id){
    const t=state.trades.find(x=>x.id===id);if(!t||t.status!=='closed')return;const r=t.review||{};showModal(`<div class="modal-head"><div><div class="modal-title">Évaluer ${esc(t.asset)}</div><div class="modal-sub">Le résultat financier et la qualité d’exécution sont deux choses différentes.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="field"><label>Qualité d’exécution</label><select id="review-quality"><option value="unrated">Non évalué</option><option value="good">Bon trade · plan respecté</option><option value="bad">Mauvais trade · plan non respecté</option></select></div><div class="field"><label>Leçon principale</label><textarea id="trade-review-lesson" rows="4">${esc(r.lesson||'')}</textarea></div><div class="field"><label>Erreur / point à corriger</label><textarea id="trade-review-mistake" rows="3">${esc(r.mistake||'')}</textarea></div><div class="field"><label>État émotionnel / contexte</label><input id="trade-review-emotion" value="${esc(r.emotion||'')}"></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-trade-review">Enregistrer la revue</button></div>`);$('#review-quality').value=t.quality||'unrated';$('#save-trade-review').onclick=()=>{t.quality=$('#review-quality').value;t.review={reviewed:true,lesson:$('#trade-review-lesson').value.trim(),mistake:$('#trade-review-mistake').value.trim(),emotion:$('#trade-review-emotion').value.trim(),updatedAt:new Date().toISOString()};save();hideModal();renderAll();toast('Trade évalué.','success')}
  }

  function openCloseTradeModal(id){
    const t=state.trades.find(x=>x.id===id);if(!t||t.status!=='open')return;const a=accountById(t.accountId);showModal(`<div class="modal-head"><div><div class="modal-title">Enregistrer une sortie</div><div class="modal-sub">${esc(t.asset)} · ${t.direction} · ${t.remainingPct}% de la position initiale restant</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Prix de sortie</label><input id="exit-price" inputmode="decimal" placeholder="Prix réellement exécuté"></div><div class="field"><label>Part de la position initiale à clôturer (%)</label><input id="exit-percent" type="number" min="0.01" max="${t.remainingPct}" step="0.01" value="${t.remainingPct}"></div><div class="field"><label>Date / heure</label><input id="exit-at" type="datetime-local" value="${new Date().toISOString().slice(0,16)}"></div><div class="field"><label>Raison</label><select id="exit-reason"><option>Sortie manuelle avant TP</option><option>Take Profit</option><option>Stop Loss</option><option>Break-even</option><option>Sortie partielle planifiée</option><option>Invalidation du setup</option><option>Autre</option></select></div><div class="field"><label>PnL réel (facultatif)</label><input id="exit-pnl-override" inputmode="decimal" placeholder="Vide = calcul automatique"></div><div class="field"><label>Note de sortie</label><input id="exit-note" placeholder="Pourquoi sortir maintenant ?"></div></div><div id="exit-preview"></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="confirm-exit" disabled>Enregistrer la sortie</button></div>`);['exit-price','exit-percent','exit-pnl-override'].forEach(id=>$(`#${id}`).oninput=()=>updateExitPreview(t));
  }

  function updateExitPreview(t){
    const a=accountById(t.accountId),currency=a?.currency||t.currencySnapshot||'USD',price=num($('#exit-price').value),pct=num($('#exit-percent').value),overrideRaw=$('#exit-pnl-override').value.trim(),override=overrideRaw?num(overrideRaw):null,riskDist=Number(t.riskDistance)||Math.abs(t.entry-(t.initialSl??t.sl)),move=Number.isFinite(price)?(t.direction==='BUY'?(price-t.entry):(t.entry-price)):NaN,rMult=Number.isFinite(move)&&riskDist>0?move/riskDist:NaN,units=Number(t.positionSize)||((t.riskUSD&&riskDist)?t.riskUSD/riskDist:0),autoPnl=Number.isFinite(move)&&units?move*units*(pct/100):NaN,pnl=Number.isFinite(override)?override:autoPnl,valid=Number.isFinite(price)&&pct>0&&pct<=t.remainingPct&&Number.isFinite(pnl);$('#exit-preview').innerHTML=`<div class="risk-preview"><div class="risk-box"><span>R de cette sortie</span><strong>${Number.isFinite(rMult)?rMult.toFixed(2):'—'}</strong></div><div class="risk-box"><span>PnL réalisé</span><strong class="${pnl>=0?'up':'down'}">${valid?fmtMoney(pnl,currency):'—'}</strong></div><div class="risk-box"><span>Restant après</span><strong>${valid?`${Number((t.remainingPct-pct).toFixed(2))}%`:'—'}</strong></div><div class="risk-box"><span>Solde après</span><strong>${valid?fmtMoney((a?.balance||0)+pnl,currency):'—'}</strong></div></div>`;const btn=$('#confirm-exit');btn.disabled=!valid;btn.onclick=valid?()=>applyExit(t,{price,pct,pnl,rMult,reason:$('#exit-reason').value,note:$('#exit-note').value.trim(),at:$('#exit-at').value?new Date($('#exit-at').value).toISOString():new Date().toISOString()}):null
  }

  function applyExit(t,{price,pct,pnl,rMult,reason,note,at}){
    const a=accountById(t.accountId);t.partialExits=t.partialExits||[];t.partialExits.push({at:at||new Date().toISOString(),price,percent:pct,pnl:Number(pnl.toFixed(2)),r:Number(rMult.toFixed(3)),reason,note:note||''});t.realizedPnl=Number(((t.realizedPnl||0)+pnl).toFixed(2));t.remainingPct=Math.max(0,Number((t.remainingPct-pct).toFixed(2)));if(a)a.balance=Number((Number(a.balance||0)+pnl).toFixed(2));if(t.remainingPct<=0.0001){t.remainingPct=0;t.status='closed';t.closedAt=at||new Date().toISOString();t.pnl=t.realizedPnl;t.resultR=t.riskUSD?Number((t.pnl/t.riskUSD).toFixed(3)):0;t.capitalAfter=a?.balance??null;t.finalExitReason=reason}else{t.pnl=t.realizedPnl}save();hideModal();renderAll();toast(t.status==='closed'?'Position clôturée. Pensez à évaluer la qualité du trade.':'Sortie partielle enregistrée.','success');if(t.status==='closed')setTimeout(()=>openTradeReviewModal(t.id),120)
  }

  function renderHistory(){
    const el=$('#view-history');if(!el)return;const periodTrades=tradesInPeriod(historyPeriod,'all',historyAnchor),filtered=filterTrades(periodTrades,historyFilters),st=statsFor(filtered),pg=paginate(filtered,historyPage);historyPage=pg.page;
    el.innerHTML=`${pageHead('Historique','Naviguez réellement dans vos semaines, mois, trimestres et années — sans tout mélanger.')}
      <div class="history-toolbar card"><div class="history-period-nav"><button class="btn" id="history-prev">←</button><div><strong>${esc(periodTitle(historyPeriod,historyAnchor))}</strong><span>${filtered.length} trade${filtered.length>1?'s':''}</span></div><button class="btn" id="history-next">→</button><button class="btn btn-ghost" id="history-today">Aujourd’hui</button></div>${periodTabs(historyPeriod,'data-history-period')}</div>
      <div class="grid metric-grid history-kpis">${metric('PnL',fmtMoney(st.pnl,primaryAccount()?.currency||'USD'),fmtR(st.totalR),st.pnl>=0)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} G · ${st.losses} P`)}${metric('R moyen',st.closed?st.avgR.toFixed(2):'—','Espérance en R')}${metric('Qualité',st.qualityRate===null?'—':fmtPct(st.qualityRate),`${st.rated} trade${st.rated>1?'s':''} évalué${st.rated>1?'s':''}`)}</div>
      <div class="card filter-bar"><input id="history-query" class="input" placeholder="Rechercher…" value="${esc(historyFilters.query)}"><select id="history-account"><option value="all">Tous comptes</option>${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><select id="history-strategy"><option value="all">Toutes stratégies</option>${state.strategies.map(st=>`<option value="${st.id}">${esc(st.name)}</option>`).join('')}</select><select id="history-result"><option value="all">Tous résultats</option><option value="win">Gagnants</option><option value="loss">Perdants</option><option value="be">Break-even</option><option value="open">Ouverts</option></select><select id="history-sort"><option value="newest">Plus récents</option><option value="oldest">Plus anciens</option><option value="pnl-desc">PnL décroissant</option><option value="pnl-asc">PnL croissant</option><option value="r-desc">R décroissant</option></select><button class="btn" id="export-history">Exporter CSV</button></div>
      <div class="card">${pg.items.length?tradeRows(pg.items,false):`<div class="quiet-empty">Aucune donnée pour cette période et ces filtres.</div>`}${pagerHtml(pg,'history')}</div>`;
    $('#history-account').value=historyFilters.account;$('#history-strategy').value=historyFilters.strategy;$('#history-result').value=historyFilters.result;$('#history-sort').value=historyFilters.sort;$$('[data-history-period]').forEach(b=>b.onclick=()=>{historyPeriod=b.dataset.historyPeriod;historyAnchor=new Date();historyPage=1;renderHistory()});$('#history-prev').onclick=()=>{historyAnchor=shiftPeriod(historyAnchor,historyPeriod,-1);historyPage=1;renderHistory()};$('#history-next').onclick=()=>{historyAnchor=shiftPeriod(historyAnchor,historyPeriod,1);historyPage=1;renderHistory()};$('#history-today').onclick=()=>{historyAnchor=new Date();historyPage=1;renderHistory()};$('#history-query').oninput=e=>{historyFilters.query=e.target.value;historyPage=1;renderHistory()};['account','strategy','result','sort'].forEach(k=>$(`#history-${k}`).onchange=e=>{historyFilters[k]=e.target.value;historyPage=1;renderHistory()});$('#export-history').onclick=()=>exportCSV(filtered);$$('[data-history-page]').forEach(b=>b.onclick=()=>{historyPage=Number(b.dataset.historyPage);renderHistory()});$$('[data-trade-id]').forEach(b=>b.onclick=()=>openTradeDetails(b.dataset.tradeId));
  }

  function labelPeriod(p){return {week:'Cette semaine',month:'Ce mois',quarter:'Ce trimestre',year:'Cette année'}[p]||'Historique'}
  function exportCSV(trades){
    const rows=[['date_ouverture','date_cloture','actif','direction','compte','strategie','entry','sl','tp','pnl','R','qualite','statut'],...trades.map(t=>[t.openedAt,t.closedAt||'',t.asset,t.direction,accountById(t.accountId)?.name||t.accountNameSnapshot||'',strategyNameForTrade(t),t.entry,t.sl,t.tp,t.pnl,t.resultR,t.quality,t.status])];const csv=rows.map(r=>r.map(x=>`"${String(x??'').replace(/"/g,'""')}"`).join(',')).join('\n');downloadFile(`altitude-history-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8')
  }

  function renderProductivity(){
    const el=$('#view-productivity');if(!el)return;const trades=tradesInPeriod(productivityPeriod,productivityAccount),closed=trades.filter(t=>t.status==='closed'),st=statsFor(trades),series=equitySeries(closed),dd=drawdownSeries(closed),breakdown=strategyBreakdown(closed);
    el.innerHTML=`${pageHead('Productivité','Suivez votre progression dans le temps : résultats, risque, discipline et qualité d’exécution.')}
      <div class="productivity-toolbar card"><div class="period-tabs">${[['last20','20 derniers'],['month','Mois'],['quarter','Trimestre'],['year','Année'],['all','Tout']].map(([v,l])=>`<button class="${productivityPeriod===v?'active':''}" data-productivity-period="${v}">${l}</button>`).join('')}</div><select id="productivity-account"><option value="all">Tous les comptes</option>${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
      <div class="grid metric-grid">${metric('PnL',fmtMoney(st.pnl,primaryAccount()?.currency||'USD'),fmtR(st.totalR),st.pnl>=0)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} gains · ${st.losses} pertes`)}${metric('Profit factor',Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—'),'Gains bruts / pertes brutes')}${metric('Qualité',st.qualityRate===null?'—':fmtPct(st.qualityRate),`${st.rated} évalués`)}</div>
      <div class="two-col productivity-charts"><div class="card"><div class="card-head"><div><div class="card-title">Évolution</div><div class="page-sub">PnL cumulé sur la période</div></div></div>${lineChart(series)}</div><div class="card"><div class="card-head"><div><div class="card-title">Drawdown</div><div class="page-sub">Repli depuis le plus haut de la période</div></div><span class="down mono">${fmtMoney(st.maxDrawdown,primaryAccount()?.currency||'USD')}</span></div>${lineChart(dd)}</div></div>
      <div class="two-col"><div class="card"><div class="card-head"><div><div class="card-title">Résultats trade par trade</div><div class="page-sub">Chaque barre représente un trade clôturé</div></div></div>${bars(closed)}</div><div class="card"><div class="card-head"><div><div class="card-title">Par stratégie</div><div class="page-sub">Comparaison de vos propres méthodes</div></div></div>${breakdown.length?breakdown.slice(0,8).map(x=>`<div class="strategy-performance-row"><span>${esc(x.name)}</span><span>${x.trades.length} trades</span><b class="${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,primaryAccount()?.currency||'USD')}</b><span class="mono">${fmtR(x.r)}</span></div>`).join(''):'<div class="quiet-empty">Pas encore assez de données.</div>'}</div></div>
      <div class="card stat-line" style="margin-top:12px"><span><b>${st.expectancyR.toFixed(2)}</b> espérance R</span><span><b>${st.bestWinStreak}</b> meilleure série gagnante</span><span><b>${st.worstLossStreak}</b> pire série perdante</span><span><b>${st.closed}</b> trades clôturés</span></div>`;
    $('#productivity-account').value=productivityAccount;$('#productivity-account').onchange=e=>{productivityAccount=e.target.value;renderProductivity()};$$('[data-productivity-period]').forEach(b=>b.onclick=()=>{productivityPeriod=b.dataset.productivityPeriod;renderProductivity()});
  }

  function currentWeekKey(){const r=rangeFor('week');return r.start.toISOString().slice(0,10)}
  function renderWeekly(){
    const el=$('#view-weekly');if(!el)return;const key=currentWeekKey(),review=state.weeklyReviews[key]||{summary:'',lesson:'',rule:'',completed:false},weekTrades=tradesInPeriod('week').filter(t=>t.status==='closed'),reviewed=weekTrades.filter(t=>t.review?.reviewed).length;
    el.innerHTML=`${pageHead('Revue hebdomadaire','Passez de vos résultats à des décisions concrètes pour la semaine suivante.')}
      <div class="review-progress card"><div><span class="eyebrow">PROGRESSION</span><strong>${reviewed} / ${weekTrades.length}</strong><small>trades évalués individuellement</small></div><div class="progress-track"><span style="width:${weekTrades.length?reviewed/weekTrades.length*100:0}%"></span></div></div>
      <div class="detail-grid"><div class="card"><div class="card-head"><div><div class="card-title">Trades de la semaine</div><div class="page-sub">Évaluez le processus, pas seulement le résultat.</div></div></div>${weekTrades.length?weekTrades.map(t=>`<div class="review-trade-row"><div><b>${esc(t.asset)}</b><span>${fmtMoney(t.pnl,accountById(t.accountId)?.currency||t.currencySnapshot||'USD')} · ${fmtR(t.resultR)}</span></div><span class="pill ${t.quality==='good'?'success':t.quality==='bad'?'danger':''}">${qualityLabel(t.quality)}</span><button class="btn" data-week-review-trade="${t.id}">${t.review?.reviewed?'Modifier':'Revoir'}</button></div>`).join(''):'<div class="quiet-empty">Aucun trade clôturé cette semaine.</div>'}</div><div class="card"><div class="field"><label>Bilan de la semaine</label><textarea id="review-summary" rows="5">${esc(review.summary)}</textarea></div><div class="field"><label>Leçon principale</label><textarea id="review-lesson" rows="4">${esc(review.lesson)}</textarea></div><div class="field"><label>Règle à retenir</label><textarea id="review-rule" rows="3">${esc(review.rule)}</textarea></div><button class="btn btn-primary" id="save-review" style="width:100%">Valider la revue</button></div></div>`;
    $$('[data-week-review-trade]').forEach(b=>b.onclick=()=>openTradeReviewModal(b.dataset.weekReviewTrade));$('#save-review').onclick=()=>{const summary=$('#review-summary').value.trim(),lesson=$('#review-lesson').value.trim(),rule=$('#review-rule').value.trim();if(!summary||!lesson||!rule){toast('Complétez le bilan, la leçon et la règle avant de valider.','error');return}state.weeklyReviews[key]={summary,lesson,rule,completed:true,reviewedTrades:reviewed,totalTrades:weekTrades.length,updatedAt:new Date().toISOString()};if(rule&&!state.rules.some(r=>r.text===rule))state.rules.unshift({id:uid('rule'),text:rule,status:'active',favorite:false,violations:0,createdAt:new Date().toISOString(),sourceWeek:key});save();renderAll();toast('Revue hebdomadaire validée.','success')}
  }

  function renderRules(){
    const el=$('#view-rules');if(!el)return;const q=rulesQuery.trim().toLowerCase(),visible=state.rules.filter(r=>(rulesStatus==='all'||r.status===rulesStatus)&&(!q||r.text.toLowerCase().includes(q)));
    el.innerHTML=`${pageHead('Règles & notes','Votre mémoire de trading : ce qui doit réellement changer votre prochaine décision.','<button class="btn btn-primary" id="add-rule-manual">+ Nouvelle règle</button><button class="btn" id="add-note">+ Note</button>')}
      <div class="card filter-bar"><input class="input" id="rule-query" placeholder="Rechercher une règle…" value="${esc(rulesQuery)}"><div class="period-tabs">${[['all','Toutes'],['active','Actives'],['watch','À surveiller'],['archived','Archivées']].map(([v,l])=>`<button class="${rulesStatus===v?'active':''}" data-rule-status="${v}">${l}</button>`).join('')}</div></div>
      <div class="two-col"><div class="card"><div class="card-head"><div><div class="card-title">Livre de règles</div><div class="page-sub">${visible.length} règle${visible.length>1?'s':''}</div></div></div>${visible.length?visible.map((r,i)=>`<div class="rulebook-row"><button class="rule-star ${r.favorite?'active':''}" data-rule-favorite="${r.id}" title="Favori">★</button><div><div class="row-main">${esc(r.text)}</div><div class="row-sub">${fmtDate(r.createdAt)} · ${r.status==='active'?'Active':r.status==='watch'?'À surveiller':'Archivée'} · ${Number(r.violations||0)} violation${Number(r.violations||0)>1?'s':''}</div></div><button class="btn" data-rule-violation="${r.id}">+ violation</button><button class="btn" data-rule-cycle="${r.id}">${r.status==='active'?'Surveiller':r.status==='watch'?'Archiver':'Réactiver'}</button></div>`).join(''):'<div class="quiet-empty">Aucune règle dans cette vue.</div>'}</div>
      <div class="card"><div class="card-head"><div><div class="card-title">Notes</div><div class="page-sub">Pensées, observations et rappels libres</div></div><span class="pill">${state.notes.length}</span></div>${state.notes.length?state.notes.map(n=>`<div class="note-row"><div><div class="row-main">${esc(n.title)}</div><div class="row-sub">${esc(n.text)}</div></div><button class="btn" data-note-delete="${n.id}">×</button></div>`).join(''):'<div class="quiet-empty">Aucune note personnelle.</div>'}</div></div>`;
    $('#rule-query').oninput=e=>{rulesQuery=e.target.value;renderRules()};$$('[data-rule-status]').forEach(b=>b.onclick=()=>{rulesStatus=b.dataset.ruleStatus;renderRules()});$('#add-rule-manual').onclick=()=>showModal(`<div class="modal-head"><div><div class="modal-title">Nouvelle règle</div><div class="modal-sub">Une règle courte, observable et actionnable.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="field"><label>Règle</label><textarea id="manual-rule" rows="4" placeholder="Ex. Je ne prends aucun trade si…"></textarea></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-manual-rule">Enregistrer</button></div>`);setTimeout(()=>$('#save-manual-rule')?.addEventListener('click',()=>{const text=$('#manual-rule').value.trim();if(!text)return;state.rules.unshift({id:uid('rule'),text,status:'active',favorite:false,violations:0,createdAt:new Date().toISOString(),sourceWeek:null});save();hideModal();renderRules();toast('Règle ajoutée.','success')}),0);$('#add-note').onclick=()=>showModal(`<div class="modal-head"><div><div class="modal-title">Nouvelle note</div></div><button class="close-btn" data-close-modal>×</button></div><div class="field"><label>Titre</label><input id="note-title"></div><div class="field"><label>Note</label><textarea id="note-text" rows="6"></textarea></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-note">Enregistrer</button></div>`);setTimeout(()=>{$('#save-note')?.addEventListener('click',()=>{const title=$('#note-title').value.trim(),text=$('#note-text').value.trim();if(!title||!text)return;state.notes.unshift({id:uid('note'),title,text,createdAt:new Date().toISOString()});save();hideModal();renderRules();toast('Note enregistrée.','success')})},0);$$('[data-rule-favorite]').forEach(b=>b.onclick=()=>{const r=state.rules.find(x=>x.id===b.dataset.ruleFavorite);r.favorite=!r.favorite;save();renderRules()});$$('[data-rule-violation]').forEach(b=>b.onclick=()=>{const r=state.rules.find(x=>x.id===b.dataset.ruleViolation);r.violations=Number(r.violations||0)+1;save();renderRules()});$$('[data-rule-cycle]').forEach(b=>b.onclick=()=>{const r=state.rules.find(x=>x.id===b.dataset.ruleCycle);r.status=r.status==='active'?'watch':r.status==='watch'?'archived':'active';save();renderRules()});$$('[data-note-delete]').forEach(b=>b.onclick=()=>{state.notes=state.notes.filter(n=>n.id!==b.dataset.noteDelete);save();renderRules()})
  }

  function renderProfile(){
    const el=$('#view-profile');if(!el)return;el.innerHTML=`${pageHead('Profil','Votre identité et vos préférences personnelles dans ALTITUDE OS.')}
      <div class="profile-layout"><div class="card profile-card"><div class="profile-hero">${avatarHtml('large')}<div class="profile-meta"><h2>${esc(displayName())}</h2><p>${esc(currentUser?.email||'Mode démo local')}</p><span class="pill">${esc(accountProfile?.plan||'Compte')}</span><button class="btn" id="change-avatar">Changer la photo</button><input type="file" id="avatar-file" accept="image/*" hidden></div></div><div class="profile-summary"><span>${state.accounts.length} compte${state.accounts.length>1?'s':''}</span><span>${state.strategies.filter(s=>!s.archived).length} stratégie${state.strategies.filter(s=>!s.archived).length>1?'s':''}</span><span>${closedTrades().length} trades clôturés</span></div></div>
      <div class="card"><div class="form-grid"><div class="field"><label>Prénom</label><input id="profile-first" value="${esc(state.profile.firstName)}"></div><div class="field"><label>Nom</label><input id="profile-last" value="${esc(state.profile.lastName)}"></div><div class="field"><label>Nom affiché</label><input id="profile-display" value="${esc(state.profile.displayName)}"></div><div class="field"><label>Ville</label><input id="profile-city" value="${esc(state.profile.city||'')}"></div><div class="field"><label>Pays</label><input id="profile-country" value="${esc(state.profile.country)}"></div><div class="field"><label>Fuseau horaire</label><input id="profile-timezone" value="${esc(state.profile.timezone)}"></div><div class="field"><label>Langue</label><select id="profile-language"><option value="fr">Français</option><option value="en">English</option></select></div><div class="field"><label>Expérience</label><select id="profile-experience"><option value="">Non renseigné</option><option>Débutant</option><option>Intermédiaire</option><option>Avancé</option><option>Professionnel</option></select></div><div class="field"><label>Style de trading</label><input id="profile-style" value="${esc(state.profile.tradingStyle||'')}" placeholder="Scalping, intraday, swing…"></div><div class="field" style="grid-column:1/-1"><label>Bio / objectif</label><textarea id="profile-bio" rows="4">${esc(state.profile.bio||'')}</textarea></div></div><button class="btn btn-primary" id="save-profile">Enregistrer le profil</button></div></div>`;
    $('#profile-experience').value=state.profile.experience||'';$('#profile-language').value=state.profile.language||'fr';$('#save-profile').onclick=()=>{state.profile={...state.profile,firstName:$('#profile-first').value.trim(),lastName:$('#profile-last').value.trim(),displayName:$('#profile-display').value.trim(),city:$('#profile-city').value.trim(),country:$('#profile-country').value.trim(),timezone:$('#profile-timezone').value.trim(),language:$('#profile-language').value,experience:$('#profile-experience').value,tradingStyle:$('#profile-style').value.trim(),bio:$('#profile-bio').value.trim()};save();renderAll();toast('Profil mis à jour.','success')};$('#change-avatar').onclick=()=>$('#avatar-file').click();$('#avatar-file').onchange=async e=>{const f=e.target.files?.[0];if(f){state.profile.avatar=await imageToDataUrl(f);save();renderAll();toast('Photo de profil mise à jour.','success')}}
  }

  function imageToDataUrl(file){return new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');const s=Math.min(img.width,img.height),sx=(img.width-s)/2,sy=(img.height-s)/2;ctx.drawImage(img,sx,sy,s,s,0,0,256,256);res(c.toDataURL('image/jpeg',.78))};img.onerror=rej;img.src=reader.result};reader.onerror=rej;reader.readAsDataURL(file)})}

  function renderSettings(){
    const el=$('#view-settings');if(!el)return;const themes=[['midnight','Midnight'],['summit','Summit'],['obsidian','Obsidian'],['glacier','Glacier'],['carbon','Carbon']];
    el.innerHTML=`${pageHead('Paramètres','Apparence, comportement, données et sécurité.')}
      <div class="settings-sections"><section class="card"><div class="card-head"><div><div class="card-title">Apparence</div><div class="page-sub">Un environnement de travail cohérent, pas un simple dark/light mode.</div></div></div><div class="theme-picker">${themes.map(([v,l])=>`<button class="theme-choice ${state.preferences.theme===v?'active':''}" data-theme-choice="${v}"><span class="theme-preview" data-theme-preview="${v}"></span><strong>${l}</strong></button>`).join('')}</div><div class="form-grid"><div class="field"><label>Densité</label><select id="pref-density"><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select></div><div class="field"><label>Taille du texte</label><select id="pref-text"><option value="small">Petite</option><option value="default">Standard</option><option value="large">Grande</option></select></div></div></section>
      <section class="card"><div class="card-title">Comportement de trading</div><div class="form-grid"><div class="field"><label>Début de semaine</label><select id="pref-week"><option value="monday">Lundi</option><option value="saturday">Samedi</option><option value="sunday">Dimanche</option></select></div></div></section>
      <section class="card"><div class="card-title">Données</div><div class="page-sub">Les exports conservent votre structure complète. Une remise à zéro n’efface pas votre compte de connexion.</div><div class="settings-actions"><button class="btn" id="export-json">Exporter JSON</button><button class="btn" id="import-json">Importer JSON</button><input type="file" id="import-json-file" accept="application/json" hidden><button class="btn btn-danger" id="reset-trades">Réinitialiser le journal</button><button class="btn btn-danger" id="reset-all">Tout remettre à zéro</button></div></section>
      <section class="card"><div class="card-title">Sécurité</div><div class="page-sub">${currentUser?'Compte cloud connecté et synchronisé.':'Mode démo local.'}</div><div class="settings-actions">${currentUser?'<button class="btn" id="send-password-reset">Modifier le mot de passe</button>':''}<button class="btn" id="sign-out">Se déconnecter</button>${currentUser?'<button class="btn btn-danger" id="delete-cloud-account">Supprimer mon compte</button>':''}</div></section></div>`;
    $('#pref-density').value=state.preferences.density;$('#pref-text').value=state.preferences.textScale;$('#pref-week').value=state.preferences.weekStart||'monday';$$('[data-theme-choice]').forEach(b=>b.onclick=()=>{state.preferences.theme=b.dataset.themeChoice;save();renderAll();toast('Thème appliqué.','success')});$('#pref-density').onchange=e=>{state.preferences.density=e.target.value;save();renderAll()};$('#pref-text').onchange=e=>{state.preferences.textScale=e.target.value;save()};$('#pref-week').onchange=e=>{state.preferences.weekStart=e.target.value;save();renderAll()};$('#export-json').onclick=()=>downloadFile(`altitude-os-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2));$('#import-json').onclick=()=>$('#import-json-file').click();$('#import-json-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{state=mergeState(JSON.parse(await f.text()));save();renderAll();toast('Données importées.','success')}catch{toast('Fichier JSON invalide.','error')}};$('#reset-trades').onclick=()=>confirmDialog({title:'Réinitialiser le journal ?',text:'Tous les trades, revues hebdomadaires et règles issues des revues seront supprimés. Les comptes, stratégies, profil et préférences resteront.',confirmLabel:'Réinitialiser le journal',danger:true,onConfirm:()=>{state.trades=[];state.weeklyReviews={};state.rules=[];state.resetHistory.push({at:new Date().toISOString(),scope:'trades'});save();renderAll();toast('Journal réinitialisé.','success')}});$('#reset-all').onclick=()=>confirmDialog({title:'Tout remettre à zéro ?',text:'Comptes de trading, stratégies, trades, historiques, revues, règles et notes seront effacés. Profil, thème et compte de connexion resteront.',confirmLabel:'Tout remettre à zéro',danger:true,onConfirm:()=>{const keepProfile=state.profile,keepPreferences=state.preferences;state=defaults();state.profile=keepProfile;state.preferences=keepPreferences;state.onboardingDone=true;state.resetHistory=[{at:new Date().toISOString(),scope:'all'}];save();renderAll();toast('Espace remis à zéro.','success')}});$('#send-password-reset')?.addEventListener('click',async()=>{if(!currentUser?.email||!supabase)return;const {error}=await supabase.auth.resetPasswordForEmail(currentUser.email,{redirectTo:APP_URL});toast(error?translateAuth(error.message):'Email de modification du mot de passe envoyé.',error?'error':'success')});$('#sign-out').onclick=signOut;$('#delete-cloud-account')?.addEventListener('click',deleteCloudAccount)
  }

  function renderOpenPositionSelectors(){/* reserved */}

  function ensureCommandPalette(){
    let back=$('#command-backdrop');
    if(!back){
      back=document.createElement('div');
      back.className='command-backdrop';
      back.id='command-backdrop';
      back.hidden=true;
      back.setAttribute('aria-hidden','true');
      back.innerHTML='<div class="command-palette" role="dialog" aria-modal="true" aria-label="Recherche ALTITUDE OS"><input id="command-input" autocomplete="off" placeholder="Rechercher ou lancer une action…"><div id="command-results"></div></div>';
      document.body.appendChild(back);
      back.addEventListener('click',e=>{if(e.target===back)closeCommands()});
      $('#command-input')?.addEventListener('input',e=>renderCommands(e.target.value));
    }
    return {back,input:$('#command-input')};
  }
  function openCommandPalette(){
    const {back,input}=ensureCommandPalette();
    document.body.classList.add('command-open');
    back.hidden=false;
    back.setAttribute('aria-hidden','false');
    if(input){input.value='';renderCommands('');setTimeout(()=>input.focus(),10)}
  }
  function renderCommands(q=''){
    const actions=[['Nouveau trade','Créer une position',()=>{closeCommands();openNewTrade()}],['Tableau de bord','Navigation',()=>{closeCommands();setView('dashboard')}],['Comptes','Navigation',()=>{closeCommands();setView('accounts')}],['Stratégies','Navigation',()=>{closeCommands();setView('strategies')}],['Journal','Navigation',()=>{closeCommands();setView('journal')}],['Historique','Navigation',()=>{closeCommands();setView('history')}],['Productivité','Navigation',()=>{closeCommands();setView('productivity')}],['Revue hebdo','Navigation',()=>{closeCommands();setView('weekly')}],['Règles & notes','Navigation',()=>{closeCommands();setView('rules')}],['Profil','Navigation',()=>{closeCommands();setView('profile')}],['Paramètres','Navigation',()=>{closeCommands();setView('settings')}]];const results=$('#command-results');if(!results)return;const f=actions.filter(a=>a[0].toLowerCase().includes(q.toLowerCase()));results.innerHTML=f.map((a,i)=>`<div class="command-item" data-cmd="${i}"><span>${esc(a[0])}</span><span>${esc(a[1])}</span></div>`).join('')||'<div class="empty">Aucun résultat</div>';$$('[data-cmd]').forEach(b=>b.onclick=()=>f[Number(b.dataset.cmd)][2]())
  }

  function closeCommands(){
    document.body.classList.remove('command-open');
    const back=$('#command-backdrop'),input=$('#command-input');
    if(back){back.hidden=true;back.setAttribute('aria-hidden','true')}
    if(input){input.value='';input.blur()}
    const results=$('#command-results');if(results)results.innerHTML='';
  }

  function showOnboarding(){
    if(state.onboardingDone)return;const a=primaryAccount();showModal(`<div class="modal-head"><div><div class="eyebrow">BIENVENUE SUR ALTITUDE OS</div><div class="modal-title">Configurez votre espace en moins de 2 minutes.</div><div class="modal-sub">Ces réglages sont modifiables à tout moment.</div></div><button class="close-btn" id="skip-onboarding">×</button></div><div class="form-grid"><div class="field"><label>Prénom</label><input id="on-first" value="${esc(state.profile.firstName||'')}"></div><div class="field"><label>Nom du premier compte</label><input id="on-account" value="${esc(a?.name||'Compte principal')}"></div><div class="field"><label>Solde actuel</label><input id="on-balance" inputmode="decimal" value="${a?.balance??50}"></div><div class="field"><label>Risque par trade</label><input id="on-risk" inputmode="decimal" value="${a?.riskValue??10}"></div><div class="field"><label>Mode de risque</label><select id="on-risk-mode"><option value="fixed">Montant fixe</option><option value="percent">Pourcentage</option></select></div><div class="field"><label>Thème</label><select id="on-theme"><option value="midnight">Midnight</option><option value="summit">Summit</option><option value="obsidian">Obsidian</option><option value="glacier">Glacier</option><option value="carbon">Carbon</option></select></div></div><div class="modal-footer"><button class="btn" id="onboarding-later">Plus tard</button><button class="btn btn-primary" id="finish-onboarding">Créer mon espace</button></div>`,true);$('#on-risk-mode').value=a?.riskMode||'fixed';$('#on-theme').value=state.preferences.theme||'midnight';const skip=()=>{state.onboardingDone=true;save();hideModal();renderAll()};$('#skip-onboarding').onclick=skip;$('#onboarding-later').onclick=skip;$('#finish-onboarding').onclick=()=>{const balance=num($('#on-balance').value),risk=num($('#on-risk').value);if(!Number.isFinite(balance)||balance<0||!Number.isFinite(risk)||risk<0){toast('Vérifiez le solde et le risque.','error');return}state.profile.firstName=$('#on-first').value.trim();const acc=primaryAccount();acc.name=$('#on-account').value.trim()||'Compte principal';acc.balance=balance;acc.initialBalance=acc.initialBalance??balance;acc.riskValue=risk;acc.riskMode=$('#on-risk-mode').value;state.preferences.theme=$('#on-theme').value;state.onboardingDone=true;save();hideModal();renderAll();toast('Votre espace est prêt.','success');setView('strategies')}
  }

  let authMode='login';
  function authMessage(msg,type='success'){return msg?`<div class="auth-msg ${type}">${esc(msg)}</div>`:''}
  function showAuth(mode='login',message='',type='success'){
    authMode=mode;$('#auth-screen').hidden=false;$('#app-shell').hidden=true;const allowDemo=location.hostname==='localhost'||location.hostname==='127.0.0.1'||!supabaseConfigured;
    $('#auth-content').innerHTML=`<div class="eyebrow">ALTITUDE OS</div><div class="auth-title">${mode==='signup'?'Créer votre espace':'Connexion'}</div><div class="auth-sub">${mode==='signup'?'Votre environnement privé de trading et de progression.':'Retrouvez votre espace de travail.'}</div><div class="auth-tabs"><button class="auth-tab ${mode==='login'?'active':''}" data-auth-tab="login">Connexion</button><button class="auth-tab ${mode==='signup'?'active':''}" data-auth-tab="signup">Créer un compte</button></div>${!supabaseConfigured?authMessage('Le cloud n’est pas configuré sur cet environnement.','error'):''}${authMessage(message,type)}${mode==='signup'?'<div class="auth-field"><label>Nom affiché</label><input id="auth-name" autocomplete="name"></div>':''}<div class="auth-field"><label>Email</label><input id="auth-email" type="email" autocomplete="email"></div><div class="auth-field"><label>Mot de passe</label><input id="auth-password" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}"></div><div class="auth-actions"><button class="btn btn-primary" id="auth-submit">${mode==='signup'?'Créer mon espace':'Se connecter'}</button>${mode==='login'&&supabaseConfigured?'<button class="auth-link" id="forgot-password">Mot de passe oublié ?</button>':''}</div>${allowDemo?'<div class="auth-divider">OU</div><button class="btn" id="demo-mode" style="width:100%">Continuer en démo locale</button>':''}`;$$('[data-auth-tab]').forEach(b=>b.onclick=()=>showAuth(b.dataset.authTab));$('#auth-submit').onclick=submitAuth;$('#demo-mode')?.addEventListener('click',enterDemo);$('#forgot-password')?.addEventListener('click',resetPassword)
  }

  async function submitAuth(){if(!supabaseConfigured){showAuth(authMode,'Configurez Supabase ou utilisez le mode démo.','error');return}const email=$('#auth-email').value.trim(),password=$('#auth-password').value;if(!email||password.length<8){showAuth(authMode,'Renseignez un email valide et un mot de passe d’au moins 8 caractères.','error');return}if(authMode==='signup'){const displayName=$('#auth-name').value.trim()||email.split('@')[0],{data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo:APP_URL}});if(error){showAuth('signup',translateAuth(error.message),'error');return}if(data.session)await startUser(data.user);else showAuth('login','Compte créé. Vérifiez votre email puis connectez-vous.')}else{const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error){showAuth('login',translateAuth(error.message),'error');return}await startUser(data.user)}}
  function translateAuth(m){const map={'Invalid login credentials':'Email ou mot de passe incorrect.','Email not confirmed':'Confirmez votre email avant de vous connecter.','User already registered':'Un compte existe déjà avec cet email.'};return map[m]||m}
  async function resetPassword(){const email=$('#auth-email').value.trim();if(!email){showAuth('login','Saisissez votre email puis recommencez.','error');return}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:APP_URL});showAuth('login',error?translateAuth(error.message):'Email de réinitialisation envoyé.',error?'error':'success')}
  async function enterDemo(){closeCommands();currentUser=null;accountProfile={plan:'DEMO'};storageKey=`${STORAGE_KEY_BASE}:demo`;state=load();syncState='local';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;if(!state.profile.firstName)state.profile.firstName='Trader';applyPreferences();renderAll();setView('dashboard');if(!state.onboardingDone)setTimeout(showOnboarding,280)}

  async function startUser(user){if(!user)return;closeCommands();currentUser=user;storageKey=`${STORAGE_KEY_BASE}:${user.id}`;state=load();if(supabase){try{const {data}=await supabase.from('profiles').select('display_name,plan').eq('id',user.id).maybeSingle();accountProfile=data||{display_name:user.user_metadata?.display_name||'',plan:'free'}}catch{accountProfile={plan:'free'}}await hydrateCloudState()}if(!state.profile.displayName)state.profile.displayName=accountProfile?.display_name||user.user_metadata?.display_name||'';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;applyPreferences();renderAll();setView('dashboard');closeCommands();if(!state.onboardingDone)setTimeout(showOnboarding,320)}

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
