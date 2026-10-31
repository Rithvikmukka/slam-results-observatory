'use strict';
const $=id=>document.getElementById(id);
const C={dvm:'#79aaff',covins:'#efb44f',custom:'#71dcad',reference:'#dce5f1',muted:'#91a7bf',red:'#ff8493',purple:'#bd9aff'};
const palette=[C.dvm,C.covins,C.custom,C.purple,C.red,'#74d7e5'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,n=2)=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(n);
let state=null,currentRecording=null,currentTrial=null,latestAudit=null,busy=false;

let sharedSnapshot=null,sharedFetched=0,lastRenderedPublication=null;
const FEED_URL='https://raw.githubusercontent.com/Rithvikmukka/slam-results-observatory/live-data/live.json';
async function loadSharedSnapshot(force=false){
  if(!force&&sharedSnapshot&&Date.now()-sharedFetched<55000)return sharedSnapshot;
  const response=await fetch(FEED_URL+'?minute='+Math.floor(Date.now()/60000),{cache:'no-store'});
  if(!response.ok)throw new Error('Shared results feed unavailable (HTTP '+response.status+')');
  const data=await response.json();if(data.schema!=='shared-slam-dashboard-v1')throw new Error('Unknown results format');
  sharedSnapshot=data;sharedFetched=Date.now();return data;
}
async function api(path,options){
  if(options?.method&&options.method!=='GET')throw new Error('Public view has no control or export endpoints');
  const shared=await loadSharedSnapshot(),url=new URL(path,'https://dashboard.invalid');
  if(url.pathname==='/api/status')return {...shared.status,heartbeat_age_s:Math.max(0,(Date.now()-Date.parse(shared.status.updated_utc))/1000)};
  if(url.pathname==='/api/trial')return shared.trials[url.searchParams.get('index')]||{available:false,reason:'No shared detail for this trial'};
  if(url.pathname==='/api/recording')return {available:false,reason:'Raw input footage, floor maps and sensor recordings remain private on the research laptop.'};
  if(url.pathname==='/api/export-status')return {audit:shared.audit,current_queue:false,phase:'not_generated'};
  throw new Error('Not part of the public results projection');
}
function downloadShared(format){
  if(!sharedSnapshot)return;
  let content,mime;
  if(format==='csv'){
    const fields=['index','id','algorithm','condition_id','repetition','phase','eligible','fraction','first_eligible_s','memory_peak_mib','native_track_p95_ms','custom_latency_p95_ms','clean_shutdown'];
    const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    content=[fields.map(cell).join(','),...sharedSnapshot.status.trials.map(t=>fields.map(k=>cell(t[k])).join(','))].join('\r\n');mime='text/csv';
  }else{content=JSON.stringify(sharedSnapshot,null,2);mime='application/json';}
  const url=URL.createObjectURL(new Blob([content],{type:mime}));const link=document.createElement('a');
  link.href=url;link.download='shared-slam-results.'+format;link.click();URL.revokeObjectURL(url);
}

function empty(id,message='No qualified data available yet.'){ $(id).innerHTML='<div class="empty">'+esc(message)+'</div>'; }
function stats(id,items){$(id).innerHTML=items.map(([v,label])=>'<div class="stat"><b>'+esc(v)+'</b><span>'+esc(label)+'</span></div>').join('');}
function chosenCases(){return state.trials.filter(t=>$('filterCase').value==='all'||t.condition_id===$('filterCase').value);}
function nice(v){if(Math.abs(v)>=1000)return num(v/1000,1)+'k';if(v===0)return '0';return Math.abs(v)<.01?v.toExponential(1):num(v,Math.abs(v)<1?3:Math.abs(v)<10?2:0);}

function chart(id,lines,options={}){
  const usable=lines.filter(l=>l.data?.some(p=>p[1]!=null&&Number.isFinite(p[1])));
  if(!usable.length){empty(id,options.empty);return;}
  const W=650,H=310,m={l:65,r:22,t:20,b:50},iw=W-m.l-m.r,ih=H-m.t-m.b;
  const points=usable.flatMap(l=>l.data.filter(p=>p[1]!=null&&Number.isFinite(p[1])));
  let xmin=options.xmin??Math.min(...points.map(p=>p[0])),xmax=options.xmax??Math.max(...points.map(p=>p[0]));
  let ymin=options.zero?Math.min(0,...points.map(p=>p[1])):Math.min(...points.map(p=>p[1])),ymax=options.ymax??Math.max(...points.map(p=>p[1]));
  if(xmax===xmin){xmin-=.5;xmax+=.5;}if(ymax===ymin){ymin-=.5;ymax+=.5;}
  const yp=(ymax-ymin)*.07;ymin-=options.zero&&ymin===0?0:yp;ymax+=yp;
  if(options.equal){const xr=xmax-xmin,yr=ymax-ymin;if(xr/yr>iw/ih){const extra=xr*ih/iw-yr;ymin-=extra/2;ymax+=extra/2;}else{const extra=yr*iw/ih-xr;xmin-=extra/2;xmax+=extra/2;}}
  const x=v=>m.l+(v-xmin)/(xmax-xmin)*iw,y=v=>m.t+ih-(v-ymin)/(ymax-ymin)*ih;
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(options.label||id)+'"><title>'+esc(options.label||id)+'</title>';
  for(let i=0;i<=4;i++){const tx=xmin+(xmax-xmin)*i/4,ty=ymin+(ymax-ymin)*i/4;svg+='<path class="gridline" d="M'+x(tx)+' '+m.t+'V'+(m.t+ih)+'M'+m.l+' '+y(ty)+'H'+(W-m.r)+'"/><text x="'+x(tx)+'" y="'+(H-27)+'" text-anchor="middle">'+esc(nice(tx))+'</text><text x="'+(m.l-9)+'" y="'+(y(ty)+3)+'" text-anchor="end">'+esc(nice(ty))+'</text>';}
  svg+='<text x="'+(m.l+iw/2)+'" y="'+(H-6)+'" text-anchor="middle">'+esc(options.xlabel||'Input time (s)')+'</text><text transform="translate(15 '+(m.t+ih/2)+') rotate(-90)" text-anchor="middle">'+esc(options.ylabel||'')+'</text>';
  usable.forEach((line,i)=>{
    const color=line.color||palette[i%palette.length];let d='',previous=null;
    for(const p of line.data){if(p[1]==null||!Number.isFinite(p[1])){previous=null;continue;}const start=!previous||(line.gap&&p[0]-previous[0]>line.gap);
      d+=(start?'M':line.step?'H':'L')+x(p[0])+(start||!line.step?' '+y(p[1]):'V'+y(p[1]));previous=p;}
    if(line.scatter){for(const p of line.data){if(p[1]==null)continue;svg+='<circle cx="'+x(p[0])+'" cy="'+y(p[1])+'" r="4.2" fill="'+color+'" stroke="#0c1118"><title>'+esc(p[2]||line.name)+': '+esc(num(p[1],4))+'</title></circle>';}}
    else svg+='<path d="'+d+'" stroke="'+color+'" stroke-width="'+(line.width||1.8)+'" fill="none"'+(line.dash?' stroke-dasharray="6 4"':'')+'><title>'+esc(line.name)+'</title></path>';
  });
  svg+='</svg><div class="legend">'+usable.map((l,i)=>'<span class="legend-item">'+esc(l.name)+'</span>').join('')+'</div>';
  $(id).innerHTML=svg;
  $(id).querySelectorAll('.legend-item').forEach((e,i)=>e.style.setProperty('--c',usable[i].color||palette[i%palette.length]));
}

function stateChart(data){
  if(!data.length){empty('stateChart');return;}
  const W=650,H=310,left=65,right=22,top=20,iw=W-left-right,ih=240,last=Math.max(...data.map(r=>r[1]));
  const x=t=>left+t/Math.max(last,1)*iw,y=s=>top+ih-(s+1)/6*ih;
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Native state timeline"><title>Native state; gaps are unobserved</title>';
  for(let s=-1;s<=5;s++)svg+='<path class="gridline" d="M'+left+' '+y(s)+'H628"/><text x="50" y="'+(y(s)+4)+'" text-anchor="end">'+s+'</text>';
  for(const [a,b,s] of data){const color=s===2?C.custom:s===1?C.covins:C.red;svg+='<rect x="'+x(a)+'" y="'+(y(s)-4)+'" width="'+Math.max(1,x(b)-x(a))+'" height="8" fill="'+color+'"><title>state '+s+' / '+num(a,3)+'–'+num(b,3)+' s</title></rect>';}
  for(let i=0;i<=4;i++){const t=last*i/4;svg+='<text x="'+x(t)+'" y="282" text-anchor="middle">'+nice(t)+'</text>';}
  svg+='<text x="350" y="305" text-anchor="middle">Input time (s); blank spans are unobserved</text></svg>';$('stateChart').innerHTML=svg;
}

function fillOptions(id,items){const select=$(id),value=select.value,signature=JSON.stringify(items);if(select.dataset.options===signature)return;select.dataset.options=signature;select.innerHTML=items.map(([v,label])=>'<option value="'+esc(v)+'">'+esc(label)+'</option>').join('');if(items.some(r=>String(r[0])===value))select.value=value;}

function renderStatus(s){
  state=s;const terminal=!['running','starting'].includes(s.phase),stale=!terminal&&s.heartbeat_age_s>30;
  $('liveBadge').textContent=terminal?s.phase:stale?'Queue heartbeat stale':'Queue heartbeat fresh';$('liveBadge').className='badge'+(s.phase==='stopped_failed'?' bad':stale?' warn':'');
  $('updated').textContent='Queue update '+new Date(s.updated_utc).toLocaleTimeString();$('phase').textContent=s.phase;
  stats('stats',[[s.counts.completed+' / '+s.trials.length,'Finalized trials (not tracking passes)'],[s.counts.running,'Trials in progress'],[s.counts.failed,'Failed trial slots'],[s.recordings_registered+' / '+s.cases.length,'Shared recordings registered'],[s.recording?num(s.recording.time/60,1)+' min':'—','Current capture simulator time'],[num(s.heartbeat_age_s,0)+' s','Queue heartbeat age']]);
  $('progressBar').style.width=(100*(s.counts.completed+s.counts.failed)/Math.max(s.trials.length,1))+'%';$('active').textContent=s.error||s.active_stage||'No active stage';
  if(s.recording)$('active').textContent+=' · '+s.recording.frames+' saved stereo pairs · '+num(s.recording.payload_bytes/1e9,3)+' GB current image payload';
  $('schedule').innerHTML=['dvm','covins','custom'].map(a=>'<div class="schedule-row"><strong class="'+a+'">'+a.toUpperCase()+'</strong>'+s.trials.filter(t=>t.algorithm===a).map(t=>'<button class="slot '+t.phase+'" data-trial="'+t.index+'" title="'+esc(t.id+' · '+t.phase)+'" aria-label="'+esc(t.id+' '+t.phase)+'"></button>').join('')+'</div>').join('');
  $('schedule').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{const choice=[...$('trialSelect').options].find(o=>o.value===b.dataset.trial);if(choice){$('trialSelect').value=b.dataset.trial;loadTrial();location.hash='trial';}}));
  fillOptions('caseSelect',[['active','Shared input context (private raw data)'],...s.cases.map(c=>[c.id,c.id+' / '+c.duration_seconds/60+' min'])]);
  fillOptions('filterCase',[['all','All conditions (exploratory; mixed durations)'],...s.cases.map(c=>[c.id,c.id+' / '+c.duration_seconds/60+' min'])]);
  if(!$('filterCase').dataset.initialized){$('filterCase').value=s.trials[0]?.condition_id||'all';$('filterCase').dataset.initialized='true';}
  const candidates=s.trials.filter(t=>t.phase==='completed'||t.phase==='running'||t.phase==='failed');
  fillOptions('trialSelect',[['','Select a shared formal trial'],...candidates.map(t=>[t.index,t.id+' / '+t.phase])]);
  renderComparisons();renderChecks();
}

function renderComparisons(){
  if(!state)return;const trials=chosenCases(),completed=trials.filter(t=>t.phase==='completed');
  const lines=(key,filter=()=>true)=>['dvm','covins','custom'].map((algorithm,i)=>({name:algorithm.toUpperCase(),color:C[algorithm],scatter:true,data:completed.filter(t=>t.algorithm===algorithm&&filter(t)&&t[key]!=null).map((t,j)=>[i+1+((j%3)-1)*.1,t[key],t.id])}));
  const common={xlabel:'Entry (1 DVM · 2 COVINS · 3 Custom)',zero:true,xmin:.5,xmax:3.5};
  chart('availabilityChart',lines('fraction'),{...common,ylabel:'Eligible camera sample fraction',ymax:1});
  chart('initChart',lines('first_eligible_s'),{...common,ylabel:'First eligible output (s)'});
  chart('memoryChart',lines('memory_peak_mib'),{...common,ylabel:'Container peak memory (MiB)'});
  const accuracy=['dvm','covins','custom'].map((a,i)=>({name:a.toUpperCase()+(a==='dvm'?' · fitted scale':' · metric'),color:C[a],scatter:true,data:completed.filter(t=>t.algorithm===a).flatMap(t=>(t.epoch_errors||[]).map((v,e)=>[i+1+(e%5-2)*.035,v,t.id+' epoch'+e+' n='+t.epoch_support[e]]))}));
  chart('accuracyChart',accuracy,{...common,ylabel:'Epoch XY APE RMSE (m)'});
  chart('referenceTimeChart',lines('native_track_p95_ms',t=>t.algorithm!=='custom'),{...common,ylabel:'Native Track p95 (ms)'});
  chart('customTimeChart',lines('custom_latency_p95_ms',t=>t.algorithm==='custom'),{...common,ylabel:'Target → fused prediction p95 (ms)'});
  const range=(values,n=3)=>{const finite=values.filter(v=>v!=null&&Number.isFinite(v));return finite.length?num(Math.min(...finite),n)+'–'+num(Math.max(...finite),n):'unavailable';};
  let html='';
  for(const c of state.cases){if($('filterCase').value!=='all'&&$('filterCase').value!==c.id)continue;for(const a of ['dvm','covins','custom']){const selected=trials.filter(t=>t.condition_id===c.id&&t.algorithm===a),done=selected.filter(t=>t.phase==='completed'),failed=selected.filter(t=>t.phase==='failed').length;
    html+='<tr><td>'+esc(c.id)+'<small class="'+a+'">'+a.toUpperCase()+(a==='custom'?' · fused, visual unknown':a==='dvm'?' · monocular shape':' · metric stereo')+'</small></td><td>'+done.length+' / '+selected.length+(failed?'<small>'+failed+' failed</small>':'')+'</td><td>'+range(done.map(t=>t.fraction))+'</td><td>'+done.filter(t=>t.eligible===0).length+'</td><td>'+range(done.flatMap(t=>t.epoch_errors||[]),4)+'</td><td>'+range(done.map(t=>t.memory_peak_mib),1)+'</td><td>'+done.filter(t=>t.clean_shutdown===true).length+' / '+done.length+'</td></tr>';}}
  $('comparisonTable').querySelector('tbody').innerHTML=html;
}

async function loadRecording(){
  const caseId=$('caseSelect').value||'active';const data=await api('/api/recording?case='+encodeURIComponent(caseId));currentRecording=data;
  if(!data.available){$('recordStatus').textContent=data.reason;$('motionStats').innerHTML='';for(const id of ['pathChart','coverageChart','speedChart','turnChart'])empty(id,data.reason);for(const type of ['map','camera']){$(type+'Image').hidden=true;$(type+'Placeholder').hidden=false;}return;}
  const m=data.motion,c=data.coverage;$('recordStatus').textContent=(data.complete?'Complete input':'Live capture (provisional appended records)')+' · '+num(data.last_input_s,1)+' s · '+data.samples+' control samples · '+data.camera_timestamp_note;
  stats('motionStats',[[num(m.distance_m,2)+' m','Reference travelled distance'],[num(c.unique_area_m2,3)+' m²','Unique body-footprint visitation'],[num(c.reference_floor_percent,4)+'%','Of reference free floor · not map coverage'],[num(m.stationary_fraction*100,1)+'%','Ticks nearly stationary (<0.005m/s)'],[num(m.turning_fraction*100,1)+'%','Ticks turning (|yaw rate|>0.05rad/s)']]);
  chart('pathChart',[{name:'Common reference path',color:C.reference,data:m.reference_path.map(p=>[p[1],p[2]])}],{equal:true,xlabel:'Relative x (m)',ylabel:'Relative y (m)'});
  chart('coverageChart',[{name:'Unique reference footprint area',color:C.custom,data:c.curve}],{ylabel:'Visited reference floor (m²)',zero:true});
  chart('speedChart',[{name:'Reference |velocity|',color:C.reference,data:m.reference_speed},{name:'Wheel forward velocity',color:C.dvm,data:m.wheel_speed},{name:'Commanded linear velocity',color:C.covins,data:m.commanded_speed}],{ylabel:'Speed (m/s)'});
  chart('turnChart',[{name:'Reference yaw rate',color:C.reference,data:m.reference_yaw_rate},{name:'Gyro z',color:C.custom,data:m.gyro_z},{name:'Commanded yaw rate',color:C.covins,data:m.commanded_yaw_rate}],{ylabel:'Yaw rate (rad/s)'});
  for(const [type,url] of [['map',data.map_image],['camera',data.preview]]){const image=$(type+'Image');image.onload=()=>{image.hidden=false;$(type+'Placeholder').hidden=true;};image.onerror=()=>{image.hidden=true;$(type+'Placeholder').hidden=false;};image.src=url+'&t='+Math.floor(Date.now()/60000);}
}

function trialChartsEmpty(message){for(const id of ['trajectoryChart','stateChart','errorChart','headingChart','rpeChart','errorCdfChart','rssChart','cpuChart','durationChart','durationCdfChart','latencyChart','counterChart'])empty(id,message);}
function plainSummary(data){
  const parts=[],a=data.slot.algorithm,accuracy=data.accuracy;
  if(data.slot.development_only)parts.push('This is an earlier development preview, excluded from the formal comparison.');
  if(data.live)parts.push('This native replay is still running. Displayed logs are provisional; final validity and accuracy checks have not finished.');
  if(accuracy){const n=accuracy.eligible_output_samples,total=accuracy.declared_camera_inputs;
    parts.push(a.toUpperCase()+' has '+n+' eligible pose samples out of '+total+' camera input samples ('+num(accuracy.eligible_output_fraction*100,1)+'%).');
    if(n===0)parts.push('There is no qualified trajectory error score. A blank error plot means unavailable, not zero error or perfect performance.');
    else{const epochs=accuracy.coordinate_epochs.filter(e=>e.planar_ape_m);const values=epochs.map(e=>e.planar_ape_m.rmse);
      if(values.length)parts.push('On its eligible local-map epochs, horizontal position RMSE ranges from '+num(Math.min(...values)*100,2)+' to '+num(Math.max(...values)*100,2)+' cm. This describes those samples, not continuous correctness over the full input.');}
  }
  if(a==='custom')parts.push('These are wheel/gyro-assisted fused predictions with a declared starting prior. The current interface does not tell us whether visual tracking is healthy.');
  if(a==='dvm')parts.push('DVM error plots fit monocular scale from reference data, so they describe aligned trajectory shape rather than native metric localization.');
  const execution=data.review?.execution;if(execution?.clean_frontend_shutdown===false)parts.push('The frontend did not exit cleanly at the requested shutdown; tracking results and shutdown reliability remain separate.');
  const map=data.native_map;if(map?.available){const c=map.confusion_known_reference_cells;
    parts.push('The native map confidently classifies '+num(map.native_confident_area_m2,2)+' m²; confident cells overlap '+num(map.confident_reference_floor_fraction*100,3)+'% of the reference free floor.');
    parts.push('Among confident obstacle predictions, '+c.tp+' cells agree with reference and '+c.fp+' disagree. Unknown cells are excluded from these conditional scores; this is not a three-algorithm map comparison.');
  }else parts.push('A comparable verified native occupancy map is unavailable for this trial. Accurate poses alone cannot establish map completeness.');
  return parts.join(' ');
}
function renderObservations(data){
  const o=data?.observations;
  if(!o){$('inputAccounting').textContent='Choose a trial with retained native evidence.';$('stateAccounting').textContent='State support is unavailable.';return;}
  const a=o.accounting,s=o.states,value=v=>v==null?'unavailable':String(v);
  $('inputAccounting').textContent='Expected camera samples: '+value(a.expected_camera_samples)+'; delivered: '+value(a.delivered_camera_samples)+'; processed camera samples: '+value(a.processed_camera_samples)+'; eligible '+(data.slot.algorithm==='custom'?'fused camera-grid outputs (different basis)':'camera-grid outputs')+': '+value(a.eligible_camera_samples)+'. Processing boundary verified: '+value(a.processing_boundary_verified)+'.'+
    (data.slot.algorithm==='custom'?' Calibration-history image omissions: '+value(a.calibration_history_omissions)+'; delayed images pending: '+value(a.delayed_camera_samples_pending)+'. Fused sensor-tick predictions are separate from camera processing.':' Native returns observed: '+value(a.observed_native_returns)+'.')+
    ' Delivery lateness max / p95: '+(a.delivery_max_lateness_s==null?'unavailable':num(a.delivery_max_lateness_s*1000,2))+' / '+(a.delivery_p95_lateness_s==null?'unavailable':num(a.delivery_p95_lateness_s*1000,2))+' ms. '+a.scope;
  $('stateAccounting').textContent=(data.live?'PROVISIONAL / ':'')+'Sample counts: '+JSON.stringify(s.sample_counts)+'. Approximate seconds by state: '+JSON.stringify(Object.fromEntries(Object.entries(s.approximate_seconds).map(([k,v])=>[k,Number(v.toFixed(3))])))+'. Unobserved/boundary seconds: '+num(s.unobserved_seconds,3)+'. Longest gap without observed eligible output: '+num(s.longest_no_observed_eligible_output_gap_s,3)+' s. Map identity transitions: '+value(s.map_identity_transitions)+'. '+s.scope+' Visual health: '+s.visual_tracking_health+'.';
}
async function loadTrial(){
  const index=$('trialSelect').value;
  if(index===''){trialChartsEmpty('Choose a formal trial when available, or a labelled development preview.');currentTrial=null;renderObservations(null);$('plainSummary').textContent='Select a trial to see a plain-language interpretation. Formal results stay pending until execution and evaluation are complete.';return;}
  const data=await api('/api/trial?index='+encodeURIComponent(index));currentTrial=data;
  renderObservations(data);
  if(!data.available){$('trialInfo').textContent=data.reason;trialChartsEmpty(data.reason);return;}
  const a=data.slot.algorithm,epochs=(data.epochs||[]).filter(e=>e.available),r=data.resources;
  $('plainSummary').textContent=plainSummary(data);
  $('trialInfo').textContent=data.slot.id+' · '+(data.slot.development_only?'DEVELOPMENT DATA · EXCLUDED FROM FORMAL COMPARISON':data.live?'LIVE / provisional logs':data.slot.phase==='completed'?'completed formal execution':'incomplete / retained evidence')+' · '+data.validity;
  stats('trialStats',[[data.native_rows,'Recorded native rows'],[data.accuracy?num(data.accuracy.eligible_output_fraction*100,2)+'%':'pending','Eligible camera-grid samples'],[num(r.sampled_native_peak_rss_mib,1)+' MiB','Sampled native peak RSS'],[num(r.sampled_native_cpu_seconds,1)+' s','Sampled native cumulative CPU'],[epochs.length,'Scored coordinate epochs'],[epochs.length?epochs.every(e=>e.independent_ape_matches)?'Agrees':'CHECK':'pending','Independent scalar APE arithmetic']]);
  chart('trajectoryChart',epochs.flatMap((e,i)=>[{name:'Reference epoch'+e.epoch,color:palette[i%palette.length],data:e.reference.map(p=>[p[1],p[2]])},{name:'Estimate epoch'+e.epoch+' n='+e.rows,color:palette[i%palette.length],dash:true,data:e.estimate.map(p=>[p[1],p[2]])}]),{equal:true,xlabel:'Relative x (m)',ylabel:'Relative y (m)',empty:data.live?'Aligned trajectories appear after completed input/execution gates.':'No eligible trajectory with supported scale/alignment.'});
  stateChart(data.state_intervals||[]);
  const epochLines=key=>epochs.map((e,i)=>({name:'Epoch'+e.epoch+' / map'+e.map_id+' / n='+e.rows,color:palette[i%palette.length],data:e[key]}));
  chart('errorChart',epochLines('ape_m'),{ylabel:'Epoch-local XY error (m)',zero:true});chart('headingChart',epochLines('heading_deg'),{ylabel:'Heading residual (degrees)',zero:true});
  chart('rpeChart',epochLines('planar_oracle_rpe_m'),{ylabel:'Independent planar RPE (m)',zero:true});
  chart('errorCdfChart',epochs.map((e,i)=>({name:'Epoch'+e.epoch+' / n='+e.rows,color:palette[i%palette.length],data:e.ape_distribution.cdf})),{xlabel:'Epoch XY error (m)',ylabel:'Empirical probability',zero:true,ymax:1});
  chart('rssChart',[{name:'Native RSS',color:C[a],data:r.native_rss_mib},{name:'Container current (if recorded)',color:C.muted,data:r.container_current_mib}],{xlabel:'Supervisor elapsed time (s)',ylabel:'Memory (MiB)',zero:true});
  chart('cpuChart',[{name:'Native utilization',color:C[a],data:r.native_cpu_percent}],{xlabel:'Supervisor elapsed time (s)',ylabel:'CPU percent · 100% = one core',zero:true});
  chart('durationChart',[{name:data.duration_boundary,color:C[a],data:data.duration_ms}],{ylabel:'Processing duration (ms)',zero:true});$('durationCaption').textContent=data.duration_boundary+' · median'+num(data.duration_distribution.median,2)+' ms / p95'+num(data.duration_distribution.p95,2)+' ms / max'+num(data.duration_distribution.maximum,2)+' ms.';
  chart('durationCdfChart',[{name:'All native duration samples (n='+data.duration_distribution.n+')',color:C[a],data:data.duration_distribution.cdf}],{xlabel:'Processing duration (ms)',ylabel:'Empirical probability',zero:true,ymax:1});
  chart('latencyChart',[{name:'Target → fused output',color:C.custom,data:data.latency_ms},{name:'Delivered → processing start',color:C.covins,data:data.backlog_ms}],{ylabel:'Latency (ms)',zero:true,empty:'Matching end-to-end clocks are unavailable for this entry.'});
  chart('counterChart',a==='custom'?[{name:'Keyframes',data:data.keyframes,color:C.dvm},{name:'Accepted visual updates',data:data.visual_updates,color:C.custom},{name:'Native loops',data:data.loops,color:C.covins}]:[{name:'Native reference map ID',data:data.map_ids,color:C[a],step:true}],{ylabel:'Native counter / identity',zero:true});
  $('receipt').textContent=JSON.stringify({slot:data.slot,integrity:data.integrity,primary_review:data.review,primary_accuracy:data.accuracy,epoch_checks:epochs.map(e=>({epoch:e.epoch,rows:e.rows,scale:e.scale,scalar_ape_agrees:e.independent_ape_matches,rpe_note:e.rpe_note}))},null,2);renderChecks();
  $('nativeLogs').textContent=Object.entries(data.log_tails||{}).filter(([name,text])=>text).map(([name,text])=>'--- '+name+' ---\n'+text).join('\n\n')||'No native log output yet.';
  const map=data.native_map;$('nativeMapImage').hidden=true;$('nativeMapPlaceholder').hidden=false;$('nativeMapPlaceholder').textContent=map?.reason||'Waiting for a retained native map';
  $('mapEvidence').textContent=map?.interpretation||map?.reason||'No map evidence';$('mapStats').innerHTML='';
  if(map?.available){stats('mapStats',[[num(map.native_confident_area_m2,2)+' m²','Native confident grid area'],[num(100*map.confident_reference_floor_fraction,3)+'%','Reference floor with confident native cells'],[map.occupied_precision==null?'—':num(100*map.occupied_precision,1)+'%','Occupied precision · known cells only'],[map.occupied_iou_within_known_cells==null?'—':num(100*map.occupied_iou_within_known_cells,1)+'%','Occupied IoU · known cells only']]);const image=$('nativeMapImage');image.onload=()=>{image.hidden=false;$('nativeMapPlaceholder').hidden=true;};image.src='/api/native-map?index='+index;}
}

function renderChecks(){
  if(!state)return;const t=currentTrial,audit=latestAudit?.queue===state.queue?latestAudit:null,checks=[
    ['Frozen plan hash',state.plan_hash_verified?'Verified':'Mismatch',state.plan_hash_verified?'good':'bad'],
    ['Pinned helper hashes',state.all_pinned_tools_unchanged?'Unchanged':'Mismatch / review required',state.all_pinned_tools_unchanged?'good':'bad'],
    ['Final independent study audit',audit?.phase==='failed'?'Audit failed: '+audit.error:audit?.final_evidence_audit_pass===true?'Complete study evidence checks passed; mapping scope limits remain':audit?.final_evidence_audit_pass===false?'Evidence mismatch: investigate':'Pending current study and matching post-run audit',audit?.final_evidence_audit_pass===true?'good':audit?.phase==='failed'||audit?.final_evidence_audit_pass===false?'bad':''],
    ['Original source receipts',t?.integrity?.source_receipts_equal===true?'Selected trial before/after agree':'Pending selected completed trial',t?.integrity?.source_receipts_equal===true?'good':''],
    ['Evaluation evidence receipts',t?.integrity?.evaluation_before_after_equal===true?'Selected trial before/after agree':'Pending or unavailable',t?.integrity?.evaluation_before_after_equal===true?'good':''],
    ['Independent metric arithmetic',t?.epochs?.some(e=>e.available)?t.epochs.filter(e=>e.available).every(e=>e.independent_primary_metric_pass)?'Primary APE/RPE/support checks agree':'Mismatch or unavailable: investigate':'Pending usable pose support',t?.epochs?.some(e=>e.available)&&t.epochs.filter(e=>e.available).every(e=>e.independent_primary_metric_pass)?'good':''],
    ['Comparison scope','Declared unequal-sensor deployments; one simulated building',''],
    ['Coverage scope','Reference footprint visitation only; mapping/cleaning unmeasured',''],
    ['Statistical confidence','No confidence percentage / frame-based significance; repeats are not independent scenes','']];
  $('confidenceChecks').innerHTML=checks.map(([title,value,cls])=>'<div class="check '+cls+'"><strong>'+esc(title)+'</strong><span>'+esc(value)+'</span></div>').join('');
}


async function refresh(){if(busy)return;busy=true;$('refresh').disabled=true;try{
  $('error').hidden=true;await loadSharedSnapshot(true);
  if(lastRenderedPublication!==sharedSnapshot.generated_utc){renderStatus(await api('/api/status'));await loadRecording();await loadTrial();latestAudit=sharedSnapshot.audit;renderChecks();lastRenderedPublication=sharedSnapshot.generated_utc;}
  renderReaderSummary(sharedSnapshot);
  const age=Math.max(0,(Date.now()-Date.parse(sharedSnapshot.generated_utc))/1000),terminal=!['running','starting'].includes(state.phase),sourceStale=(Date.now()-Date.parse(state.updated_utc))/1000>900;
  $('liveBadge').textContent=terminal?state.phase:age>900?'Shared snapshot stale':sourceStale?'Source queue heartbeat stale':'Shared snapshot / updates about every 5 min';
  $('liveBadge').className='badge'+(!terminal&&(age>900||sourceStale)?' warn':'');
  $('updated').textContent='Published '+new Date(sharedSnapshot.generated_utc).toLocaleString()+' | queue update '+new Date(state.updated_utc).toLocaleString();
  $('exportStatus').textContent='Read-only shared snapshot. Last publication '+new Date(sharedSnapshot.generated_utc).toLocaleString()+'. Backend stays on the owner\'s laptop. Download contains only the public projection.';
  $('bundleDownload').hidden=true;
}catch(error){$('error').textContent=error.message+'. Last displayed results may be stale; this public page cannot start or change experiments.';$('error').hidden=false;}finally{busy=false;$('refresh').disabled=false;}}
$('refresh').addEventListener('click',refresh);$('filterCase').addEventListener('change',renderComparisons);
$('caseSelect').addEventListener('change',()=>loadRecording().catch(showError));$('trialSelect').addEventListener('change',()=>loadTrial().catch(showError));
function showError(error){$('error').textContent=error.message;$('error').hidden=false;}
$('export').addEventListener('click',()=>downloadShared('json'));
$('publicCsv').addEventListener('click',()=>downloadShared('csv'));

function renderReaderSummary(shared){
  const s=shared.status,c=s.counts,total=s.trials.length,active=s.trials.find(t=>t.phase==='running');
  const age=Math.max(0,(Date.now()-Date.parse(shared.generated_utc))/60000);
  if(s.phase==='stopped_failed'){
    $('readerNow').textContent='The study stopped for review.';
    $('readerNext').textContent=c.completed+' of '+total+' trials finalized; '+c.pending+' remain pending. A stopped or pending trial does not count as a successful result.';
  }else if(s.phase==='completed_with_scope_limitations'){
    $('readerNow').textContent='The scheduled trial sequence has finished.';
    $('readerNext').textContent=shared.audit?.final_evidence_audit_pass===true?'The matching independent evidence audit passed. The sensor, scale and mapping limitations still apply.':'The independent audit is pending or needs review. Completed trials and an audited final comparison are separate milestones.';
  }else if(active){
    const condition=s.cases.find(item=>item.id===active.condition_id);
    $('readerNow').textContent=active.algorithm.toUpperCase()+' trial underway / '+(condition?condition.duration_seconds/60+'-minute input':'registered input')+' / repeat '+active.repetition;
    $('readerNext').textContent=c.completed+' of '+total+' trials finalized. This trial may be checking input, starting, replaying or evaluating. Its accuracy enters the comparison only after the required gates finish. Published '+num(age,0)+' minutes ago.';
  }else{
    $('readerNow').textContent='Preparing or checking the next shared input.';
    $('readerNext').textContent=c.completed+' of '+total+' trials finalized. Data preparation is part of the study; it is not an algorithm result. Published '+num(age,0)+' minutes ago.';
  }
  const notes={dvm:'One camera. Its fitted-scale error describes trajectory shape, not native knowledge of metres.',covins:'Stereo cameras and backend. Local tracking output does not certify a globally correct map.',custom:'Stereo plus wheel/gyro and a start prior. Fused predictions do not establish healthy visual tracking.'};
  $('entrySummary').innerHTML=['dvm','covins','custom'].map(a=>{
    const all=s.trials.filter(t=>t.algorithm===a),done=all.filter(t=>t.phase==='completed'),running=all.filter(t=>t.phase==='running').length;
    const usable=done.filter(t=>t.eligible!=null&&t.eligible>0).length;
    return '<article><span class="eyebrow '+a+'">'+a.toUpperCase()+'</span><h3>'+done.length+' / '+all.length+' finalized</h3><p>'+running+' trial'+(running===1?'':'s')+' in progress. '+(done.length?usable+' finalized trial'+(usable===1?'':'s')+' with some eligible '+(a==='custom'?'fused output':'tracking output')+'.':'Waiting for finalized outcomes.')+'</p><p class="caption">'+notes[a]+'</p></article>';
  }).join('');
}

refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);