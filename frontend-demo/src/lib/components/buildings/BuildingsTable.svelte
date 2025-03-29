<script>
  import { onMount } from 'svelte';
  import { buildingsAPI } from '../../services/api.js';
  
  // Состояние для зданий
  let buildings = [];
  let loading = true;
  let error = null;
  
  // Состояние для пагинации
  let currentPage = 1;
  let totalPages = 1;
  let limit = 10;
  let total = 0;
  
  // Загрузка данных
  async function loadBuildings() {
    loading = true;
    error = null;
    
    try {
      const response = await buildingsAPI.getBuildings(currentPage, limit);
      buildings = response.data || [];
      
      // Обновление информации о пагинации
      if (response.pagination) {
        currentPage = response.pagination.page || 1;
        limit = response.pagination.limit || 10;
        total = response.pagination.total || 0;
        totalPages = Math.ceil(total / limit) || 1;
      }
    } catch (err) {
      console.error('Error loading buildings:', err);
      error = err.message || 'Ошибка загрузки данных';
      buildings = [];
    } finally {
      loading = false;
    }
  }
  
  // Переход на предыдущую страницу
  function prevPage() {
    if (currentPage > 1) {
      currentPage--;
      loadBuildings();
    }
  }
  
  // Переход на следующую страницу
  function nextPage() {
    if (currentPage < totalPages) {
      currentPage++;
      loadBuildings();
    }
  }
  
  // Удаление здания
  async function deleteBuilding(id) {
    if (confirm('Вы уверены, что хотите удалить это здание?')) {
      try {
        await buildingsAPI.deleteBuilding(id);
        await loadBuildings(); // Перезагрузка списка
        alert('Здание успешно удалено');
      } catch (err) {
        console.error('Error deleting building:', err);
        alert(`Ошибка при удалении: ${err.message || 'Неизвестная ошибка'}`);
      }
    }
  }
  
  // Загрузка данных при монтировании компонента
  onMount(() => {
    loadBuildings();
  });
</script>

<div class="buildings-table-container">
  <h2>Список зданий</h2>
  
  {#if error}
    <div class="error-message">
      <p>{error}</p>
      <button class="btn" on:click={loadBuildings}>Повторить</button>
    </div>
  {/if}
  
  <div class="table-container">
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Название</th>
          <th>Адрес</th>
          <th>Город</th>
          <th>Область</th>
          <th>Координаты</th>
          <th>Управляющая компания</th>
          <th>Горячая вода</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr>
            <td colspan="9" class="loading-message">
              <div class="loading-spinner"></div>
              Загрузка данных...
            </td>
          </tr>
        {:else if buildings.length === 0}
          <tr>
            <td colspan="9" class="empty-message">Нет доступных зданий</td>
          </tr>
        {:else}
          {#each buildings as building}
            <tr>
              <td>{building.building_id}</td>
              <td>{building.name}</td>
              <td>{building.address}</td>
              <td>{building.town}</td>
              <td>{building.region || '-'}</td>
              <td>{building.latitude}, {building.longitude}</td>
              <td>{building.management_company || '-'}</td>
              <td>{building.hot_water ? 'Да' : 'Нет'}</td>
              <td class="actions-cell">
                <button class="btn-secondary btn-sm" on:click={() => window.location.href = `/buildings/${building.building_id}`}>
                  Просмотр
                </button>
                <button class="btn-secondary btn-sm" on:click={() => window.location.href = `/buildings/${building.building_id}/edit`}>
                  Редактировать
                </button>
                <button class="btn-danger btn-sm" on:click={() => deleteBuilding(building.building_id)}>
                  Удалить
                </button>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
  
  <!-- Пагинация -->
  <div class="pagination">
    <button class="btn-secondary" on:click={prevPage} disabled={currentPage <= 1 || loading}>
      Предыдущая
    </button>
    <span class="page-info">
      Страница {currentPage} из {totalPages} (всего {total})
    </span>
    <button class="btn-secondary" on:click={nextPage} disabled={currentPage >= totalPages || loading}>
      Следующая
    </button>
  </div>
</div>

<style>
  .buildings-table-container {
    margin-bottom: 2rem;
  }
  
  .loading-message, .empty-message {
    text-align: center;
    padding: 2rem;
    color: #666;
  }
  
  .loading-spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 3px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    border-top-color: #22c55e;
    animation: spin 1s linear infinite;
    margin-right: 0.5rem;
  }
  
  .pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 1rem;
    gap: 1rem;
  }
  
  .page-info {
    color: #666;
  }
  
  .error-message {
    background-color: #fee2e2;
    color: #b91c1c;
    padding: 1rem;
    border-radius: 0.375rem;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .actions-cell {
    display: flex;
    gap: 0.5rem;
  }
  
  .btn-sm {
    padding: 0.25rem 0.5rem;
    font-size: 0.875rem;
  }
  
  .btn-danger {
    background-color: #ef4444;
    color: white;
    border-radius: 0.25rem;
  }
  
  .btn-danger:hover {
    background-color: #dc2626;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style> 