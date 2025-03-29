// Конфигурация Grafana
const GRAFANA_URL = 'http://localhost:3000/grafana'; // Пример URL, нужно заменить на реальный

// Генерация URL для встраивания панели Grafana с параметрами
export function buildGrafanaPanelUrl(dashboardId, panelId, params = {}) {
  // Базовый URL панели Grafana
  let url = `${GRAFANA_URL}/d-solo/${dashboardId}?panelId=${panelId}&theme=light`;
  
  // Добавление временного диапазона, если он указан
  if (params.from && params.to) {
    url += `&from=${params.from}&to=${params.to}`;
  }
  
  // Добавление переменных для фильтрации
  Object.entries(params).forEach(([key, value]) => {
    // Пропускаем временные параметры, так как они уже добавлены выше
    if (key !== 'from' && key !== 'to' && value) {
      url += `&var-${key}=${encodeURIComponent(value)}`;
    }
  });
  
  return url;
}

// Предопределенные панели
export const GRAFANA_PANELS = {
  // Панели для зданий
  BUILDING_OVERVIEW: {
    dashboardId: 'building-overview',
    panelId: 1,
    title: 'Обзор здания'
  },
  BUILDING_ELECTRICITY: {
    dashboardId: 'building-electricity',
    panelId: 2,
    title: 'Потребление электроэнергии'
  },
  BUILDING_WATER: {
    dashboardId: 'building-water',
    panelId: 3,
    title: 'Водоснабжение'
  },
  
  // Панели для контроллеров
  CONTROLLER_STATUS: {
    dashboardId: 'controller-status',
    panelId: 4,
    title: 'Статус контроллера'
  },
  CONTROLLER_METRICS: {
    dashboardId: 'controller-metrics',
    panelId: 5,
    title: 'Метрики контроллера'
  },
  
  // Общие панели
  SYSTEM_OVERVIEW: {
    dashboardId: 'system-overview',
    panelId: 6,
    title: 'Обзор системы'
  }
};

// Функция для получения предопределенных временных диапазонов
export function getTimeRanges() {
  return [
    { label: 'Последний час', from: 'now-1h', to: 'now' },
    { label: 'Последние 6 часов', from: 'now-6h', to: 'now' },
    { label: 'Последние 12 часов', from: 'now-12h', to: 'now' },
    { label: 'Последние 24 часа', from: 'now-24h', to: 'now' },
    { label: 'Последние 3 дня', from: 'now-3d', to: 'now' },
    { label: 'Последняя неделя', from: 'now-7d', to: 'now' },
    { label: 'Последний месяц', from: 'now-30d', to: 'now' }
  ];
}

export default {
  buildGrafanaPanelUrl,
  GRAFANA_PANELS,
  getTimeRanges
}; 