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
  let currentView = 'dashboard', dashboardPeriod = 'month', historyPeriod = 'month', historyAnchor = new Date(), productivityPeriod = 'month', productivityAccount = 'all', productivityStrategy='all', productivityAsset='all';
  let accountAnalyticsPeriod='month', selectedAccountId=null;
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
  const localDateTimeValue = (d=new Date()) => { const x=new Date(d); x.setMinutes(x.getMinutes()-x.getTimezoneOffset()); return x.toISOString().slice(0,16); };

  const defaults = () => ({
    version:6.4,
    profile:{firstName:'',lastName:'',displayName:'',avatar:'',country:'France',city:'',timezone:'Europe/Paris',language:'fr',experience:'',tradingStyle:'',bio:''},
    preferences:{theme:'midnight',density:'comfortable',textScale:'default',sidebarCollapsed:false,weekStart:'monday',confirmStrategy:true},
    accounts:[
      {id:'acc_deriv',name:'Deriv · Synthétiques',broker:'Deriv',accountType:'personal',marketType:'synthetic',currency:'USD',initialBalance:0,balance:0,riskMode:'percent',riskValue:1,active:true,color:'#8b5cf6',assetList:['V10','V25','V75','Boom 500','Jump 10'],balanceAdjustments:[],createdAt:new Date().toISOString()},
      {id:'acc_justmarkets',name:'JustMarkets · Forex/CFD',broker:'JustMarkets',accountType:'personal',marketType:'forex',currency:'USD',initialBalance:0,balance:0,riskMode:'percent',riskValue:1,active:false,color:'#38bdf8',assetList:['BTCUSD','GBPJPY','XAUUSD','US30'],balanceAdjustments:[],createdAt:new Date().toISOString()},
      {id:'acc_fundednext',name:'FundedNext · Prop Firm',broker:'FundedNext',accountType:'prop',marketType:'prop',currency:'USD',initialBalance:0,balance:0,riskMode:'percent',riskValue:1,active:false,color:'#34d399',assetList:['BTCUSD','GBPJPY','XAUUSD','US30'],balanceAdjustments:[],createdAt:new Date().toISOString()}
    ],
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
    const normalizeMedia=v=>{
      if(Array.isArray(v)) return v.filter(Boolean);
      if(v&&typeof v==='object'&&(v.type||v.dataUrl||v.path)) return [v];
      return [];
    };
    const merged={
      ...d,...src,version:6.4,
      profile:{...d.profile,...(src.profile||{})},
      preferences:{...d.preferences,...(src.preferences||{})},
      weeklyReviews:src.weeklyReviews||{},
      rules:Array.isArray(src.rules)?src.rules:[],
      notes:Array.isArray(src.notes)?src.notes:[],
      resetHistory:Array.isArray(src.resetHistory)?src.resetHistory:[]
    };
    const sourceAccounts=Array.isArray(src.accounts)&&src.accounts.length?src.accounts:d.accounts;
    const untouchedLegacy=Number(src.version||0)<6&&sourceAccounts.length===1&&!sourceAccounts[0]?.broker&&String(sourceAccounts[0]?.name||'').toLowerCase().includes('compte principal')&&!(Array.isArray(src.trades)&&src.trades.length);
    merged.accounts=(untouchedLegacy?d.accounts:sourceAccounts).map((a,i)=>({
      id:a.id||uid('acc'),
      name:a.name||`Compte ${i+1}`,
      broker:a.broker||'',
      accountType:a.accountType||'personal',
      marketType:a.marketType||((a.broker||'').toLowerCase().includes('deriv')?'synthetic':a.accountType==='prop'?'prop':'forex'),
      currency:a.currency||'USD',
      initialBalance:Number.isFinite(Number(a.initialBalance))?Number(a.initialBalance):Number(a.balance||0),
      balance:Number(a.balance||0),
      riskMode:a.riskMode==='percent'?'percent':'fixed',
      riskValue:Number(a.riskValue??10),
      active:Boolean(a.active ?? i===0),
      color:a.color||['#8b5cf6','#38bdf8','#34d399','#f59e0b'][i%4],
      assetList:Array.isArray(a.assetList)&&a.assetList.length?a.assetList:(String(a.broker||'').toLowerCase().includes('deriv')?['V10','V25','V75','Boom 500','Jump 10']:['BTCUSD','GBPJPY','XAUUSD','US30']),
      balanceAdjustments:Array.isArray(a.balanceAdjustments)?a.balanceAdjustments:[],
      createdAt:a.createdAt||new Date().toISOString()
    }));
    // ALTITUDE Trade 6.4 — garantir les trois environnements principaux demandés.
    // On conserve les comptes personnalisés existants, mais Deriv, JustMarkets et FundedNext
    // sont toujours présents et affichés en premier.
    const coreAccounts=d.accounts;
    for(const core of coreAccounts){
      const brokerKey=String(core.broker||'').toLowerCase();
      let existing=merged.accounts.find(a=>a.id===core.id||String(a.broker||'').toLowerCase()===brokerKey);
      if(existing){
        existing.id=core.id;
        existing.name=core.name;
        existing.broker=core.broker;
        existing.accountType=core.accountType;
        existing.marketType=core.marketType;
        existing.assetList=[...core.assetList];
        existing.color=existing.color||core.color;
      }else{
        merged.accounts.push({...core,assetList:[...core.assetList],balanceAdjustments:[]});
      }
    }
    const coreOrder=new Map([['acc_deriv',0],['acc_justmarkets',1],['acc_fundednext',2]]);
    merged.accounts.sort((a,b)=>(coreOrder.has(a.id)?coreOrder.get(a.id):99)-(coreOrder.has(b.id)?coreOrder.get(b.id):99));
    if(!merged.accounts.some(a=>a.active)&&merged.accounts[0]) merged.accounts[0].active=true;
    merged.strategies=(Array.isArray(src.strategies)?src.strategies:[]).map(st=>({
      id:st.id||uid('strat'),name:st.name||'Stratégie',description:st.description||'',
      marketScope:st.marketScope||'',timeframe:st.timeframe||'',tags:Array.isArray(st.tags)?st.tags:[],
      entryRules:Array.isArray(st.entryRules)?st.entryRules:[],confirmations:Array.isArray(st.confirmations)?st.confirmations:[],
      riskRules:Array.isArray(st.riskRules)?st.riskRules:[],exitRules:Array.isArray(st.exitRules)?st.exitRules:[],
      active:Boolean(st.active ?? true),archived:Boolean(st.archived),createdAt:st.createdAt||new Date().toISOString(),updatedAt:st.updatedAt||st.createdAt||new Date().toISOString()
    }));
    if(!merged.strategies.length){
      merged.strategies.push({
        id:'strat_mm20_sr_m5',
        name:'MM20 + S/R + Confirmation M5',
        description:'Tendance via MM20, retour en zone support/résistance, puis confirmation M5.',
        marketScope:'BTCUSD, GBPJPY, XAUUSD, US30, V10, V25, V75, Boom 500, Jump 10',
        timeframe:'H1 + M30 → M5',tags:['personnelle','pullback','support-résistance'],
        entryRules:['Tendance H1 et M30 alignée avec la MM20','Attendre un retour du prix dans une zone support/résistance H4, H2 ou H1'],
        confirmations:['Attendre une confirmation M5 avant l’entrée'],
        riskRules:['Définir le risque avant l’entrée et respecter le montant prévu'],
        exitRules:['Documenter toute sortie partielle, passage à break-even ou clôture anticipée'],
        active:true,archived:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
      });
    }
    merged.trades=(Array.isArray(src.trades)?src.trades:[]).map(t=>({
      ...t,
      status:t.status||'closed',
      remainingPct:Number.isFinite(Number(t.remainingPct))?Number(t.remainingPct):(t.status==='open'?100:0),
      partialExits:Array.isArray(t.partialExits)?t.partialExits:[],
      realizedPnl:Number(t.realizedPnl||0),pnl:Number(t.pnl||0),
      resultR:t.resultR===null||t.resultR===undefined?null:Number(t.resultR),
      plannedRR:Number(t.plannedRR||0),riskUSD:Number(t.riskUSD||0),positionSize:Number(t.positionSize||0),initialSl:Number(t.initialSl??t.sl??0),initialTp:Number(t.initialTp??t.tp??0),riskDistance:Number(t.riskDistance??Math.abs(Number(t.entry||0)-Number(t.initialSl??t.sl??0))),
      timeframe:t.timeframe||t.entryTimeframe||'',entryTimeframe:t.entryTimeframe||t.timeframe||'M5',trendTimeframe:t.trendTimeframe||'H1 + M30',marketContext:t.marketContext||'',session:t.session||'',confirmation:t.confirmation||'',confidence:Number(t.confidence||0),preTradeEmotion:t.preTradeEmotion||'',tags:Array.isArray(t.tags)?t.tags:[],
      quality:t.quality||'unrated',review:t.review||{reviewed:false,lesson:'',mistake:'',emotion:'',updatedAt:null},
      strategySnapshot:t.strategySnapshot||null,modifications:Array.isArray(t.modifications)?t.modifications:[],
      media:{before:normalizeMedia(t.media?.before),after:normalizeMedia(t.media?.after)}
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
  function globalInitialCapital(){return state.accounts.reduce((s,a)=>s+(Number(a.initialBalance)||0),0)}
  function accountInitialCapital(id){const a=accountById(id);return Number(a?.initialBalance)||0}
  function accountAssets(id){const a=accountById(id);return Array.isArray(a?.assetList)?a.assetList:[]}
  function accountMarketLabel(a){return a?.marketType==='synthetic'?'Indices synthétiques':a?.accountType==='prop'||a?.marketType==='prop'?'Prop firm':'Forex / CFD'}
  function periodLabel(p){return {day:'Aujourd’hui',week:'Semaine',month:'Mois',quarter:'Trimestre',year:'Année',all:'Tout'}[p]||'Période'}
  function average(list){return list.length?list.reduce((s,v)=>s+Number(v||0),0)/list.length:0}
  function durationMinutes(t){if(!t.closedAt||!t.openedAt)return 0;return Math.max(0,(new Date(t.closedAt)-new Date(t.openedAt))/60000)}
  function periodKey(date,kind='day'){const d=new Date(date);if(kind==='day')return d.toISOString().slice(0,10);if(kind==='month')return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;const ws=startOfWeek(d);return ws.toISOString().slice(0,10)}
  function aggregatePeriod(trades,kind='day'){
    const map=new Map();trades.filter(t=>t.status==='closed').forEach(t=>{const key=periodKey(t.closedAt||t.openedAt,kind),x=map.get(key)||{key,pnl:0,r:0,trades:0};x.pnl+=Number(t.pnl)||0;x.r+=Number(t.resultR)||0;x.trades++;map.set(key,x)});return [...map.values()].sort((a,b)=>a.key.localeCompare(b.key));
  }
  function breakdownBy(trades,keyFn){
    const map=new Map();trades.filter(t=>t.status==='closed').forEach(t=>{const key=keyFn(t)||'Non renseigné',x=map.get(key)||{key,trades:[],pnl:0,r:0,wins:0,losses:0,be:0};x.trades.push(t);x.pnl+=Number(t.pnl)||0;x.r+=Number(t.resultR)||0;const res=tradeResult(t);if(res==='win')x.wins++;else if(res==='loss')x.losses++;else x.be++;map.set(key,x)});return [...map.values()].map(x=>({...x,winRate:x.trades.length?x.wins/x.trades.length*100:0,profitFactor:statsFor(x.trades).profitFactor})).sort((a,b)=>b.pnl-a.pnl)
  }
  function bestWorstBucket(trades,kind='day'){
    const rows=aggregatePeriod(trades,kind);if(!rows.length)return {best:null,worst:null};return {best:[...rows].sort((a,b)=>b.pnl-a.pnl)[0],worst:[...rows].sort((a,b)=>a.pnl-b.pnl)[0]}
  }
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
  function shiftPeriod(ref,period,delta){const d=new Date(ref);if(period==='day')d.setDate(d.getDate()+delta);else if(period==='week')d.setDate(d.getDate()+delta*7);else if(period==='month')d.setMonth(d.getMonth()+delta);else if(period==='quarter')d.setMonth(d.getMonth()+delta*3);else if(period==='year')d.setFullYear(d.getFullYear()+delta);return d}
  function periodTitle(period,ref=new Date()){
    const {start,end}=rangeFor(period,ref);
    if(period==='day')return start.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
    if(period==='week')return `${start.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})} – ${end.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})}`;
    if(period==='month')return start.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    if(period==='quarter')return `T${Math.floor(start.getMonth()/3)+1} ${start.getFullYear()}`;
    if(period==='year')return String(start.getFullYear());
    if(period==='all')return 'Tout l’historique';
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
      if(q&&!`${t.asset} ${t.direction} ${account?.name||''} ${strategy} ${t.timeframe||''} ${t.session||''} ${t.confirmation||''} ${t.note||''}`.toLowerCase().includes(q))return false;
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
  async function uploadTradeMediaFiles(tradeId,kind,files,{refresh=true}={}){
    const t=state.trades.find(x=>x.id===tradeId),list=[...(files||[])].filter(Boolean);if(!t||!list.length)return;
    t.media=t.media||{before:[],after:[]};if(!Array.isArray(t.media[kind]))t.media[kind]=t.media[kind]?[t.media[kind]]:[];
    try{
      toast(list.length>1?`Compression de ${list.length} captures…`:'Compression de la capture…');
      for(let i=0;i<list.length;i++){
        const blob=await compressTradeImage(list[i]);let ref;
        if(currentUser&&supabase){const path=`${currentUser.id}/${tradeId}/${kind}-${Date.now()}-${i}.jpg`;const {error}=await supabase.storage.from('trade-media').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(error)throw error;ref={type:'storage',path}}
        else ref={type:'data',dataUrl:await blobToDataUrl(blob)};
        t.media[kind].push(ref);
      }
      save();toast(`${list.length} capture${list.length>1?'s':''} enregistrée${list.length>1?'s':''}.`,'success');if(refresh)openTradeDetails(tradeId)
    }catch(e){console.warn(e);toast(e.message||'Impossible d’enregistrer la capture.','error')}
  }
  async function uploadTradeMedia(tradeId,kind,file){return uploadTradeMediaFiles(tradeId,kind,[file])}
  async function mediaUrl(ref){if(!ref)return null;if(ref.type==='data')return ref.dataUrl||null;if(ref.type==='storage'&&supabase){const {data,error}=await supabase.storage.from('trade-media').createSignedUrl(ref.path,3600);if(error)return null;return data?.signedUrl||null}return null}
  function openMediaLightbox(url,title='Capture de trade'){
    const back=$('#media-lightbox'),img=$('#media-lightbox-img'),caption=$('#media-lightbox-caption');if(!back||!img)return;img.src=url;img.style.transform='scale(1)';img.dataset.zoom='1';caption.textContent=title;back.hidden=false
  }
  function closeMediaLightbox(){const back=$('#media-lightbox');if(back)back.hidden=true}
  function changeMediaZoom(delta){const img=$('#media-lightbox-img');if(!img)return;const z=Math.min(3,Math.max(.6,Number(img.dataset.zoom||1)+delta));img.dataset.zoom=String(z);img.style.transform=`scale(${z})`}
  async function hydrateTradeMedia(t){
    for(const kind of ['before','after']){
      const gallery=$(`#trade-media-${kind}-gallery`),empty=$(`#trade-media-${kind}-empty`);if(!gallery)continue;gallery.innerHTML='';const refs=Array.isArray(t.media?.[kind])?t.media[kind]:(t.media?.[kind]?[t.media[kind]]:[]);
      for(let i=0;i<refs.length;i++){const url=await mediaUrl(refs[i]);if(!url)continue;const btn=document.createElement('button');btn.type='button';btn.className='media-thumb';btn.innerHTML=`<img src="${url}" alt="Capture ${kind==='before'?'avant':'après'} ${i+1}"><span>Ouvrir</span>`;btn.onclick=()=>openMediaLightbox(url,`${t.asset} · ${kind==='before'?'Avant':'Après'} · ${i+1}`);gallery.appendChild(btn)}
      if(empty)empty.hidden=gallery.children.length>0;
    }
  }
  function bindTradeMediaDropzones(tradeId){
    $$('[data-trade-drop]').forEach(zone=>{const kind=zone.dataset.tradeDrop,input=zone.querySelector('input[type=file]');if(input)input.onchange=e=>uploadTradeMediaFiles(tradeId,kind,e.target.files);['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag-over')}));['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag-over')}));zone.addEventListener('drop',e=>uploadTradeMediaFiles(tradeId,kind,e.dataTransfer?.files))})
  }
  function bindDraftMedia(draft){
    draft.beforeFiles=draft.beforeFiles||[];const zone=$('#draft-media-drop'),input=$('#draft-media-input'),list=$('#draft-media-list');if(!zone||!input)return;
    const render=()=>{list.innerHTML=draft.beforeFiles.length?draft.beforeFiles.map((f,i)=>`<span class="draft-file-chip">${esc(f.name)} <button type="button" data-remove-draft="${i}">×</button></span>`).join(''):'<span class="row-sub">Aucune capture ajoutée</span>';$$('[data-remove-draft]',list).forEach(b=>b.onclick=()=>{draft.beforeFiles.splice(Number(b.dataset.removeDraft),1);render()})};
    const add=files=>{draft.beforeFiles.push(...[...(files||[])].filter(f=>f.type.startsWith('image/')));render()};input.onchange=e=>add(e.target.files);['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag-over')}));['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag-over')}));zone.addEventListener('drop',e=>add(e.dataTransfer?.files));render()
  }

  function nextAction(){
    if(!state.accounts.length)return {title:'Créer un compte de trading',sub:'Ajoutez votre premier compte avant de journaliser une position.',action:'accounts'};
    if(!state.strategies.some(s=>s.active&&!s.archived))return {title:'Configurer votre stratégie',sub:'ALTITUDE Trade vérifiera ensuite votre checklist avant chaque trade.',action:'strategies'};
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
    if(period==='day'){
      start=new Date(ref);start.setHours(0,0,0,0);end.setHours(23,59,59,999);
    }else if(period==='week'){
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

  function statsFor(trades,initialCapital=0){
    const c=trades.filter(t=>t.status==='closed'),wins=c.filter(t=>Number(t.resultR)>0),losses=c.filter(t=>Number(t.resultR)<0),be=c.filter(t=>Number(t.resultR)===0);
    const pnl=c.reduce((s,t)=>s+(Number(t.pnl)||0),0),totalR=c.reduce((s,t)=>s+(Number(t.resultR)||0),0),grossWin=wins.reduce((s,t)=>s+Math.max(0,Number(t.pnl)||0),0),grossLoss=Math.abs(losses.reduce((s,t)=>s+Math.min(0,Number(t.pnl)||0),0));
    let equity=Number(initialCapital)||0,peak=equity,maxDD=0,maxDDPct=0,winStreak=0,lossStreak=0,bestWin=0,worstLoss=0,currentWin=0,currentLoss=0;
    c.slice().sort((a,b)=>new Date(a.closedAt||a.openedAt)-new Date(b.closedAt||b.openedAt)).forEach(t=>{equity+=Number(t.pnl)||0;peak=Math.max(peak,equity);const dd=equity-peak,ddPct=peak>0?dd/peak*100:0;maxDD=Math.min(maxDD,dd);maxDDPct=Math.min(maxDDPct,ddPct);if(Number(t.resultR)>0){winStreak++;lossStreak=0;currentWin=winStreak;currentLoss=0;bestWin=Math.max(bestWin,winStreak)}else if(Number(t.resultR)<0){lossStreak++;winStreak=0;currentLoss=lossStreak;currentWin=0;worstLoss=Math.max(worstLoss,lossStreak)}else{winStreak=lossStreak=currentWin=currentLoss=0}});
    const rated=c.filter(t=>t.quality==='good'||t.quality==='bad'),good=rated.filter(t=>t.quality==='good').length;
    const winRs=wins.map(t=>Number(t.resultR)||0),lossRs=losses.map(t=>Math.abs(Number(t.resultR)||0)),risks=c.map(t=>Number(t.riskUSD)||0).filter(v=>v>0),durations=c.map(durationMinutes).filter(v=>v>0);
    const bestTrade=c.length?[...c].sort((a,b)=>(Number(b.pnl)||0)-(Number(a.pnl)||0))[0]:null,worstTrade=c.length?[...c].sort((a,b)=>(Number(a.pnl)||0)-(Number(b.pnl)||0))[0]:null;
    return {closed:c.length,wins:wins.length,losses:losses.length,be:be.length,pnl,totalR,winRate:c.length?wins.length/c.length*100:0,lossRate:c.length?losses.length/c.length*100:0,beRate:c.length?be.length/c.length*100:0,avgR:c.length?totalR/c.length:0,expectancyR:c.length?totalR/c.length:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),maxDrawdown:maxDD,maxDrawdownPct:maxDDPct,bestWinStreak:bestWin,worstLossStreak:worstLoss,currentWinStreak:currentWin,currentLossStreak:currentLoss,qualityRate:rated.length?good/rated.length*100:null,rated:rated.length,avgWinR:average(winRs),avgLossR:average(lossRs),payoffR:average(lossRs)?average(winRs)/average(lossRs):0,avgRisk:average(risks),avgHoldMinutes:average(durations),bestTrade,worstTrade}
  }

  function equitySeries(trades=closedTrades(), accountId='all'){
    const list=trades.filter(t=>accountId==='all'||t.accountId===accountId).slice().sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt));let v=0;return list.map(t=>(v+=Number(t.pnl)||0));
  }

  function toast(message,type='info'){const stack=$('#toast-stack');if(!stack)return;const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;stack.appendChild(el);setTimeout(()=>el.remove(),type==='error'?6500:3800)}
  function showModal(html,large=false){const back=$('#modal-backdrop'),m=$('#modal');const tradeWizard=html.includes('trade-wizard-progress'),tradeDetails=html.includes('trade-media-grid')||html.includes('trade-detail-metrics');m.className=`modal${large?' large':''}${tradeWizard?' trade-modal':''}${tradeDetails?' trade-detail-modal':''}`;m.innerHTML=html;back.hidden=false;document.body.classList.add('modal-open');$$('[data-close-modal]',m).forEach(b=>b.onclick=hideModal);setTimeout(()=>m.querySelector('input,select,textarea,button')?.focus(),30)}
  function hideModal(){$('#modal-backdrop').hidden=true;$('#modal').innerHTML='';document.body.classList.remove('modal-open')}
  function confirmDialog({title,text,confirmLabel='Confirmer',danger=false,onConfirm}){showModal(`<div class="modal-head"><div><div class="modal-title">${esc(title)}</div><div class="modal-sub">${esc(text)}</div></div><button class="close-btn" data-close-modal>×</button></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirm-dialog">${esc(confirmLabel)}</button></div>`);$('#confirm-dialog').onclick=()=>{hideModal();onConfirm?.()}}

  function setView(name){currentView=name;$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));$$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));renderView(name);if(innerWidth<620)$('#sidebar')?.classList.remove('mobile-open')}
  function renderAll(){['dashboard','accounts','strategies','journal','history','productivity','weekly','rules','profile','settings'].forEach(renderView);renderProfileMini();renderThemeMini();updateSyncBadge()}
  function renderView(name){
    const fn={dashboard:renderDashboard,accounts:renderAccounts,strategies:renderStrategies,journal:renderJournal,history:renderHistory,productivity:renderProductivity,weekly:renderWeekly,rules:renderRules,profile:renderProfile,settings:renderSettings}[name];
    try{
      if(typeof fn!=='function') throw new Error(`Vue inconnue : ${name}`);
      fn();
    }catch(error){
      console.error(`[ALTITUDE Trade] Erreur de rendu — ${name}`,error);
      const el=$(`#view-${name}`);
      if(el) el.innerHTML=`<div class="card render-error"><div class="eyebrow">ALTITUDE TRADE</div><div class="page-title">Cette vue n’a pas pu s’afficher.</div><p class="page-sub">${esc(error?.message||'Erreur inconnue')}</p><pre style="white-space:pre-wrap;opacity:.7;font-size:11px;max-height:130px;overflow:auto">${esc(error?.stack||'')}</pre><button class="btn btn-primary" data-retry-view="${esc(name)}">Réessayer</button></div>`;
      $(`[data-retry-view="${name}"]`,el||document)?.addEventListener('click',()=>renderView(name));
    }
  }

  function displayName(){return state.profile.firstName||state.profile.displayName||accountProfile?.display_name||currentUser?.user_metadata?.display_name||'Trader'}
  function initials(){const n=`${state.profile.firstName||''} ${state.profile.lastName||''}`.trim()||displayName();return n.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'AT'}
  function avatarHtml(size=''){return `<div class="avatar ${size}">${state.profile.avatar?`<img src="${state.profile.avatar}" alt="">`:esc(initials())}</div>`}
  function renderProfileMini(){const el=$('#profile-mini');if(!el)return;el.innerHTML=`${avatarHtml()}<div><strong>${esc(displayName())}</strong><span>${esc(accountProfile?.plan||'Compte')}</span></div>`;el.onclick=()=>setView('profile')}
  function renderThemeMini(){const el=$('#theme-mini');if(!el)return;const themes=['midnight','summit','obsidian','glacier','carbon'];el.innerHTML=themes.map(t=>`<button class="theme-dot ${state.preferences.theme===t?'active':''}" data-mini-theme="${t}" title="${t}"></button>`).join('');$$('[data-mini-theme]',el).forEach(b=>b.onclick=()=>{state.preferences.theme=b.dataset.miniTheme;save();renderAll()})}

  function pageHead(title,sub,actions=''){return `<div class="page-head"><div><div class="page-title">${esc(title)}</div><div class="page-sub">${esc(sub)}</div></div><div class="page-actions">${actions}</div></div>`}
  function periodTabs(active=dashboardPeriod,attr='data-period'){
    return `<div class="period-tabs">${[['day','Jour'],['week','Semaine'],['month','Mois'],['quarter','Trimestre'],['year','Année'],['all','Tout']].map(([v,l])=>`<button class="${active===v?'active':''}" ${attr}="${v}">${l}</button>`).join('')}</div>`
  }

  function lineChart(values){
    if(!values.length)return `<div class="empty" style="height:180px;display:grid;place-items:center">Aucune donnée pour cette période.</div>`;
    const w=640,h=180,p=12,min=Math.min(0,...values),max=Math.max(1,...values),span=max-min||1,id=`area-${Math.random().toString(36).slice(2,8)}`;const pts=values.map((v,i)=>`${p+(i/(Math.max(values.length-1,1)))*(w-p*2)},${h-p-((v-min)/span)*(h-p*2)}`).join(' ');
    return `<svg class="line-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--success)" stop-opacity=".26"/><stop offset="1" stop-color="var(--success)" stop-opacity="0"/></linearGradient></defs>${[.25,.5,.75].map(r=>`<line class="chart-grid-line" x1="0" x2="${w}" y1="${h*r}" y2="${h*r}"/>`).join('')}<polygon class="chart-area" style="fill:url(#${id})" points="${p},${h-p} ${pts} ${w-p},${h-p}"/><polyline class="chart-line" points="${pts}"/></svg>`
  }
  function bars(trades){const c=trades.filter(t=>t.status==='closed').slice(-26);if(!c.length)return `<div class="empty" style="height:130px">Aucun trade clôturé.</div>`;const max=Math.max(1,...c.map(t=>Math.abs(Number(t.resultR)||0)));return `<div class="performance-bars">${c.map(t=>`<span class="bar ${(t.resultR||0)<0?'neg':''}" style="height:${24+Math.abs(t.resultR||0)/max*80}px" title="${fmtR(t.resultR)}"></span>`).join('')}</div>`}

  function pnlBucketChart(trades,period='month',currency='USD'){
    const kind=['year','all'].includes(period)?'month':['quarter'].includes(period)?'week':'day';
    const rows=aggregatePeriod(trades,kind).slice(-18);
    if(!rows.length)return `<div class="chart-empty-state"><strong>Le graphique se construira avec vos trades.</strong><span>Les gains et pertes de la période apparaîtront ici automatiquement.</span></div>`;
    const max=Math.max(1,...rows.map(x=>Math.abs(x.pnl)));
    return `<div class="pnl-bucket-chart">${rows.map(x=>{const h=Math.max(8,Math.abs(x.pnl)/max*92);return `<div class="pnl-bucket-item" title="${esc(x.key)} · ${fmtMoney(x.pnl,currency)}"><span class="pnl-bucket-value ${x.pnl>=0?'up':'down'}">${x.pnl>=0?'+':''}${Math.round(x.pnl)}</span><div class="pnl-bucket-track"><i class="${x.pnl>=0?'positive':'negative'}" style="height:${h}%"></i></div><small>${esc(x.key.slice(5)||x.key)}</small></div>`}).join('')}</div>`;
  }

  function resultDonut(st){
    const total=Math.max(1,st.wins+st.losses+st.be),w=st.wins/total*100,l=st.losses/total*100;
    const bg=st.closed?`conic-gradient(var(--success) 0 ${w}%, var(--danger) ${w}% ${w+l}%, var(--warning) ${w+l}% 100%)`:`conic-gradient(var(--surface-3) 0 100%)`;
    return `<div class="result-donut-wrap"><div class="result-donut" style="background:${bg}"><div><strong>${st.closed?fmtPct(st.winRate):'—'}</strong><span>Win rate</span></div></div><div class="donut-legend"><span><i class="dot-win"></i>Gagnants <b>${st.wins}</b></span><span><i class="dot-loss"></i>Perdants <b>${st.losses}</b></span><span><i class="dot-be"></i>BE <b>${st.be}</b></span></div></div>`;
  }

  function renderDashboard(){
    const el=$('#view-dashboard');if(!el)return;
    const periodTrades=tradesInPeriod(dashboardPeriod),st=statsFor(periodTrades,globalInitialCapital()),open=openTrades(),recent=sortTrades(state.trades,'newest').slice(0,6),series=equitySeries(periodTrades.filter(t=>t.status==='closed')),action=nextAction();
    const accountPerf=state.accounts.map(a=>({account:a,stats:statsFor(periodTrades.filter(t=>t.accountId===a.id),a.initialBalance)}));
    const assets=breakdownBy(periodTrades,t=>t.asset).slice(0,6),currency=primaryAccount()?.currency||'USD';
    el.innerHTML=`
      <div class="dashboard-welcome">
        <div><p class="eyebrow">ALTITUDE TRADE · ${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</p><h1>${esc(displayName())}, votre trading en chiffres.</h1><p class="dashboard-intro">Vue globale de tous vos comptes, vos positions et votre progression. Chaque chiffre vient de votre journal.</p></div>
        <button class="next-action" id="dashboard-next-action"><span>PROCHAINE ACTION</span><strong>${esc(action.title)}</strong><small>${esc(action.sub)}</small></button>
      </div>
      <div class="analytics-toolbar card"><div><span class="eyebrow">VUE GLOBALE</span><strong>${esc(periodLabel(dashboardPeriod))}</strong></div>${periodTabs(dashboardPeriod,'data-dashboard-period')}</div>
      <div class="grid metric-grid metric-grid-8">
        ${metric('Capital total',totalBalanceLabel(),`${state.accounts.length} compte${state.accounts.length>1?'s':''}`,true)}
        ${metric('PnL période',fmtMoney(st.pnl,currency),fmtR(st.totalR),st.pnl>=0)}
        ${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} G · ${st.losses} P · ${st.be} BE`)}
        ${metric('Profit factor',st.closed?(Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—')):'—','Gains / pertes brutes')}
        ${metric('Espérance',st.closed?fmtR(st.expectancyR):'—','Par trade')}
        ${metric('Drawdown max',st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—',st.closed?fmtMoney(st.maxDrawdown,currency):'—',false)}
        ${metric('Risque moyen',st.closed?fmtMoney(st.avgRisk,currency):'—','Par position')}
        ${metric('Trades',String(st.closed),`${open.length} en cours`)}
      </div>
      <div class="dashboard-primary dashboard-global-grid">
        <section class="card performance-calm"><div class="card-head"><div><div class="card-title">Courbe de progression</div><div class="page-sub">PnL cumulé · tous comptes</div></div><span class="pill">${esc(periodLabel(dashboardPeriod))}</span></div>${lineChart(series)}<div class="stat-line"><span><b>${st.closed}</b> trades</span><span><b>${st.closed?fmtR(st.avgWinR):'—'}</b> gain moyen</span><span><b>${st.closed?fmtR(-st.avgLossR):'—'}</b> perte moyenne</span><span><b>${st.payoffR?st.payoffR.toFixed(2):'—'}</b> payoff</span></div></section>
        <section class="card open-focus"><div class="card-head"><div><div class="card-label">EN COURS</div><div class="card-title">Trades ouverts</div></div><span class="pill">${open.length}</span></div>${open.length?open.slice(0,4).map(openPositionCompact).join(''):`<div class="quiet-empty"><strong>Aucune position ouverte</strong><span>Votre prochaine position apparaîtra ici.</span></div>`}<button class="btn btn-primary" id="dash-new-trade" style="width:100%;margin-top:12px">+ Nouveau trade</button></section>
      </div>
      <div class="dashboard-secondary dashboard-global-grid">
        <section class="card"><div class="card-head"><div><div class="card-title">Performance par compte</div><div class="page-sub">Comparer Deriv, JustMarkets, FundedNext et vos autres comptes</div></div><button class="btn btn-ghost" id="dash-manage-accounts">Analyser</button></div><div class="account-performance-list">${accountPerf.map(({account:a,stats:x})=>`<button class="account-performance-row" data-dash-account="${a.id}"><span class="account-dot" style="background:${a.color}"></span><span><b>${esc(a.name)}</b><small>${esc(accountMarketLabel(a))}</small></span><span class="mono ${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,a.currency)}</span><span class="mono">${x.closed?fmtPct(x.winRate):'—'}</span></button>`).join('')}</div></section>
        <section class="card"><div class="card-head"><div><div class="card-title">Actifs</div><div class="page-sub">Ce qui contribue réellement à vos résultats</div></div><button class="btn btn-ghost" id="dash-stats">Statistiques</button></div>${assets.length?`<div class="asset-breakdown">${assets.map(x=>`<div class="asset-breakdown-row"><span><b>${esc(x.key)}</b><small>${x.trades.length} trades · ${fmtPct(x.winRate)}</small></span><strong class="mono ${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join('')}</div>`:'<div class="quiet-empty">Pas encore assez de trades clôturés.</div>'}</section>
      </div>
      <div class="dashboard-visual-grid">
        <section class="card"><div class="card-head"><div><div class="card-title">PnL dans le temps</div><div class="page-sub">Gains et pertes agrégés sur la période</div></div></div>${pnlBucketChart(periodTrades,dashboardPeriod,currency)}</section>
        <section class="card"><div class="card-head"><div><div class="card-title">Répartition des résultats</div><div class="page-sub">Gagnants · perdants · break-even</div></div></div>${resultDonut(st)}</section>
        <section class="card"><div class="card-head"><div><div class="card-title">Drawdown</div><div class="page-sub">Repli cumulé depuis le dernier plus haut</div></div><span class="down mono">${st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—'}</span></div>${lineChart(drawdownSeries(periodTrades.filter(t=>t.status==='closed')))}</section>
      </div>
      <section class="card" style="margin-top:12px"><div class="card-head"><div><div class="card-title">Derniers trades</div><div class="page-sub">Tous comptes confondus</div></div><button class="btn btn-ghost" id="dash-all-trades">Voir le journal</button></div>${recent.length?tradeRows(recent,true):`<div class="quiet-empty"><strong>Votre journal est encore vide.</strong><span>Créez votre premier trade pour commencer à alimenter toutes les statistiques.</span></div>`}</section>`;
    $$('[data-dashboard-period]').forEach(b=>b.onclick=()=>{dashboardPeriod=b.dataset.dashboardPeriod;renderDashboard()});
    $('#dash-manage-accounts')?.addEventListener('click',()=>setView('accounts'));$('#dash-stats')?.addEventListener('click',()=>setView('productivity'));$('#dash-all-trades')?.addEventListener('click',()=>setView('journal'));$('#dash-new-trade')?.addEventListener('click',openNewTrade);$('#dashboard-next-action')?.addEventListener('click',()=>action.action==='new-trade'?openNewTrade():setView(action.action));$$('[data-open-trade]').forEach(b=>b.onclick=()=>openCloseTradeModal(b.dataset.openTrade));$$('[data-trade-id]').forEach(b=>b.onclick=()=>openTradeDetails(b.dataset.tradeId));$$('[data-dash-account]').forEach(b=>b.onclick=()=>{selectedAccountId=b.dataset.dashAccount;setView('accounts')})
  }

  function metric(label,value,sub,positive=true){return `<div class="card metric-card"><div class="metric-top"><div class="card-label">${esc(label)}</div></div><div class="card-value" style="margin-top:16px">${value}</div><div class="metric-change ${positive?'up':''}">${esc(sub)}</div></div>`}
  function smallMetric(label,value){return `<div><div class="card-label">${esc(label)}</div><div class="mono" style="margin-top:4px;font-size:14px;font-weight:700">${value}</div></div>`}
  function openPositionCompact(t){const acc=accountById(t.accountId);return `<div class="account-row" style="grid-template-columns:1fr .65fr auto"><div><div class="row-main">${esc(t.asset)} <span class="pill ${t.direction==='BUY'?'success':'danger'}">${t.direction}</span></div><div class="row-sub">${esc(acc?.name||'Compte')} · ${esc(strategyById(t.strategyId)?.name||'Sans stratégie')}</div></div><div class="mono">${fmtMoney(t.realizedPnl||0,acc?.currency||'USD')}</div><button class="btn" data-open-trade="${t.id}">Gérer</button></div>`}

  function renderAccounts(){
    const el=$('#view-accounts');if(!el)return;const primary=primaryAccount();if(!selectedAccountId||!accountById(selectedAccountId))selectedAccountId=primary?.id||state.accounts[0]?.id||null;const selected=accountById(selectedAccountId);const pTrades=selected?tradesInPeriod(accountAnalyticsPeriod,selected.id):[],st=selected?statsFor(pTrades,selected.initialBalance):statsFor([]),series=selected?equitySeries(pTrades.filter(t=>t.status==='closed'),selected.id):[],assets=selected?breakdownBy(pTrades,t=>t.asset):[];
    el.innerHTML=`${pageHead('Comptes','Un capital, un historique et des statistiques séparés pour chaque environnement.','<button class="btn btn-primary" id="add-account">+ Ajouter un compte</button>')}
      <div class="account-summary card"><div><span>Capital global</span><strong>${totalBalanceLabel()}</strong></div><div><span>Comptes</span><strong>${state.accounts.length}</strong></div><div><span>Compte principal</span><strong>${esc(primary?.name||'—')}</strong></div></div>
      <div class="account-cards">${state.accounts.map(a=>{const ast=statsFor(state.trades.filter(t=>t.accountId===a.id),a.initialBalance);return `<article class="card account-card ${selected?.id===a.id?'selected':''}"><div class="card-head"><div><div class="row-main"><span class="account-dot" style="background:${a.color}"></span>${esc(a.name)} ${a.active?'<span class="pill success">Principal</span>':''}</div><div class="row-sub">${esc(a.broker||'Courtier non renseigné')} · ${esc(accountMarketLabel(a))}</div></div><button class="btn" data-edit-account="${a.id}">Modifier</button></div><div class="account-balance-total">${fmtMoney(a.balance,a.currency)}</div><div class="account-card-stats"><span>PnL total <b class="${ast.pnl>=0?'up':'down'}">${fmtMoney(ast.pnl,a.currency)}</b></span><span>Win rate <b>${ast.closed?fmtPct(ast.winRate):'—'}</b></span><span>Drawdown <b>${ast.closed?fmtPct(Math.abs(ast.maxDrawdownPct)):'—'}</b></span></div><div class="account-assets">${(a.assetList||[]).map(x=>`<span>${esc(x)}</span>`).join('')}</div><button class="btn btn-ghost" data-analyse-account="${a.id}" style="width:100%;margin-top:12px">Voir les statistiques</button></article>`}).join('')}</div>
      ${selected?`<section class="account-analytics card"><div class="card-head"><div><div class="eyebrow">ANALYSE DU COMPTE</div><div class="card-title">${esc(selected.name)}</div><div class="page-sub">${esc(selected.broker)} · ${esc(accountMarketLabel(selected))}</div></div>${periodTabs(accountAnalyticsPeriod,'data-account-period')}</div><div class="grid metric-grid metric-grid-8 compact-metrics">${metric('Solde',fmtMoney(selected.balance,selected.currency),`Initial ${fmtMoney(selected.initialBalance,selected.currency)}`)}${metric('PnL',fmtMoney(st.pnl,selected.currency),fmtR(st.totalR),st.pnl>=0)}${metric('Trades',String(st.closed),`${st.wins} G · ${st.losses} P`)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${fmtPct(st.lossRate)} loss`)}${metric('Profit factor',st.closed?(Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—')):'—','')}${metric('Espérance',st.closed?fmtR(st.expectancyR):'—','Par trade')}${metric('Max DD',st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—',fmtMoney(st.maxDrawdown,selected.currency),false)}${metric('Risque moyen',st.closed?fmtMoney(st.avgRisk,selected.currency):'—','')}</div><div class="two-col account-analytics-grid"><div class="analytics-chart-panel">${lineChart(series)}</div><div><div class="card-label">Performance par actif</div>${assets.length?assets.slice(0,8).map(x=>`<div class="asset-breakdown-row"><span><b>${esc(x.key)}</b><small>${x.trades.length} trades · ${fmtPct(x.winRate)}</small></span><strong class="mono ${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,selected.currency)}</strong></div>`).join(''):'<div class="quiet-empty">Aucune donnée pour cette période.</div>'}</div></div></section>`:''}`;
    $('#add-account').onclick=()=>openAccountModal();$$('[data-edit-account]').forEach(b=>b.onclick=()=>openAccountModal(b.dataset.editAccount));$$('[data-analyse-account]').forEach(b=>b.onclick=()=>{selectedAccountId=b.dataset.analyseAccount;renderAccounts()});$$('[data-account-period]').forEach(b=>b.onclick=()=>{accountAnalyticsPeriod=b.dataset.accountPeriod;renderAccounts()})
  }

  function openAccountModal(id=null){
    const a=id?accountById(id):null;
    showModal(`<div class="modal-head"><div><div class="modal-title">${a?'Modifier le compte':'Ajouter un compte'}</div><div class="modal-sub">Solde, risque, broker et univers d’actifs restent propres à ce compte.</div></div><button class="close-btn" data-close-modal>×</button></div>
      <div class="form-grid"><div class="field"><label>Nom du compte</label><input id="acc-name" value="${esc(a?.name||'')}"></div><div class="field"><label>Courtier / Prop firm</label><input id="acc-broker" value="${esc(a?.broker||'')}"></div><div class="field"><label>Type</label><select id="acc-type"><option value="personal">Personnel</option><option value="prop">Prop firm</option><option value="demo">Démo</option></select></div><div class="field"><label>Marché</label><select id="acc-market"><option value="forex">Forex / CFD</option><option value="synthetic">Indices synthétiques</option><option value="prop">Prop firm</option></select></div><div class="field"><label>Devise</label><select id="acc-currency"><option>USD</option><option>EUR</option><option>GBP</option><option>CHF</option><option>CAD</option></select></div><div class="field"><label>Capital initial</label><input id="acc-initial-balance" inputmode="decimal" value="${a?.initialBalance??a?.balance??''}"></div><div class="field"><label>Solde actuel</label><input id="acc-balance" inputmode="decimal" value="${a?.balance??''}"></div><div class="field"><label>Mode de risque</label><select id="acc-risk-mode"><option value="fixed">Montant fixe</option><option value="percent">Pourcentage du solde</option></select></div><div class="field"><label>Risque par trade</label><input id="acc-risk" inputmode="decimal" value="${a?.riskValue??1}"></div><div class="field" style="grid-column:1/-1"><label>Actifs disponibles</label><input id="acc-assets" value="${esc((a?.assetList||[]).join(', '))}" placeholder="BTCUSD, GBPJPY, XAUUSD, US30"><small>Séparez les actifs par des virgules. Ils seront proposés dans Nouveau trade.</small></div>${a?'<div class="field" style="grid-column:1/-1"><label>Motif si le solde change</label><input id="acc-adjust-reason" placeholder="Dépôt, retrait, correction…"></div>':''}</div>
      <label class="check-row"><input type="checkbox" id="acc-active" ${a?.active?'checked':''}><span>Définir comme compte principal</span></label>
      <div class="modal-footer">${a?'<button class="btn btn-danger" id="delete-account-item">Supprimer</button>':''}<button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-account">Enregistrer</button></div>`);
    $('#acc-currency').value=a?.currency||'USD';$('#acc-risk-mode').value=a?.riskMode||'percent';$('#acc-type').value=a?.accountType||'personal';$('#acc-market').value=a?.marketType||'forex';
    $('#save-account').onclick=()=>{const name=$('#acc-name').value.trim(),initialBalance=num($('#acc-initial-balance').value),balance=num($('#acc-balance').value),risk=num($('#acc-risk').value),assets=$('#acc-assets').value.split(',').map(x=>x.trim()).filter(Boolean);if(!name||!Number.isFinite(initialBalance)||initialBalance<0||!Number.isFinite(balance)||balance<0||!Number.isFinite(risk)||risk<0){toast('Vérifiez le nom, le capital, le solde et le risque.','error');return}if(a){const old=Number(a.balance||0);if(old!==balance){a.balanceAdjustments.push({at:new Date().toISOString(),from:old,to:balance,delta:Number((balance-old).toFixed(2)),reason:$('#acc-adjust-reason').value.trim()||'Ajustement manuel'})}Object.assign(a,{name,broker:$('#acc-broker').value.trim(),accountType:$('#acc-type').value,marketType:$('#acc-market').value,currency:$('#acc-currency').value,initialBalance,balance,riskMode:$('#acc-risk-mode').value,riskValue:risk,assetList:assets})}else state.accounts.push({id:uid('acc'),name,broker:$('#acc-broker').value.trim(),accountType:$('#acc-type').value,marketType:$('#acc-market').value,currency:$('#acc-currency').value,initialBalance,balance,riskMode:$('#acc-risk-mode').value,riskValue:risk,active:false,color:['#8b5cf6','#38bdf8','#34d399','#f59e0b'][state.accounts.length%4],assetList:assets,balanceAdjustments:[],createdAt:new Date().toISOString()});if($('#acc-active').checked){state.accounts.forEach(x=>x.active=false);(a||state.accounts.at(-1)).active=true}save();hideModal();renderAll();toast('Compte enregistré.','success')};
    $('#delete-account-item')?.addEventListener('click',()=>{if(state.accounts.length<=1){toast('Gardez au moins un compte.','error');return}confirmDialog({title:'Supprimer ce compte ?',text:'Les trades existants conserveront le nom historique du compte, mais le compte ne sera plus disponible pour de nouvelles positions.',confirmLabel:'Supprimer',danger:true,onConfirm:()=>{state.accounts=state.accounts.filter(x=>x.id!==a.id);if(!state.accounts.some(x=>x.active)&&state.accounts[0])state.accounts[0].active=true;if(selectedAccountId===a.id)selectedAccountId=state.accounts[0]?.id||null;save();renderAll();toast('Compte supprimé.','success')}})})
  }

  function renderStrategies(){
    const el=$('#view-strategies');if(!el)return;
    if(!hasPremiumAccess()){el.innerHTML=`${pageHead('Stratégies','Le Strategy Builder est inclus dans ALTITUDE Trade Premium.')}<div class="card premium-gate"><p class="eyebrow">PREMIUM</p><h2>Construisez votre propre méthode.</h2><p>Configurez vos conditions d’entrée, confirmations, risque et sorties. ALTITUDE Trade ne fournit aucune stratégie de trading.</p><button class="btn btn-primary" disabled>Abonnement Premium requis</button></div>`;return}
    const list=state.strategies.filter(s=>!s.archived);
    el.innerHTML=`${pageHead('Stratégies','Votre méthode vous appartient. ALTITUDE Trade ne fournit aucune stratégie préchargée.','<button class="btn btn-primary" id="new-strategy">+ Nouvelle stratégie</button>')}<div class="strategy-intro card"><div><p class="eyebrow">STRATEGY BUILDER</p><h2>Transformez votre plan en checklist.</h2><p>À chaque nouveau trade, vous devrez confirmer vos propres règles avant d’accéder au calcul de risque.</p></div><div class="strategy-count"><strong>${list.length}</strong><span>stratégie${list.length>1?'s':''}</span></div></div>${list.length?`<div class="grid">${list.map(st=>`<div class="card"><div class="strategy-row"><div><div class="row-main">${esc(st.name)} ${st.active?'<span class="pill success">Active</span>':'<span class="pill">Inactive</span>'}</div><div class="row-sub">${esc(st.description||'Aucune description')}</div>${st.marketScope||st.timeframe?`<div class="row-sub">${esc(st.marketScope||'Tous marchés')} ${st.timeframe?'· '+esc(st.timeframe):''}</div>`:''}</div><div><div class="row-sub">Règles</div><div class="mono">${strategyRules(st).length}</div></div><div><div class="row-sub">Trades</div><div class="mono">${state.trades.filter(t=>t.strategyId===st.id).length}</div></div><button class="btn" data-edit-strategy="${st.id}">Modifier</button></div></div>`).join('')}</div>`:`<div class="card quiet-empty"><strong>Aucune stratégie configurée.</strong><span>Créez votre méthode, puis ALTITUDE Trade vous demandera de la confirmer avant chaque position.</span><button class="btn btn-primary" id="empty-new-strategy">Créer ma stratégie</button></div>`}`;
    $('#new-strategy').onclick=()=>openStrategyModal();$('#empty-new-strategy')?.addEventListener('click',()=>openStrategyModal());$$('[data-edit-strategy]').forEach(b=>b.onclick=()=>openStrategyModal(b.dataset.editStrategy));
  }

  function strategyRules(s){return [...(s.entryRules||[]),...(s.confirmations||[]),...(s.riskRules||[]),...(s.exitRules||[])]}
  function openStrategyModal(id=null){
    const original=id?strategyById(id):null,s=original||{name:'',description:'',marketScope:'',timeframe:'',tags:[],entryRules:[],confirmations:[],riskRules:[],exitRules:[],active:true};
    showModal(`<div class="modal-head"><div><div class="modal-title">${id?'Modifier la stratégie':'Nouvelle stratégie'}</div><div class="modal-sub">Définissez uniquement vos règles. ALTITUDE Trade n’invente aucun signal.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Nom</label><input id="strat-name" value="${esc(s.name)}" placeholder="Ex. Breakout London"></div><div class="field"><label>Description</label><input id="strat-desc" value="${esc(s.description||'')}" placeholder="Une phrase pour reconnaître ce plan"></div><div class="field"><label>Marchés concernés</label><input id="strat-market" value="${esc(s.marketScope||'')}" placeholder="Ex. XAUUSD, NAS100"></div><div class="field"><label>Unité(s) de temps</label><input id="strat-timeframe" value="${esc(s.timeframe||'')}" placeholder="Ex. H1 / M15 / M5"></div></div><div class="strategy-builder">${ruleEditor('Conditions d’entrée','entryRules',s.entryRules)}${ruleEditor('Confirmations','confirmations',s.confirmations)}${ruleEditor('Règles de risque','riskRules',s.riskRules)}${ruleEditor('Validation & sortie','exitRules',s.exitRules)}</div><label class="check-row"><input id="strat-active" type="checkbox" ${s.active?'checked':''}><span>Disponible pour de nouveaux trades</span></label><div class="modal-footer">${id?'<button class="btn" id="archive-strategy">Archiver</button>':''}<button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-strategy">Enregistrer</button></div>`,true);
    const working={entryRules:[...(s.entryRules||[])],confirmations:[...(s.confirmations||[])],riskRules:[...(s.riskRules||[])],exitRules:[...(s.exitRules||[])]};
    function bindRuleEditors(){$$('[data-add-rule]').forEach(b=>b.onclick=()=>{const key=b.dataset.addRule,input=$(`[data-rule-input="${key}"]`),v=input.value.trim();if(v){working[key].push(v);input.value='';refreshRules(key)}});$$('[data-remove-rule]').forEach(b=>b.onclick=()=>{const [key,idx]=b.dataset.removeRule.split(':');working[key].splice(Number(idx),1);refreshRules(key)})}
    function refreshRules(key){const box=$(`[data-rule-list="${key}"]`);box.innerHTML=working[key].map((r,i)=>`<div class="rule-line"><span>${esc(r)}</span><button data-remove-rule="${key}:${i}">×</button></div>`).join('')||'<div class="row-sub">Aucune règle</div>';bindRuleEditors()}
    ['entryRules','confirmations','riskRules','exitRules'].forEach(refreshRules);
    $('#save-strategy').onclick=()=>{const name=$('#strat-name').value.trim();if(!name){toast('Donnez un nom à la stratégie.','error');return}const obj={id:s.id||uid('strat'),name,description:$('#strat-desc').value.trim(),marketScope:$('#strat-market').value.trim(),timeframe:$('#strat-timeframe').value.trim(),tags:s.tags||[],...working,active:$('#strat-active').checked,archived:false,createdAt:s.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};if(id)Object.assign(original,obj);else state.strategies.push(obj);save();hideModal();renderAll();toast('Stratégie enregistrée.','success')};
    $('#archive-strategy')?.addEventListener('click',()=>confirmDialog({title:'Archiver cette stratégie ?',text:'Elle disparaîtra des nouveaux trades, mais restera attachée à l’historique existant.',confirmLabel:'Archiver',onConfirm:()=>{original.archived=true;original.active=false;save();renderAll();toast('Stratégie archivée.','success')}}));
  }

  function ruleEditor(title,key,rules=[]){return `<div class="rule-block"><h4>${esc(title)}</h4><div class="rule-list" data-rule-list="${key}"></div><div class="new-rule-row"><input class="input" data-rule-input="${key}" placeholder="Ajouter une règle…"><button class="btn" data-add-rule="${key}">+</button></div></div>`}

  function renderJournal(){
    const el=$('#view-journal');if(!el)return;
    const filtered=filterTrades(state.trades,journalFilters),pg=paginate(filtered,journalPage);journalPage=pg.page;
    const open=sortTrades(openTrades(),'newest');
    const openRisk=open.reduce((sum,t)=>sum+Math.abs(Number(t.riskUSD||0))*(Number(t.remainingPct??100)/100),0);
    const today=rangeFor('day',new Date());
    const closedToday=state.trades.filter(t=>t.status==='closed').filter(t=>{const d=new Date(t.closedAt||t.openedAt);return d>=today.start&&d<=today.end});
    const pnlToday=closedToday.reduce((sum,t)=>sum+Number(t.pnl||0),0);
    const currency=primaryAccount()?.currency||'USD';
    el.innerHTML=`${pageHead('Journal','Enregistrez le plan, suivez la position puis documentez le résultat. Chaque donnée nourrit vos statistiques.','<button class="btn btn-primary" id="journal-new">+ Nouveau trade</button>')}
      <div class="journal-kpis">
        <div class="journal-kpi"><span>Trades en cours</span><strong>${open.length}</strong><small>positions ouvertes</small></div>
        <div class="journal-kpi"><span>Risque encore exposé</span><strong>${fmtMoney(openRisk,currency)}</strong><small>sur les positions ouvertes</small></div>
        <div class="journal-kpi"><span>PnL aujourd’hui</span><strong class="${pnlToday>=0?'up':'down'}">${fmtMoney(pnlToday,currency)}</strong><small>${closedToday.length} clôture${closedToday.length>1?'s':''}</small></div>
        <div class="journal-kpi"><span>Trades enregistrés</span><strong>${state.trades.length}</strong><small>historique total</small></div>
      </div>
      <section class="card open-trades-board"><div class="card-head"><div><div class="eyebrow">TRADES EN COURS</div><div class="card-title">${open.length} position${open.length>1?'s':''} ouverte${open.length>1?'s':''}</div></div></div>${open.length?`<div class="open-trade-grid">${open.map(t=>{const a=accountById(t.accountId);return `<button class="open-trade-card" data-trade-id="${t.id}"><span class="open-trade-top"><b>${esc(t.asset)}</b><span class="pill ${t.direction==='BUY'?'success':'danger'}">${t.direction}</span></span><span>${esc(a?.name||t.accountNameSnapshot||'Compte')}</span><div class="open-trade-meta"><small>Risque ${fmtMoney(t.riskUSD||0,a?.currency||t.currencySnapshot||'USD')}</small><small>${Number(t.plannedRR||0)>0?'R:R 1:'+Number(t.plannedRR).toFixed(2):'R:R libre'}</small></div><strong>${fmtMoney(t.realizedPnl||0,a?.currency||t.currencySnapshot||'USD')}</strong><small>${t.remainingPct}% restant · ${esc(t.entryTimeframe||t.timeframe||'TF —')} · ${esc(t.confirmation||'Confirmation —')}</small></button>`}).join('')}</div>`:'<div class="quiet-empty"><strong>Aucun trade en cours</strong><span>Les nouvelles positions apparaîtront ici jusqu’à leur clôture.</span></div>'}</section>
      <div class="card filter-bar"><input id="journal-query" class="input" placeholder="Rechercher actif, note, compte…" value="${esc(journalFilters.query)}"><select id="journal-account"><option value="all">Tous les comptes</option>${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><select id="journal-strategy"><option value="all">Toutes les stratégies</option>${state.strategies.map(st=>`<option value="${st.id}">${esc(st.name)}</option>`).join('')}</select><select id="journal-status"><option value="all">Ouverts + clôturés</option><option value="open">Ouverts</option><option value="closed">Clôturés</option></select><select id="journal-result"><option value="all">Tous résultats</option><option value="win">Gagnants</option><option value="loss">Perdants</option><option value="be">Break-even</option></select><select id="journal-sort"><option value="newest">Plus récents</option><option value="oldest">Plus anciens</option><option value="pnl-desc">PnL décroissant</option><option value="r-desc">R décroissant</option></select></div>
      <div class="card"><div class="card-head"><div><div class="card-title">Tous les trades</div><div class="page-sub">${filtered.length} résultat${filtered.length>1?'s':''}</div></div></div>${pg.items.length?tradeRows(pg.items,false):`<div class="quiet-empty">Aucun trade ne correspond à ces filtres.</div>`}${pagerHtml(pg,'journal')}</div>`;
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
    const acc=primaryAccount()||state.accounts[0];
    const renderAssetOptions=id=>{const assets=accountAssets(id);return `${assets.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}<option value="__custom">Autre actif…</option>`};
    showModal(`<div class="modal-head"><div><div class="modal-title">Nouveau trade</div><div class="modal-sub">Étape 1 sur 3 · contexte et plan</div></div><button class="close-btn" data-close-modal>×</button></div>
      <div class="trade-wizard-progress"><span class="active">1 · Plan</span><span>2 · Checklist</span><span>3 · Risque & média</span></div>
      <div class="form-grid">
        <div class="field"><label>Compte</label><select id="trade-account">${state.accounts.map(a=>`<option value="${a.id}" ${a.id===acc?.id?'selected':''}>${esc(a.name)} · ${fmtMoney(a.balance,a.currency)}</option>`).join('')}</select></div>
        <div class="field"><label>Actif</label><select id="trade-asset-select">${renderAssetOptions(acc?.id)}</select><input id="trade-asset-custom" class="input" placeholder="Symbole de l’actif" hidden style="margin-top:8px"></div>
        <div class="field"><label>Stratégie</label><select id="trade-strategy">${strats.map(st=>`<option value="${st.id}">${esc(st.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Direction</label><select id="trade-direction"><option value="BUY">BUY / Long</option><option value="SELL">SELL / Short</option></select></div>
        <div class="field"><label>Contexte de marché</label><select id="trade-market-context"><option value="bullish">Tendance haussière</option><option value="bearish">Tendance baissière</option><option value="range">Range / neutre</option><option value="other">Autre contexte</option></select></div>
        <div class="field"><label>Date / heure d’entrée</label><input id="trade-opened-at" type="datetime-local" value="${localDateTimeValue()}"></div>
        <div class="field"><label>Timeframes tendance</label><select id="trade-trend-timeframe"><option selected>H1 + M30</option><option>H4 + H1</option><option>H2 + H1</option><option>H1</option><option>M30</option><option>Autre</option></select></div>
        <div class="field"><label>Timeframe d’entrée</label><select id="trade-entry-timeframe"><option>M1</option><option selected>M5</option><option>M15</option><option>M30</option><option>H1</option></select></div>
        <div class="field"><label>Session</label><select id="trade-session"><option value="">Non renseignée</option><option>Synthétique</option><option>Asie</option><option>Londres</option><option>New York</option><option>Overlap Londres / New York</option><option>Hors session</option></select></div>
        <div class="field"><label>Confirmation</label><select id="trade-confirmation"><option>Avalement / Engulfing</option><option>Marteau / Hammer</option><option>Doji</option><option>Pin bar / rejet</option><option>Break & retest</option><option>Structure / cassure</option><option>Autre</option></select></div>
        <div class="field"><label>Confiance dans le setup</label><select id="trade-confidence"><option value="0">Non évaluée</option><option value="1">1 / 5</option><option value="2">2 / 5</option><option value="3">3 / 5</option><option value="4">4 / 5</option><option value="5">5 / 5</option></select></div>
        <div class="field"><label>État avant le trade</label><select id="trade-emotion"><option value="">Non renseigné</option><option>Calme</option><option>Concentré</option><option>Pressé</option><option>Stressé</option><option>Fatigué</option><option>FOMO</option></select></div>
        <div class="field" style="grid-column:1/-1"><label>Plan / observation personnelle</label><textarea id="trade-plan-note" rows="4" placeholder="Pourquoi je prends ce trade ? Zone, tendance, ce que j’attends du marché, invalidation…"></textarea></div>
      </div>
      <div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="trade-next">Continuer</button></div>`,true);
    const accountSel=$('#trade-account'),assetSel=$('#trade-asset-select'),custom=$('#trade-asset-custom');
    const refreshAssets=()=>{assetSel.innerHTML=renderAssetOptions(accountSel.value);custom.hidden=true;const a=accountById(accountSel.value);if(a?.marketType==='synthetic')$('#trade-session').value='Synthétique'};
    accountSel.onchange=refreshAssets;assetSel.onchange=()=>{custom.hidden=assetSel.value!=='__custom';if(!custom.hidden)custom.focus()};refreshAssets();
    $('#trade-next').onclick=()=>{const asset=(assetSel.value==='__custom'?custom.value:assetSel.value).trim();if(!asset){toast('Choisissez ou renseignez l’actif.','error');return}const strategy=strategyById($('#trade-strategy').value);const openedAt=$('#trade-opened-at').value?new Date($('#trade-opened-at').value).toISOString():new Date().toISOString();const draft={accountId:accountSel.value,strategyId:strategy.id,asset:asset.toUpperCase(),direction:$('#trade-direction').value,marketContext:$('#trade-market-context').value,trendTimeframe:$('#trade-trend-timeframe').value,entryTimeframe:$('#trade-entry-timeframe').value,timeframe:$('#trade-entry-timeframe').value,session:$('#trade-session').value,confirmation:$('#trade-confirmation').value,confidence:Number($('#trade-confidence').value||0),preTradeEmotion:$('#trade-emotion').value,openedAt,planNote:$('#trade-plan-note').value.trim(),beforeFiles:[],strategySnapshot:{id:strategy.id,name:strategy.name,description:strategy.description,entryRules:[...strategy.entryRules],confirmations:[...strategy.confirmations],riskRules:[...strategy.riskRules],exitRules:[...strategy.exitRules]}};openStrategyConfirmation(draft)};
  }

  function openStrategyConfirmation(draft){
    const st=draft.strategySnapshot,groups=[['Conditions d’entrée',st.entryRules],['Confirmations',st.confirmations],['Risque',st.riskRules],['Sortie',st.exitRules]];
    showModal(`<div class="modal-head"><div><div class="modal-title">Confirmer le plan</div><div class="modal-sub">Étape 2 sur 3 · ${esc(st.name)} · ${esc(draft.asset)} · ${draft.direction}</div></div><button class="close-btn" data-close-modal>×</button></div>
      <div class="trade-wizard-progress"><span class="done">1 · Plan</span><span class="active">2 · Checklist</span><span>3 · Risque & média</span></div>
      <div class="trade-plan-summary"><span>${esc(draft.trendTimeframe)}</span><span>${esc(draft.entryTimeframe)}</span><span>${esc(draft.confirmation)}</span><span>${esc(draft.marketContext==='bullish'?'Tendance haussière':draft.marketContext==='bearish'?'Tendance baissière':draft.marketContext==='range'?'Range / neutre':'Autre contexte')}</span></div>
      <div class="checklist">${groups.map(([group,items])=>items.length?`<div class="check-group"><div class="eyebrow">${esc(group)}</div>${items.map(r=>`<label class="check-row"><input type="checkbox" data-strategy-check><span>${esc(r)}</span></label>`).join('')}</div>`:'').join('')}</div>
      <div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="strategy-confirm-next" disabled>Passer au risque</button></div>`,true);
    const checks=$$('[data-strategy-check]'),next=$('#strategy-confirm-next');const sync=()=>{next.disabled=checks.length?checks.some(x=>!x.checked):false};checks.forEach(c=>c.onchange=sync);sync();next.onclick=()=>openRiskTrade(draft);
  }

  function openRiskTrade(draft){
    const a=accountById(draft.accountId),defaultRiskUSD=accountRiskUSD(a),defaultRiskPct=a?.balance>0?defaultRiskUSD/a.balance*100:0;
    showModal(`<div class="modal-head"><div><div class="modal-title">Risque, niveaux & captures</div><div class="modal-sub">Étape 3 sur 3 · ${esc(a?.name||'Compte')} · ${esc(draft.asset)} · ${draft.direction}</div></div><button class="close-btn" data-close-modal>×</button></div>
      <div class="trade-wizard-progress"><span class="done">1 · Plan</span><span class="done">2 · Checklist</span><span class="active">3 · Risque & média</span></div>
      <div class="form-grid">
        <div class="field"><label>Entrée</label><input id="trade-entry" inputmode="decimal" placeholder="Prix d’entrée"></div>
        <div class="field"><label>Stop loss</label><input id="trade-sl" inputmode="decimal" placeholder="Niveau d’invalidation"></div>
        <div class="field"><label>Take profit <span class="optional">optionnel</span></label><input id="trade-tp" inputmode="decimal" placeholder="Objectif"></div>
        <div class="field"><label>Risque % du compte</label><input id="trade-risk-pct" inputmode="decimal" value="${defaultRiskPct.toFixed(2)}"></div>
        <div class="field"><label>Risque monétaire</label><input id="trade-risk-override" inputmode="decimal" value="${defaultRiskUSD.toFixed(2)}"><small>Montant réellement risqué sur ce trade.</small></div>
        <div class="field"><label>Capital avant trade</label><input value="${fmtMoney(a?.balance||0,a?.currency||'USD')}" disabled></div>
      </div>
      <div id="risk-live"></div>
      <div class="field"><label>Plan / observation</label><textarea id="trade-note" rows="4">${esc(draft.planNote||'')}</textarea></div>
      <div class="draft-dropzone" id="draft-media-drop"><input type="file" id="draft-media-input" accept="image/*" multiple hidden><div><strong>Glissez vos captures avant trade ici</strong><span>Vous pourrez les agrandir ensuite dans le journal.</span></div><button type="button" class="btn" id="draft-media-choose">Choisir des images</button></div><div id="draft-media-list" class="draft-file-list"></div>
      <div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="create-trade" disabled>Enregistrer le trade</button></div>`,true);
    $('#draft-media-choose').onclick=()=>$('#draft-media-input').click();bindDraftMedia(draft);
    let source='usd';
    $('#trade-risk-pct').oninput=()=>{source='pct';const pct=num($('#trade-risk-pct').value);if(Number.isFinite(pct)&&a?.balance>=0)$('#trade-risk-override').value=((a.balance||0)*pct/100).toFixed(2);updateNewTradeRisk(draft)};
    $('#trade-risk-override').oninput=()=>{source='usd';const usd=num($('#trade-risk-override').value);if(Number.isFinite(usd)&&a?.balance>0)$('#trade-risk-pct').value=(usd/a.balance*100).toFixed(2);updateNewTradeRisk(draft)};
    ['trade-entry','trade-sl','trade-tp'].forEach(id=>$(`#${id}`).oninput=()=>updateNewTradeRisk(draft));updateNewTradeRisk(draft);
  }

  function updateNewTradeRisk(draft){
    const a=accountById(draft.accountId),entry=num($('#trade-entry').value),sl=num($('#trade-sl').value),tpRaw=$('#trade-tp').value.trim(),tp=tpRaw?num(tpRaw):null,riskUSD=num($('#trade-risk-override').value),riskPct=num($('#trade-risk-pct').value),riskDist=Math.abs(entry-sl),slCorrect=draft.direction==='BUY'?sl<entry:sl>entry,reward=Number.isFinite(tp)?(draft.direction==='BUY'?tp-entry:entry-tp):null,tpCorrect=!Number.isFinite(tp)||reward>0,rr=Number.isFinite(reward)&&riskDist>0?reward/riskDist:null,units=riskDist>0?riskUSD/riskDist:0,valid=[entry,sl,riskUSD].every(Number.isFinite)&&riskUSD>0&&slCorrect&&riskDist>0&&tpCorrect;
    $('#risk-live').innerHTML=`<div class="risk-preview"><div class="risk-box"><span>Risque</span><strong>${valid?fmtMoney(riskUSD,a?.currency||'USD'):'—'}</strong></div><div class="risk-box"><span>Risque %</span><strong>${valid&&a?.balance>0?fmtPct(riskUSD/a.balance*100):'—'}</strong></div><div class="risk-box"><span>R:R prévu</span><strong>${valid&&Number.isFinite(rr)?`1:${rr.toFixed(2)}`:'Libre'}</strong></div><div class="risk-box"><span>Taille indicative</span><strong>${valid?units.toFixed(4):'—'}</strong></div></div>${valid&&riskUSD>(a?.balance||0)*0.03&&a?.balance>0?'<div class="risk-warning">Risque supérieur à 3% du capital de ce compte. Vérifiez volontairement ce montant avant d’enregistrer.</div>':''}`;
    const btn=$('#create-trade');btn.disabled=!valid;btn.onclick=valid?async()=>{const t={id:uid('trade'),accountId:draft.accountId,accountNameSnapshot:a.name,currencySnapshot:a.currency,strategyId:draft.strategyId,strategySnapshot:draft.strategySnapshot,asset:draft.asset,direction:draft.direction,marketContext:draft.marketContext||'',trendTimeframe:draft.trendTimeframe||'H1 + M30',entryTimeframe:draft.entryTimeframe||'M5',timeframe:draft.entryTimeframe||'M5',session:draft.session||'',confirmation:draft.confirmation||'',confidence:Number(draft.confidence||0),preTradeEmotion:draft.preTradeEmotion||'',entry,sl,tp:Number.isFinite(tp)?tp:null,initialSl:sl,initialTp:Number.isFinite(tp)?tp:null,riskDistance:Number(riskDist.toFixed(8)),plannedRR:Number.isFinite(rr)?Number(rr.toFixed(3)):0,riskUSD:Number(riskUSD.toFixed(2)),riskPct:a.balance>0?Number((riskUSD/a.balance*100).toFixed(3)):Number(riskPct||0),positionSize:Number(units.toFixed(6)),openedAt:draft.openedAt||new Date().toISOString(),status:'open',remainingPct:100,partialExits:[],realizedPnl:0,pnl:0,resultR:null,quality:'unrated',review:{reviewed:false,lesson:'',mistake:'',emotion:'',updatedAt:null},note:$('#trade-note').value.trim(),capitalBefore:a.balance,capitalAfter:null,modifications:[],media:{before:[],after:[]}};state.trades.unshift(t);save();hideModal();renderAll();setView('journal');toast('Trade enregistré dans Trades en cours.','success');if(draft.beforeFiles?.length)await uploadTradeMediaFiles(t.id,'before',draft.beforeFiles,{refresh:false})}:null;
  }

  function openTradeDetails(id){
    const t=state.trades.find(x=>x.id===id);if(!t)return;const a=accountById(t.accountId),currency=a?.currency||t.currencySnapshot||'USD';
    const context=t.marketContext==='bullish'?'Tendance haussière':t.marketContext==='bearish'?'Tendance baissière':t.marketContext==='range'?'Range / neutre':t.marketContext||'Contexte —';
    const rr=Number(t.plannedRR||0)>0?`1:${Number(t.plannedRR).toFixed(2)}`:'Libre';
    showModal(`<div class="modal-head"><div><div class="modal-title">${esc(t.asset)} · ${t.direction}</div><div class="modal-sub">${fmtDateTime(t.openedAt)} · ${esc(a?.name||t.accountNameSnapshot||'Compte supprimé')} · ${esc(strategyNameForTrade(t))}</div></div><button class="close-btn" data-close-modal>×</button></div>
      <div class="trade-context-strip"><span>${esc(context)}</span><span>Tendance ${esc(t.trendTimeframe||'—')}</span><span>Entrée ${esc(t.entryTimeframe||t.timeframe||'—')}</span><span>${esc(t.session||'Session —')}</span><span>${esc(t.confirmation||'Confirmation —')}</span>${Number(t.confidence||0)?`<span>Confiance ${Number(t.confidence)}/5</span>`:''}</div>
      <div class="grid metric-grid trade-detail-metrics">${metric('Entrée',String(t.entry),'')}${metric('SL actuel',String(t.sl),'Initial '+String(t.initialSl??t.sl))}${metric('TP actuel',t.tp??'Libre','Initial '+String(t.initialTp??'—'))}${metric('Risque',fmtMoney(t.riskUSD,currency),fmtPct(t.riskPct||0))}${metric('R:R prévu',rr,'')}${metric('Réalisé',fmtMoney(t.realizedPnl||t.pnl||0,currency),t.status==='closed'?fmtR(t.resultR):`${t.remainingPct}% restant`)}</div>
      ${t.note?`<div class="trade-note-card"><span>PLAN / OBSERVATION</span><p>${esc(t.note)}</p></div>`:''}
      <div class="trade-media-grid">
        <section class="card trade-media-card"><div class="card-head"><div><div class="card-title">Avant le trade</div><div class="page-sub">Plan et contexte initial</div></div></div><div class="trade-media-dropzone" data-trade-drop="before"><input type="file" accept="image/*" multiple hidden><b>+ Ajouter des captures avant</b><span>Glissez ou cliquez</span></div><div class="trade-media-gallery" id="trade-media-before-gallery"></div><div class="trade-media-empty" id="trade-media-before-empty">Aucune capture.</div></section>
        <section class="card trade-media-card"><div class="card-head"><div><div class="card-title">Pendant / après</div><div class="page-sub">Gestion, sortie et résultat</div></div></div><div class="trade-media-dropzone" data-trade-drop="after"><input type="file" accept="image/*" multiple hidden><b>+ Ajouter des captures après</b><span>Glissez ou cliquez</span></div><div class="trade-media-gallery" id="trade-media-after-gallery"></div><div class="trade-media-empty" id="trade-media-after-empty">Aucune capture.</div></section>
      </div>
      ${t.partialExits?.length?`<div class="card" style="margin-top:12px"><div class="card-title">Historique des sorties</div>${t.partialExits.map(e=>`<div class="account-row" style="grid-template-columns:1fr .55fr .6fr"><div>${fmtDateTime(e.at)}<div class="row-sub">${esc(e.reason)}${e.note?' · '+esc(e.note):''}</div></div><div class="mono">${e.percent}%</div><div class="mono ${e.pnl>=0?'up':'down'}">${fmtMoney(e.pnl,currency)}</div></div>`).join('')}</div>`:''}
      ${t.modifications?.length?`<div class="card" style="margin-top:12px"><div class="card-title">Journal de gestion</div>${t.modifications.map(m=>`<div class="row-sub" style="padding:6px 0">${fmtDateTime(m.at)} · ${esc(m.type||'Modification')} · SL ${m.sl??'—'} · TP ${m.tp??'—'}${m.note?' · '+esc(m.note):''}</div>`).join('')}</div>`:''}
      ${t.status==='closed'&&t.review?.reviewed?`<div class="card" style="margin-top:12px"><div class="card-title">Revue du trade</div><p>${esc(t.review.lesson||'')}</p>${t.review.mistake?`<div class="row-sub">Erreur / point à corriger : ${esc(t.review.mistake)}</div>`:''}</div>`:''}
      <div class="modal-footer trade-management-actions">${t.status==='open'?'<button class="btn" id="move-trade-be">SL → BE</button><button class="btn" id="edit-open-trade">Modifier SL / TP</button><button class="btn btn-primary" id="manage-open-trade">Enregistrer une sortie</button>':'<button class="btn btn-primary" id="review-closed-trade">Évaluer ce trade</button>'}</div>`,true);
    bindTradeMediaDropzones(id);$$('[data-trade-drop]').forEach(z=>z.onclick=e=>{if(e.target.tagName!=='INPUT')z.querySelector('input')?.click()});hydrateTradeMedia(t);
    $('#manage-open-trade')?.addEventListener('click',()=>openCloseTradeModal(id));$('#edit-open-trade')?.addEventListener('click',()=>openEditTradeModal(id));$('#review-closed-trade')?.addEventListener('click',()=>openTradeReviewModal(id));
    $('#move-trade-be')?.addEventListener('click',()=>{if(t.status!=='open')return;const previous=t.sl;t.sl=t.entry;t.modifications=t.modifications||[];t.modifications.push({at:new Date().toISOString(),type:'Break-even',fromSl:previous,sl:t.entry,tp:t.tp,note:'Stop déplacé au prix d’entrée'});save();hideModal();renderAll();toast('Stop déplacé à break-even.','success');setTimeout(()=>openTradeDetails(id),80)});
  }

  function openEditTradeModal(id){
    const t=state.trades.find(x=>x.id===id);if(!t||t.status!=='open')return;
    showModal(`<div class="modal-head"><div><div class="modal-title">Modifier le plan en cours</div><div class="modal-sub">Chaque changement est conservé dans le journal de gestion.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="form-grid"><div class="field"><label>Stop loss actuel</label><input id="edit-trade-sl" inputmode="decimal" value="${t.sl}"></div><div class="field"><label>Take profit actuel <span class="optional">optionnel</span></label><input id="edit-trade-tp" inputmode="decimal" value="${t.tp??''}"></div><div class="field" style="grid-column:1/-1"><label>Pourquoi cette modification ?</label><input id="edit-trade-note" placeholder="Ex. sécurisation, nouveau sommet, structure invalidée…"></div></div><div class="quick-action-row"><button class="btn" id="edit-set-be">Mettre SL à BE</button></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-trade-edit">Enregistrer</button></div>`);
    $('#edit-set-be').onclick=()=>{$('#edit-trade-sl').value=String(t.entry);$('#edit-trade-note').value=$('#edit-trade-note').value||'Passage à break-even'};
    $('#save-trade-edit').onclick=()=>{const sl=num($('#edit-trade-sl').value),tpRaw=$('#edit-trade-tp').value.trim(),tp=tpRaw?num(tpRaw):null;if(!Number.isFinite(sl)||!(tp===null||Number.isFinite(tp))){toast('Vérifiez SL et TP.','error');return}const oldSl=t.sl,oldTp=t.tp;t.sl=sl;t.tp=tp;t.modifications=t.modifications||[];t.modifications.push({at:new Date().toISOString(),type:sl===t.entry?'Break-even':'Plan modifié',fromSl:oldSl,fromTp:oldTp,sl,tp,note:$('#edit-trade-note').value.trim()});save();hideModal();renderAll();toast('Position mise à jour.','success');setTimeout(()=>openTradeDetails(id),80)};
  }

  function openTradeReviewModal(id){
    const t=state.trades.find(x=>x.id===id);if(!t||t.status!=='closed')return;const r=t.review||{};showModal(`<div class="modal-head"><div><div class="modal-title">Évaluer ${esc(t.asset)}</div><div class="modal-sub">Le résultat financier et la qualité d’exécution sont deux choses différentes.</div></div><button class="close-btn" data-close-modal>×</button></div><div class="field"><label>Qualité d’exécution</label><select id="review-quality"><option value="unrated">Non évalué</option><option value="good">Bon trade · plan respecté</option><option value="bad">Mauvais trade · plan non respecté</option></select></div><div class="field"><label>Leçon principale</label><textarea id="trade-review-lesson" rows="4">${esc(r.lesson||'')}</textarea></div><div class="field"><label>Erreur / point à corriger</label><textarea id="trade-review-mistake" rows="3">${esc(r.mistake||'')}</textarea></div><div class="field"><label>État émotionnel / contexte</label><input id="trade-review-emotion" value="${esc(r.emotion||'')}"></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="save-trade-review">Enregistrer la revue</button></div>`);$('#review-quality').value=t.quality||'unrated';$('#save-trade-review').onclick=()=>{t.quality=$('#review-quality').value;t.review={reviewed:true,lesson:$('#trade-review-lesson').value.trim(),mistake:$('#trade-review-mistake').value.trim(),emotion:$('#trade-review-emotion').value.trim(),updatedAt:new Date().toISOString()};save();hideModal();renderAll();toast('Trade évalué.','success')}
  }

  function openCloseTradeModal(id){
    const t=state.trades.find(x=>x.id===id);if(!t||t.status!=='open')return;const a=accountById(t.accountId);
    showModal(`<div class="modal-head"><div><div class="modal-title">Enregistrer une sortie</div><div class="modal-sub">${esc(t.asset)} · ${t.direction} · ${t.remainingPct}% de la position initiale restant</div></div><button class="close-btn" data-close-modal>×</button></div>
      <div class="quick-exit-grid"><button class="btn" data-exit-pct="25">25%</button><button class="btn" data-exit-pct="50">50%</button><button class="btn" data-exit-pct="75">75%</button><button class="btn" data-exit-pct="100">Tout clôturer</button></div>
      <div class="form-grid"><div class="field"><label>Prix de sortie</label><input id="exit-price" inputmode="decimal" placeholder="Prix réellement exécuté"></div><div class="field"><label>Part de la position initiale à clôturer (%)</label><input id="exit-percent" type="number" min="0.01" max="${t.remainingPct}" step="0.01" value="${t.remainingPct}"></div><div class="field"><label>Date / heure</label><input id="exit-at" type="datetime-local" value="${localDateTimeValue()}"></div><div class="field"><label>Raison</label><select id="exit-reason"><option>Sortie manuelle avant TP</option><option>Take Profit</option><option>Stop Loss</option><option>Break-even</option><option>Sortie partielle planifiée</option><option>Invalidation du setup</option><option>Autre</option></select></div><div class="field"><label>PnL réel <span class="optional">facultatif</span></label><input id="exit-pnl-override" inputmode="decimal" placeholder="Vide = calcul automatique"></div><div class="field"><label>Note de sortie</label><input id="exit-note" placeholder="Pourquoi sortir maintenant ?"></div></div><div id="exit-preview"></div><div class="modal-footer"><button class="btn" data-close-modal>Annuler</button><button class="btn btn-primary" id="confirm-exit" disabled>Enregistrer la sortie</button></div>`,true);
    $$('[data-exit-pct]').forEach(b=>b.onclick=()=>{$('#exit-percent').value=String(Math.min(Number(b.dataset.exitPct),Number(t.remainingPct)));updateExitPreview(t)});
    $('#exit-reason').onchange=()=>{if($('#exit-reason').value==='Break-even'){if(!$('#exit-price').value.trim())$('#exit-price').value=String(t.entry);if(!$('#exit-pnl-override').value.trim())$('#exit-pnl-override').value='0'}updateExitPreview(t)};
    ['exit-price','exit-percent','exit-pnl-override'].forEach(x=>$(`#${x}`).oninput=()=>updateExitPreview(t));updateExitPreview(t);
  }

  function updateExitPreview(t){
    const a=accountById(t.accountId),currency=a?.currency||t.currencySnapshot||'USD',price=num($('#exit-price').value),pct=num($('#exit-percent').value),overrideRaw=$('#exit-pnl-override').value.trim(),override=overrideRaw?num(overrideRaw):null,riskDist=Number(t.riskDistance)||Math.abs(t.entry-(t.initialSl??t.sl)),move=Number.isFinite(price)?(t.direction==='BUY'?(price-t.entry):(t.entry-price)):NaN,rMult=Number.isFinite(move)&&riskDist>0?move/riskDist:NaN,units=Number(t.positionSize)||((t.riskUSD&&riskDist)?t.riskUSD/riskDist:0),autoPnl=Number.isFinite(move)&&units?move*units*(pct/100):NaN,pnl=Number.isFinite(override)?override:autoPnl,valid=Number.isFinite(price)&&pct>0&&pct<=t.remainingPct&&Number.isFinite(pnl);$('#exit-preview').innerHTML=`<div class="risk-preview"><div class="risk-box"><span>R de cette sortie</span><strong>${Number.isFinite(rMult)?rMult.toFixed(2):'—'}</strong></div><div class="risk-box"><span>PnL réalisé</span><strong class="${pnl>=0?'up':'down'}">${valid?fmtMoney(pnl,currency):'—'}</strong></div><div class="risk-box"><span>Restant après</span><strong>${valid?`${Number((t.remainingPct-pct).toFixed(2))}%`:'—'}</strong></div><div class="risk-box"><span>Solde après</span><strong>${valid?fmtMoney((a?.balance||0)+pnl,currency):'—'}</strong></div></div>`;const btn=$('#confirm-exit');btn.disabled=!valid;btn.onclick=valid?()=>applyExit(t,{price,pct,pnl,rMult,reason:$('#exit-reason').value,note:$('#exit-note').value.trim(),at:$('#exit-at').value?new Date($('#exit-at').value).toISOString():new Date().toISOString()}):null
  }

  function applyExit(t,{price,pct,pnl,rMult,reason,note,at}){
    const a=accountById(t.accountId);t.partialExits=t.partialExits||[];t.partialExits.push({at:at||new Date().toISOString(),price,percent:pct,pnl:Number(pnl.toFixed(2)),r:Number(rMult.toFixed(3)),reason,note:note||''});t.realizedPnl=Number(((t.realizedPnl||0)+pnl).toFixed(2));t.remainingPct=Math.max(0,Number((t.remainingPct-pct).toFixed(2)));if(a)a.balance=Number((Number(a.balance||0)+pnl).toFixed(2));if(t.remainingPct<=0.0001){t.remainingPct=0;t.status='closed';t.closedAt=at||new Date().toISOString();t.pnl=t.realizedPnl;t.resultR=t.riskUSD?Number((t.pnl/t.riskUSD).toFixed(3)):0;t.capitalAfter=a?.balance??null;t.finalExitReason=reason}else{t.pnl=t.realizedPnl}save();hideModal();renderAll();toast(t.status==='closed'?'Position clôturée. Ajoutez la capture après trade puis évaluez votre exécution.':'Sortie partielle enregistrée.','success');if(t.status==='closed')setTimeout(()=>openTradeDetails(t.id),120)
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

  function labelPeriod(p){return {day:'Aujourd’hui',week:'Cette semaine',month:'Ce mois',quarter:'Ce trimestre',year:'Cette année',all:'Tout l’historique'}[p]||'Historique'}
  function exportCSV(trades){
    const rows=[['date_ouverture','date_cloture','actif','direction','compte','strategie','timeframe','session','confirmation','entry','sl','tp','risque','pnl','R','qualite','statut','note'],...trades.map(t=>[t.openedAt,t.closedAt||'',t.asset,t.direction,accountById(t.accountId)?.name||t.accountNameSnapshot||'',strategyNameForTrade(t),t.timeframe||'',t.session||'',t.confirmation||'',t.entry,t.sl,t.tp??'',t.riskUSD,t.pnl,t.resultR,t.quality,t.status,t.note||''])];const csv=rows.map(r=>r.map(x=>`"${String(x??'').replace(/"/g,'""')}"`).join(',')).join('\n');downloadFile(`altitude-history-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8')
  }

  function renderProductivity(){
    const el=$('#view-productivity');if(!el)return;let trades=tradesInPeriod(productivityPeriod,productivityAccount);if(productivityStrategy!=='all')trades=trades.filter(t=>t.strategyId===productivityStrategy);if(productivityAsset!=='all')trades=trades.filter(t=>t.asset===productivityAsset);const closed=trades.filter(t=>t.status==='closed'),base=productivityAccount==='all'?globalInitialCapital():accountInitialCapital(productivityAccount),st=statsFor(trades,base),series=equitySeries(closed),dd=drawdownSeries(closed),byStrategy=strategyBreakdown(closed),byAsset=breakdownBy(closed,t=>t.asset),byDirection=breakdownBy(closed,t=>t.direction),byAccount=breakdownBy(closed,t=>accountById(t.accountId)?.name||t.accountNameSnapshot||'Compte'),days=bestWorstBucket(closed,'day'),weeks=bestWorstBucket(closed,'week'),months=bestWorstBucket(closed,'month'),assets=[...new Set(state.trades.map(t=>t.asset).filter(Boolean))].sort(),currency=productivityAccount==='all'?(primaryAccount()?.currency||'USD'):(accountById(productivityAccount)?.currency||'USD');
    const pf=st.closed?(Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—')):'—';
    el.innerHTML=`${pageHead('Statistiques','Mesurez une stratégie de A à Z : rentabilité, risque, drawdown, actifs, comptes et qualité d’exécution.')}
      <div class="productivity-toolbar card analytics-filters"><div class="period-tabs">${[['last20','20 derniers'],['day','Jour'],['week','Semaine'],['month','Mois'],['quarter','Trimestre'],['year','Année'],['all','Tout']].map(([v,l])=>`<button class="${productivityPeriod===v?'active':''}" data-productivity-period="${v}">${l}</button>`).join('')}</div><div class="analytics-filter-selects"><select id="productivity-account"><option value="all">Tous les comptes</option>${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><select id="productivity-strategy"><option value="all">Toutes les stratégies</option>${state.strategies.map(st=>`<option value="${st.id}">${esc(st.name)}</option>`).join('')}</select><select id="productivity-asset"><option value="all">Tous les actifs</option>${assets.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div></div>
      <div class="grid metric-grid metric-grid-8">${metric('PnL',fmtMoney(st.pnl,currency),fmtR(st.totalR),st.pnl>=0)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} G · ${st.losses} P · ${st.be} BE`)}${metric('Profit factor',pf,'Gains bruts / pertes brutes')}${metric('Espérance',st.closed?fmtR(st.expectancyR):'—','Par trade')}${metric('Drawdown max',st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—',fmtMoney(st.maxDrawdown,currency),false)}${metric('Payoff R',st.closed&&st.payoffR?st.payoffR.toFixed(2):'—',`${fmtR(st.avgWinR)} / ${fmtR(-st.avgLossR)}`)}${metric('Risque moyen',st.closed?fmtMoney(st.avgRisk,currency):'—','Par trade')}${metric('Trades',String(st.closed),`${st.bestWinStreak} win streak · ${st.worstLossStreak} loss streak`)}</div>
      <div class="two-col productivity-charts"><div class="card"><div class="card-head"><div><div class="card-title">Equity / progression</div><div class="page-sub">PnL cumulé des trades clôturés</div></div></div>${lineChart(series)}</div><div class="card"><div class="card-head"><div><div class="card-title">Drawdown</div><div class="page-sub">Repli depuis le plus haut atteint</div></div><span class="down mono">${fmtMoney(st.maxDrawdown,currency)}</span></div>${lineChart(dd)}</div></div>
      <div class="analytics-three-col"><section class="card"><div class="card-title">Par actif</div>${byAsset.length?byAsset.slice(0,10).map(x=>`<div class="analytics-rank-row"><span><b>${esc(x.key)}</b><small>${x.trades.length} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty">Pas de données.</div>'}</section><section class="card"><div class="card-title">Par stratégie</div>${byStrategy.length?byStrategy.slice(0,10).map(x=>{const sx=statsFor(x.trades);return `<div class="analytics-rank-row"><span><b>${esc(x.name)}</b><small>${x.trades.length} trades · WR ${fmtPct(sx.winRate)}</small></span><strong class="${x.pnl>=0?'up':'down'}">${fmtR(x.r)}</strong></div>`}).join(''):'<div class="quiet-empty">Pas de données.</div>'}</section><section class="card"><div class="card-title">BUY vs SELL</div>${byDirection.map(x=>`<div class="direction-stat"><span>${esc(x.key)}</span><strong>${fmtPct(x.winRate)}</strong><small>${x.trades.length} trades · ${fmtMoney(x.pnl,currency)}</small></div>`).join('')||'<div class="quiet-empty">Pas de données.</div>'}</section></div>
      <div class="two-col"><section class="card"><div class="card-title">Extrêmes</div><div class="insight-grid"><div><span>Meilleur trade</span><b class="up">${st.bestTrade?`${esc(st.bestTrade.asset)} · ${fmtMoney(st.bestTrade.pnl,currency)}`:'—'}</b></div><div><span>Pire trade</span><b class="down">${st.worstTrade?`${esc(st.worstTrade.asset)} · ${fmtMoney(st.worstTrade.pnl,currency)}`:'—'}</b></div><div><span>Meilleure journée</span><b>${days.best?`${days.best.key} · ${fmtMoney(days.best.pnl,currency)}`:'—'}</b></div><div><span>Pire journée</span><b>${days.worst?`${days.worst.key} · ${fmtMoney(days.worst.pnl,currency)}`:'—'}</b></div><div><span>Meilleure semaine</span><b>${weeks.best?`${weeks.best.key} · ${fmtMoney(weeks.best.pnl,currency)}`:'—'}</b></div><div><span>Meilleur mois</span><b>${months.best?`${months.best.key} · ${fmtMoney(months.best.pnl,currency)}`:'—'}</b></div></div></section><section class="card"><div class="card-title">Par compte</div>${byAccount.length?byAccount.map(x=>`<div class="analytics-rank-row"><span><b>${esc(x.key)}</b><small>${x.trades.length} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty">Pas de données.</div>'}</section></div>`;
    $('#productivity-account').value=productivityAccount;$('#productivity-strategy').value=productivityStrategy;$('#productivity-asset').value=productivityAsset;$('#productivity-account').onchange=e=>{productivityAccount=e.target.value;renderProductivity()};$('#productivity-strategy').onchange=e=>{productivityStrategy=e.target.value;renderProductivity()};$('#productivity-asset').onchange=e=>{productivityAsset=e.target.value;renderProductivity()};$$('[data-productivity-period]').forEach(b=>b.onclick=()=>{productivityPeriod=b.dataset.productivityPeriod;renderProductivity()})
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
    const el=$('#view-profile');if(!el)return;el.innerHTML=`${pageHead('Profil','Votre identité et vos préférences personnelles dans ALTITUDE Trade.')}
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
    $('#pref-density').value=state.preferences.density;$('#pref-text').value=state.preferences.textScale;$('#pref-week').value=state.preferences.weekStart||'monday';$$('[data-theme-choice]').forEach(b=>b.onclick=()=>{state.preferences.theme=b.dataset.themeChoice;save();renderAll();toast('Thème appliqué.','success')});$('#pref-density').onchange=e=>{state.preferences.density=e.target.value;save();renderAll()};$('#pref-text').onchange=e=>{state.preferences.textScale=e.target.value;save()};$('#pref-week').onchange=e=>{state.preferences.weekStart=e.target.value;save();renderAll()};$('#export-json').onclick=()=>downloadFile(`altitude-trade-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2));$('#import-json').onclick=()=>$('#import-json-file').click();$('#import-json-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{state=mergeState(JSON.parse(await f.text()));save();renderAll();toast('Données importées.','success')}catch{toast('Fichier JSON invalide.','error')}};$('#reset-trades').onclick=()=>confirmDialog({title:'Réinitialiser le journal ?',text:'Tous les trades, revues hebdomadaires et règles issues des revues seront supprimés. Les comptes, stratégies, profil et préférences resteront.',confirmLabel:'Réinitialiser le journal',danger:true,onConfirm:()=>{state.trades=[];state.weeklyReviews={};state.rules=[];state.resetHistory.push({at:new Date().toISOString(),scope:'trades'});save();renderAll();toast('Journal réinitialisé.','success')}});$('#reset-all').onclick=()=>confirmDialog({title:'Tout remettre à zéro ?',text:'Comptes de trading, stratégies, trades, historiques, revues, règles et notes seront effacés. Profil, thème et compte de connexion resteront.',confirmLabel:'Tout remettre à zéro',danger:true,onConfirm:()=>{const keepProfile=state.profile,keepPreferences=state.preferences;state=defaults();state.profile=keepProfile;state.preferences=keepPreferences;state.onboardingDone=true;state.resetHistory=[{at:new Date().toISOString(),scope:'all'}];save();renderAll();toast('Espace remis à zéro.','success')}});$('#send-password-reset')?.addEventListener('click',async()=>{if(!currentUser?.email||!supabase)return;const {error}=await supabase.auth.resetPasswordForEmail(currentUser.email,{redirectTo:APP_URL});toast(error?translateAuth(error.message):'Email de modification du mot de passe envoyé.',error?'error':'success')});$('#sign-out').onclick=signOut;$('#delete-cloud-account')?.addEventListener('click',deleteCloudAccount)
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
      back.innerHTML='<div class="command-palette" role="dialog" aria-modal="true" aria-label="Recherche ALTITUDE Trade"><input id="command-input" autocomplete="off" placeholder="Rechercher ou lancer une action…"><div id="command-results"></div></div>';
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
    const actions=[['Nouveau trade','Créer une position',()=>{closeCommands();openNewTrade()}],['Tableau de bord','Navigation',()=>{closeCommands();setView('dashboard')}],['Comptes','Navigation',()=>{closeCommands();setView('accounts')}],['Stratégies','Navigation',()=>{closeCommands();setView('strategies')}],['Journal','Navigation',()=>{closeCommands();setView('journal')}],['Historique','Navigation',()=>{closeCommands();setView('history')}],['Statistiques','Navigation',()=>{closeCommands();setView('productivity')}],['Revue hebdo','Navigation',()=>{closeCommands();setView('weekly')}],['Règles & notes','Navigation',()=>{closeCommands();setView('rules')}],['Profil','Navigation',()=>{closeCommands();setView('profile')}],['Paramètres','Navigation',()=>{closeCommands();setView('settings')}]];const results=$('#command-results');if(!results)return;const f=actions.filter(a=>a[0].toLowerCase().includes(q.toLowerCase()));results.innerHTML=f.map((a,i)=>`<div class="command-item" data-cmd="${i}"><span>${esc(a[0])}</span><span>${esc(a[1])}</span></div>`).join('')||'<div class="empty">Aucun résultat</div>';$$('[data-cmd]').forEach(b=>b.onclick=()=>f[Number(b.dataset.cmd)][2]())
  }

  function closeCommands(){
    document.body.classList.remove('command-open');
    const back=$('#command-backdrop'),input=$('#command-input');
    if(back){back.hidden=true;back.setAttribute('aria-hidden','true')}
    if(input){input.value='';input.blur()}
    const results=$('#command-results');if(results)results.innerHTML='';
  }

  function showOnboarding(){
    if(state.onboardingDone)return;const a=primaryAccount();showModal(`<div class="modal-head"><div><div class="eyebrow">BIENVENUE SUR ALTITUDE TRADE</div><div class="modal-title">Configurez votre espace en moins de 2 minutes.</div><div class="modal-sub">Ces réglages sont modifiables à tout moment.</div></div><button class="close-btn" id="skip-onboarding">×</button></div><div class="form-grid"><div class="field"><label>Prénom</label><input id="on-first" value="${esc(state.profile.firstName||'')}"></div><div class="field"><label>Nom du premier compte</label><input id="on-account" value="${esc(a?.name||'Compte principal')}"></div><div class="field"><label>Solde actuel</label><input id="on-balance" inputmode="decimal" value="${a?.balance??50}"></div><div class="field"><label>Risque par trade</label><input id="on-risk" inputmode="decimal" value="${a?.riskValue??10}"></div><div class="field"><label>Mode de risque</label><select id="on-risk-mode"><option value="fixed">Montant fixe</option><option value="percent">Pourcentage</option></select></div><div class="field"><label>Thème</label><select id="on-theme"><option value="midnight">Midnight</option><option value="summit">Summit</option><option value="obsidian">Obsidian</option><option value="glacier">Glacier</option><option value="carbon">Carbon</option></select></div></div><div class="modal-footer"><button class="btn" id="onboarding-later">Plus tard</button><button class="btn btn-primary" id="finish-onboarding">Créer mon espace</button></div>`,true);$('#on-risk-mode').value=a?.riskMode||'fixed';$('#on-theme').value=state.preferences.theme||'midnight';const skip=()=>{state.onboardingDone=true;save();hideModal();renderAll()};$('#skip-onboarding').onclick=skip;$('#onboarding-later').onclick=skip;$('#finish-onboarding').onclick=()=>{const balance=num($('#on-balance').value),risk=num($('#on-risk').value);if(!Number.isFinite(balance)||balance<0||!Number.isFinite(risk)||risk<0){toast('Vérifiez le solde et le risque.','error');return}state.profile.firstName=$('#on-first').value.trim();const acc=primaryAccount();acc.name=$('#on-account').value.trim()||'Compte principal';acc.balance=balance;if(!Number(acc.initialBalance)&&!state.trades.some(t=>t.accountId===acc.id))acc.initialBalance=balance;acc.riskValue=risk;acc.riskMode=$('#on-risk-mode').value;state.preferences.theme=$('#on-theme').value;state.onboardingDone=true;save();hideModal();renderAll();toast('Votre espace est prêt.','success');setView('strategies')}
  }

  let authMode='login';
  function authMessage(msg,type='success'){return msg?`<div class="auth-msg ${type}">${esc(msg)}</div>`:''}
  function showAuth(mode='login',message='',type='success'){
    authMode=mode;$('#auth-screen').hidden=false;$('#app-shell').hidden=true;const allowDemo=location.hostname==='localhost'||location.hostname==='127.0.0.1'||!supabaseConfigured;
    $('#auth-content').innerHTML=`<div class="eyebrow">ALTITUDE TRADE</div><div class="auth-title">${mode==='signup'?'Créer votre espace':'Connexion'}</div><div class="auth-sub">${mode==='signup'?'Votre environnement privé de trading et de progression.':'Retrouvez votre espace de travail.'}</div><div class="auth-tabs"><button class="auth-tab ${mode==='login'?'active':''}" data-auth-tab="login">Connexion</button><button class="auth-tab ${mode==='signup'?'active':''}" data-auth-tab="signup">Créer un compte</button></div>${!supabaseConfigured?authMessage('Le cloud n’est pas configuré sur cet environnement.','error'):''}${authMessage(message,type)}${mode==='signup'?'<div class="auth-field"><label>Nom affiché</label><input id="auth-name" autocomplete="name"></div>':''}<div class="auth-field"><label>Email</label><input id="auth-email" type="email" autocomplete="email"></div><div class="auth-field"><label>Mot de passe</label><input id="auth-password" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}"></div><div class="auth-actions"><button class="btn btn-primary" id="auth-submit">${mode==='signup'?'Créer mon espace':'Se connecter'}</button>${mode==='login'&&supabaseConfigured?'<button class="auth-link" id="forgot-password">Mot de passe oublié ?</button>':''}</div>${allowDemo?'<div class="auth-divider">OU</div><button class="btn" id="demo-mode" style="width:100%">Continuer en démo locale</button>':''}`;$$('[data-auth-tab]').forEach(b=>b.onclick=()=>showAuth(b.dataset.authTab));$('#auth-submit').onclick=submitAuth;$('#demo-mode')?.addEventListener('click',enterDemo);$('#forgot-password')?.addEventListener('click',resetPassword)
  }

  async function submitAuth(){if(!supabaseConfigured){showAuth(authMode,'Configurez Supabase ou utilisez le mode démo.','error');return}const email=$('#auth-email').value.trim(),password=$('#auth-password').value;if(!email||password.length<8){showAuth(authMode,'Renseignez un email valide et un mot de passe d’au moins 8 caractères.','error');return}if(authMode==='signup'){const displayName=$('#auth-name').value.trim()||email.split('@')[0],{data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo:APP_URL}});if(error){showAuth('signup',translateAuth(error.message),'error');return}if(data.session)await startUser(data.user);else showAuth('login','Compte créé. Vérifiez votre email puis connectez-vous.')}else{const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error){showAuth('login',translateAuth(error.message),'error');return}await startUser(data.user)}}
  function translateAuth(m){const map={'Invalid login credentials':'Email ou mot de passe incorrect.','Email not confirmed':'Confirmez votre email avant de vous connecter.','User already registered':'Un compte existe déjà avec cet email.'};return map[m]||m}
  async function resetPassword(){const email=$('#auth-email').value.trim();if(!email){showAuth('login','Saisissez votre email puis recommencez.','error');return}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:APP_URL});showAuth('login',error?translateAuth(error.message):'Email de réinitialisation envoyé.',error?'error':'success')}
  async function enterDemo(){closeCommands();currentUser=null;accountProfile={plan:'DEMO'};storageKey=`${STORAGE_KEY_BASE}:demo`;state=load();syncState='local';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;if(!state.profile.firstName)state.profile.firstName='Trader';applyPreferences();renderAll();setView('dashboard');if(!state.onboardingDone)setTimeout(showOnboarding,280)}

  async function startUser(user){if(!user)return;closeCommands();currentUser=user;storageKey=`${STORAGE_KEY_BASE}:${user.id}`;state=load();if(supabase){try{const {data}=await supabase.from('profiles').select('display_name,plan').eq('id',user.id).maybeSingle();accountProfile=data||{display_name:user.user_metadata?.display_name||'',plan:'free'}}catch{accountProfile={plan:'free'}}await hydrateCloudState()}if(!state.profile.displayName)state.profile.displayName=accountProfile?.display_name||user.user_metadata?.display_name||'';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;applyPreferences();renderAll();setView('dashboard');closeCommands();if(!state.onboardingDone)setTimeout(showOnboarding,320)}

  async function signOut(){if(currentUser&&supabase)await supabase.auth.signOut();currentUser=null;showAuth('login')}
  async function deleteCloudAccount(){confirmDialog({title:'Supprimer définitivement votre compte ?',text:'Cette action supprimera votre compte ALTITUDE Trade et ses données cloud. Elle est irréversible.',confirmLabel:'Supprimer mon compte',danger:true,onConfirm:async()=>{try{const {data}=await supabase.auth.getSession();const token=data.session?.access_token;const res=await fetch(`${SUPABASE_URL}/functions/v1/delete-account`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});if(!res.ok)throw new Error('Suppression impossible');localStorage.removeItem(storageKey);await supabase.auth.signOut();currentUser=null;showAuth('login','Compte supprimé.','success')}catch(e){toast(e.message||'Suppression impossible.','error')}}})}



  // ═══════════════════════════════════════════════════════════════════
  // ALTITUDE Trade 6.2 — Analytics Safe Core
  // Ces vues sont volontairement défensives : une ancienne donnée mal formée
  // ne doit jamais empêcher le Dashboard, Comptes, Historique ou Statistiques
  // de s'afficher.
  // ═══════════════════════════════════════════════════════════════════

  function v62Objects(value){return Array.isArray(value)?value.filter(x=>x&&typeof x==='object'):[]}
  function v62Number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}
  function v62Date(value){const d=new Date(value);return Number.isFinite(d.getTime())?d:null}
  function v62Trades(){return v62Objects(state?.trades)}
  function v62Strategies(){return v62Objects(state?.strategies)}
  function v62Accounts(){return v62Objects(state?.accounts)}
  function v62Closed(list){return v62Objects(list).filter(t=>String(t.status||'closed')==='closed')}
  function v62TradeR(t){const r=Number(t?.resultR);if(Number.isFinite(r))return r;const pnl=v62Number(t?.pnl),risk=Math.abs(v62Number(t?.riskUSD));return risk>0?pnl/risk:(pnl>0?1:pnl<0?-1:0)}
  function v62TradePnl(t){return v62Number(t?.pnl)}
  function v62SafeText(v,empty='—'){const x=String(v??'').trim();return x||empty}

  const V62_CORE_TEMPLATES=[
    {id:'acc_deriv',name:'Deriv · Synthétiques',broker:'Deriv',accountType:'personal',marketType:'synthetic',currency:'USD',initialBalance:0,balance:0,riskMode:'percent',riskValue:1,active:true,color:'#8b5cf6',assetList:['V10','V25','V75','Boom 500','Jump 10'],balanceAdjustments:[]},
    {id:'acc_justmarkets',name:'JustMarkets · Forex/CFD',broker:'JustMarkets',accountType:'personal',marketType:'forex',currency:'USD',initialBalance:0,balance:0,riskMode:'percent',riskValue:1,active:false,color:'#38bdf8',assetList:['BTCUSD','GBPJPY','XAUUSD','US30'],balanceAdjustments:[]},
    {id:'acc_fundednext',name:'FundedNext · Prop Firm',broker:'FundedNext',accountType:'prop',marketType:'prop',currency:'USD',initialBalance:0,balance:0,riskMode:'percent',riskValue:1,active:false,color:'#34d399',assetList:['BTCUSD','GBPJPY','XAUUSD','US30'],balanceAdjustments:[]}
  ];

  function v62CoreAccounts(){
    if(!Array.isArray(state.accounts)) state.accounts=[];
    const out=[];
    for(const template of V62_CORE_TEMPLATES){
      let found=v62Accounts().find(a=>a.id===template.id||String(a.broker||'').toLowerCase()===template.broker.toLowerCase());
      if(!found){found={...template,assetList:[...template.assetList],balanceAdjustments:[],createdAt:new Date().toISOString()};state.accounts.push(found)}
      found.id=template.id;found.name=template.name;found.broker=template.broker;found.accountType=template.accountType;found.marketType=template.marketType;found.assetList=[...template.assetList];
      found.currency=found.currency||'USD';found.initialBalance=v62Number(found.initialBalance,v62Number(found.balance));found.balance=v62Number(found.balance);found.riskValue=v62Number(found.riskValue,1);found.riskMode=found.riskMode==='fixed'?'fixed':'percent';found.color=found.color||template.color;found.balanceAdjustments=Array.isArray(found.balanceAdjustments)?found.balanceAdjustments:[];
      out.push(found);
    }
    if(!out.some(a=>a.active))out[0].active=true;
    return out;
  }

  function v62PeriodTrades(period='month',accountId='all',ref=new Date()){
    let list=v62Trades();
    if(accountId!=='all')list=list.filter(t=>t.accountId===accountId);
    if(period==='all')return list;
    if(period==='last20')return list.slice().sort((a,b)=>(v62Date(b.closedAt||b.openedAt)?.getTime()||0)-(v62Date(a.closedAt||a.openedAt)?.getTime()||0)).slice(0,20).reverse();
    const range=rangeFor(period,ref);
    return list.filter(t=>{const d=v62Date(t.closedAt||t.openedAt);return d&&d>=range.start&&d<=range.end});
  }

  function v62Stats(trades,initialCapital=0){
    const c=v62Closed(trades).slice().sort((a,b)=>(v62Date(a.closedAt||a.openedAt)?.getTime()||0)-(v62Date(b.closedAt||b.openedAt)?.getTime()||0));
    const wins=[],losses=[],bes=[];let pnl=0,totalR=0,grossWin=0,grossLoss=0;
    for(const t of c){const p=v62TradePnl(t),r=v62TradeR(t);pnl+=p;totalR+=r;if(r>0){wins.push(t);grossWin+=Math.max(0,p)}else if(r<0){losses.push(t);grossLoss+=Math.abs(Math.min(0,p))}else bes.push(t)}
    let equity=v62Number(initialCapital),peak=equity,maxDD=0,maxDDPct=0,winRun=0,lossRun=0,maxWinRun=0,maxLossRun=0;
    for(const t of c){equity+=v62TradePnl(t);peak=Math.max(peak,equity);const dd=equity-peak,ddPct=peak>0?dd/peak*100:0;maxDD=Math.min(maxDD,dd);maxDDPct=Math.min(maxDDPct,ddPct);const r=v62TradeR(t);if(r>0){winRun++;lossRun=0;maxWinRun=Math.max(maxWinRun,winRun)}else if(r<0){lossRun++;winRun=0;maxLossRun=Math.max(maxLossRun,lossRun)}else{winRun=0;lossRun=0}}
    const winRs=wins.map(v62TradeR),lossRs=losses.map(t=>Math.abs(v62TradeR(t))),risks=c.map(t=>Math.abs(v62Number(t.riskUSD))).filter(n=>n>0),holds=c.map(t=>{const a=v62Date(t.openedAt),b=v62Date(t.closedAt);return a&&b?Math.max(0,(b-a)/60000):0}).filter(Boolean);
    const bestTrade=c.length?[...c].sort((a,b)=>v62TradePnl(b)-v62TradePnl(a))[0]:null,worstTrade=c.length?[...c].sort((a,b)=>v62TradePnl(a)-v62TradePnl(b))[0]:null;
    const avg=x=>x.length?x.reduce((s,n)=>s+v62Number(n),0)/x.length:0;
    return {closed:c.length,wins:wins.length,losses:losses.length,be:bes.length,pnl,totalR,winRate:c.length?wins.length/c.length*100:0,lossRate:c.length?losses.length/c.length*100:0,beRate:c.length?bes.length/c.length*100:0,avgR:c.length?totalR/c.length:0,expectancyR:c.length?totalR/c.length:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),maxDrawdown:maxDD,maxDrawdownPct:maxDDPct,bestWinStreak:maxWinRun,worstLossStreak:maxLossRun,avgWinR:avg(winRs),avgLossR:avg(lossRs),payoffR:avg(lossRs)?avg(winRs)/avg(lossRs):0,avgRisk:avg(risks),avgHoldMinutes:avg(holds),bestTrade,worstTrade,qualityRate:null,rated:0};
  }

  function v62EquitySeries(trades){let total=0;return v62Closed(trades).slice().sort((a,b)=>(v62Date(a.closedAt||a.openedAt)?.getTime()||0)-(v62Date(b.closedAt||b.openedAt)?.getTime()||0)).map(t=>{total+=v62TradePnl(t);return Number(total.toFixed(2))})}
  function v62DrawdownSeries(trades){let total=0,peak=0;return v62Closed(trades).slice().sort((a,b)=>(v62Date(a.closedAt||a.openedAt)?.getTime()||0)-(v62Date(b.closedAt||b.openedAt)?.getTime()||0)).map(t=>{total+=v62TradePnl(t);peak=Math.max(peak,total);return Number((total-peak).toFixed(2))})}
  function v62Chart(values,emptyText='Les données apparaîtront après vos premiers trades.'){
    const finite=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite);
    if(!finite.length){return `<div style="position:relative"><svg class="line-chart" viewBox="0 0 640 180" preserveAspectRatio="none">${[.2,.4,.6,.8].map(r=>`<line class="chart-grid-line" x1="0" x2="640" y1="${180*r}" y2="${180*r}"/>`).join('')}<polyline class="chart-line" style="opacity:.28" points="12,92 130,92 250,92 370,92 500,92 628,92"/></svg><div class="page-sub" style="text-align:center;margin-top:8px">${esc(emptyText)}</div></div>`}
    return lineChart(finite)
  }
  function v62BarChart(trades){
    const c=v62Closed(trades);if(!c.length)return `<div style="height:170px;display:flex;gap:10px;align-items:flex-end;padding:20px 8px"><span style="height:28%;flex:1;background:var(--surface-3);border-radius:5px"></span><span style="height:48%;flex:1;background:var(--surface-3);border-radius:5px"></span><span style="height:35%;flex:1;background:var(--surface-3);border-radius:5px"></span><span style="height:60%;flex:1;background:var(--surface-3);border-radius:5px"></span><span style="height:42%;flex:1;background:var(--surface-3);border-radius:5px"></span></div><div class="page-sub" style="text-align:center">PnL par trade après vos premières clôtures</div>`;
    const recent=c.slice(-20),max=Math.max(1,...recent.map(t=>Math.abs(v62TradePnl(t))));return `<div style="height:190px;display:flex;gap:7px;align-items:center;padding:10px 0">${recent.map(t=>{const p=v62TradePnl(t),h=Math.max(8,Math.abs(p)/max*78);return `<span title="${fmtMoney(p,accountById(t.accountId)?.currency||t.currencySnapshot||'USD')}" style="height:${h}%;align-self:${p>=0?'flex-end':'flex-start'};flex:1;min-width:5px;max-width:24px;background:${p>=0?'var(--success)':'var(--danger)'};border-radius:5px;opacity:.82"></span>`}).join('')}</div>`;
  }
  function v62Breakdown(trades,keyFn){
    const map=new Map();for(const t of v62Closed(trades)){let key='Non renseigné';try{key=v62SafeText(keyFn(t),'Non renseigné')}catch{}const row=map.get(key)||{key,trades:0,pnl:0,wins:0,losses:0,be:0};row.trades++;row.pnl+=v62TradePnl(t);const r=v62TradeR(t);if(r>0)row.wins++;else if(r<0)row.losses++;else row.be++;map.set(key,row)}return [...map.values()].map(x=>({...x,winRate:x.trades?x.wins/x.trades*100:0})).sort((a,b)=>b.pnl-a.pnl)
  }
  function v62BalanceLabel(accounts=v62CoreAccounts()){return accounts.map(a=>fmtMoney(v62Number(a.balance),a.currency||'USD')).join(' · ')}
  function v62TradeTable(list){
    const trades=v62Objects(list);if(!trades.length)return `<div class="quiet-empty"><strong>Aucun trade pour le moment.</strong><span>Les trades que vous enregistrez apparaîtront ici automatiquement.</span></div>`;
    return `<div class="trade-table-wrap"><table class="trade-table"><thead><tr><th>Date</th><th>Actif</th><th>Compte</th><th>Sens</th><th>Statut</th><th>R</th><th>PnL</th></tr></thead><tbody>${trades.map(t=>{const a=accountById(t.accountId);const d=v62Date(t.closedAt||t.openedAt);const r=v62TradeR(t),p=v62TradePnl(t),currency=a?.currency||t.currencySnapshot||'USD';return `<tr data-trade-id="${esc(t.id||'')}"><td>${d?d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'2-digit'}):'—'}</td><td><b>${esc(v62SafeText(t.asset))}</b></td><td>${esc(a?.name||t.accountNameSnapshot||'Compte')}</td><td><span class="pill ${t.direction==='BUY'?'success':t.direction==='SELL'?'danger':''}">${esc(v62SafeText(t.direction))}</span></td><td>${String(t.status||'closed')==='open'?'Ouvert':r>0?'Gain':r<0?'Perte':'BE'}</td><td class="mono ${r>0?'up':r<0?'down':''}">${fmtR(r)}</td><td class="mono ${p>0?'up':p<0?'down':''}">${fmtMoney(p,currency)}</td></tr>`}).join('')}</tbody></table></div>`;
  }

  renderDashboard = function(){
    const el=$('#view-dashboard');if(!el)return;const accounts=v62CoreAccounts(),periodTrades=v62PeriodTrades(dashboardPeriod),st=v62Stats(periodTrades,accounts.reduce((s,a)=>s+v62Number(a.initialBalance),0)),open=v62Trades().filter(t=>String(t.status)==='open'),currency=accounts[0]?.currency||'USD',series=v62EquitySeries(periodTrades),dd=v62DrawdownSeries(periodTrades),recent=v62Trades().slice().sort((a,b)=>(v62Date(b.openedAt)?.getTime()||0)-(v62Date(a.openedAt)?.getTime()||0)).slice(0,7),byAsset=v62Breakdown(periodTrades,t=>t.asset).slice(0,6);
    el.innerHTML=`<div class="dashboard-welcome"><div><p class="eyebrow">ALTITUDE TRADE · VUE GLOBALE</p><h1>${esc(displayName())}, votre trading en chiffres.</h1><p class="dashboard-intro">Tous vos comptes, votre progression, votre risque et la performance de votre stratégie dans une seule vue.</p></div><button class="btn btn-primary" id="dash-new-trade">+ Nouveau trade</button></div>
      <div class="analytics-toolbar card"><div><span class="eyebrow">PÉRIODE</span><strong>${esc(periodLabel(dashboardPeriod))}</strong></div>${periodTabs(dashboardPeriod,'data-dashboard-period')}</div>
      <div class="grid metric-grid metric-grid-8">${metric('Capital total',v62BalanceLabel(accounts),`${accounts.length} comptes`)}${metric('PnL période',fmtMoney(st.pnl,currency),fmtR(st.totalR),st.pnl>=0)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} G · ${st.losses} P · ${st.be} BE`)}${metric('Profit factor',st.closed?(Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—')):'—','Gains / pertes')}${metric('Espérance',st.closed?fmtR(st.expectancyR):'—','Par trade')}${metric('Drawdown max',st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—',fmtMoney(st.maxDrawdown,currency),false)}${metric('Risque moyen',st.closed?fmtMoney(st.avgRisk,currency):'—','Par position')}${metric('Trades',String(st.closed),`${open.length} en cours`)}</div>
      <div class="dashboard-visual-grid"><section class="card"><div class="card-head"><div><div class="card-title">Courbe d’évolution</div><div class="page-sub">PnL cumulé</div></div></div>${v62Chart(series)}</section><section class="card"><div class="card-head"><div><div class="card-title">Gains / pertes</div><div class="page-sub">Amplitude de vos trades clôturés</div></div></div>${v62BarChart(periodTrades)}</section><section class="card"><div class="card-head"><div><div class="card-title">Drawdown</div><div class="page-sub">Repli depuis le dernier sommet</div></div></div>${v62Chart(dd,'Le drawdown apparaîtra après vos premiers trades.')}</section></div>
      <div class="dashboard-secondary dashboard-global-grid"><section class="card"><div class="card-head"><div><div class="card-title">Vos trois comptes</div><div class="page-sub">Deriv · JustMarkets · FundedNext</div></div></div><div class="account-performance-list">${accounts.map(a=>{const x=v62Stats(periodTrades.filter(t=>t.accountId===a.id),a.initialBalance);return `<button class="account-performance-row" data-dash-account="${a.id}"><span class="account-dot" style="background:${esc(a.color)}"></span><span><b>${esc(a.name)}</b><small>${esc(accountMarketLabel(a))}</small></span><span class="mono ${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,a.currency)}</span><span class="mono">${x.closed?fmtPct(x.winRate):'—'}</span></button>`}).join('')}</div></section><section class="card"><div class="card-head"><div><div class="card-title">Performance par actif</div><div class="page-sub">Les actifs qui contribuent à vos résultats</div></div></div>${byAsset.length?byAsset.map(x=>`<div class="asset-breakdown-row"><span><b>${esc(x.key)}</b><small>${x.trades} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="mono ${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty"><strong>Pas encore de données</strong><span>BTCUSD, GBPJPY, XAUUSD, US30 et vos synthétiques seront analysés ici.</span></div>'}</section></div>
      <section class="card" style="margin-top:12px"><div class="card-head"><div><div class="card-title">Derniers trades</div><div class="page-sub">Tous comptes confondus</div></div><button class="btn btn-ghost" id="dash-all-trades">Voir le journal</button></div>${v62TradeTable(recent)}</section>`;
    $$('[data-dashboard-period]',el).forEach(b=>b.onclick=()=>{dashboardPeriod=b.dataset.dashboardPeriod;renderDashboard()});$('#dash-new-trade',el)?.addEventListener('click',openNewTrade);$('#dash-all-trades',el)?.addEventListener('click',()=>setView('journal'));$$('[data-dash-account]',el).forEach(b=>b.onclick=()=>{selectedAccountId=b.dataset.dashAccount;setView('accounts')});$$('[data-trade-id]',el).forEach(b=>b.onclick=()=>b.dataset.tradeId&&openTradeDetails(b.dataset.tradeId));
  };

  renderAccounts = function(){
    const el=$('#view-accounts');if(!el)return;const accounts=v62CoreAccounts();if(!selectedAccountId||!accounts.some(a=>a.id===selectedAccountId))selectedAccountId=accounts[0]?.id||null;const selected=accounts.find(a=>a.id===selectedAccountId)||accounts[0];const trades=selected?v62PeriodTrades(accountAnalyticsPeriod,selected.id):[],st=v62Stats(trades,selected?.initialBalance||0),series=v62EquitySeries(trades),byAsset=v62Breakdown(trades,t=>t.asset),currency=selected?.currency||'USD';
    el.innerHTML=`${pageHead('Comptes','Vos trois environnements sont séparés : capital, historique, risque et statistiques propres à chacun.')}
      <div class="account-cards">${accounts.map(a=>{const all=v62Stats(v62Trades().filter(t=>t.accountId===a.id),a.initialBalance);return `<article class="card account-card ${selected?.id===a.id?'selected':''}"><div class="card-head"><div><div class="row-main"><span class="account-dot" style="background:${esc(a.color)}"></span>${esc(a.name)}</div><div class="row-sub">${esc(a.broker)} · ${esc(accountMarketLabel(a))}</div></div><button class="btn" data-edit-account="${a.id}">Configurer</button></div><div class="account-balance-total">${fmtMoney(a.balance,a.currency)}</div><div class="account-card-stats"><span>PnL <b class="${all.pnl>=0?'up':'down'}">${fmtMoney(all.pnl,a.currency)}</b></span><span>Win rate <b>${all.closed?fmtPct(all.winRate):'—'}</b></span><span>Max DD <b>${all.closed?fmtPct(Math.abs(all.maxDrawdownPct)):'—'}</b></span></div><div class="account-assets">${a.assetList.map(x=>`<span>${esc(x)}</span>`).join('')}</div><button class="btn btn-ghost" data-analyse-account="${a.id}" style="width:100%;margin-top:12px">Analyser ce compte</button></article>`}).join('')}</div>
      <section class="card account-analytics"><div class="card-head"><div><div class="eyebrow">ANALYSE DU COMPTE</div><div class="card-title">${esc(selected?.name||'Compte')}</div><div class="page-sub">${esc(selected?.broker||'')} · ${esc(accountMarketLabel(selected))}</div></div>${periodTabs(accountAnalyticsPeriod,'data-account-period')}</div><div class="grid metric-grid metric-grid-8 compact-metrics">${metric('Solde',fmtMoney(selected?.balance||0,currency),`Initial ${fmtMoney(selected?.initialBalance||0,currency)}`)}${metric('PnL',fmtMoney(st.pnl,currency),fmtR(st.totalR),st.pnl>=0)}${metric('Trades',String(st.closed),`${st.wins} G · ${st.losses} P`)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${fmtPct(st.lossRate)} loss`)}${metric('Profit factor',st.closed?(Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—')):'—','')}${metric('Espérance',st.closed?fmtR(st.expectancyR):'—','Par trade')}${metric('Max DD',st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—',fmtMoney(st.maxDrawdown,currency),false)}${metric('Risque moyen',st.closed?fmtMoney(st.avgRisk,currency):'—','')}</div><div class="two-col account-analytics-grid"><div><div class="card-label">Courbe du compte</div>${v62Chart(series)}</div><div><div class="card-label">Performance par actif</div>${byAsset.length?byAsset.slice(0,8).map(x=>`<div class="asset-breakdown-row"><span><b>${esc(x.key)}</b><small>${x.trades} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="mono ${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty">Aucune donnée pour cette période.</div>'}</div></div></section>`;
    $$('[data-edit-account]',el).forEach(b=>b.onclick=()=>openAccountModal(b.dataset.editAccount));$$('[data-analyse-account]',el).forEach(b=>b.onclick=()=>{selectedAccountId=b.dataset.analyseAccount;renderAccounts()});$$('[data-account-period]',el).forEach(b=>b.onclick=()=>{accountAnalyticsPeriod=b.dataset.accountPeriod;renderAccounts()});
  };

  renderHistory = function(){
    const el=$('#view-history');if(!el)return;const period=v62PeriodTrades(historyPeriod,'all',historyAnchor);let filtered=period.slice();const q=String(historyFilters.query||'').trim().toLowerCase();if(historyFilters.account!=='all')filtered=filtered.filter(t=>t.accountId===historyFilters.account);if(historyFilters.strategy!=='all')filtered=filtered.filter(t=>t.strategyId===historyFilters.strategy);if(historyFilters.result!=='all')filtered=filtered.filter(t=>{const r=v62TradeR(t);return historyFilters.result==='open'?String(t.status)==='open':historyFilters.result==='win'?String(t.status)!=='open'&&r>0:historyFilters.result==='loss'?String(t.status)!=='open'&&r<0:String(t.status)!=='open'&&r===0});if(q)filtered=filtered.filter(t=>`${t.asset||''} ${t.note||''} ${accountById(t.accountId)?.name||''}`.toLowerCase().includes(q));filtered.sort((a,b)=>{const da=v62Date(a.openedAt)?.getTime()||0,db=v62Date(b.openedAt)?.getTime()||0;if(historyFilters.sort==='oldest')return da-db;if(historyFilters.sort==='pnl-desc')return v62TradePnl(b)-v62TradePnl(a);if(historyFilters.sort==='pnl-asc')return v62TradePnl(a)-v62TradePnl(b);if(historyFilters.sort==='r-desc')return v62TradeR(b)-v62TradeR(a);return db-da});const st=v62Stats(filtered),accounts=v62CoreAccounts();
    el.innerHTML=`${pageHead('Historique','Jour, semaine, mois, trimestre, année ou historique complet.')}
      <div class="history-toolbar card"><div class="history-period-nav"><button class="btn" id="history-prev">←</button><div><strong>${esc(periodTitle(historyPeriod,historyAnchor))}</strong><span>${filtered.length} trade${filtered.length>1?'s':''}</span></div><button class="btn" id="history-next">→</button><button class="btn btn-ghost" id="history-today">Aujourd’hui</button></div>${periodTabs(historyPeriod,'data-history-period')}</div>
      <div class="grid metric-grid history-kpis">${metric('PnL',fmtMoney(st.pnl,accounts[0]?.currency||'USD'),fmtR(st.totalR),st.pnl>=0)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} G · ${st.losses} P`)}${metric('Espérance',st.closed?fmtR(st.expectancyR):'—','Par trade')}${metric('Drawdown',st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—',fmtMoney(st.maxDrawdown,accounts[0]?.currency||'USD'),false)}</div>
      <div class="card filter-bar"><input id="history-query" class="input" placeholder="Rechercher un actif, une note…" value="${esc(historyFilters.query||'')}"><select id="history-account"><option value="all">Tous comptes</option>${accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><select id="history-strategy"><option value="all">Toutes stratégies</option>${v62Strategies().map(st=>`<option value="${esc(st.id)}">${esc(st.name)}</option>`).join('')}</select><select id="history-result"><option value="all">Tous résultats</option><option value="win">Gagnants</option><option value="loss">Perdants</option><option value="be">Break-even</option><option value="open">Ouverts</option></select><select id="history-sort"><option value="newest">Plus récents</option><option value="oldest">Plus anciens</option><option value="pnl-desc">PnL décroissant</option><option value="pnl-asc">PnL croissant</option><option value="r-desc">R décroissant</option></select><button class="btn" id="export-history">Exporter CSV</button></div><div class="card">${v62TradeTable(filtered)}</div>`;
    $('#history-account',el).value=historyFilters.account;$('#history-strategy',el).value=historyFilters.strategy;$('#history-result',el).value=historyFilters.result;$('#history-sort',el).value=historyFilters.sort;$$('[data-history-period]',el).forEach(b=>b.onclick=()=>{historyPeriod=b.dataset.historyPeriod;historyAnchor=new Date();renderHistory()});$('#history-prev',el).onclick=()=>{historyAnchor=shiftPeriod(historyAnchor,historyPeriod,-1);renderHistory()};$('#history-next',el).onclick=()=>{historyAnchor=shiftPeriod(historyAnchor,historyPeriod,1);renderHistory()};$('#history-today',el).onclick=()=>{historyAnchor=new Date();renderHistory()};$('#history-query',el).oninput=e=>{historyFilters.query=e.target.value;renderHistory()};['account','strategy','result','sort'].forEach(k=>{const x=$(`#history-${k}`,el);if(x)x.onchange=e=>{historyFilters[k]=e.target.value;renderHistory()}});$('#export-history',el)?.addEventListener('click',()=>exportCSV(filtered));$$('[data-trade-id]',el).forEach(b=>b.onclick=()=>b.dataset.tradeId&&openTradeDetails(b.dataset.tradeId));
  };

  renderProductivity = function(){
    const el=$('#view-productivity');if(!el)return;const accounts=v62CoreAccounts();let trades=v62PeriodTrades(productivityPeriod,productivityAccount);if(productivityStrategy!=='all')trades=trades.filter(t=>t.strategyId===productivityStrategy);if(productivityAsset!=='all')trades=trades.filter(t=>t.asset===productivityAsset);const base=productivityAccount==='all'?accounts.reduce((s,a)=>s+v62Number(a.initialBalance),0):v62Number(accountById(productivityAccount)?.initialBalance),st=v62Stats(trades,base),series=v62EquitySeries(trades),dd=v62DrawdownSeries(trades),byAsset=v62Breakdown(trades,t=>t.asset),byStrategy=v62Breakdown(trades,t=>strategyNameForTrade(t)),byDirection=v62Breakdown(trades,t=>t.direction),byConfirmation=v62Breakdown(trades,t=>t.confirmation||'Non renseignée'),byAccount=v62Breakdown(trades,t=>accountById(t.accountId)?.name||t.accountNameSnapshot||'Compte'),assets=[...new Set(v62Trades().map(t=>String(t.asset||'').trim()).filter(Boolean))].sort(),currency=productivityAccount==='all'?(accounts[0]?.currency||'USD'):(accountById(productivityAccount)?.currency||'USD'),pf=st.closed?(Number.isFinite(st.profitFactor)?st.profitFactor.toFixed(2):(st.profitFactor===Infinity?'∞':'—')):'—';
    el.innerHTML=`${pageHead('Statistiques','Analysez votre stratégie avec les chiffres nécessaires pour décider objectivement.')}
      <div class="productivity-toolbar card analytics-filters"><div class="period-tabs">${[['last20','20 derniers'],['day','Jour'],['week','Semaine'],['month','Mois'],['quarter','Trimestre'],['year','Année'],['all','Tout']].map(([v,l])=>`<button class="${productivityPeriod===v?'active':''}" data-productivity-period="${v}">${l}</button>`).join('')}</div><div class="analytics-filter-selects"><select id="productivity-account"><option value="all">Tous les comptes</option>${accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><select id="productivity-strategy"><option value="all">Toutes les stratégies</option>${v62Strategies().map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select><select id="productivity-asset"><option value="all">Tous les actifs</option>${assets.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div></div>
      <div class="grid metric-grid metric-grid-8">${metric('PnL',fmtMoney(st.pnl,currency),fmtR(st.totalR),st.pnl>=0)}${metric('Win rate',st.closed?fmtPct(st.winRate):'—',`${st.wins} G · ${st.losses} P · ${st.be} BE`)}${metric('Profit factor',pf,'Gains bruts / pertes brutes')}${metric('Espérance',st.closed?fmtR(st.expectancyR):'—','Par trade')}${metric('Drawdown max',st.closed?fmtPct(Math.abs(st.maxDrawdownPct)):'—',fmtMoney(st.maxDrawdown,currency),false)}${metric('Payoff R',st.closed&&st.payoffR?st.payoffR.toFixed(2):'—',`${fmtR(st.avgWinR)} / ${fmtR(-st.avgLossR)}`)}${metric('Risque moyen',st.closed?fmtMoney(st.avgRisk,currency):'—','Par trade')}${metric('Trades',String(st.closed),`${st.bestWinStreak} win streak · ${st.worstLossStreak} loss streak`)}</div>
      <div class="two-col productivity-charts"><div class="card"><div class="card-head"><div><div class="card-title">Equity / progression</div><div class="page-sub">PnL cumulé</div></div></div>${v62Chart(series)}</div><div class="card"><div class="card-head"><div><div class="card-title">Drawdown</div><div class="page-sub">Repli depuis le plus haut</div></div></div>${v62Chart(dd,'Le drawdown sera calculé automatiquement.')}</div></div>
      <div class="analytics-three-col"><section class="card"><div class="card-title">Par actif</div>${byAsset.length?byAsset.slice(0,10).map(x=>`<div class="analytics-rank-row"><span><b>${esc(x.key)}</b><small>${x.trades} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty">Pas encore de données.</div>'}</section><section class="card"><div class="card-title">Par stratégie</div>${byStrategy.length?byStrategy.slice(0,10).map(x=>`<div class="analytics-rank-row"><span><b>${esc(x.key)}</b><small>${x.trades} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty">Pas encore de données.</div>'}</section><section class="card"><div class="card-title">BUY vs SELL</div>${byDirection.length?byDirection.map(x=>`<div class="direction-stat"><span>${esc(x.key)}</span><strong>${fmtPct(x.winRate)}</strong><small>${x.trades} trades · ${fmtMoney(x.pnl,currency)}</small></div>`).join(''):'<div class="quiet-empty">Pas encore de données.</div>'}</section></div>
      <div class="two-col" style="margin-top:12px"><section class="card"><div class="card-title">Par confirmation</div>${byConfirmation.length?byConfirmation.slice(0,10).map(x=>`<div class="analytics-rank-row"><span><b>${esc(x.key)}</b><small>${x.trades} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty">Pas encore de données.</div>'}</section><section class="card"><div class="card-title">Par compte</div>${byAccount.length?byAccount.map(x=>`<div class="analytics-rank-row"><span><b>${esc(x.key)}</b><small>${x.trades} trades · WR ${fmtPct(x.winRate)}</small></span><strong class="${x.pnl>=0?'up':'down'}">${fmtMoney(x.pnl,currency)}</strong></div>`).join(''):'<div class="quiet-empty">Pas encore de données.</div>'}</section></div>`;
    $('#productivity-account',el).value=productivityAccount;$('#productivity-strategy',el).value=productivityStrategy;$('#productivity-asset',el).value=productivityAsset;$('#productivity-account',el).onchange=e=>{productivityAccount=e.target.value;renderProductivity()};$('#productivity-strategy',el).onchange=e=>{productivityStrategy=e.target.value;renderProductivity()};$('#productivity-asset',el).onchange=e=>{productivityAsset=e.target.value;renderProductivity()};$$('[data-productivity-period]',el).forEach(b=>b.onclick=()=>{productivityPeriod=b.dataset.productivityPeriod;renderProductivity()});
  };

  function finishLaunch(){setTimeout(()=>$('#launch-screen')?.classList.add('leaving'),1000);setTimeout(()=>{const x=$('#launch-screen');if(x)x.style.display='none'},1500)}
  async function boot(){
    closeCommands();
    applyPreferences();
    if(supabaseConfigured){const client=await loadSupabaseClient();if(client){const {data}=await client.auth.getSession();if(data.session?.user)await startUser(data.session.user);else showAuth('login');client.auth.onAuthStateChange(async(event,session)=>{if(event==='SIGNED_IN'&&session?.user&&session.user.id!==currentUser?.id)await startUser(session.user);if(event==='SIGNED_OUT'&&currentUser){currentUser=null;showAuth('login')}})}else showAuth('login','Le service cloud n’a pas pu charger.','error')}else showAuth('login');finishLaunch()
  }

  closeCommands();window.addEventListener('pageshow',()=>closeCommands());$('#new-trade-global').onclick=openNewTrade;$('#command-search').onclick=openCommandPalette;$('#sidebar-toggle').onclick=()=>{$('#sidebar').classList.toggle('mobile-open')};$('#media-lightbox-close')?.addEventListener('click',closeMediaLightbox);$('#media-lightbox-in')?.addEventListener('click',()=>changeMediaZoom(.2));$('#media-lightbox-out')?.addEventListener('click',()=>changeMediaZoom(-.2));$('#media-lightbox')?.addEventListener('click',e=>{if(e.target.id==='media-lightbox')closeMediaLightbox()});$$('.nav-item[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommandPalette()}if(e.key==='Escape'){hideModal();closeCommands()}if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&e.key.toLowerCase()==='n'){e.preventDefault();openNewTrade()}});
  boot().catch(e=>{console.error(e);showAuth('login','Une erreur est survenue au démarrage.','error');finishLaunch()});
})();
