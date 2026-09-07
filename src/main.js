(() => {
  'use strict';
  const STORAGE_KEY_BASE = 'altitude_os_v3_state';
  const runtimeConfig = window.ALTITUDE_CONFIG || {};
  const SUPABASE_URL = String(runtimeConfig.SUPABASE_URL || '').trim();
  const SUPABASE_KEY = String(runtimeConfig.SUPABASE_ANON_KEY || '').trim();
  const APP_URL = String(runtimeConfig.APP_URL || window.location.origin + window.location.pathname).trim();
  const BILLING_ENABLED = runtimeConfig.BILLING_ENABLED === true || String(runtimeConfig.BILLING_ENABLED).toLowerCase() === 'true';
  const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR_PROJECT'));
  let supabase = null;
  let currentUser = null;
  let accountProfile = null;
  let storageKey = `${STORAGE_KEY_BASE}:demo`;
  let syncTimer = null;
  let cloudHydrating = false;
  let syncState = supabaseConfigured ? 'idle' : 'local';
  async function loadSupabaseClient(){
    if(!supabaseConfigured) return null;
    if(supabase) return supabase;
    try{
      const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      supabase = mod.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      return supabase;
    }catch(e){ console.warn('Supabase client unavailable',e); syncState='local'; return null; }
  }
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const fmtUSD = n => `${Number(n||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} $`;
  const fmtR = n => `${n>0?'+':''}${Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2})}R`;
  const isoDay = d => { const x=new Date(d); const y=x.getFullYear(),m=String(x.getMonth()+1).padStart(2,'0'),day=String(x.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
  const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uid = () => `T${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;

  const defaults = () => ({
    version:3,
    settings:{initialCapital:50,riskPerTrade:10,minRR:2,targetRR:3,maxDailyTrades:2,maxWeeklyLosses:5,maxWeeklyWins:10,monthlyTarget:500},
    capital:50,
    trades:[], rules:[], weeklyReviews:{}, weeklyDrafts:{},
    locks:{monthLock:null},
    analysis:{asset:'BTCUSD',h1:null,m30:null,m5:null,scenario:null,signal:null,checks:{}},
    pendingTrade:null
  });
  let state = load();
  let currentView = 'dashboard';
  let closeTradeResult = null;
  let beforeImageFile = null;
  let afterImageFile = null;

  function mergeState(s){
    return {...defaults(),...(s||{}),settings:{...defaults().settings,...((s||{}).settings||{})},locks:{...defaults().locks,...((s||{}).locks||{})},analysis:{...defaults().analysis,...((s||{}).analysis||{})}};
  }
  function load(){
    try{ const raw=localStorage.getItem(storageKey); return raw ? mergeState(JSON.parse(raw)) : defaults(); }
    catch(e){ return defaults(); }
  }
  function save(){
    try{ localStorage.setItem(storageKey,JSON.stringify(state)); }catch(e){ console.warn('Local save failed',e); }
    if(currentUser && supabase && !cloudHydrating) scheduleCloudSave();
    updateSyncBadge();
  }
  function scheduleCloudSave(){
    clearTimeout(syncTimer); syncState='syncing'; updateSyncBadge();
    syncTimer=setTimeout(async()=>{
      try{
        const {error}=await supabase.from('user_states').upsert({user_id:currentUser.id,state,updated_at:new Date().toISOString()},{onConflict:'user_id'});
        if(error) throw error; syncState='synced';
      }catch(e){ console.warn('Cloud sync failed',e); syncState='error'; }
      updateSyncBadge();
    },420);
  }
  async function hydrateCloudState(){
    if(!currentUser||!supabase)return;
    cloudHydrating=true; syncState='syncing'; updateSyncBadge();
    try{
      const {data,error}=await supabase.from('user_states').select('state').eq('user_id',currentUser.id).maybeSingle();
      if(error) throw error;
      if(data?.state){ state=mergeState(data.state); localStorage.setItem(storageKey,JSON.stringify(state)); }
      else { state=load(); await supabase.from('user_states').upsert({user_id:currentUser.id,state,updated_at:new Date().toISOString()},{onConflict:'user_id'}); }
      syncState='synced';
    }catch(e){ console.warn('Cloud hydrate failed; using local cache',e); state=load(); syncState='error'; }
    finally{ cloudHydrating=false; updateSyncBadge(); }
  }
  function updateSyncBadge(){
    const el=document.querySelector('#sync-badge'); if(!el)return;
    const map={synced:['Cloud synchronisé','ok'],syncing:['Synchronisation…','warn'],error:['Hors ligne · cache local','warn'],local:['Mode local','warn'],idle:['Cloud prêt','']};
    const [txt,cls]=map[syncState]||map.local; el.textContent=txt; el.className=`sync-badge ${cls}`;
  }

  function startOfRiskWeek(d=new Date()){
    const x=new Date(d); x.setHours(0,0,0,0); const offset=(x.getDay()+1)%7; x.setDate(x.getDate()-offset); return x;
  }
  function endOfRiskWeek(d=new Date()){ const x=startOfRiskWeek(d); x.setDate(x.getDate()+6); x.setHours(23,59,59,999); return x; }
  function monthKey(d=new Date()){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  function completedReviewPeriod(now=new Date()){
    const end=new Date(now); end.setHours(23,59,59,999); let diff=(end.getDay()-5+7)%7; if(diff===0) diff=7; end.setDate(end.getDate()-diff);
    const start=new Date(end); start.setDate(start.getDate()-6); start.setHours(0,0,0,0);
    return {start,end,key:`${isoDay(start)}_${isoDay(end)}`};
  }
  function tradesBetween(start,end){ return state.trades.filter(t=>{ const d=new Date(t.openedAt); return d>=start && d<=end; }); }
  function closedTrades(){ return state.trades.filter(t=>t.status==='closed'); }
  function dayTrades(d=new Date()){ const key=isoDay(d); return state.trades.filter(t=>isoDay(t.openedAt)===key); }
  function weekTrades(d=new Date()){ return tradesBetween(startOfRiskWeek(d),endOfRiskWeek(d)); }
  function monthTrades(d=new Date()){ const mk=monthKey(d); return state.trades.filter(t=>monthKey(new Date(t.openedAt))===mk); }
  function sumPnL(trades){ return trades.filter(t=>t.status==='closed').reduce((a,t)=>a+Number(t.pnl||0),0); }
  function sumR(trades){ return trades.filter(t=>t.status==='closed').reduce((a,t)=>a+Number(t.resultR||0),0); }

  function reviewRequirement(){
    const p=completedReviewPeriod(); const trades=tradesBetween(p.start,p.end); const done=!!state.weeklyReviews[p.key]; const day=new Date().getDay();
    const overdue=trades.length>0 && !done && day>=1 && day<=5;
    const dueWeekend=trades.length>0 && !done && (day===6 || day===0);
    return {...p,trades,done,overdue,dueWeekend};
  }
  function triggerMonthLockIfNeeded(){ if(state.capital>=state.settings.monthlyTarget && state.locks.monthLock!==monthKey()) { state.locks.monthLock=monthKey(); save(); } }
  function tradingLocks(){
    triggerMonthLockIfNeeded();
    const reasons=[]; const today=dayTrades(); const wk=weekTrades(); const wClosed=wk.filter(t=>t.status==='closed');
    if(today.length>=state.settings.maxDailyTrades) reasons.push('2 trades maximum atteints aujourd’hui');
    if(today.some(t=>t.status==='closed' && t.resultR>=3)) reasons.push('Un trade à +3R a déjà clôturé la journée');
    const losses=wClosed.filter(t=>t.result==='loss').length, wins=wClosed.filter(t=>t.result==='win').length;
    if(losses>=state.settings.maxWeeklyLosses) reasons.push('5 pertes atteintes cette semaine');
    if(wins>=state.settings.maxWeeklyWins) reasons.push('10 gains atteints cette semaine');
    if(state.capital<=0) reasons.push('Capital disponible nul ou négatif');
    if(state.capital>0 && state.settings.riskPerTrade>=state.capital) reasons.push('Le risque fixe par trade est supérieur ou égal au capital disponible');
    if(state.locks.monthLock===monthKey()) reasons.push(`Objectif mensuel de ${state.settings.monthlyTarget} $ atteint`);
    return reasons;
  }
  function canTrade(){ return !reviewRequirement().overdue && tradingLocks().length===0; }

  const signals = {
    HHH:[
      {id:'hammer_bull',title:'Marteau haussier vert',sub:'Retracement MM20 · grande mèche basse',direction:'BUY',entry:'Clôture du marteau',stop:'10 pips sous le plus bas de la mèche',target:'Sommet avant retracement',checks:['Retracement du prix vers la MM20','Marteau de couleur verte','Corps situé en haut du marteau','Grande mèche basse ≥ 5 × petite mèche opposée','MM20 traverse le corps OU la grande mèche basse','Marteau clôturé']},
      {id:'inv_hammer_bull',title:'Marteau inversé haussier vert',sub:'MM20 obligatoirement dans le corps',direction:'BUY',entry:'Clôture du marteau inversé',stop:'10 pips sous le plus bas de la bougie',target:'Sommet avant retracement',checks:['Retracement du prix vers la MM20','Marteau inversé de couleur verte','Corps en bas · grande mèche haute','Grande mèche haute ≥ 5 × petite mèche opposée','MM20 traverse obligatoirement le corps','Bougie clôturée']},
      {id:'engulf_bull',title:'Avalement haussier',sub:'Rouge → verte qui avale la précédente',direction:'BUY',entry:'Clôture de la bougie verte d’avalement',stop:'10 pips sous le plus bas de la bougie d’avalement',target:'Sommet avant retracement',checks:['Retournement / retracement sur la MM20','Première bougie rouge','Deuxième bougie verte','La verte avale réellement la rouge selon ta règle','Bougie d’avalement clôturée']}
    ],
    BBB:[
      {id:'hammer_bear',title:'Marteau baissier rouge',sub:'Corps en bas · grande mèche haute',direction:'SELL',entry:'Clôture du marteau',stop:'10 pips au-dessus du plus haut de la mèche',target:'Plus bas avant retracement',checks:['Retracement du prix vers la MM20','Marteau de couleur rouge','Corps situé en bas du marteau','Grande mèche haute ≥ 5 × petite mèche opposée','MM20 traverse obligatoirement la grande mèche haute','Marteau clôturé']},
      {id:'inv_hammer_bear',title:'Marteau inversé baissier rouge',sub:'Corps en haut · grande mèche basse',direction:'SELL',entry:'Clôture du marteau inversé',stop:'10 pips au-dessus du plus haut de la bougie',target:'Plus bas avant retracement',checks:['Retracement du prix vers la MM20','Marteau inversé de couleur rouge','Corps en haut · grande mèche basse','Grande mèche basse ≥ 5 × petite mèche opposée','MM20 traverse obligatoirement le corps','Bougie clôturée']},
      {id:'engulf_bear',title:'Avalement baissier',sub:'Verte → rouge qui avale la précédente',direction:'SELL',entry:'Clôture de la bougie rouge d’avalement',stop:'10 pips au-dessus du plus haut de la bougie d’avalement',target:'Plus bas avant retracement',checks:['Retournement / retracement sur la MM20','Première bougie verte','Deuxième bougie rouge','La rouge avale réellement la verte selon ta règle','Bougie d’avalement clôturée']}
    ],
    HHB:[
      {id:'arrow_mm20_bull',title:'Flèche verte directement sur MM20',sub:'Réintégration haussière immédiate',direction:'BUY',entry:'Clôture de la flèche directionnelle',stop:'10 pips sous le plus bas de la flèche',target:'Sommet précédant le retournement',checks:['M5 était sous la MM20','Réintégration haussière en cours','Flèche directionnelle verte','Corps rectangulaire important','Flèche située directement sur la MM20','Flèche clôturée']},
      {id:'one_arrow_bull',title:'1 bougie puis flèche verte',sub:'Réintégration · 1 bougie · flèche',direction:'BUY',entry:'Clôture de la flèche directionnelle',stop:'Sous la MM20',target:'Sommet précédant le retournement',checks:['Prix repasse au-dessus de la MM20','Une première bougie se forme après la réintégration','Flèche directionnelle verte ensuite','Corps rectangulaire important','Flèche clôturée']},
      {id:'multi_arrow_bull',title:'Succession de bougies puis flèche',sub:'Réintégration prolongée avant signal',direction:'BUY',entry:'Clôture de la flèche directionnelle',stop:'10 pips sous le plus bas de la flèche',target:'Sommet précédant le retournement',checks:['Prix réintègre au-dessus de la MM20','Succession de bougies après la réintégration','Flèche directionnelle verte apparaît ensuite','Corps rectangulaire important','Flèche clôturée']},
      {draft:true,id:'two_hammers_up',title:'2 marteaux verts ascendants',sub:'Marteau 2 situé plus haut que marteau 1',direction:'BUY',entry:'Après validation du deuxième marteau',stop:'10 pips sous le marteau le plus bas',target:'Sommet précédant le retournement',checks:['Réintégration haussière de la MM20','Deux marteaux de couleur verte','Les deux marteaux sont ascendants','Marteau 2 est plus haut que marteau 1','Deuxième marteau clôturé']},
      {draft:true,id:'three_inv_up',title:'3 marteaux inversés verts ascendants',sub:'Corps carrés · progression ascendante',direction:'BUY',entry:'Après validation du troisième marteau',stop:'Référence dernier marteau — niveau exact à compléter',target:'Sommet précédant le retournement',checks:['Réintégration haussière de la MM20','Trois marteaux inversés verts','Corps petits / carrés','Les trois marteaux sont ascendants','Troisième marteau clôturé']},
      {id:'cancel_return_hammer',title:'Signaux annulés → retour MM20 → marteau',sub:'Marteau vert + marteau inversé rouge = nuls',direction:'BUY',entry:'Après le nouveau marteau vert',stop:'10 pips sous la mèche du nouveau marteau',target:'Sommet précédant le retournement',checks:['Marteau vert puis marteau inversé rouge observés','Les deux premiers signaux sont considérés comme nuls','Le prix revient ensuite sur la MM20','Un nouveau marteau vert valide se forme','Nouveau marteau clôturé']},
      {draft:true,id:'cancel_return_engulf',title:'Signaux annulés → retour MM20 → marteau + avalement',sub:'Nouvelle validation par avalement',direction:'BUY',entry:'Clôture de la bougie d’avalement',stop:'Sous la structure de validation',target:'Sommet précédant le retournement',checks:['Premiers signaux contradictoires annulés','Retour du prix sur la MM20','Formation d’un marteau','Formation ensuite d’un avalement haussier conforme','Bougie d’avalement clôturée']}
    ],
    BBH:[
      {id:'arrow_mm20_bear',title:'Flèche rouge directement sur MM20',sub:'Réintégration baissière immédiate',direction:'SELL',entry:'Clôture de la flèche directionnelle',stop:'10 pips au-dessus du plus haut de la flèche',target:'Plus bas précédant le retournement',checks:['M5 était au-dessus de la MM20','Réintégration baissière en cours','Flèche directionnelle rouge','Corps rectangulaire important','Corps en bas · mèche principale en haut','Flèche située directement sur la MM20','Flèche clôturée']},
      {id:'one_arrow_bear',title:'1 bougie puis flèche rouge',sub:'Réintégration · 1 bougie · flèche',direction:'SELL',entry:'Clôture de la flèche directionnelle',stop:'Au-dessus de la MM20',target:'Plus bas précédant le retournement',checks:['Prix repasse sous la MM20','Une première bougie se forme après la réintégration','Flèche directionnelle rouge ensuite','Corps rectangulaire important','Flèche clôturée']},
      {id:'multi_arrow_bear',title:'Succession de bougies puis flèche',sub:'Réintégration prolongée avant signal',direction:'SELL',entry:'Clôture de la flèche directionnelle',stop:'10 pips au-dessus du plus haut de la flèche',target:'Plus bas précédant le retournement',checks:['Prix réintègre sous la MM20','Succession de bougies après la réintégration','Flèche directionnelle rouge apparaît ensuite','Corps rectangulaire important','Flèche clôturée']},
      {draft:true,id:'two_hammers_down',title:'2 marteaux rouges descendants',sub:'Marteau 2 situé plus bas que marteau 1',direction:'SELL',entry:'Après validation du deuxième marteau',stop:'10 pips au-dessus du marteau le plus haut',target:'Plus bas précédant le retournement',checks:['Réintégration baissière de la MM20','Deux marteaux de couleur rouge','Corps en bas · mèche principale en haut','Les deux marteaux sont descendants','Marteau 2 est plus bas que marteau 1','Deuxième marteau clôturé']},
      {draft:true,id:'three_hammers_down',title:'3 marteaux rouges descendants',sub:'Séquence baissière de trois marteaux',direction:'SELL',entry:'Après validation du troisième marteau',stop:'Au-dessus de la structure — niveau exact à compléter',target:'Plus bas précédant le retournement',checks:['Réintégration baissière de la MM20','Trois marteaux de couleur rouge','Les trois marteaux sont descendants','Marteau 1 > marteau 2 > marteau 3','Troisième marteau clôturé']}
    ]
  };
  function getSignal(){ return (signals[state.analysis.scenario]||[]).find(s=>s.id===state.analysis.signal)||null; }

  function setView(name, force=false){
    const req=reviewRequirement();
    if(req.overdue && name!=='weekly' && !force){ showReviewLock(); return; }
    if(['analyse','setups','risk'].includes(name) && tradingLocks().length && !force){ alert(`Trading bloqué :\n• ${tradingLocks().join('\n• ')}`); return; }
    currentView=name; $$('.view').forEach(v=>v.classList.remove('active')); $(`#view-${name}`)?.classList.add('active');
    $$('.nav-item[data-view]').forEach(i=>i.classList.toggle('active',i.dataset.view===name));
    renderAll();
  }
  function showReviewLock(){ const req=reviewRequirement(); if(!req.overdue) return; $('#review-lock-text').textContent=`La revue de la période du ${formatDate(req.start)} au ${formatDate(req.end)} n’est pas terminée. ALTITUDE OS reste verrouillé jusqu’à sa validation.`; $('#review-lock').style.display='flex'; }
  function hideReviewLock(){ $('#review-lock').style.display='none'; }
  function formatDate(d){ return new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}); }
  function formatShortDate(d){ return new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}); }
  function formatDateTime(d){ return new Date(d).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }

  function renderAll(){ updateGlobalStatus(); renderDashboard(); renderAnalyse(); renderSetups(); renderRisk(); renderJournal(); renderWeekly(); renderStats(); renderRules(); renderSettings(); }
  function updateGlobalStatus(){
    const chip=$('#global-status'); if(!chip) return; const locked=!canTrade(); chip.classList.toggle('blocked',locked); $('.label',chip).textContent=locked?'TRADING BLOQUÉ':'TRADING AUTORISÉ';
    $$('.nav-item[data-view]').forEach(n=>n.classList.toggle('locked-nav',reviewRequirement().overdue && n.dataset.view!=='weekly'));
  }

  function renderDashboard(){
    const el=$('#view-dashboard'); if(!el) return;
    const today=dayTrades(), wk=weekTrades(), mo=monthTrades(), closed=closedTrades();
    const wins=wk.filter(t=>t.status==='closed'&&t.result==='win').length, losses=wk.filter(t=>t.status==='closed'&&t.result==='loss').length;
    const good=closed.filter(t=>t.quality==='good').length; const discipline=closed.length?Math.round(good/closed.length*100):100;
    const s=state.settings; const progress=Math.max(0,Math.min(100,(state.capital-s.initialCapital)/(s.monthlyTarget-s.initialCapital)*100));
    const req=reviewRequirement(); const reasons=tradingLocks(); const statusText=req.overdue?'REVUE EN RETARD':reasons.length?'TRADING BLOQUÉ':'TRADING AUTORISÉ';
    const lastRule=state.rules.filter(r=>r.status==='active').slice(-1)[0];
    el.innerHTML=`
      <div class="topbar"><div><div class="page-title">Dashboard</div><div class="page-sub">${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div></div><div style="display:flex;gap:10px;align-items:center"><span class="top-status ${canTrade()?'ok':'blocked'}">${statusText}</span><button class="btn btn-primary" id="dash-new">Nouvelle analyse</button></div></div>
      ${req.dueWeekend?`<div class="notice warn" style="margin-bottom:16px">Revue hebdomadaire disponible : ${req.trades.length} trade(s) de la période ${formatShortDate(req.start)} → ${formatShortDate(req.end)} à analyser avant lundi.</div>`:''}
      ${req.overdue?`<div class="notice danger" style="margin-bottom:16px">Revue hebdomadaire en retard. La plateforme est verrouillée jusqu’à sa validation.</div>`:''}
      ${reasons.length?`<div class="notice danger" style="margin-bottom:16px">${reasons.map(r=>`• ${escapeHtml(r)}`).join('<br>')}</div>`:''}
      <div class="grid dash-top">
        <div class="card capital-card">
          <svg class="quotient-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#1d2733" stroke-width="9"/><circle cx="50" cy="50" r="42" fill="none" stroke="#3ddc97" stroke-width="9" stroke-dasharray="263.9" stroke-dashoffset="${263.9-(263.9*progress/100)}" stroke-linecap="round" transform="rotate(-90 50 50)"/><text x="50" y="46" text-anchor="middle" fill="#e9edf3" font-family="JetBrains Mono" font-size="15" font-weight="700">${Math.round(progress)}%</text><text x="50" y="61" text-anchor="middle" fill="#5c6675" font-family="Inter" font-size="8">de l'objectif</text></svg>
          <div class="capital-info"><div class="card-label">Capital actuel</div><div class="capital-figure">${fmtUSD(state.capital)}</div><div class="capital-goal-row"><span>Départ ${s.initialCapital} $</span><span>→</span><span class="goal">Objectif ${s.monthlyTarget} $</span></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><div class="progress-marks"><span>${s.initialCapital} $</span><span>150 $</span><span>300 $</span><span>${s.monthlyTarget} $</span></div></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px"><div class="card"><div class="card-label">PnL jour</div><div class="card-value ${sumPnL(today)>=0?'up':'down'}">${sumPnL(today)>=0?'+':''}${fmtUSD(sumPnL(today))}</div><div class="card-delta ${sumR(today)>=0?'up':'down'}">${fmtR(sumR(today))}</div></div><div class="card"><div class="card-label">PnL semaine</div><div class="card-value ${sumPnL(wk)>=0?'up':'down'}">${sumPnL(wk)>=0?'+':''}${fmtUSD(sumPnL(wk))}</div><div class="card-delta ${sumR(wk)>=0?'up':'down'}">${fmtR(sumR(wk))}</div></div><div class="card"><div class="card-label">PnL mois</div><div class="card-value ${sumPnL(mo)>=0?'up':'down'}">${sumPnL(mo)>=0?'+':''}${fmtUSD(sumPnL(mo))}</div><div class="card-delta neutral">Capital ${Math.round(progress)}% vers objectif</div></div><div class="card"><div class="card-label">Discipline</div><div class="card-value" style="color:var(--amber)">${discipline}</div><div class="card-delta neutral">${good} bon(s) trade(s) / ${closed.length}</div></div></div>
      </div>
      <div class="grid limits-row" style="margin-bottom:16px"><div class="card"><div class="card-label">Trades aujourd'hui</div><div class="card-value" style="font-size:20px">${today.length} <span class="muted" style="font-size:13px">/ ${s.maxDailyTrades}</span></div><div class="limit-bar-track"><div class="limit-bar-fill" style="width:${Math.min(100,today.length/s.maxDailyTrades*100)}%;background:var(--amber)"></div></div></div><div class="card"><div class="card-label">Gains cette semaine</div><div class="card-value" style="font-size:20px">${wins} <span class="muted" style="font-size:13px">/ ${s.maxWeeklyWins}</span></div><div class="limit-bar-track"><div class="limit-bar-fill" style="width:${Math.min(100,wins/s.maxWeeklyWins*100)}%;background:var(--mint)"></div></div></div><div class="card"><div class="card-label">Pertes cette semaine</div><div class="card-value" style="font-size:20px">${losses} <span class="muted" style="font-size:13px">/ ${s.maxWeeklyLosses}</span></div><div class="limit-bar-track"><div class="limit-bar-fill" style="width:${Math.min(100,losses/s.maxWeeklyLosses*100)}%;background:var(--red)"></div></div></div></div>
      <div class="grid" style="grid-template-columns:1.4fr 1fr;gap:16px"><div class="card"><div class="card-label">Dernière règle créée</div><div style="font-size:13.5px;margin-top:6px;line-height:1.5">${lastRule?`« ${escapeHtml(lastRule.text)} »`:'Aucune règle créée pour le moment.'}</div><div class="rule-meta" style="margin-top:12px">${lastRule?escapeHtml(lastRule.period||'Revue hebdomadaire'):'Elle apparaîtra après ta première revue.'}</div></div><div class="card"><div class="card-label">Prochain objectif</div><div style="font-size:13.5px;margin-top:6px">Atteindre <span style="color:var(--amber);font-family:var(--font-mono)">${s.monthlyTarget} $</span> de capital</div><div class="rule-meta" style="margin-top:12px">${fmtUSD(Math.max(0,s.monthlyTarget-state.capital))} restants</div></div></div>`;
    $('#dash-new')?.addEventListener('click',()=>setView('analyse'));
  }

  function computeScenario(){ const a=state.analysis; if(!a.h1||!a.m30||a.h1!==a.m30){a.scenario=null;a.m5=null;return;} if(!a.m5){a.scenario=null;return;} a.scenario = a.h1==='up' ? (a.m5==='up'?'HHH':'HHB') : (a.m5==='down'?'BBB':'BBH'); }
  function renderAnalyse(){
    const el=$('#view-analyse'); if(!el) return; computeScenario(); const a=state.analysis; save();
    const trendLabel=v=>v==='up'?'au-dessus de la MM20':v==='down'?'en dessous de la MM20':'non défini';
    const aligned=a.h1&&a.m30&&a.h1===a.m30;
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Nouvelle analyse</div><div class="page-sub">H1 → M30 → M5 — le scénario est déterminé automatiquement</div></div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-label">Actif analysé</div><div class="segmented" id="asset-seg">${['BTCUSD','XAUUSD','US30'].map(x=>`<button class="seg-btn ${a.asset===x?'selected':''}" data-asset="${x}">${x}</button>`).join('')}</div></div>
      <div class="analysis-grid">
        ${analysisStep('01','H1','Tendance principale',a.h1,'h1')}
        ${analysisStep('02','M30','Confirmation de tendance',a.m30,'m30')}
        <div class="card analysis-step" style="${aligned?'':'opacity:.45'}"><div class="step-number">03 · M5</div><div style="font-family:var(--font-display);font-weight:600">Chemin d’exécution</div><div class="muted" style="font-size:11.5px;margin-top:4px">${aligned?'Position du prix vs MM20':'H1 et M30 doivent d’abord être alignés'}</div>${aligned?choicePair(a.m5,'m5'):''}</div>
      </div>
      ${a.h1&&a.m30&&!aligned?`<div class="notice danger" style="margin-top:16px">H1 (${trendLabel(a.h1)}) et M30 (${trendLabel(a.m30)}) ne sont pas alignés. <strong>Aucune tendance principale n’est validée.</strong></div>`:''}
      ${a.scenario?scenarioBanner(a.scenario):''}`;
    $$('#asset-seg [data-asset]').forEach(b=>b.onclick=()=>{state.analysis.asset=b.dataset.asset;state.analysis.signal=null;state.analysis.checks={};save();renderAll();});
    $$('[data-choice]').forEach(b=>b.onclick=()=>{ const k=b.dataset.choice; state.analysis[k]=b.dataset.value; if(k==='h1'||k==='m30'){state.analysis.m5=null;state.analysis.scenario=null;} state.analysis.signal=null;state.analysis.checks={};computeScenario();save();renderAll(); });
    $('#continue-setup')?.addEventListener('click',()=>setView('setups'));
  }
  function analysisStep(n,label,sub,val,key){ return `<div class="card analysis-step"><div class="step-number">${n} · ${label}</div><div style="font-family:var(--font-display);font-weight:600">${sub}</div><div class="muted" style="font-size:11.5px;margin-top:4px">Prix par rapport à la MM20</div>${choicePair(val,key)}</div>`; }
  function choicePair(val,key){ return `<div class="choice-pair"><button class="choice up-choice ${val==='up'?'selected':''}" data-choice="${key}" data-value="up">↑ Au-dessus</button><button class="choice down-choice ${val==='down'?'selected':''}" data-choice="${key}" data-value="down">↓ En dessous</button></div>`; }
  function scenarioBanner(sc){ const names={HHH:'Continuation haussière confirmée',BBB:'Continuation baissière confirmée',HHB:'Réintégration haussière à attendre',BBH:'Réintégration baissière à attendre'}; return `<div class="card scenario-banner"><div><div class="card-label">Scénario détecté</div><div class="scenario-big" style="color:${sc==='HHH'||sc==='HHB'?'var(--mint)':'var(--red)'}">${sc}</div><div class="muted" style="font-size:12px;margin-top:5px">${names[sc]}</div></div><button class="btn btn-primary" id="continue-setup">Voir les setups compatibles →</button></div>`; }

  function renderSetups(){
    const el=$('#view-setups'); if(!el) return; const a=state.analysis;
    if(!a.scenario){ el.innerHTML=`<div class="topbar"><div><div class="page-title">Setups</div><div class="page-sub">Aucun scénario actif</div></div></div><div class="empty-state card">Commence une nouvelle analyse H1 → M30 → M5 pour obtenir les setups compatibles.<br><button class="btn btn-primary" id="setup-go-analysis" style="margin-top:16px">Nouvelle analyse</button></div>`; $('#setup-go-analysis')?.addEventListener('click',()=>setView('analyse')); return; }
    const list=signals[a.scenario]||[]; const sig=getSignal(); const allChecked=sig&&sig.checks.every((_,i)=>!!a.checks[i]); const setupReady=Boolean(sig&&allChecked&&!sig.draft);
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Validation du setup</div><div class="page-sub">${a.asset} — scénario ${a.scenario}</div></div><span class="top-status ${setupReady?'ok':''}">${setupReady?'PRÊT À VALIDER':sig?.draft?'RÈGLE À COMPLÉTER':'OBSERVATION EN COURS'}</span></div>
      <div class="grid setup-layout"><div><div class="chart-wrap">${setupSVG(a.scenario,sig?.id)}<div class="chart-legend"><span><span class="legend-dot" style="background:#c9a15c"></span>MM20</span><span><span class="legend-dot" style="background:#3ddc97"></span>Haussier</span><span><span class="legend-dot" style="background:#f0546a"></span>Baissier</span></div></div><h3 class="section-title">Signal observé</h3><div class="signal-grid">${list.map(s=>`<div class="signal-card ${a.signal===s.id?'selected':''}" data-signal="${s.id}"><div class="signal-title">${escapeHtml(s.title)} ${s.draft?'<span style="color:var(--amber);font-family:var(--font-mono);font-size:9px">· À COMPLÉTER</span>':''}</div><div class="signal-sub">${escapeHtml(s.sub)}</div></div>`).join('')}</div></div>
      <div><div class="card"><div class="card-label">Checklist du signal</div>${sig?`<div class="checklist">${sig.checks.map((c,i)=>`<label class="check-row"><span>${escapeHtml(c)}</span><input class="check-toggle" type="checkbox" data-check="${i}" ${a.checks[i]?'checked':''}></label>`).join('')}</div>${sig.draft?'<div class="notice warn" style="margin-top:16px">Cette variante est enregistrée dans ta stratégie mais une règle d’entrée/SL reste à préciser. ALTITUDE OS la bloque volontairement pour ne pas inventer une règle de trading.</div>':`<div class="verdict ${allChecked?'':'pending'}"><div class="verdict-title">${allChecked?'SETUP CONFORME':'VALIDATION EN COURS'}</div><div class="verdict-sub">${allChecked?'Toutes les conditions déclarées sont réunies.':'Coche uniquement ce que tu observes réellement sur le marché.'}</div></div>`}<div style="margin-top:14px;font-size:11px;color:var(--text-3);line-height:1.55"><strong style="color:var(--text-2)">Entrée :</strong> ${escapeHtml(sig.entry)}<br><strong style="color:var(--text-2)">SL :</strong> ${escapeHtml(sig.stop)}<br><strong style="color:var(--text-2)">TP :</strong> ${escapeHtml(sig.target)}</div><button class="btn btn-primary" id="validate-setup" style="width:100%;margin-top:14px" ${setupReady?'':'disabled'}>${sig.draft?'Règle à compléter':'Envoyer au Risk Manager'}</button>`:`<div class="empty-state" style="padding:30px 6px">Choisis le signal que tu observes pour afficher ses règles exactes.</div>`}</div></div></div>`;
    $$('[data-signal]').forEach(c=>c.onclick=()=>{state.analysis.signal=c.dataset.signal;state.analysis.checks={};save();renderSetups();});
    $$('[data-check]').forEach(c=>c.onchange=()=>{state.analysis.checks[c.dataset.check]=c.checked;save();renderSetups();});
    $('#validate-setup')?.addEventListener('click',()=>{ if(!setupReady||!sig)return; state.pendingTrade={asset:a.asset,scenario:a.scenario,signalId:sig.id,signalTitle:sig.title,direction:sig.direction,entryHint:sig.entry,stopHint:sig.stop,targetHint:sig.target,validatedAt:new Date().toISOString()}; save(); setView('risk'); });
  }

  function setupSVG(sc,signalId){
    const bullish=sc==='HHH'||sc==='HHB'; const continuation=sc==='HHH'||sc==='BBB'; const color=bullish?'#3ddc97':'#f0546a'; const opp=bullish?'#f0546a':'#3ddc97';
    const mmPath=continuation?(bullish?'M10,170 C120,160 230,145 330,125 C420,108 500,100 550,92':'M10,90 C120,100 230,116 330,135 C420,150 500,160 550,168'):(bullish?'M10,118 C170,118 360,116 550,116':'M10,142 C170,142 360,144 550,144');
    let candles='';
    const candle=(x,y,h,bodyY,bodyH,c,wide=14)=>`<line x1="${x}" y1="${y}" x2="${x}" y2="${y+h}" stroke="${c}" stroke-width="1.5"/><rect x="${x-wide/2}" y="${bodyY}" width="${wide}" height="${bodyH}" fill="${c}" opacity=".88" rx="1"/>`;
    if(signalId?.includes('two_hammers')){
      candles = bullish ? candle(250,120,90,138,18,color,17)+candle(330,96,86,118,18,color,17) : candle(250,82,90,128,18,color,17)+candle(330,108,90,151,18,color,17);
    } else if(signalId?.includes('three')){
      candles = [230,310,390].map((x,i)=> bullish?candle(x,118-i*18,82,142-i*18,15,color,16):candle(x,75+i*18,82,118+i*18,15,color,16)).join('');
    } else if(signalId?.includes('engulf')){
      candles = bullish ? candle(255,105,66,118,26,opp,14)+candle(310,92,82,108,50,color,20) : candle(255,96,66,110,26,opp,14)+candle(310,88,86,104,52,color,20);
    } else if(signalId?.includes('arrow')){
      candles = bullish ? candle(300,72,118,104,64,color,24) : candle(300,72,118,104,64,color,24);
    } else if(signalId?.includes('inv')){
      candles = bullish ? candle(300,72,118,142,18,color,19) : candle(300,92,112,106,18,color,19);
    } else {
      candles = bullish ? candle(300,86,126,128,20,color,19) : candle(300,62,126,140,20,color,19);
    }
    const bgCandles = bullish ? candle(70,150,48,160,18,color)+candle(125,132,48,143,18,color)+candle(180,120,48,130,18,opp)+candle(440,88,48,98,18,color)+candle(495,78,48,88,18,color) : candle(70,74,48,84,18,color)+candle(125,91,48,101,18,color)+candle(180,104,48,114,18,opp)+candle(440,150,48,160,18,color)+candle(495,164,48,174,18,color);
    const entryY=bullish?128:140, slY=bullish?210:58, tpY=bullish?64:218;
    return `<svg viewBox="0 0 600 260" width="100%" height="auto"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#182029" stroke-width="1"/></pattern></defs><rect width="600" height="260" fill="url(#grid)" opacity=".7"/><path d="${mmPath}" fill="none" stroke="#c9a15c" stroke-width="2"/><text x="530" y="${continuation?(bullish?84:184):108}" fill="#c9a15c" font-family="JetBrains Mono" font-size="10">MM20</text>${bgCandles}${candles}<line x1="300" y1="${entryY}" x2="558" y2="${entryY}" stroke="#e9edf3" stroke-dasharray="4 4" opacity=".6"/><text x="564" y="${entryY+3}" fill="#e9edf3" font-family="JetBrains Mono" font-size="9">ENTRY</text><line x1="300" y1="${slY}" x2="558" y2="${slY}" stroke="#f0546a" stroke-dasharray="4 4" opacity=".8"/><text x="564" y="${slY+3}" fill="#f0546a" font-family="JetBrains Mono" font-size="9">SL</text><line x1="300" y1="${tpY}" x2="558" y2="${tpY}" stroke="#3ddc97" stroke-dasharray="4 4" opacity=".8"/><text x="564" y="${tpY+3}" fill="#3ddc97" font-family="JetBrains Mono" font-size="9">TP</text></svg>`;
  }

  function renderRisk(){
    const el=$('#view-risk'); if(!el) return; const p=state.pendingTrade;
    if(!p){ el.innerHTML=`<div class="topbar"><div><div class="page-title">Risk Manager</div><div class="page-sub">Aucun setup validé en attente</div></div></div><div class="empty-state card">Valide d’abord un setup pour préparer une position.<br><button class="btn btn-primary" id="risk-go-analysis" style="margin-top:16px">Nouvelle analyse</button></div>`; $('#risk-go-analysis')?.addEventListener('click',()=>setView('analyse')); return; }
    const s=state.settings; const locks=tradingLocks();
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Risk Manager</div><div class="page-sub">${p.asset} · ${p.scenario} · ${escapeHtml(p.signalTitle)} · ${p.direction}</div></div><span class="top-status ${locks.length?'blocked':'ok'}">RISQUE FIXE ${s.riskPerTrade} $</span></div>
      ${locks.length?`<div class="notice danger" style="margin-bottom:16px">${locks.map(r=>`• ${escapeHtml(r)}`).join('<br>')}</div>`:''}
      <div class="card" style="margin-bottom:16px"><div class="card-label">Repères du setup</div><div style="font-size:12px;line-height:1.7;color:var(--text-2)"><strong>Entrée :</strong> ${escapeHtml(p.entryHint)} · <strong>SL :</strong> ${escapeHtml(p.stopHint)} · <strong>TP :</strong> ${escapeHtml(p.targetHint)}</div></div>
      <div class="grid rr-grid"><div class="field"><label>Entry</label><input id="risk-entry" inputmode="decimal" placeholder="ex. 64210"></div><div class="field"><label>Stop loss</label><input id="risk-sl" inputmode="decimal" placeholder="ex. 64040"></div><div class="field"><label>Take profit</label><input id="risk-tp" inputmode="decimal" placeholder="ex. 64720"></div></div>
      <div id="risk-live"></div>
      <h3 class="section-title">Capture avant le trade <span class="muted" style="font-weight:400">(optionnelle)</span></h3><div class="field"><input id="before-image" type="file" accept="image/*"></div>
      <div style="margin-top:20px;display:flex;justify-content:flex-end"><button class="btn btn-primary" id="create-trade" disabled>Créer le trade dans le journal</button></div>`;
    ['risk-entry','risk-sl','risk-tp'].forEach(id=>$(`#${id}`)?.addEventListener('input',updateRiskLive));
    $('#before-image')?.addEventListener('change',e=>{beforeImageFile=e.target.files?.[0]||null;});
  }
  function parseNum(v){ return Number(String(v||'').replace(/\s/g,'').replace(',','.')); }
  function updateRiskLive(){
    const p=state.pendingTrade, live=$('#risk-live'); if(!p||!live)return;
    const entry=parseNum($('#risk-entry')?.value), sl=parseNum($('#risk-sl')?.value), tp=parseNum($('#risk-tp')?.value); let valid=false, rr=0, reason='Renseigne Entry, SL et TP.';
    if([entry,sl,tp].every(Number.isFinite)){
      const risk=Math.abs(entry-sl), reward=p.direction==='BUY'?tp-entry:entry-tp; const correct=p.direction==='BUY'?(sl<entry&&tp>entry):(sl>entry&&tp<entry);
      if(!correct) reason=`Pour un ${p.direction}, le SL et le TP ne sont pas du bon côté de l’entrée.`;
      else if(risk<=0||reward<=0) reason='Distances Entry/SL/TP invalides.';
      else {rr=reward/risk; valid=rr>=state.settings.minRR; reason=valid?'Ratio conforme.':'Ratio inférieur au minimum 1:2.';}
    }
    const rewardUSD=state.settings.riskPerTrade*rr;
    live.innerHTML=`<div class="risk-summary"><div class="card"><div class="card-label">Risque</div><div class="card-value" style="font-size:19px">${fmtUSD(state.settings.riskPerTrade)}</div></div><div class="card"><div class="card-label">Ratio calculé</div><div class="card-value ${valid?'up':'down'}" style="font-size:19px">${rr?`1:${rr.toFixed(2)}`:'—'}</div></div><div class="card"><div class="card-label">Reward potentiel</div><div class="card-value up" style="font-size:19px">${rr?fmtUSD(rewardUSD):'—'}</div></div><div class="card"><div class="card-label">Capital si TP</div><div class="card-value up" style="font-size:19px">${rr?fmtUSD(state.capital+rewardUSD):'—'}</div></div></div><div class="notice ${valid?'success':'danger'}" style="margin-top:16px">${escapeHtml(reason)} ${rr>=3?'★ Ratio 1:3 ou supérieur : si le trade gagne, la journée sera terminée.':''}</div>`;
    const btn=$('#create-trade'); if(btn){btn.disabled=!valid||tradingLocks().length>0||reviewRequirement().overdue; btn.onclick=valid?()=>createTrade(entry,sl,tp,rr):null;}
  }
  async function createTrade(entry,sl,tp,rr){
    if(!state.pendingTrade||!canTrade()) return;
    const p=state.pendingTrade; const trade={id:uid(),openedAt:new Date().toISOString(),asset:p.asset,scenario:p.scenario,signalId:p.signalId,signalTitle:p.signalTitle,direction:p.direction,entry,sl,tp,plannedRR:Number(rr.toFixed(3)),riskUSD:state.settings.riskPerTrade,status:'open',result:null,resultR:null,pnl:0,quality:null,error:'',comment:'',capitalBefore:state.capital,capitalAfter:null};
    state.trades.unshift(trade); state.pendingTrade=null; state.analysis={asset:p.asset,h1:null,m30:null,m5:null,scenario:null,signal:null,checks:{}}; save();
    if(beforeImageFile){ await mediaPut(`${trade.id}:before`,await compressImage(beforeImageFile)); beforeImageFile=null; }
    setView('journal',true); openTradeDetails(trade.id);
  }

  function renderJournal(){
    const el=$('#view-journal'); if(!el) return; const trades=state.trades;
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Journal</div><div class="page-sub">${trades.length} trade(s) enregistré(s)</div></div></div><div class="card" style="padding:6px 14px">${trades.length?`<div class="trade-row dynamic"><span>Date</span><span>Actif</span><span>Scénario / setup</span><span>Ratio</span><span>Résultat</span><span>Exécution</span><span>PnL</span><span></span></div>${trades.map(t=>`<div class="trade-row dynamic"><span>${formatShortDate(t.openedAt)}</span><span class="pair-tag">${t.asset}</span><span>${t.scenario} — ${escapeHtml(t.signalTitle)} <span class="${t.direction==='BUY'?'side-buy':'side-sell'}">${t.direction}</span></span><span>1:${Number(t.plannedRR).toFixed(2)}</span><span class="${t.status==='open'?'neutral':t.resultR>=0?'pnl-pos':'pnl-neg'}">${t.status==='open'?'OUVERT':fmtR(t.resultR)}</span><span class="${t.quality==='good'?'quality-good':t.quality==='bad'?'quality-bad':'neutral'}">${t.status==='open'?'—':t.quality==='good'?'BON TRADE ✓':'MAUVAIS TRADE'}</span><span class="${t.pnl>=0?'pnl-pos':'pnl-neg'}">${t.status==='open'?'—':`${t.pnl>=0?'+':''}${fmtUSD(t.pnl)}`}</span><span><button class="btn trade-action" data-trade="${t.id}">${t.status==='open'?'Clôturer':'Voir'}</button></span></div>`).join('')}`:`<div class="empty-state">Aucun trade pour le moment. Les positions validées par le Risk Manager apparaîtront ici.</div>`}</div><p class="muted" style="margin-top:12px;font-size:11.5px">Le résultat financier et la qualité d’exécution sont toujours distingués.</p>`;
    $$('[data-trade]').forEach(b=>b.onclick=()=>{const t=state.trades.find(x=>x.id===b.dataset.trade); if(t?.status==='open')openCloseTrade(t.id);else openTradeDetails(t.id);});
  }

  function openCloseTrade(id){
    const t=state.trades.find(x=>x.id===id); if(!t)return; closeTradeResult=null; afterImageFile=null;
    showModal(`<div class="modal-head"><div><div class="modal-title">Clôturer ${t.asset} · ${t.scenario}</div><div class="muted" style="font-size:11px;margin-top:4px">${escapeHtml(t.signalTitle)} · risque ${fmtUSD(t.riskUSD)}</div></div><button class="icon-btn" data-close-modal>×</button></div>
      <div class="card-label">Résultat financier</div><div class="result-options" style="margin-bottom:18px"><button class="result-btn win" data-result="win">GAIN</button><button class="result-btn loss" data-result="loss">PERTE</button><button class="result-btn be" data-result="be">BREAK-EVEN</button></div>
      <div class="form-grid"><label class="check-row"><span>Setup respecté</span><input id="q-setup" class="check-toggle" type="checkbox" checked></label><label class="check-row"><span>Risk management respecté</span><input id="q-risk" class="check-toggle" type="checkbox" checked></label><label class="check-row"><span>Clôture du signal attendue</span><input id="q-close" class="check-toggle" type="checkbox" checked></label><label class="check-row"><span>Trade prévu par la stratégie</span><input id="q-plan" class="check-toggle" type="checkbox" checked></label><label class="check-row"><span>SL/TP non modifiés hors plan</span><input id="q-unmodified" class="check-toggle" type="checkbox" checked></label><div class="field"><label>Erreur éventuelle</label><select id="q-error"><option value="">Aucune</option><option>Entrée trop tôt</option><option>Mauvaise lecture de tendance</option><option>Mauvais setup</option><option>Ratio insuffisant</option><option>FOMO</option><option>Trade hors stratégie</option><option>Stop déplacé</option><option>TP déplacé</option><option>Autre</option></select></div></div>
      <div class="field" style="margin-top:14px"><label>Commentaire / leçon du trade</label><textarea id="q-comment" rows="4" placeholder="Ce que tu veux retenir de ce trade..."></textarea></div><div class="field" style="margin-top:14px"><label>Capture après le trade (optionnelle)</label><input id="after-image" type="file" accept="image/*"></div><button class="btn btn-primary" id="confirm-close" style="width:100%;margin-top:18px" disabled>Enregistrer le résultat</button>`);
    $$('[data-result]').forEach(b=>b.onclick=()=>{closeTradeResult=b.dataset.result;$$('[data-result]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');$('#confirm-close').disabled=false;});
    $('#after-image')?.addEventListener('change',e=>afterImageFile=e.target.files?.[0]||null);
    $('#confirm-close')?.addEventListener('click',()=>closeTrade(id));
  }
  async function closeTrade(id){
    const t=state.trades.find(x=>x.id===id); if(!t||!closeTradeResult)return;
    const resultR=closeTradeResult==='win'?t.plannedRR:closeTradeResult==='loss'?-1:0; const pnl=resultR*t.riskUSD;
    const good=['q-setup','q-risk','q-close','q-plan','q-unmodified'].every(i=>$(`#${i}`)?.checked);
    t.status='closed';t.closedAt=new Date().toISOString();t.result=closeTradeResult;t.resultR=resultR;t.pnl=pnl;t.quality=good?'good':'bad';t.error=$('#q-error')?.value||'';t.comment=$('#q-comment')?.value||'';state.capital=Number((state.capital+pnl).toFixed(2));t.capitalAfter=state.capital;
    triggerMonthLockIfNeeded();save(); if(afterImageFile){await mediaPut(`${t.id}:after`,await compressImage(afterImageFile));afterImageFile=null;} closeModal();renderAll();openTradeDetails(id);
  }
  async function openTradeDetails(id){
    const t=state.trades.find(x=>x.id===id); if(!t)return; const before=await mediaGet(`${id}:before`), after=await mediaGet(`${id}:after`);
    showModal(`<div class="modal-head"><div><div class="modal-title">${t.asset} · ${t.scenario} · ${t.direction}</div><div class="muted" style="font-size:11px;margin-top:4px">${formatDateTime(t.openedAt)} · ${escapeHtml(t.signalTitle)}</div></div><button class="icon-btn" data-close-modal>×</button></div>
      <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:10px"><div class="card"><div class="card-label">Entry</div><div class="pair-tag">${t.entry}</div></div><div class="card"><div class="card-label">SL</div><div class="pair-tag">${t.sl}</div></div><div class="card"><div class="card-label">TP</div><div class="pair-tag">${t.tp}</div></div><div class="card"><div class="card-label">Ratio</div><div class="pair-tag">1:${Number(t.plannedRR).toFixed(2)}</div></div></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><div class="card"><div class="card-label">Résultat</div><div class="card-value ${t.status==='open'?'neutral':t.resultR>=0?'up':'down'}" style="font-size:20px">${t.status==='open'?'OUVERT':fmtR(t.resultR)}</div></div><div class="card"><div class="card-label">Qualité d’exécution</div><div style="font-weight:600;color:${t.quality==='good'?'var(--mint)':t.quality==='bad'?'var(--red)':'var(--text-2)'}">${t.status==='open'?'À évaluer':t.quality==='good'?'BON TRADE ✓':'MAUVAIS TRADE'}</div></div></div>
      <h3 class="section-title">Captures</h3><div class="thumbs"><div class="thumb">${before?`<img src="${before}">`:'Aucune capture avant'}</div><div class="thumb">${after?`<img src="${after}">`:'Aucune capture après'}</div></div>${t.status==='closed'?`<h3 class="section-title">Retour</h3><div class="card"><div class="card-label">Erreur</div><div>${escapeHtml(t.error||'Aucune')}</div><div class="card-label" style="margin-top:14px">Commentaire</div><div style="line-height:1.55;color:var(--text-2)">${escapeHtml(t.comment||'Aucun commentaire')}</div></div>`:''}`);
  }

  function renderWeekly(){
    const el=$('#view-weekly'); if(!el)return; const req=reviewRequirement(); const draft=state.weeklyDrafts[req.key]||{trades:{},summary:'',rule:''};
    if(req.trades.length===0){ el.innerHTML=`<div class="topbar"><div><div class="page-title">Revue hebdomadaire</div><div class="page-sub">Période ${formatShortDate(req.start)} → ${formatShortDate(req.end)}</div></div></div><div class="empty-state card">Aucun trade n’a été pris pendant cette période. Aucune revue n’est obligatoire.</div>`; return; }
    if(req.done){ const rv=state.weeklyReviews[req.key]; el.innerHTML=`<div class="topbar"><div><div class="page-title">Revue hebdomadaire</div><div class="page-sub">${formatShortDate(req.start)} → ${formatShortDate(req.end)} · terminée</div></div><span class="top-status ok">REVUE VALIDÉE</span></div><div class="card"><div class="card-label">Bilan</div><div style="line-height:1.6">${escapeHtml(rv.summary)}</div></div><h3 class="section-title">Règle de la semaine</h3><div class="card rule-card"><span class="rule-status active">ACTIVE</span><div class="rule-text">${escapeHtml(rv.rule)}</div></div>`; return; }
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Revue hebdomadaire</div><div class="page-sub">${req.trades.length} trade(s) · ${formatShortDate(req.start)} → ${formatShortDate(req.end)}</div></div><span class="top-status ${req.overdue?'blocked':''}">${req.overdue?'EN RETARD':'À TERMINER'}</span></div>
      <div class="notice ${req.overdue?'danger':'warn'}" style="margin-bottom:16px">Chaque trade doit être observé. La revue n’est validée qu’après une conclusion générale et une règle de la semaine.</div>
      <div id="review-list">${req.trades.map(t=>reviewTradeCard(t,draft.trades[t.id]||{})).join('')}</div>
      <h3 class="section-title">Bilan de la semaine</h3><div class="card"><div class="field"><label>Conclusion générale</label><textarea id="review-summary" rows="4" placeholder="Ce que la semaine t’a appris...">${escapeHtml(draft.summary||'')}</textarea></div></div>
      <h3 class="section-title">Règle de la semaine</h3><div class="card"><div class="field"><label>Une règle claire issue de tes observations</label><textarea id="review-rule" rows="3" placeholder="Ex. Toujours attendre la clôture de la flèche directionnelle...">${escapeHtml(draft.rule||'')}</textarea></div><button class="btn btn-primary" id="complete-review" style="margin-top:16px;width:100%">Valider la revue et ajouter la règle</button></div>`;
    $$('[data-review-field]').forEach(inp=>inp.addEventListener('input',saveReviewDraft)); $('#review-summary')?.addEventListener('input',saveReviewDraft); $('#review-rule')?.addEventListener('input',saveReviewDraft); $('#complete-review')?.addEventListener('click',completeReview);
  }
  function reviewTradeCard(t,d){ return `<div class="card review-trade"><div class="review-head"><div><div style="font-weight:600">${formatShortDate(t.openedAt)} · ${t.asset} · ${t.scenario} · ${escapeHtml(t.signalTitle)}</div><div class="rule-meta">${t.status==='closed'?`${fmtR(t.resultR)} · ${t.quality==='good'?'bon trade':'mauvais trade'}`:'Trade encore ouvert'}</div></div><span class="review-status ${t.status==='closed'&&t.resultR>=0?'up':'down'}">${t.status==='closed'?`${t.pnl>=0?'+':''}${fmtUSD(t.pnl)}`:'OUVERT'}</span></div><div class="form-grid"><div class="field"><label>Observation</label><textarea data-review-field="observation" data-trade-id="${t.id}" rows="3">${escapeHtml(d.observation||'')}</textarea></div><div class="field"><label>Ce qui était correct</label><textarea data-review-field="correct" data-trade-id="${t.id}" rows="3">${escapeHtml(d.correct||'')}</textarea></div><div class="field"><label>Erreur / point faible</label><textarea data-review-field="error" data-trade-id="${t.id}" rows="3">${escapeHtml(d.error||'')}</textarea></div><div class="field"><label>Leçon à retenir</label><textarea data-review-field="lesson" data-trade-id="${t.id}" rows="3">${escapeHtml(d.lesson||'')}</textarea></div></div></div>`; }
  function saveReviewDraft(){ const req=reviewRequirement(); const d=state.weeklyDrafts[req.key]||{trades:{},summary:'',rule:''}; $$('[data-review-field]').forEach(inp=>{const id=inp.dataset.tradeId;d.trades[id]=d.trades[id]||{};d.trades[id][inp.dataset.reviewField]=inp.value;}); d.summary=$('#review-summary')?.value||'';d.rule=$('#review-rule')?.value||'';state.weeklyDrafts[req.key]=d;save(); }
  function completeReview(){
    saveReviewDraft(); const req=reviewRequirement(), d=state.weeklyDrafts[req.key]; const missing=req.trades.some(t=>!d.trades[t.id]||['observation','correct','error','lesson'].some(k=>!String(d.trades[t.id][k]||'').trim()));
    if(missing||!d.summary.trim()||!d.rule.trim()){alert('Complète les 4 champs de chaque trade, le bilan et la règle de la semaine.');return;}
    state.weeklyReviews[req.key]={completedAt:new Date().toISOString(),start:req.start.toISOString(),end:req.end.toISOString(),summary:d.summary,rule:d.rule,trades:d.trades}; state.rules.push({id:uid(),text:d.rule,status:'active',createdAt:new Date().toISOString(),period:`Revue ${formatShortDate(req.start)} → ${formatShortDate(req.end)}`}); delete state.weeklyDrafts[req.key];save();hideReviewLock();renderAll();alert('Revue validée. La règle a été ajoutée au Livre de règles.');
  }

  function renderStats(){
    const el=$('#view-stats'); if(!el)return; const c=closedTrades(); const wins=c.filter(t=>t.result==='win').length; const winRate=c.length?wins/c.length*100:0; const totalR=sumR(c), avgR=c.length?totalR/c.length:0; let cum=0,peak=0,maxDD=0; [...c].reverse().forEach(t=>{cum+=t.resultR;peak=Math.max(peak,cum);maxDD=Math.max(maxDD,peak-cum)}); const discipline=c.length?c.filter(t=>t.quality==='good').length/c.length*100:100;
    const scStats=['HHH','BBB','HHB','BBH'].map(sc=>{const arr=c.filter(t=>t.scenario===sc),w=arr.filter(t=>t.result==='win').length;return {sc,n:arr.length,wr:arr.length?w/arr.length*100:0,r:sumR(arr)}}); const maxAbs=Math.max(1,...scStats.map(x=>Math.abs(x.r)));
    const errors={};c.forEach(t=>{if(t.error)errors[t.error]=(errors[t.error]||0)+1});
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Statistiques</div><div class="page-sub">Performance réelle issue du journal</div></div></div><div class="grid stat-grid"><div class="card"><div class="card-label">Win rate</div><div class="card-value">${winRate.toFixed(0)}%</div></div><div class="card"><div class="card-label">R total</div><div class="card-value ${totalR>=0?'up':'down'}">${fmtR(totalR)}</div></div><div class="card"><div class="card-label">R moyen</div><div class="card-value ${avgR>=0?'up':'down'}">${fmtR(avgR)}</div></div><div class="card"><div class="card-label">Drawdown max</div><div class="card-value down">-${maxDD.toFixed(2)}R</div></div></div>
      <div class="grid" style="grid-template-columns:1.35fr 1fr;gap:16px"><div class="card"><div class="card-label">Performance par scénario</div>${scStats.map(x=>`<div class="bar-row"><span class="pair-tag">${x.sc}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.abs(x.r)/maxAbs*100}%;background:${x.r>=0?'var(--mint)':'var(--red)'}"></div></div><span class="${x.r>=0?'up':'down'}" style="font-family:var(--font-mono)">${fmtR(x.r)}</span></div><div class="rule-meta">${x.n} trade(s) · ${x.wr.toFixed(0)}% win rate</div>`).join('')}</div><div class="card"><div class="card-label">Discipline</div><div class="card-value" style="color:var(--amber)">${discipline.toFixed(0)}%</div><div class="rule-meta">${c.filter(t=>t.quality==='good').length} bons trades sur ${c.length}</div><h3 class="section-title" style="margin-top:22px">Erreurs fréquentes</h3>${Object.keys(errors).length?Object.entries(errors).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`<div class="check-row"><span>${escapeHtml(k)}</span><span class="down">${v}×</span></div>`).join(''):'<div class="muted" style="font-size:12px">Aucune erreur enregistrée.</div>'}</div></div>`;
  }

  function renderRules(){
    const el=$('#view-rules'); if(!el)return; const rules=[...state.rules].reverse();
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Livre de règles</div><div class="page-sub">${rules.length} règle(s) construites à partir de tes revues</div></div></div>${rules.length?`<div class="grid" style="grid-template-columns:1fr 1fr">${rules.map(r=>`<div class="card rule-card"><span class="rule-status ${r.status==='active'?'active':r.status==='watch'?'watch':'archived'}">${r.status==='active'?'ACTIVE':r.status==='watch'?'À SURVEILLER':'ARCHIVÉE'}</span><div class="rule-text">${escapeHtml(r.text)}</div><div class="rule-meta">${escapeHtml(r.period||formatDate(r.createdAt))}</div><div style="display:flex;gap:6px;margin-top:12px"><button class="btn trade-action" data-rule-status="active" data-rule="${r.id}">Active</button><button class="btn trade-action" data-rule-status="watch" data-rule="${r.id}">À surveiller</button><button class="btn trade-action" data-rule-status="archived" data-rule="${r.id}">Archiver</button></div></div>`).join('')}</div>`:`<div class="empty-state card">Ton Livre de règles se construira automatiquement à chaque revue hebdomadaire.</div>`}`;
    $$('[data-rule-status]').forEach(b=>b.onclick=()=>{const r=state.rules.find(x=>x.id===b.dataset.rule);if(r){r.status=b.dataset.ruleStatus;save();renderAll();}});
  }

  function renderSettings(){
    const el=$('#view-settings');if(!el)return; const s=state.settings; const cloud=Boolean(currentUser&&supabase);
    el.innerHTML=`<div class="topbar"><div><div class="page-title">Paramètres</div><div class="page-sub">Compte, gestion du risque et données</div></div></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><div class="card-label">Compte</div><div class="check-row"><span>Email</span><span class="pair-tag">${escapeHtml(currentUser?.email||'Mode démo local')}</span></div><div class="check-row"><span>Plan</span><span class="pair-tag" style="color:var(--amber)">${escapeHtml(accountProfile?.plan||'DEMO')}</span></div><div class="check-row"><span>Mémoire</span><span>${cloud?'Cloud privé + cache local':'Ce navigateur uniquement'}</span></div><div id="sync-badge" class="sync-badge"></div><div class="settings-actions">${cloud?'<button class="btn" id="sign-out">Se déconnecter</button>':''}${cloud&&BILLING_ENABLED&&accountProfile?.plan!=='pro'?'<button class="btn btn-primary" id="upgrade-plan">Passer Pro</button>':''}${cloud&&BILLING_ENABLED&&accountProfile?.plan==='pro'?'<button class="btn" id="billing-portal">Gérer mon abonnement</button>':''}</div></div>
        <div class="card"><div class="card-label">Gestion du risque</div><div class="form-grid"><div class="field"><label>Capital initial ($)</label><input id="set-initial" value="${s.initialCapital}"></div><div class="field"><label>Risque / trade ($)</label><input id="set-risk" value="${s.riskPerTrade}"></div><div class="field"><label>Ratio minimum</label><input id="set-minrr" value="${s.minRR}"></div><div class="field"><label>Ratio cible</label><input id="set-targetrr" value="${s.targetRR}"></div><div class="field"><label>Trades max / jour</label><input id="set-daily" value="${s.maxDailyTrades}"></div><div class="field"><label>Pertes max / semaine</label><input id="set-losses" value="${s.maxWeeklyLosses}"></div><div class="field"><label>Gains max / semaine</label><input id="set-wins" value="${s.maxWeeklyWins}"></div><div class="field"><label>Objectif mensuel ($)</label><input id="set-target" value="${s.monthlyTarget}"></div></div><button class="btn btn-primary" id="save-settings" style="margin-top:14px;width:100%">Enregistrer les règles</button></div>
        <div class="card"><div class="card-label">Sauvegarde & portabilité</div><p class="muted" style="font-size:12px;line-height:1.6">${cloud?'Tes données sont synchronisées avec ton compte ALTITUDE OS. Une copie locale reste disponible en cas de coupure réseau.':'Le mode démo ne synchronise pas entre plusieurs appareils.'}</p><div class="settings-actions"><button class="btn" id="export-data">Exporter JSON</button><label class="btn" style="cursor:pointer">Importer JSON<input id="import-data" type="file" accept="application/json" style="display:none"></label><button class="btn danger-btn" id="reset-data">Réinitialiser mes données</button></div></div>
        <div class="card"><div class="card-label">Confidentialité & sécurité</div><div class="legal-note">Chaque compte cloud est isolé par des politiques Row Level Security dans Supabase. Les captures de trades sont stockées dans un bucket privé et servies par URL temporaire. La clé service-role ne doit jamais être placée dans ce frontend.</div>${cloud?'<button class="btn danger-btn" id="delete-account" style="margin-top:16px">Supprimer définitivement mon compte</button>':''}</div>
      </div>
      <h3 class="section-title">Informations légales</h3><div class="legal-grid"><div class="card legal-note"><strong style="color:var(--text-1)">Avertissement</strong><br>ALTITUDE OS est un outil de journalisation, de gestion de discipline et d’analyse personnelle. Il ne fournit pas de conseil financier et n’exécute pas d’ordres de marché.</div><div class="card legal-note"><strong style="color:var(--text-1)">Avant commercialisation</strong><br>Complète l’identité de l’éditeur, les CGU, la politique de confidentialité, le support, les prix et le traitement de paiement avant de vendre des abonnements.</div></div>`;
    updateSyncBadge();
    $('#save-settings')?.addEventListener('click',saveSettingsFromForm); $('#export-data')?.addEventListener('click',exportData); $('#import-data')?.addEventListener('change',importData); $('#reset-data')?.addEventListener('click',resetData); $('#sign-out')?.addEventListener('click',signOut); $('#delete-account')?.addEventListener('click',deleteAccount); $('#upgrade-plan')?.addEventListener('click',startCheckout); $('#billing-portal')?.addEventListener('click',openBillingPortal);
  }
  function saveSettingsFromForm(){
    const n=id=>parseNum($(`#${id}`)?.value); const vals={initialCapital:n('set-initial'),riskPerTrade:n('set-risk'),minRR:n('set-minrr'),targetRR:n('set-targetrr'),maxDailyTrades:n('set-daily'),maxWeeklyLosses:n('set-losses'),maxWeeklyWins:n('set-wins'),monthlyTarget:n('set-target')};
    if(Object.values(vals).some(v=>!Number.isFinite(v)||v<=0)){alert('Tous les paramètres doivent être des nombres strictement positifs.');return;} if(state.trades.length===0)state.capital=vals.initialCapital; state.settings=vals; save(); renderAll(); alert('Paramètres enregistrés.');
  }
  function exportData(){ const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`altitude-os-backup-${isoDay(new Date())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500); }
  function importData(e){ const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const imported=JSON.parse(r.result);state=mergeState(imported);save();renderAll();alert('Sauvegarde importée.');}catch{alert('Fichier JSON invalide.');}};r.readAsText(f); }
  function resetData(){ if(!confirm('Réinitialiser tes données ALTITUDE OS ? Les trades, règles et revues seront supprimés pour ce compte.'))return; localStorage.removeItem(storageKey);state=defaults();save();renderAll(); }
  async function signOut(){ if(supabase&&currentUser) await supabase.auth.signOut(); currentUser=null;accountProfile=null;storageKey=`${STORAGE_KEY_BASE}:demo`;document.querySelector('#app-shell').hidden=true;showAuth('login','Déconnexion réussie.'); }
  async function deleteAccount(){ if(!supabase||!currentUser)return; if(!confirm('Supprimer définitivement ton compte et toutes ses données ? Cette action est irréversible.'))return; const {error}=await supabase.functions.invoke('delete-account'); if(error){alert('Suppression impossible : '+error.message+'\nDéploie la fonction Supabase delete-account fournie dans le projet.');return;} await supabase.auth.signOut(); currentUser=null;document.querySelector('#app-shell').hidden=true;showAuth('login','Compte supprimé.'); }
  async function startCheckout(){ if(!supabase||!currentUser)return; const {data,error}=await supabase.functions.invoke('create-checkout-session'); if(error||!data?.url){alert('Paiement indisponible : '+(error?.message||'configuration Stripe incomplète'));return;} window.location.assign(data.url); }
  async function openBillingPortal(){ if(!supabase||!currentUser)return; const {data,error}=await supabase.functions.invoke('billing-portal'); if(error||!data?.url){alert('Portail de facturation indisponible : '+(error?.message||'configuration incomplète'));return;} window.location.assign(data.url); }

  function showModal(html){ $('#modal').innerHTML=html; $('#modal-backdrop').classList.add('show'); $$('[data-close-modal]').forEach(b=>b.onclick=closeModal); }
  function closeModal(){ $('#modal-backdrop').classList.remove('show'); $('#modal').innerHTML=''; }
  $('#modal-backdrop').addEventListener('click',e=>{if(e.target===$('#modal-backdrop'))closeModal();});

  // Screenshots: private Supabase Storage in cloud mode, IndexedDB fallback in demo/offline mode.
  let dbPromise=null;
  function mediaDB(){ if(dbPromise)return dbPromise; dbPromise=new Promise((res,rej)=>{const q=indexedDB.open('altitude_os_media_v3',1);q.onupgradeneeded=()=>q.result.createObjectStore('media');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);}); return dbPromise; }
  async function localMediaPut(key,val){try{const db=await mediaDB();await new Promise((res,rej)=>{const tx=db.transaction('media','readwrite');tx.objectStore('media').put(val,key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}catch(e){console.warn(e)}}
  async function localMediaGet(key){try{const db=await mediaDB();return await new Promise((res,rej)=>{const q=db.transaction('media').objectStore('media').get(key);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error);});}catch{return null}}
  function mediaPath(key){ return `${currentUser.id}/${String(key).replace(':','/')}.jpg`; }
  function dataURLToBlob(dataURL){ const [head,body]=dataURL.split(','); const mime=(head.match(/data:(.*?);/)||[])[1]||'image/jpeg'; const bin=atob(body); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i); return new Blob([bytes],{type:mime}); }
  async function mediaPut(key,val){
    if(currentUser&&supabase){try{const {error}=await supabase.storage.from('trade-media').upload(mediaPath(key),dataURLToBlob(val),{contentType:'image/jpeg',upsert:true});if(error)throw error;return;}catch(e){console.warn('Cloud media upload failed',e)}}
    await localMediaPut(`${storageKey}:${key}`,val);
  }
  async function mediaGet(key){
    if(currentUser&&supabase){try{const {data,error}=await supabase.storage.from('trade-media').createSignedUrl(mediaPath(key),3600);if(error)throw error;if(data?.signedUrl)return data.signedUrl;}catch(e){console.warn('Cloud media read failed',e)}}
    return localMediaGet(`${storageKey}:${key}`);
  }
  function compressImage(file){ return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const max=1600,scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.78));};img.onerror=reject;img.src=reader.result;};reader.onerror=reject;reader.readAsDataURL(file);}); }

  $$('.nav-item[data-view]').forEach(it=>it.addEventListener('click',()=>setView(it.dataset.view)));
  $('#go-review').addEventListener('click',()=>{hideReviewLock();setView('weekly',true);});

  // --- Authentication, account memory and launch sequence ---
  let authMode='login';
  function animateLaunchDots(){ const dots=$$('.launch-dot'); let i=0; dots.forEach((d,j)=>d.classList.toggle('active',j===0)); return setInterval(()=>{i=(i+1)%dots.length;dots.forEach((d,j)=>d.classList.toggle('active',j===i));},240); }
  const launchTimer=animateLaunchDots(); const launchStarted=Date.now();
  async function finishLaunch(){ const wait=Math.max(0,1250-(Date.now()-launchStarted)); await new Promise(r=>setTimeout(r,wait)); clearInterval(launchTimer); $('#launch-screen')?.classList.add('is-leaving'); setTimeout(()=>{const x=$('#launch-screen');if(x)x.style.display='none';},520); }
  function authMessageHtml(message,type='success'){ return message?`<div class="auth-msg ${type}">${escapeHtml(message)}</div>`:''; }
  function showAuth(mode='login',message='',type='success'){
    authMode=mode; const screen=$('#auth-screen'); screen.hidden=false; $('#app-shell').hidden=true;
    const configuredNote=supabaseConfigured?'':'Supabase n’est pas encore configuré : utilise le mode démo, puis suis DEPLOYMENT.md pour activer les comptes cloud.';
    $('#auth-content').innerHTML=`<div class="auth-title">${mode==='signup'?'Créer ton compte':'Bienvenue'}</div><div class="auth-sub">${mode==='signup'?'Un espace privé sera créé pour tes analyses, trades, règles et revues.':'Connecte-toi pour retrouver ton desk et ta mémoire sur tous tes appareils.'}</div><div class="auth-tabs"><button class="auth-tab ${mode==='login'?'active':''}" data-auth-tab="login">Connexion</button><button class="auth-tab ${mode==='signup'?'active':''}" data-auth-tab="signup">Créer un compte</button></div>${configuredNote?authMessageHtml(configuredNote,'error'):''}${authMessageHtml(message,type)}${mode==='signup'?'<div class="auth-field"><label>Nom affiché</label><input id="auth-name" autocomplete="name" placeholder="Ton nom"></div>':''}<div class="auth-field"><label>Email</label><input id="auth-email" type="email" autocomplete="email" placeholder="nom@exemple.com"></div><div class="auth-field"><label>Mot de passe</label><input id="auth-password" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="8 caractères minimum"></div><div class="auth-actions"><button class="btn btn-primary" id="auth-submit">${mode==='signup'?'Créer mon compte':'Se connecter'}</button>${mode==='login'&&supabaseConfigured?'<button class="auth-link" id="forgot-password">Mot de passe oublié ?</button>':''}</div><div class="auth-divider">TEST LOCAL</div><button class="btn" id="demo-mode" style="width:100%">Continuer en mode démo locale</button>`;
    $$('[data-auth-tab]').forEach(b=>b.onclick=()=>showAuth(b.dataset.authTab)); $('#auth-submit').onclick=submitAuth; $('#demo-mode').onclick=enterDemo; $('#forgot-password')?.addEventListener('click',resetPassword);
  }
  async function submitAuth(){
    if(!supabaseConfigured){showAuth(authMode,'Configure Supabase avant de créer de vrais comptes. Tu peux tester en mode démo.','error');return;}
    const email=$('#auth-email')?.value.trim(), password=$('#auth-password')?.value||''; if(!email||password.length<8){showAuth(authMode,'Renseigne un email valide et un mot de passe d’au moins 8 caractères.','error');return;}
    if(authMode==='signup'){
      const displayName=$('#auth-name')?.value.trim()||email.split('@')[0]; const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo:APP_URL}}); if(error){showAuth('signup',error.message,'error');return;} if(data.session){await startUser(data.user);} else showAuth('login','Compte créé. Vérifie ton email puis connecte-toi.','success');
    }else{ const {data,error}=await supabase.auth.signInWithPassword({email,password}); if(error){showAuth('login',error.message,'error');return;} await startUser(data.user); }
  }
  function showPasswordRecovery(){
    const screen=$('#auth-screen'); screen.hidden=false; $('#app-shell').hidden=true;
    $('#auth-content').innerHTML=`<div class="auth-title">Nouveau mot de passe</div><div class="auth-sub">Choisis un nouveau mot de passe pour ton compte ALTITUDE OS.</div><div class="auth-field"><label>Nouveau mot de passe</label><input id="recovery-password" type="password" autocomplete="new-password" placeholder="8 caractères minimum"></div><button class="btn btn-primary" id="save-new-password" style="width:100%;margin-top:8px">Enregistrer le mot de passe</button>`;
    $('#save-new-password').onclick=async()=>{const password=$('#recovery-password')?.value||'';if(password.length<8){alert('Le mot de passe doit contenir au moins 8 caractères.');return;}const {error}=await supabase.auth.updateUser({password});if(error){alert(error.message);return;}alert('Mot de passe mis à jour.');const {data}=await supabase.auth.getUser();if(data.user)await startUser(data.user);};
  }
  async function resetPassword(){ const email=$('#auth-email')?.value.trim(); if(!email){showAuth('login','Saisis ton email puis clique à nouveau sur “Mot de passe oublié”.','error');return;} const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:APP_URL}); showAuth('login',error?error.message:'Email de réinitialisation envoyé.',error?'error':'success'); }
  async function enterDemo(){ currentUser=null;accountProfile={plan:'DEMO'};storageKey=`${STORAGE_KEY_BASE}:demo`;state=load();syncState='local';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;updateAccountMini();renderAll();if(reviewRequirement().overdue)setTimeout(showReviewLock,100); }
  async function startUser(user){
    if(!user)return; currentUser=user;storageKey=`${STORAGE_KEY_BASE}:${user.id}`;state=load();
    if(supabase){try{const {data}=await supabase.from('profiles').select('display_name,plan').eq('id',user.id).maybeSingle();accountProfile=data||{display_name:user.user_metadata?.display_name||'',plan:'free'};}catch{accountProfile={plan:'free'}} await hydrateCloudState();}
    $('#auth-screen').hidden=true;$('#app-shell').hidden=false;updateAccountMini();renderAll();if(reviewRequirement().overdue)setTimeout(showReviewLock,100);
  }
  function updateAccountMini(){ const el=$('#account-mini');if(!el)return; el.innerHTML=`<div class="account-email">${escapeHtml(currentUser?.email||'Mode démo local')}</div><div class="account-plan">${escapeHtml(accountProfile?.plan||'DEMO')}</div><div id="sync-badge" class="sync-badge"></div>`;updateSyncBadge(); }
  async function boot(){
    if(supabaseConfigured){ const client=await loadSupabaseClient(); if(client){ const {data}=await client.auth.getSession(); if(data.session?.user) await startUser(data.session.user); else showAuth('login'); client.auth.onAuthStateChange(async(event,session)=>{ if(event==='PASSWORD_RECOVERY'){showPasswordRecovery();return;} if(event==='SIGNED_IN'&&session?.user&&session.user.id!==currentUser?.id) await startUser(session.user); if(event==='SIGNED_OUT'&&currentUser){currentUser=null;showAuth('login');} }); } else showAuth('login','Le service cloud n’a pas pu charger. Le mode démo reste disponible.','error'); }
    else showAuth('login'); await finishLaunch();
  }
  boot().catch(async e=>{console.error(e);showAuth('login','Une erreur est survenue au démarrage. Le mode démo reste disponible.','error');await finishLaunch();});
})();