'use strict';
(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#site-nav');
  const login = document.querySelector('.login-menu');
  const setMenu = (open) => {
    if (!menuButton || !navigation) return;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    navigation.classList.toggle('menu-open', open);
  };
  menuButton?.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  navigation?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (menuButton?.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menuButton.focus();
    }
    if (login?.open) {
      login.open = false;
      login.querySelector('summary')?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (login?.open && !login.contains(event.target)) login.open = false;
    if (menuButton?.getAttribute('aria-expanded') === 'true' && !event.target.closest('.header-inner')) setMenu(false);
  });
  window.matchMedia('(min-width: 981px)').addEventListener?.('change', (event) => {
    if (event.matches) setMenu(false);
  });
  const here = location.pathname.replace(/index\.html$/, '');
  navigation?.querySelectorAll('a').forEach(link => {
    const target = new URL(link.href, location.href);
    if (!target.hash && target.pathname === here) link.setAttribute('aria-current', 'page');
  });
  const form = document.querySelector('#pilot-form');
  if (!form) return;
  const moduleInputs = [...form.querySelectorAll('input[name="module"]')];
  const validateModules = () => {
    moduleInputs[0].setCustomValidity(moduleInputs.some(input => input.checked) ? '' : 'Выберите хотя бы одно направление.');
  };
  moduleInputs.forEach(input => input.addEventListener('change', validateModules));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    validateModules();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const modules = data.getAll('module').join(', ');
    const body = [
      'Здравствуйте! Хочу обсудить пилот InfraSafe.',
      '',
      `Направления: ${modules}`,
      `Имя: ${String(data.get('name') || '').trim()}`,
      `Контакт для ответа: ${String(data.get('contact') || '').trim()}`,
      `Количество домов или объектов: ${data.get('houses') || 'уточним'}`,
      `Задача: ${String(data.get('task') || '').trim() || 'обсудим при знакомстве'}`,
      '',
      'Прошу предложить состав пилота и следующий шаг.'
    ].join('\n');
    const mailto = `mailto:info@infrasafe.uz?subject=${encodeURIComponent('Обсудить пилот InfraSafe')}&body=${encodeURIComponent(body)}`;
    const draft = document.querySelector('#email-draft');
    document.querySelector('#email-draft-text').value = body;
    document.querySelector('#email-draft-link').href = mailto;
    draft.hidden = false;
    setStatus('Текст письма готов. Откройте его в почте или скопируйте и отправьте на info@infrasafe.uz. Письмо ещё не отправлено.');
  });
  const setStatus = (text) => { document.querySelector('#form-status').textContent = text; };
  document.querySelector('#copy-draft')?.addEventListener('click', async () => {
    const area = document.querySelector('#email-draft-text');
    try {
      await navigator.clipboard.writeText(area.value);
      setStatus('Текст скопирован. Вставьте его в письмо на info@infrasafe.uz.');
    } catch {
      area.focus();
      area.select();
      setStatus('Текст выделен. Скопируйте его клавишами Ctrl+C или Cmd+C.');
    }
  });
  form.querySelector('button[type="submit"]').disabled = false;
})();
(() => {
  const track = document.querySelector('#carousel-track');
  if (!track) return;
  const slides = [...track.children];
  const dots = [...document.querySelectorAll('.carousel-dot')];
  const prev = document.querySelector('#carousel-prev');
  const next = document.querySelector('#carousel-next');
  const count = document.querySelector('#carousel-count');
  const current = () => Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
  const goTo = (index) => {
    const target = Math.max(0, Math.min(slides.length - 1, index));
    track.scrollTo({ left: slides[target].offsetLeft - track.offsetLeft });
  };
  const sync = () => {
    const index = Math.min(slides.length - 1, current());
    dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    count.textContent = `${index + 1} / ${slides.length}`;
  };
  let frame = 0;
  track.addEventListener('scroll', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); }, { passive: true });
  prev.addEventListener('click', () => goTo(current() - 1));
  next.addEventListener('click', () => goTo(current() + 1));
  dots.forEach((dot) => dot.addEventListener('click', () => goTo(Number(dot.dataset.slide))));
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(current() + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(current() - 1); }
  });
  window.addEventListener('resize', () => goTo(current()));
  sync();
})();
