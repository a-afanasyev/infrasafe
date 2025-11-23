#!/bin/bash

# ============================================================================
# InfraSafe - Скрипт подготовки к публикации
# ============================================================================
# Этот скрипт исправляет критические блокеры перед публикацией проекта
# Время выполнения: ~5 минут
# ============================================================================

set -e  # Остановка при ошибке

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "============================================================================"
echo -e "${BLUE}🚀 InfraSafe - Подготовка к публикации${NC}"
echo "============================================================================"
echo ""

# ============================================================================
# 1. Проверка текущего статуса
# ============================================================================

echo -e "${BLUE}📊 Шаг 1/5: Проверка текущего статуса...${NC}"
echo ""

# Проверка LICENSE
if [ -f "LICENSE" ]; then
    echo -e "${GREEN}✅ LICENSE файл существует${NC}"
else
    echo -e "${RED}❌ LICENSE файл отсутствует${NC}"
fi

# Проверка backup файлов
BACKUP_COUNT=$(find . -name "*.bak" -o -name "*.backup*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -eq "0" ]; then
    echo -e "${GREEN}✅ Backup файлы отсутствуют${NC}"
else
    echo -e "${YELLOW}⚠️  Найдено backup файлов: ${BACKUP_COUNT}${NC}"
fi

# Проверка package.json
if grep -q '"author": ""' package.json; then
    echo -e "${YELLOW}⚠️  package.json: author пустой${NC}"
else
    echo -e "${GREEN}✅ package.json: author заполнен${NC}"
fi

echo ""
read -p "Продолжить подготовку к публикации? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}❌ Отменено пользователем${NC}"
    exit 1
fi
echo ""

# ============================================================================
# 2. Создание LICENSE файла (опционально)
# ============================================================================

echo -e "${BLUE}📄 Шаг 2/5: Проверка LICENSE файла...${NC}"
echo ""

if [ ! -f "LICENSE" ]; then
    echo "LICENSE файл отсутствует. Выберите тип лицензии:"
    echo ""
    echo "1) MIT License (рекомендуется для open source)"
    echo "2) Apache License 2.0 (для коммерческих проектов)"
    echo "3) Proprietary License (закрытый проект)"
    echo "4) Пропустить (создам вручную позже)"
    echo ""
    read -p "Ваш выбор (1-4): " license_choice
    
    case $license_choice in
        1)
            echo -e "${GREEN}Создание MIT License...${NC}"
            cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2025 InfraSafe Project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
            echo -e "${GREEN}✅ MIT License создана${NC}"
            ;;
        2)
            echo -e "${GREEN}Создание Apache License 2.0...${NC}"
            curl -s https://www.apache.org/licenses/LICENSE-2.0.txt > LICENSE
            echo -e "${GREEN}✅ Apache License 2.0 создана${NC}"
            ;;
        3)
            echo -e "${GREEN}Создание Proprietary License...${NC}"
            cat > LICENSE << 'EOF'
PROPRIETARY LICENSE

Copyright (c) 2025 InfraSafe Project. All rights reserved.

This software and associated documentation files are proprietary and confidential.
No part of this software may be reproduced, distributed, or transmitted in any
form or by any means without the prior written permission of the copyright holder.

For licensing inquiries, please contact the project maintainers.
EOF
            echo -e "${GREEN}✅ Proprietary License создана${NC}"
            ;;
        4)
            echo -e "${YELLOW}⚠️  LICENSE пропущен. Создайте файл вручную перед публикацией!${NC}"
            ;;
        *)
            echo -e "${RED}Неверный выбор. LICENSE не создана.${NC}"
            ;;
    esac
else
    echo -e "${GREEN}✅ LICENSE файл уже существует${NC}"
fi

echo ""

# ============================================================================
# 3. Удаление backup файлов
# ============================================================================

echo -e "${BLUE}🧹 Шаг 3/5: Удаление backup файлов...${NC}"
echo ""

# Поиск backup файлов
echo "Поиск backup файлов..."
BACKUP_FILES=$(find . -type f \( -name "*.bak" -o -name "*.backup*" -o -name "* 2" \) 2>/dev/null || true)

if [ -z "$BACKUP_FILES" ]; then
    echo -e "${GREEN}✅ Backup файлы не найдены${NC}"
else
    echo "Найдены следующие файлы:"
    echo "$BACKUP_FILES"
    echo ""
    read -p "Удалить эти файлы? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        find . -type f \( -name "*.bak" -o -name "*.backup*" -o -name "* 2" \) -delete 2>/dev/null || true
        echo -e "${GREEN}✅ Backup файлы удалены${NC}"
    else
        echo -e "${YELLOW}⚠️  Backup файлы оставлены${NC}"
    fi
fi

echo ""

# ============================================================================
# 4. Обновление .gitignore
# ============================================================================

echo -e "${BLUE}📝 Шаг 4/5: Обновление .gitignore...${NC}"
echo ""

# Проверка наличия правил для backup файлов
if ! grep -q "*.bak" .gitignore; then
    echo "Добавление правил для backup файлов в .gitignore..."
    cat >> .gitignore << 'EOF'

# ==========================================
# Backup и временные файлы (добавлено автоматически)
# ==========================================
*.bak
*.backup*
*~
* 2
EOF
    echo -e "${GREEN}✅ .gitignore обновлен${NC}"
else
    echo -e "${GREEN}✅ .gitignore уже содержит правила для backup файлов${NC}"
fi

echo ""

# ============================================================================
# 5. Проверка Git history на секреты
# ============================================================================

echo -e "${BLUE}🔍 Шаг 5/5: Проверка Git history на секретные данные...${NC}"
echo ""

echo "Проверка на .env файлы в истории..."
ENV_IN_HISTORY=$(git log --all --full-history --oneline -- ".env*" 2>/dev/null | wc -l | tr -d ' ')

if [ "$ENV_IN_HISTORY" -eq "0" ]; then
    echo -e "${GREEN}✅ .env файлы не найдены в истории Git${NC}"
else
    echo -e "${RED}⚠️  ВНИМАНИЕ: Найдены .env файлы в истории Git (${ENV_IN_HISTORY} коммитов)${NC}"
    echo -e "${YELLOW}   Рекомендуется очистить историю с помощью git-filter-repo или BFG${NC}"
    echo -e "${YELLOW}   См. документацию: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository${NC}"
fi

echo ""

# ============================================================================
# Итоговый отчет
# ============================================================================

echo "============================================================================"
echo -e "${GREEN}✅ Подготовка завершена!${NC}"
echo "============================================================================"
echo ""
echo "Статус проверки:"
echo ""

# LICENSE
if [ -f "LICENSE" ]; then
    echo -e "${GREEN}✅ LICENSE: Создан${NC}"
else
    echo -e "${RED}❌ LICENSE: Отсутствует (создайте вручную!)${NC}"
fi

# Backup файлы
BACKUP_COUNT_AFTER=$(find . -name "*.bak" -o -name "*.backup*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT_AFTER" -eq "0" ]; then
    echo -e "${GREEN}✅ Backup файлы: Удалены${NC}"
else
    echo -e "${YELLOW}⚠️  Backup файлы: Осталось ${BACKUP_COUNT_AFTER}${NC}"
fi

# .gitignore
if grep -q "*.bak" .gitignore; then
    echo -e "${GREEN}✅ .gitignore: Обновлен${NC}"
else
    echo -e "${YELLOW}⚠️  .gitignore: Требует обновления${NC}"
fi

# Git history
if [ "$ENV_IN_HISTORY" -eq "0" ]; then
    echo -e "${GREEN}✅ Git history: Чист${NC}"
else
    echo -e "${RED}⚠️  Git history: Содержит .env файлы${NC}"
fi

echo ""
echo "============================================================================"
echo -e "${BLUE}📋 Следующие шаги:${NC}"
echo "============================================================================"
echo ""
echo "1. ${YELLOW}Обновите package.json:${NC}"
echo "   - Заполните поле 'author'"
echo "   - Добавьте 'repository', 'homepage', 'bugs'"
echo ""
echo "2. ${YELLOW}Замените hardcoded credentials:${NC}"
echo "   - Откройте docker-compose.yml"
echo "   - Замените 'postgres' на '\${DB_PASSWORD:-postgres}'"
echo ""
echo "3. ${YELLOW}Проверьте README.md:${NC}"
echo "   - Обновите security warning"
echo "   - Проверьте актуальность информации"
echo ""
echo "4. ${YELLOW}Commit изменения:${NC}"
echo "   git add LICENSE .gitignore"
echo "   git commit -m 'chore: prepare for publication'"
echo ""
echo "5. ${YELLOW}Проверьте перед публикацией:${NC}"
echo "   - Все тесты проходят: npm test"
echo "   - Security тесты: npm run test:security"
echo "   - Linter: npm run lint"
echo ""
echo -e "${GREEN}🎉 После выполнения этих шагов проект готов к публикации!${NC}"
echo ""
echo "Подробная информация: см. PRODUCTION-READINESS.md"
echo ""


