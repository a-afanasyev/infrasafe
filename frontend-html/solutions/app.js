'use strict';
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const model = window.InfraSafeModel;
  const state = model.createState();
  const scenes = {
    courtyard: {
      image: 'courtyard-clean', alt: 'Плоская архитектурная иллюстрация: жилые дома, фонтан, насосная и электрощит под двором', subtitle: 'Фонтан · насос · электрощит',
      hotspots: [
        { id: 'fountain', x: 64.5, y: 47.5, label: 'Фонтан', kicker: 'В ФОКУСЕ · ФОНТАН', title: 'Состояние фонтана', description: 'Давление и сигнал работы насоса показывают, когда фонтану нужна проверка. Управление остаётся на объекте.', icon: 'water' },
        { id: 'pump', x: 61.3, y: 82.3, label: 'Насос', kicker: 'В ФОКУСЕ · НАСОС', title: 'Насосное оборудование', description: 'Давление и состояние насоса помогают специалисту оценить работу системы перед выездом.', icon: 'sensor' },
        { id: 'power', x: 9.7, y: 81, label: 'Электрощит', kicker: 'В ФОКУСЕ · ЭЛЕКТРОСНАБЖЕНИЕ', title: 'Напряжение по фазам', description: 'Норма 198–242 В. При выходе за 180–260 В авария уходит в заявку УК через 10 секунд.', icon: 'bolt' }
      ]
    },
    engineering: {
      image: 'engineering-clean', alt: 'Плоская архитектурная схема дома в разрезе: датчик протечки, стояки отопления и ГВС, ввод электроснабжения и контроллер', subtitle: 'Протечки · отопление и ГВС · электроснабжение · связь',
      hotspots: [
        { id: 'leak', x: 35.6, y: 89.3, label: 'Датчик протечки', kicker: 'В ФОКУСЕ · ДАТЧИК ПРОТЕЧКИ', title: 'Контроль протечек', description: 'Сигнал о воде в техническом помещении за секунды становится заявкой в панели УК.', icon: 'water' },
        { id: 'heating', x: 57.2, y: 45, label: 'Стояк ГВС и отопления', kicker: 'В ФОКУСЕ · ОТОПЛЕНИЕ И ГВС', title: 'Температура подачи и обратки', description: 'Температура и давление теплоносителя. Правила по отоплению действуют только в отопительный сезон.', icon: 'water' },
        { id: 'power', x: 73, y: 73.5, label: 'Ввод электроснабжения', kicker: 'В ФОКУСЕ · ЭЛЕКТРОСНАБЖЕНИЕ', title: 'Напряжение по фазам', description: 'Норма 198–242 В. При выходе за 180–260 В авария уходит в заявку УК через 10 секунд.', icon: 'bolt' },
        { id: 'controller', x: 40, y: 12.2, label: 'Канал связи', kicker: 'В ФОКУСЕ · КОНТРОЛЛЕР', title: 'Связь с оборудованием', description: 'Контроллер передаёт показания в мониторинг. Если данные перестают приходить, это видно на карте.', icon: 'sensor' }
      ]
    },
    overview: {
      image: 'overview', alt: 'Плоская иллюстрация продукта InfraSafe: жилой дом, обращение жителя, команда управляющей компании, инженерные системы и история объекта', subtitle: 'Обращения · исполнители · история работ',
      hotspots: [
        { id: 'resident', x: 28.2, y: 24, label: 'Житель', kicker: 'В ФОКУСЕ · ЖИТЕЛЬ', title: 'Статус для жителя', description: 'Житель обращается через Telegram и следит за статусом. Диспетчеру проще отвечать по существу заявки.', icon: 'house' },
        { id: 'team', x: 31.5, y: 71.8, label: 'Команда УК', kicker: 'В ФОКУСЕ · КОМАНДА УК', title: 'Контроль исполнения', description: 'У заявки есть исполнитель, срок и результат. Уточнение и закупка остаются частью рабочего процесса.', icon: 'check' },
        { id: 'equipment', x: 71.6, y: 24, label: 'Оборудование', kicker: 'В ФОКУСЕ · ОБОРУДОВАНИЕ', title: 'Проверка оборудования', description: 'Показания воды, электричества и параметров среды помогают определить, где требуется внимание инженера.', icon: 'sensor' },
        { id: 'history', x: 68.3, y: 71.8, label: 'История объекта', kicker: 'В ФОКУСЕ · ИСТОРИЯ ОБЪЕКТА', title: 'История обслуживания', description: 'Статусы, выполненные работы и приёмка помогают разобраться в повторном обращении по объекту.', icon: 'check' }
      ]
    }
  };
  const products = {
    residents: { image: 'management', alt: 'Иллюстрация управления домом и сервисов для жителей', tag: 'СЕРВИСНАЯ ПАНЕЛЬ УК', description: 'Обращения из Telegram поступают в работу УК. Житель видит статус, а диспетчер ведёт заявку до выполненной и принятой работы.', features: ['Обращения', 'Статусы', 'Фото результата', 'Приёмка'] },
    team: { image: 'operations', alt: 'Иллюстрация эксплуатации дома, команды и инженерных работ', tag: 'СЕРВИСНАЯ ПАНЕЛЬ УК', description: 'Распределяйте заявки между исполнителями и контролируйте сроки. Смены, ресурсы, склад и парковка помогают организовать ежедневную эксплуатацию.', features: ['Исполнители', 'Смены', 'Ресурсы', 'Склад и парковка'] },
    engineering: { image: 'resources', alt: 'Иллюстрация учёта ресурсов и инженерного оборудования в разрезе жилого дома', tag: 'ИНЖЕНЕРНЫЙ МОНИТОРИНГ', description: 'Следите за показаниями воды, электричества и параметров среды. Датчики и события помогают определить, какое оборудование требует проверки.', features: ['Датчики', 'Канал связи', 'Показания', 'События и тревоги'] }
  };
  const journey = [
    { kicker: '01 / ОБОРУДОВАНИЕ', title: 'Обнаружить проблему', description: 'Мониторинг фиксирует воду в техническом помещении. Диспетчер видит, на каком объекте нужна проверка.', event: 'Обнаружена вода', status: 'Нужна проверка', label: 'Источник', value: 'Датчик протечки', bottom: 'Требуется проверка диспетчера', icon: 'water' },
    { kicker: '02 / ДИСПЕТЧЕР', title: 'Назначить ответственного', description: 'Диспетчер проверяет сигнал и оформляет заявку. У работы появляются исполнитель и срок.', event: 'Протечка подтверждена', status: 'Заявка создана', label: 'Ответственный', value: 'Дежурный специалист', bottom: 'Заявка передана исполнителю', icon: 'sensor' },
    { kicker: '03 / КОМАНДА УК', title: 'Проконтролировать работу', description: 'Инженер отмечает ход работ и прикладывает фото результата. Уточнение и закупка отражаются в статусе заявки.', event: 'Работа выполнена', status: 'Ожидает приёмки', label: 'Результат', value: 'Описание и фото', bottom: 'Работа готова к приёмке', icon: 'check' },
    { kicker: '04 / ПРИЁМКА', title: 'Принять результат', description: 'Проверьте результат и примите работу. Сохранённая история помогает разбирать повторные обращения и оценивать качество обслуживания.', event: 'Результат принят', status: 'Завершено', label: 'История', value: 'История работ', bottom: 'Работа принята, заявка закрыта.', icon: 'check' }
  ];
  const announce = text => { $('#demo-announcement').textContent = text; };
  const stages = model.stageLabels;
  const historyLabels = [
    'Датчик обнаружил воду в техническом помещении.',
    'Диспетчер подтвердил сигнал и открыл заявку.',
    'Назначен инженер. Начата проверка протечки.',
    'Протечка устранена. Помещение осушено.',
    'Результат принят. Заявка закрыта.'
  ];
  const historyText = item => historyLabels[item.number - 1] || item.text;
  const alarmed=id=>(id==='leak'&&model.wet(state))||(id==='power'&&state.power.sag)||(['fountain','pump'].includes(id)&&state.fountain.fault);
  function syncHotspots() {
    $$('.hotspot').forEach(b=>{const selected=b.dataset.hotspot===state.selected;b.classList.toggle('selected',selected);b.classList.toggle('alert',alarmed(b.dataset.hotspot));b.setAttribute('aria-pressed',selected);});
  }
  function renderHotspots() {
    const list=scenes[state.scene].hotspots;
    if(!list.some(h=>h.id===state.selected))state.selected=list[0].id;
    $('#hotspots').innerHTML=list.map(h=>`<button class="hotspot${h.id===state.selected?' selected':''}${alarmed(h.id)?' alert':''}" style="left:${h.x}%;top:${h.y}%" data-hotspot="${h.id}" data-label="${h.label}" aria-label="${h.label}: выбрать объект" aria-pressed="${h.id===state.selected}">${icon(h.icon)}</button>`).join('');
    renderDetail();renderObjectControls();
  }
  function renderDetail() {
    const h=scenes[state.scene].hotspots.find(h=>h.id===state.selected);
    $('#detail-kicker').textContent=h.kicker;$('#detail-title').textContent=h.title;$('#detail-text').textContent=h.description;
  }
  function selectScene(name, shouldAnnounce=true) {
    state.scene=name;
    const config=scenes[name];
    $$('.scene-tab').forEach(b=>{const active=b.dataset.scene===name;b.classList.toggle('active',active);b.setAttribute('aria-selected',active);b.tabIndex=active?0:-1;});
    $('#scene').dataset.scene=name;$('#scene').setAttribute('aria-labelledby',`tab-${name}`);
    $('#scene-image').src=`/solutions/assets/${config.image}.webp`;$('#scene-image').alt=config.alt;$('#scene-subtitle').textContent=config.subtitle;
    renderHotspots();renderLive();updateAudio();
    if(shouldAnnounce)announce(`Сцена: ${$('#tab-'+name).textContent}. ${config.subtitle}.`);
  }
  function renderObjectControls() {
    const button=(action,text,extra='')=>`<button class="model-button" data-action="${action}" ${extra}>${text}</button>`;
    let content='';
    if(['fountain','pump'].includes(state.selected)) content=button('pump-fault','Показать остановку насоса');
    if(state.selected==='power')content=button('power-sag','Показать просадку фазы');
    if(state.selected==='leak')content=`${button('leak-start','Показать протечку')}<a class="model-link" href="#simulation-actions">К обработке заявки ${icon('arrow')}</a>`;
    $('#object-controls').innerHTML=content?`<span class="model-controls-label">ПОКАЗАТЬ СОБЫТИЕ</span>${content}`:'';
    $('#object-controls').hidden=!content;
    renderControlState();
  }
  function renderControlState() {
    $$('#object-controls [data-action]').forEach(b=>{
      const a=b.dataset.action;
      b.disabled=state.paused||(a==='leak-start'&&!['normal','accepted'].includes(state.leak.stage));
      if(a==='pump-fault'){b.textContent=state.fountain.fault?'Вернуть насос в работу':'Показать остановку насоса';b.setAttribute('aria-pressed',state.fountain.fault);}
      if(a==='power-sag'){b.textContent=state.power.sag?'Вернуть напряжение':'Показать просадку фазы';b.setAttribute('aria-pressed',state.power.sag);}
      if(a==='leak-start')b.textContent=state.leak.stage==='accepted'?'Повторить событие':state.leak.stage==='normal'?'Показать протечку':'Протечка в работе';
    });
    $('#simulate-leak').disabled=state.paused;
    const order=['acknowledge','assign','complete','accept'];
    const current={active:0,acknowledged:1,assigned:2,workdone:3,accepted:4}[state.leak.stage]??-1;
    $$('#simulation-actions [data-action]').forEach(b=>{
      const i=order.indexOf(b.dataset.action);
      b.disabled=state.paused||current!==i;b.classList.toggle('action-done',current>i);b.classList.toggle('action-current',current===i);
    });
  }
  function renderMetrics() {
    const unit=(n,u)=>`${n} <small>${u}</small>`, wet=model.wet(state), f=state.fountain, sag=state.power.sag;
    let rows,title,description;
    if(['fountain','pump'].includes(state.selected)) {
      rows=[['water','Давление',unit(model.pressure(state).toFixed(1),'бар')],['bolt','Насос',f.fault?'Остановлен':'Работает'],['sensor','Данные','12 с назад']];
      title=f.fault?'Насос остановлен: нужна проверка':'Фонтан работает';description=f.fault?'Давление упало, сигнал работы насоса пропал. Ответственный получает событие.':'Давление и работа насоса в норме.';
    } else if(state.selected==='heating') {
      rows=[['water','Подача',unit('62','°C')],['water','Обратка',unit('47','°C')],['sensor','Давление подачи',unit('4.1','бар')]];
      title='Отопление и ГВС в норме';description='Температура и давление теплоносителя на вводе дома.';
    } else if(state.selected==='power') {
      rows=[['bolt','L1',unit('229','В')],['bolt','L2',unit(String(model.phaseL2(state)),'В')],['bolt','L3',unit('226','В')]];
      title=sag?'Фаза L2: 176 В, авария':'Напряжение в норме';description=sag?'Ниже 180 В. Через 10 секунд авария уходит в заявку УК с высокой срочностью.':'Норма 198–242 В по каждой фазе.';
    } else if(state.selected==='leak') {
      rows=[['water','Датчик',wet?'Вода':'Сухо'],['water','Слой воды',unit(wet?'2.8':'0.0','мм')],['check','Заявка',stages[state.leak.stage]]];
      title=wet?'Обнаружена вода':state.leak.stage==='workdone'?'Сухо. Нужна приёмка':state.leak.stage==='accepted'?'Результат принят':'Помещение сухое';description=wet?'Требуется устранить протечку и проверить помещение.':'Состояние помещения и статус работ доступны диспетчеру.';
    } else if(state.selected==='controller') {
      rows=[['sensor','Источник','Контроллер дома'],['check','Последние данные','12 с назад'],['sensor','Нет данных','Видно на карте']];title='Связь в норме';description='Показания оборудования поступают через контроллер.';
    } else {
      rows=[['house','Объект','Дом А'],['check','Заявка',state.leak.stage==='normal'?'Нет события':stages[state.leak.stage]],['sensor','События',String(state.leak.history.length)]];title='Дом и команда';description='Текущий статус и история обработки обращения.';
    }
    $('#metric-list').innerHTML=rows.map(([i,label,value])=>`<div class="metric"><span class="metric-label">${icon(i)}${label}</span><strong>${value}</strong></div>`).join('');
    $('#state-title').textContent=title;$('#state-description').textContent=description;
    $('#sensor-note').textContent=state.paused?'Просмотр на паузе':'Параметры объекта';
  }
  function renderActors() {
    const sag=state.power.sag;
    $('#phase-l2').textContent=`${model.phaseL2(state)} В`;$('#phase-l2').setAttribute('fill',sag?'#c75f20':'#0f1e25');
    $('#power-status').textContent=sag?'L2 ниже 180 В · авария':'норма 198–242 В';$('#power-status').setAttribute('fill',sag?'#c75f20':'#008876');
    $('#leak-water').setAttribute('opacity',model.wet(state)?'1':'0');
    $$('#dry-indicator circle').forEach(c=>c.setAttribute('fill',model.wet(state)?'#d76e2c':'#00af94'));
    $('#scene').classList.toggle('is-leak',model.wet(state));
    const f=state.fountain, height=.76*f.level;
    $('#fountain-water').setAttribute('transform',`translate(0 586) scale(1 ${height.toFixed(3)}) translate(0 -586)`);
    $('#fountain-water').setAttribute('opacity',f.level.toFixed(3));
    $('#fountain-water').setAttribute('visibility',f.level===0?'hidden':'visible');
    $('#pump-flow').setAttribute('opacity',f.fault?'0':'0.85');
  }
  function renderEvent() {
    const stage=state.leak.stage, active=stage!=='normal';
    const configs={
      normal:['Датчик в норме','Нет события','Источник','Датчик протечки','Новых сигналов нет','water'],
      active:['Обнаружена вода','Нужна проверка','Источник','Датчик протечки','Требуется подтверждение диспетчера','water'],
      acknowledged:['Сигнал подтверждён','Заявка открыта','Ответственный','Ещё не назначен','Требуется назначить исполнителя','sensor'],
      assigned:['Инженер приступил','В работе','Ответственный','Дежурный инженер','Сигнал активен до устранения протечки','sensor'],
      workdone:['Работа выполнена','Ожидает приёмки','Датчик','Сухо · 0.0 мм','Работа готова к приёмке','check'],
      accepted:['Результат принят','Закрыто','История','5 событий сохранено','Работа принята, заявка закрыта.','check']
    };
    const [title,status,label,value,bottom,i]=configs[stage];
    $('#event-number').textContent=active?'#001':'Нет события';$('#event-title').textContent=title;$('#event-status').textContent=status;$('#event-label').textContent=label;$('#event-value').textContent=value;$('#event-bottom').textContent=bottom;$('#event-icon').innerHTML=`<use href="#i-${i}"/>`;
    $('.event-card').classList.toggle('complete',stage==='accepted');$('.event-card').classList.toggle('event-normal',stage==='normal');
    $('#event-history').innerHTML=state.leak.history.length?state.leak.history.map(h=>`<li><span>${String(h.number).padStart(2,'0')}</span>${historyText(h)}</li>`).join(''):'<li class="empty-history">Событий пока нет. Датчик в норме.</li>';
    $('#action-instruction').textContent=state.paused?'Обработка на паузе.':stage==='normal'?'Новых сигналов нет.':stage==='accepted'?'Работа принята. История заявки сохранена.':bottom;
    $('#simulate-leak').innerHTML=(stage==='normal'?'Показать протечку':stage==='accepted'?'Повторить событие':'К обработке заявки')+icon('arrow');
    renderControlState();
  }
  function renderLive(){renderActors();renderMetrics();renderControlState();}
  function renderPause() {
    document.body.classList.toggle('motion-paused',state.paused);
    $('#pause-toggle').setAttribute('aria-pressed',state.paused);$('#pause-toggle').innerHTML=icon(state.paused?'play':'pause')+`<span>${state.paused?'Продолжить':'Пауза'}</span>`;
    $('#pause-toggle').setAttribute('aria-label',state.paused?'Продолжить просмотр и звук':'Приостановить просмотр и звук');
    renderLive();renderEvent();updateAudio();
  }
  function selectJourney(step,shouldAnnounce=false) {
    state.step=step;const data=journey[step];
    $$('.journey-step').forEach((b,i)=>{b.classList.toggle('active',i===step);b.classList.remove('passed');b.setAttribute('aria-selected',i===step);b.tabIndex=i===step?0:-1;});
    $('#journey-panel').setAttribute('aria-labelledby',`step-${step}`);$('#journey-kicker').textContent=data.kicker;$('#journey-title').textContent=data.title;$('#journey-description').textContent=data.description;
    $('#journey-next').innerHTML=(step===3?'Первый этап':'Следующий этап')+icon(step===3?'reset':'arrow');
    if(shouldAnnounce)announce(data.title+'. '+data.description);
  }
  function selectProduct(name) {
    state.product=name;const product=products[name];
    $$('.product-choice').forEach(b=>{const active=b.dataset.product===name;b.classList.toggle('active',active);b.setAttribute('aria-selected',active);b.tabIndex=active?0:-1;});
    $('#product-detail').setAttribute('aria-labelledby',`product-${name}`);$('#product-image').src=`/solutions/assets/${product.image}.webp`;$('#product-image').alt=product.alt;$('#product-tag').textContent=product.tag;$('#product-description').textContent=product.description;$('#product-features').innerHTML=product.features.map(x=>`<span>${x}</span>`).join('');
  }
  let audioContext=null,masterGain=null;
  function initAudio() {
    const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)throw new Error('Web Audio unavailable');
    audioContext=new AudioContext();const length=audioContext.sampleRate*5,buffer=audioContext.createBuffer(2,length,audioContext.sampleRate);
    for(let c=0;c<2;c++){const data=buffer.getChannelData(c);let previous=0;for(let i=0;i<length;i++){const white=Math.random()*2-1;previous=(previous+.025*white)/1.025;data[i]=(previous*3.5+white*.1)*(.8+.17*Math.sin(i/audioContext.sampleRate*2.4+c*.9));}}
    const source=audioContext.createBufferSource();source.buffer=buffer;source.loop=true;
    const high=audioContext.createBiquadFilter();high.type='highpass';high.frequency.value=160;
    const low=audioContext.createBiquadFilter();low.type='lowpass';low.frequency.value=3800;
    masterGain=audioContext.createGain();masterGain.gain.value=0;source.connect(high);high.connect(low);low.connect(masterGain);masterGain.connect(audioContext.destination);source.start();
  }
  function updateAudio() {
    const audible=state.sound&&state.scene==='courtyard'&&!state.fountain.fault&&!state.paused&&!document.hidden;
    if(audioContext&&masterGain)masterGain.gain.setTargetAtTime(audible?(state.volume/100)*.48:0,audioContext.currentTime,.18);
    $('#sound-toggle').setAttribute('aria-pressed',state.sound);$('#sound-toggle').innerHTML=icon(state.sound?'sound':'muted')+`<span>${state.sound?(audible?'Звук фонтана включён':'Звук включён · сейчас тихо'):'Включить звук фонтана'}</span>`;
    $('.sound-controls').classList.toggle('sound-inactive',state.scene!=='courtyard'||state.fountain.fault||state.paused);
    $('#volume-value').textContent=`${state.volume}%`;$('#volume').value=state.volume;
  }
  function perform(action,value) {
    if(!model.dispatch(state,action,value,reducedMotion.matches))return;
    if(action==='leak-start'){state.selected='leak';selectScene('engineering',false);selectJourney(0);renderHotspots();}
    renderLive();renderEvent();updateAudio();syncHotspots();
    if(['acknowledge','assign','complete','accept'].includes(action)) {
      renderHotspots();announce(historyText(state.leak.history.at(-1)));
      const next=$('#simulation-actions .action-current');if(next)next.focus({preventScroll:true});
    } else {
      const messages={'leak-start':'Обнаружена вода. Требуется проверка диспетчера.','pump-fault':state.fountain.fault?'Насос фонтана остановлен, давление падает. Нужна проверка.':'Насос снова работает, давление в норме.','power-sag':state.power.sag?'Фаза L2: 176 вольт. Авария по электроснабжению.':'Напряжение по фазам в норме.'};
      announce(messages[action]||'Состояние обновлено.');
    }
  }
  $('#object-controls').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)perform(b.dataset.action,b.dataset.value);});
  $('#simulation-actions').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)perform(b.dataset.action);});
  $('#sound-toggle').addEventListener('click',async()=>{
    try{if(!audioContext)initAudio();if(audioContext.state==='suspended')await audioContext.resume();state.sound=!state.sound;updateAudio();announce(state.sound?'Звук фонтана включён.':'Звук выключен.');}
    catch{state.sound=false;updateAudio();announce('Звук недоступен в браузере.');$('#sound-toggle span').textContent='Звук недоступен';}
  });
  $('#volume').addEventListener('input',e=>{state.volume=Number(e.target.value);updateAudio();});
  $('#pause-toggle').addEventListener('click',()=>{model.dispatch(state,'pause');renderPause();announce(state.paused?'Просмотр и звук на паузе.':'Просмотр продолжен.');});
  $('#reset-demo').addEventListener('click',()=>{model.dispatch(state,'reset');selectScene('courtyard',false);selectJourney(0);selectProduct('residents');renderPause();announce('Начальное состояние: фонтан работает, напряжение в норме. Событий нет, звук выключен.');});
  $$('.scene-tab').forEach(b=>b.addEventListener('click',()=>selectScene(b.dataset.scene)));
  $('#hotspots').addEventListener('click',e=>{const b=e.target.closest('[data-hotspot]');if(!b)return;state.selected=b.dataset.hotspot;syncHotspots();renderDetail();renderObjectControls();renderLive();announce($('#detail-title').textContent+'. '+$('#detail-text').textContent);});
  $$('.product-choice').forEach(b=>b.addEventListener('click',()=>selectProduct(b.dataset.product)));
  $$('.journey-step').forEach(b=>b.addEventListener('click',()=>selectJourney(Number(b.dataset.step),true)));
  $('#journey-next').addEventListener('click',()=>selectJourney((state.step+1)%4,true));
  $('#simulate-leak').addEventListener('click',()=>{
    if(state.paused)return;
    if(['normal','accepted'].includes(state.leak.stage)){perform('leak-start');$('#demo').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'start'});}
    else{$('#simulation-actions').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'center'});$('#simulation-actions .action-current')?.focus({preventScroll:true});}
  });
  $$('[role="tablist"]').forEach(list=>list.addEventListener('keydown',e=>{
    const tabs=$$('[role="tab"]',list),i=tabs.indexOf(document.activeElement);if(i<0)return;let next=i;
    if(e.key==='ArrowRight'||e.key==='ArrowDown')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft'||e.key==='ArrowUp')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;
    e.preventDefault();tabs[next].focus();tabs[next].click();
  }));
  document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('page-hidden',document.hidden);lastFrame=null;updateAudio();if(!document.hidden&&state.sound&&audioContext?.state==='suspended')audioContext.resume().catch(()=>{});});
  reducedMotion.addEventListener?.('change',()=>{renderLive();});
  let lastFrame=null,uiElapsed=0;
  function frame(now) {
    const dt=lastFrame===null?0:(now-lastFrame)/1000;lastFrame=now;
    model.advance(state,dt,reducedMotion.matches,document.hidden);
    if(!state.paused&&!document.hidden){renderActors();uiElapsed+=dt;if(uiElapsed>=.1){renderMetrics();renderControlState();uiElapsed=0;}}
    requestAnimationFrame(frame);
  }
  // A read-only snapshot makes the educational state inspectable without a second source of truth.
  window.InfraSafeDemo=Object.freeze({snapshot:()=>JSON.parse(JSON.stringify(state))});
  selectScene('courtyard',false);selectJourney(0);renderEvent();renderPause();requestAnimationFrame(frame);
})();
