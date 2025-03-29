<script>
  import '../app.postcss';
</script>

<div class="app">
  <header class="app-header">
    <div class="container mx-auto px-4 py-3 flex justify-between items-center">
      <div class="logo">
        <a href="/" class="text-xl font-bold text-primary-600">InfraSafe</a>
      </div>
      
      <nav class="main-nav">
        <ul class="flex gap-6">
          <li><a href="/" class="hover:text-primary-600 transition-colors">Дашборд</a></li>
          <li><a href="/buildings" class="hover:text-primary-600 transition-colors">Здания</a></li>
          <li><a href="/controllers" class="hover:text-primary-600 transition-colors">Контроллеры</a></li>
          <li><a href="/metrics" class="hover:text-primary-600 transition-colors">Метрики</a></li>
          <li><a href="/admin" class="hover:text-primary-600 transition-colors">Админ-панель</a></li>
        </ul>
      </nav>
      
      <div class="user-menu">
        <button class="btn-secondary">Войти</button>
      </div>
    </div>
  </header>
  
  <main class="app-content container mx-auto px-4 py-6">
    <slot />
  </main>
  
  <footer class="app-footer bg-gray-100">
    <div class="container mx-auto px-4 py-6">
      <div class="flex justify-between items-center">
        <div class="copyright">
          <p>&copy; 2023 InfraSafe. Все права защищены.</p>
        </div>
        
        <div class="footer-links">
          <ul class="flex gap-4">
            <li><a href="/about" class="text-gray-600 hover:text-primary-600 transition-colors">О проекте</a></li>
            <li><a href="/privacy" class="text-gray-600 hover:text-primary-600 transition-colors">Конфиденциальность</a></li>
            <li><a href="/contact" class="text-gray-600 hover:text-primary-600 transition-colors">Контакты</a></li>
          </ul>
        </div>
      </div>
    </div>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  
  .app-header {
    background-color: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  
  .app-content {
    flex: 1;
  }
  
  .app-footer {
    margin-top: auto;
  }
</style> 