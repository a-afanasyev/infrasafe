<script>
  import BuildingsTable from '../../lib/components/buildings/BuildingsTable.svelte';
</script>

<div class="buildings-page">
  <div class="page-header">
    <h1>Управление зданиями</h1>
    <a href="/buildings/new" class="btn">Добавить здание</a>
  </div>
  
  <BuildingsTable />
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }
</style> 