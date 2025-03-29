<script>
  import { onMount } from 'svelte';
  import { buildGrafanaPanelUrl } from '../../services/grafana.js';
  
  // Обязательные параметры
  export let dashboardId;
  export let panelId;
  
  // Опциональные параметры
  export let title = 'Графана панель';
  export let building = null;
  export let controller = null;
  export let from = 'now-24h';
  export let to = 'now';
  export let height = '300px';
  export let loading = true;
  
  // Локальная переменная для URL
  let panelUrl;
  
  // Обновление URL при изменении параметров
  $: {
    panelUrl = buildGrafanaPanelUrl(dashboardId, panelId, {
      building,
      controller,
      from,
      to
    });
    
    // Для демонстрации без реальной Grafana, искусственная задержка
    if (loading) {
      setTimeout(() => {
        loading = false;
      }, 1500);
    }
  }
  
  onMount(() => {
    // Код, который будет выполнен при монтировании компонента
    console.log(`Grafana panel mounted: ${dashboardId}, panel: ${panelId}`);
  });
</script>

<div class="grafana-panel card">
  <h3 class="grafana-panel-title">{title}</h3>
  
  {#if loading}
    <div class="grafana-loading-container" style="height: {height}">
      <div class="grafana-loading-spinner"></div>
      <div class="grafana-loading-text">Загрузка данных...</div>
    </div>
  {:else}
    <iframe
      title={title}
      src={panelUrl}
      width="100%"
      height={height}
      frameborder="0"
      class="grafana-iframe"
    ></iframe>
  {/if}
</div>

<style>
  .grafana-panel {
    margin-bottom: 1.5rem;
  }
  
  .grafana-panel-title {
    margin-bottom: 0.5rem;
    font-size: 1.1rem;
    font-weight: 600;
  }
  
  .grafana-iframe {
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  
  .grafana-loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: #f8f9fa;
    border-radius: 4px;
  }
  
  .grafana-loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    border-top: 4px solid #22c55e;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  
  .grafana-loading-text {
    color: #666;
    font-size: 0.9rem;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style> 