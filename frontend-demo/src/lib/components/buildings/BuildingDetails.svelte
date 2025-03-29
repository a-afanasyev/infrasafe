<script>
  import { onMount } from 'svelte';
  import { buildingsAPI, controllersAPI } from '../../services/api.js';
  import GrafanaPanel from '../grafana/GrafanaPanel.svelte';
  import { GRAFANA_PANELS, getTimeRanges } from '../../services/grafana.js';
  
  // Параметры компонента
  export let buildingId;
  
  // Состояние для данных
  let building = null;
  let controllers = [];
  let loading = true;
  let error = null;
  
  // Состояние для графиков
  let selectedTimeRange = getTimeRanges()[3]; // По умолчанию - последние 24 часа
  let timeRanges = getTimeRanges();
  
  // Загрузка данных о здании
  async function loadBuilding() {
    loading = true;
    error = null;
    
    try {
      // Загружаем данные о здании
      const buildingData = await buildingsAPI.getBuilding(buildingId);
      building = buildingData.data;
      
      // Загружаем контроллеры для этого здания
      const controllersData = await controllersAPI.getBuildingControllers(buildingId);
      controllers = controllersData.data || [];
    } catch (err) {
      console.error('Error loading building data:', err);
      error = err.message || 'Ошибка загрузки данных';
    } finally {
      loading = false;
    }
  }
  
  // Обработчик изменения временного диапазона
  function handleTimeRangeChange(event) {
    const selectedIndex = event.target.value;
    selectedTimeRange = timeRanges[selectedIndex];
  }
  
  // Загрузка данных при монтировании компонента
  onMount(() => {
    loadBuilding();
  });
</script>

<div class="building-details">
  {#if loading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Загрузка данных здания...</p>
    </div>
  {:else if error}
    <div class="error-message">
      <p>{error}</p>
      <button class="btn" on:click={loadBuilding}>Повторить</button>
    </div>
  {:else if building}
    <div class="building-header">
      <h1>{building.name}</h1>
      <p class="building-address">{building.address}, {building.town}, {building.region || ''}</p>
      
      <div class="building-meta">
        <div class="meta-item">
          <span class="meta-label">Управляющая компания:</span>
          <span class="meta-value">{building.management_company || 'Не указана'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Горячая вода:</span>
          <span class="meta-value">{building.hot_water ? 'Да' : 'Нет'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Координаты:</span>
          <span class="meta-value">{building.latitude}, {building.longitude}</span>
        </div>
      </div>
      
      <div class="building-actions">
        <button class="btn" on:click={() => window.location.href = `/buildings/${building.building_id}/edit`}>
          Редактировать
        </button>
        <button class="btn-secondary" on:click={() => window.location.href = '/buildings'}>
          К списку зданий
        </button>
      </div>
    </div>
    
    <!-- Временной диапазон для графиков -->
    <div class="time-range-selector">
      <label for="time-range">Временной диапазон:</label>
      <select id="time-range" on:change={handleTimeRangeChange}>
        {#each timeRanges as range, index}
          <option value={index}>{range.label}</option>
        {/each}
      </select>
    </div>
    
    <div class="grafana-dashboard">
      <h2>Графики мониторинга</h2>
      
      <!-- Основной обзор здания -->
      <GrafanaPanel 
        dashboardId={GRAFANA_PANELS.BUILDING_OVERVIEW.dashboardId}
        panelId={GRAFANA_PANELS.BUILDING_OVERVIEW.panelId}
        title={GRAFANA_PANELS.BUILDING_OVERVIEW.title}
        building={buildingId}
        from={selectedTimeRange.from}
        to={selectedTimeRange.to}
        height="350px"
      />
      
      <!-- Потребление электроэнергии -->
      <GrafanaPanel 
        dashboardId={GRAFANA_PANELS.BUILDING_ELECTRICITY.dashboardId}
        panelId={GRAFANA_PANELS.BUILDING_ELECTRICITY.panelId}
        title={GRAFANA_PANELS.BUILDING_ELECTRICITY.title}
        building={buildingId}
        from={selectedTimeRange.from}
        to={selectedTimeRange.to}
        height="300px"
      />
      
      <!-- Водоснабжение -->
      <GrafanaPanel 
        dashboardId={GRAFANA_PANELS.BUILDING_WATER.dashboardId}
        panelId={GRAFANA_PANELS.BUILDING_WATER.panelId}
        title={GRAFANA_PANELS.BUILDING_WATER.title}
        building={buildingId}
        from={selectedTimeRange.from}
        to={selectedTimeRange.to}
        height="300px"
      />
    </div>
    
    <!-- Контроллеры в здании -->
    <div class="building-controllers">
      <h2>Контроллеры ({controllers.length})</h2>
      
      {#if controllers.length === 0}
        <p class="no-controllers">В этом здании нет контроллеров</p>
      {:else}
        <div class="controllers-grid">
          {#each controllers as controller}
            <div class="controller-card card">
              <div class="controller-header">
                <h3>{controller.serial_number}</h3>
                <span class="controller-status status-{controller.status}">{controller.status}</span>
              </div>
              <div class="controller-details">
                <p><span>Модель:</span> {controller.model || 'Не указана'}</p>
                <p><span>Производитель:</span> {controller.vendor || 'Не указан'}</p>
                <p><span>Установлен:</span> {new Date(controller.installed_at).toLocaleDateString()}</p>
              </div>
              <div class="controller-actions">
                <button class="btn-secondary btn-sm" on:click={() => window.location.href = `/controllers/${controller.controller_id}`}>
                  Подробнее
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      
      <button class="btn" on:click={() => window.location.href = `/buildings/${building.building_id}/controllers/new`}>
        Добавить контроллер
      </button>
    </div>
  {:else}
    <p>Здание не найдено</p>
  {/if}
</div>

<style>
  .building-details {
    margin-bottom: 2rem;
  }
  
  .building-header {
    margin-bottom: 2rem;
  }
  
  .building-address {
    color: #666;
    font-size: 1.1rem;
    margin-bottom: 1rem;
  }
  
  .building-meta {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  
  .meta-item {
    display: flex;
    flex-direction: column;
  }
  
  .meta-label {
    font-size: 0.875rem;
    color: #666;
  }
  
  .meta-value {
    font-size: 1rem;
    font-weight: 500;
  }
  
  .building-actions {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  
  .time-range-selector {
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  
  .time-range-selector select {
    padding: 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid #ddd;
  }
  
  .grafana-dashboard {
    margin-bottom: 2rem;
  }
  
  .building-controllers {
    margin-top: 2rem;
  }
  
  .controllers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }
  
  .controller-card {
    padding: 1rem;
    border-radius: 0.5rem;
  }
  
  .controller-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  
  .controller-status {
    padding: 0.25rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 600;
  }
  
  .status-online {
    background-color: #dcfce7;
    color: #15803d;
  }
  
  .status-offline {
    background-color: #fee2e2;
    color: #b91c1c;
  }
  
  .status-maintenance {
    background-color: #fef3c7;
    color: #92400e;
  }
  
  .controller-details p {
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    display: flex;
    justify-content: space-between;
  }
  
  .controller-details p span {
    color: #666;
  }
  
  .controller-actions {
    margin-top: 1rem;
    display: flex;
    justify-content: flex-end;
  }
  
  .no-controllers {
    color: #666;
    font-style: italic;
    margin-bottom: 1rem;
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