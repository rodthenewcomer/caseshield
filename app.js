(() => {
  const SESSION_KEY = 'caseshield_validation_session';
  const state = { step: 0, answers: {}, completed: false };
  const steps = [
    {
      id: 'event', title: 'What happened to your case?', sub: 'Choose the event that best describes the uncertainty you are dealing with.',
      choices: [
        ['Interview cancelled','Your scheduled appointment was cancelled','calendar-x'],['Interview rescheduled','You received a different date','calendar'],['No replacement date','Your interview changed and no new date arrived','clock'],['221(g)','Additional processing or documents requested','document'],['Administrative processing','Your case is under additional review','search'],['NVC delay','You are waiting for interview scheduling','hourglass'],['Medical / document expiry concern','A time-sensitive document may expire','alert'],['Something else','Another immigration case disruption','more']
      ]
    },
    {
      id:'visa', title:'What visa are you pursuing?', sub:'This helps separate patterns that can differ by visa category.',
      choices:[['CR1 / IR1 spouse','Spouse immigrant visa','heart'],['F2A','Spouse or child of a permanent resident','family'],['IR5 parent','Parent of a U.S. citizen','people'],['K1 fiancé(e)','Fiancé(e) visa','ring'],['Employment immigrant visa','Employment-based immigrant visa','briefcase'],['Diversity visa','Diversity Visa program','globe'],['Other','Another immigrant visa category','more']]
    },
    { id:'embassy', title:'Where is your interview being handled?', sub:'City or embassy name is enough. Do not enter a case number or personal identifier.', input:true },
    {
      id:'timing', title:'Where are you in the process?', sub:'Timing changes what should be watched first.',
      choices:[['Interview within 7 days','Very time-sensitive','bolt'],['Interview within 30 days','Upcoming interview','calendar'],['Interview already cancelled','Disruption already occurred','calendar-x'],['Waiting for new date','No replacement appointment yet','clock'],['No interview scheduled yet','Still waiting in the scheduling process','hourglass']]
    },
    {
      id:'need', title:'What matters most right now?', sub:'This tells us which outcome is valuable enough to build around.',
      choices:[['Knowing when interviews resume','Track embassy movement','pulse'],['Seeing whether applicants like me received new dates','Community rescheduling intelligence','people'],['Protecting medical / document validity','Watch time-sensitive expirations','shield'],['Understanding what policy changed','Clear official-source context','document'],['Knowing when I should seek professional help','Escalation signals, not legal advice','help']]
    }
  ];

  const icons = {
    'calendar-x':'✕','calendar':'▣','clock':'◷','document':'▤','search':'⌕','hourglass':'⌛','alert':'!','more':'···','heart':'♡','family':'◉','people':'◌','ring':'◇','briefcase':'▱','globe':'◎','bolt':'ϟ','pulse':'⌁','shield':'♢','help':'?'
  };

  const $ = id => document.getElementById(id);
  const assessmentShell = $('assessmentShell');
  const stage = $('assessmentStage');
  const snapshot = $('snapshot');
  const mobileCta = $('mobileCta');

  function getSessionId(){
    let sid = localStorage.getItem(SESSION_KEY);
    if(!sid){ sid = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`); localStorage.setItem(SESSION_KEY,sid); }
    return sid;
  }

  async function track(name, meta={}){
    const payload = { name, session_id:getSessionId(), ...meta };
    try{ await fetch('/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),keepalive:true}); }catch(_e){}
  }

  track('page_view');

  function scrollToCheck(){
    renderStep();
    $('check').scrollIntoView({behavior:'smooth',block:'start'});
    mobileCta?.classList.add('hidden');
  }

  document.querySelectorAll('[data-scroll-check]').forEach(el => el.addEventListener('click',()=>{ track('hero_cta_click',{source:'nav_or_mobile'}); scrollToCheck(); }));
  $('heroCta').addEventListener('click',()=>{ track('hero_cta_click',{source:'hero'}); scrollToCheck(); setTimeout(()=>startAssessment(),500); });

  function markStarted(){
    if(!state.started){ state.started=true; track('case_check_started'); }
  }

  function startAssessment(){
    if(state.completed) return;
    markStarted();
    renderStep();
  }

  function renderStep(){
    const step = steps[state.step];
    $('stepLabel').textContent = `Step ${state.step+1} of ${steps.length}`;
    $('progressFill').style.width = `${((state.step+1)/steps.length)*100}%`;
    const saved = state.answers[step.id] || '';
    let body='';
    if(step.input){
      body = `
        <div class="search-box"><input id="embassyInput" class="search-input" type="text" maxlength="80" autocomplete="off" placeholder="Search embassy or city" value="${escapeHtml(saved)}" aria-label="Embassy or city"><span class="search-icon">⌕</span></div>
        <div class="suggestions" aria-label="Popular embassy examples">${['Mumbai','Manila','London','Abidjan','Ciudad Juárez'].map(x=>`<button class="suggestion" type="button" data-suggestion="${x}">${x}</button>`).join('')}</div>`;
    } else {
      body = `<div class="choices">${step.choices.map(([label,desc,icon])=>`<button type="button" class="choice-card ${saved===label?'selected':''}" data-choice="${escapeAttr(label)}"><span class="choice-icon">${icons[icon]||'•'}</span><span class="choice-text"><strong>${label}</strong><small>${desc}</small></span></button>`).join('')}</div>`;
    }
    stage.innerHTML = `<div class="assessment-step"><h3>${step.title}</h3><p>${step.sub}</p>${body}<div class="assessment-nav"><button class="btn btn-subtle" id="backBtn" ${state.step===0?'disabled':''}>Back</button><button class="btn btn-primary" id="nextBtn">${state.step===steps.length-1?'Show my snapshot':'Continue'} <span aria-hidden="true">→</span></button></div></div>`;

    if(step.input){
      const inp=$('embassyInput');
      inp.addEventListener('input',e=>{markStarted();state.answers.embassy=e.target.value.trim();});
      document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{inp.value=b.dataset.suggestion;state.answers.embassy=b.dataset.suggestion;}));
    }else{
      document.querySelectorAll('[data-choice]').forEach(btn=>btn.addEventListener('click',()=>{markStarted();state.answers[step.id]=btn.dataset.choice;document.querySelectorAll('[data-choice]').forEach(x=>x.classList.toggle('selected',x===btn));}));
    }
    $('backBtn').addEventListener('click',()=>{if(state.step>0){state.step--;renderStep();}});
    $('nextBtn').addEventListener('click',()=>nextStep());
  }

  function nextStep(){
    const step=steps[state.step];
    const value=step.input ? ($('embassyInput')?.value.trim()||'') : state.answers[step.id];
    if(!value){
      const el=step.input?$('embassyInput'):stage.querySelector('.choices');
      el?.animate?.([{transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:260});
      if(step.input) $('embassyInput').focus();
      return;
    }
    state.answers[step.id]=value;
    track(`case_step_${state.step+1}`,{answer:safe(value),step_id:step.id});
    if(state.step<steps.length-1){state.step++;renderStep();return;}
    completeAssessment();
  }

  function completeAssessment(){
    state.completed=true;
    track('case_check_completed',sanitizeAnswers(state.answers));
    assessmentShell.hidden=true;
    const context=[state.answers.visa,state.answers.embassy,state.answers.event].filter(Boolean);
    $('snapshotContext').innerHTML=context.map(x=>`<span class="context-chip">${escapeHtml(x)}</span>`).join('');
    snapshot.hidden=false;
    snapshot.scrollIntoView({behavior:'smooth',block:'center'});
    mobileCta?.classList.add('hidden');
  }

  $('resetAssessment').addEventListener('click',()=>{state.step=0;state.answers={};state.completed=false;assessmentShell.hidden=false;snapshot.hidden=true;renderStep();});
  $('alertIntent').addEventListener('click',()=>{track('alert_intent',sanitizeAnswers(state.answers));$('alertSuccess').hidden=false;$('alertIntent').disabled=true;});

  const offerObserver = new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting&&!offerObserver.seen){offerObserver.seen=true;track('pricing_view');}})},{threshold:.55});
  offerObserver.observe($('offerCard'));

  $('purchaseIntent').addEventListener('click',()=>{track('purchase_intent_29',sanitizeAnswers(state.answers));$('purchaseModal').hidden=false;document.body.style.overflow='hidden';});
  function closeModal(){$('purchaseModal').hidden=true;document.body.style.overflow='';}
  $('modalClose').addEventListener('click',closeModal);$('modalDone').addEventListener('click',closeModal);$('purchaseModal').addEventListener('click',e=>{if(e.target===$('purchaseModal'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('purchaseModal').hidden)closeModal();});

  const revealObserver = new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');revealObserver.unobserve(e.target);}})},{threshold:.12});
  document.querySelectorAll('.reveal:not(.is-visible)').forEach(el=>revealObserver.observe(el));
  window.addEventListener('scroll',()=>{$('siteHeader').classList.toggle('scrolled',window.scrollY>24);if(window.scrollY>500)mobileCta?.classList.add('hidden');},{passive:true});
  renderStep();

  function sanitizeAnswers(a){return {event:safe(a.event),visa:safe(a.visa),embassy:safe(a.embassy),timing:safe(a.timing),need:safe(a.need)};}
  function safe(v){return String(v||'').replace(/[<>]/g,'').slice(0,90);}
  function escapeHtml(s){return String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
  function escapeAttr(s){return escapeHtml(s).replace(/'/g,'&#39;');}
})();
