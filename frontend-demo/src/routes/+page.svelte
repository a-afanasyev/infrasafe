<script>
  import { onMount } from 'svelte';
  import { buildingsAPI, controllersAPI, metricsAPI } from '../lib/services/api.js';
  import GrafanaPanel from '../lib/components/grafana/GrafanaPanel.svelte';
  import { GRAFANA_PANELS } from '../lib/services/grafana.js';
  
  // Состояние для данных
  let stats = {
    buildings: 0,
    controllers: 0,
    metrics: 0,
    onlineControllers: 0,
    offlineControllers: 0
  };
  
  let loading = true;
  let error = null;
  
  // Загрузка статистики
  async function loadStats() {
    loading = true;
    error = null;
    
    try {
      // В реальном проекте здесь будет API-запрос для получения общей статистики
      // Для демо используем имитацию
      const [buildingsResponse, controllersResponse] = await Promise.all([
        buildingsAPI.getBuildings(1, 1),
        controllersAPI.getControllers(1, 1)
      ]);
      
      // Получаем общее количество из пагинации
      stats.buildings = buildingsResponse.pagination?.total || 0;
      stats.controllers = controllersResponse.pagination?.total || 0;
      
      // Имитация получения метрик и статусов контроллеров
      stats.metrics = 1250;
      stats.onlineControllers = Math.floor(stats.controllers * 0.85); // 85% онлайн
      stats.offlineControllers = stats.controllers - stats.onlineControllers;
      
      loading = false;
    } catch (err) {
      console.error('Error loading stats:', err);
      error = err.message || 'Ошибка загрузки данных';
      loading = false;
    }
  }
  
  onMount(() => {
    loadStats();
  });
</script>

<div class="dashboard">
  <h1>Система мониторинга зданий</h1>
  
  {#if loading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Загрузка данных...</p>
    </div>
  {:else if error}
    <div class="error-message">
      <p>{error}</p>
      <button class="btn" on:click={loadStats}>Повторить</button>
    </div>
  {:else}
    <div class="stats-cards">
      <div class="stat-card card">
        <div class="stat-icon buildings-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
        </div>
        <div class="stat-content">
          <h3>Здания</h3>
          <p class="stat-value">{stats.buildings}</p>
        </div>
      </div>
      
      <div class="stat-card card">
        <div class="stat-icon controllers-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
        </div>
        <div class="stat-content">
          <h3>Контроллеры</h3>
          <p class="stat-value">{stats.controllers}</p>
          <div class="status-info">
            <span class="status-label online">{stats.onlineControllers} онлайн</span>
            <span class="status-label offline">{stats.offlineControllers} оффлайн</span>
          </div>
        </div>
      </div>
      
      <div class="stat-card card">
        <div class="stat-icon metrics-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        </div>
        <div class="stat-content">
          <h3>Метрики</h3>
          <p class="stat-value">{stats.metrics}</p>
          <p class="text-sm text-gray-500">За последние 24 часа</p>
        </div>
      </div>
    </div>
    
    <!-- Основные графики Grafana -->
    <div class="main-dashboard">
      <h2>Обзор системы</h2>
      
      <GrafanaPanel 
        dashboardId={GRAFANA_PANELS.SYSTEM_OVERVIEW.dashboardId}
        panelId={GRAFANA_PANELS.SYSTEM_OVERVIEW.panelId}
        title={GRAFANA_PANELS.SYSTEM_OVERVIEW.title}
        height="400px"
      />
    </div>
    
    <!-- Быстрые ссылки -->
    <div class="quick-links">
      <h2>Быстрые действия</h2>
      
      <div class="links-grid">
        <a href="/buildings/new" class="quick-link card">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>Добавить здание</span>
        </a>
        
        <a href="/controllers/new" class="quick-link card">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>Добавить контроллер</span>
        </a>
        
        <a href="/buildings" class="quick-link card">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
          <span>Управление зданиями</span>
        </a>
        
        <a href="/controllers" class="quick-link card">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          <span>Управление контроллерами</span>
        </a>
      </div>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    margin-bottom: 2rem;
  }
  
  .stats-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1.5rem;
    margin: 2rem 0;
  }
  
  .stat-card {
    padding: 1.5rem;
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  
  .stat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 50px;
    height: 50px;
    border-radius: 12px;
    flex-shrink: 0;
  }
  
  .buildings-icon {
    background-color: #e0f2fe;
    color: #0369a1;
  }
  
  .controllers-icon {
    background-color: #dcfce7;
    color: #15803d;
  }
  
  .metrics-icon {
    background-color: #fef3c7;
    color: #92400e;
  }
  
  .stat-content {
    flex: 1;
  }
  
  .stat-content h3 {
    font-size: 1rem;
    font-weight: 500;
    color: #666;
    margin-bottom: 0.25rem;
  }
  
  .stat-value {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }
  
  .status-info {
    display: flex;
    gap: 1rem;
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }
  
  .status-label {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
    border-radius: 1rem;
  }
  
  .status-label.online {
    background-color: #dcfce7;
    color: #15803d;
  }
  
  .status-label.offline {
    background-color: #fee2e2;
    color: #b91c1c;
  }
  
  .main-dashboard {
    margin: 2rem 0;
  }
  
  .links-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }
  
  .quick-link {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    text-decoration: none;
    color: inherit;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  
  .quick-link:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  }
  
  .quick-link svg {
    color: #22c55e;
  }
  
  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem;
  }
  
  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    border-top: 4px solid #22c55e;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style> 