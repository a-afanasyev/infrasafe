/* A browser-local teaching model. No devices, endpoints or live data are connected.
   The demo only shows what monitoring observes; it never models commands to equipment. */
(function (root) {
  'use strict';
  const stages = ['normal', 'active', 'acknowledged', 'assigned', 'workdone', 'accepted'];
  const stageLabels = {normal:'Норма',active:'Новый сигнал',acknowledged:'Сигнал подтверждён',assigned:'В работе',workdone:'Ожидает приёмки',accepted:'Принято'};
  const PHASE_NORMAL = 231;
  const PHASE_SAG = 176;
  function createState() {
    return {scene:'courtyard',selected:'fountain',paused:false,step:0,product:'residents',sound:false,volume:35,tick:0,
      fountain:{fault:false,level:1},
      power:{sag:false},
      leak:{stage:'normal',history:[]}};
  }
  const wet = s => ['active','acknowledged','assigned'].includes(s.leak.stage);
  const running = s => !s.paused;
  function record(s, text) { s.leak.history.push({number:s.leak.history.length+1,text}); }
  function dispatch(s, action, value, reduced=false) {
    if(action==='reset') {Object.assign(s,createState());return true;}
    if(action==='pause') {s.paused=!s.paused;return true;}
    if(!running(s)) return false;
    const l=s.leak;
    switch(action) {
      case 'pump-fault': s.fountain.fault=!s.fountain.fault;if(reduced)s.fountain.level=s.fountain.fault?0:1;return true;
      case 'power-sag': s.power.sag=!s.power.sag;return true;
      case 'leak-start':
        if(!['normal','accepted'].includes(l.stage))return false;
        l.stage='active';l.history=[];record(s,'Датчик обнаружил воду. Создано учебное событие #DEMO-001.');return true;
      case 'acknowledge':
        if(l.stage!=='active')return false;l.stage='acknowledged';record(s,'Диспетчер подтвердил сигнал. Открыта одна учебная заявка.');return true;
      case 'assign':
        if(l.stage!=='acknowledged')return false;l.stage='assigned';record(s,'Назначен дежурный инженер. Начата проверка места протечки.');return true;
      case 'complete':
        if(l.stage!=='assigned')return false;l.stage='workdone';record(s,'Инженер устранил протечку и осушил помещение. Датчик: сухо.');return true;
      case 'accept':
        if(l.stage!=='workdone')return false;l.stage='accepted';record(s,'Результат проверен и принят. Заявка закрыта, история сохранена.');return true;
      default:return false;
    }
  }
  function advance(s, dt, reduced=false, hidden=false) {
    if(s.paused||hidden)return [];
    dt=Math.max(0,Math.min(dt,0.1));s.tick+=dt;
    const f=s.fountain, target=f.fault?0:1;
    f.level=reduced?target:f.level+Math.sign(target-f.level)*Math.min(Math.abs(target-f.level),dt/0.65);
    return [];
  }
  const pressure = s => s.fountain.level*2.4;
  const phaseL2 = s => s.power.sag?PHASE_SAG:PHASE_NORMAL;
  const api={createState,dispatch,advance,wet,stageLabels,stages,pressure,phaseL2};
  root.InfraSafeModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
