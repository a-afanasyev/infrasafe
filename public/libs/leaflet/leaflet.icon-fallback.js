/**
 * Leaflet Icon Fallback
 * Предотвращает проблемы с отображением иконок, если они не загрузились
 */

(function() {
    // Обработка ошибок при загрузке иконок
    if (L && L.Icon) {
        const originalIconCreateIcon = L.Icon.prototype._createIcon;

        L.Icon.prototype._createIcon = function(name, oldIcon) {
            const icon = originalIconCreateIcon.call(this, name, oldIcon);

            // Добавляем обработчик ошибки загрузки изображения
            icon.onerror = function() {
                console.warn('Ошибка загрузки иконки Leaflet: ', icon.src);

                // Если произошла ошибка, используем запасное изображение или CSS для стилизации
                if (name === 'icon') {
                    // Для основной иконки используем синий маркер как запасной вариант
                    icon.style.backgroundColor = '#2196F3';
                    icon.style.borderRadius = '50%';
                    icon.style.width = '14px';
                    icon.style.height = '14px';
                    icon.style.margin = '12px';
                    icon.style.border = '2px solid white';
                    icon.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
                } else if (name === 'shadow') {
                    // Для тени просто скрываем элемент
                    icon.style.display = 'none';
                }
            };

            return icon;
        };
    }
})();