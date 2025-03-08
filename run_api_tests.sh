#!/bin/bash

# Скрипт для запуска автоматического тестирования API

# Устанавливаем цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Анализ аргументов командной строки
URL="http://localhost:3000"
VERBOSE=""
SKIP_ERRORS=""
OUTPUT="api_test_results.json"

while [[ $# -gt 0 ]]; do
  case $1 in
    --url=*)
      URL="${1#*=}"
      shift
      ;;
    --verbose|-v)
      VERBOSE="--verbose"
      shift
      ;;
    --skip-errors)
      SKIP_ERRORS="--skip-errors"
      shift
      ;;
    --output=*)
      OUTPUT="${1#*=}"
      shift
      ;;
    *)
      echo -e "${RED}Неизвестный аргумент: $1${NC}"
      echo "Использование: $0 [--url=URL] [--verbose|-v] [--skip-errors] [--output=FILE]"
      exit 1
      ;;
  esac
done

echo -e "${YELLOW}==== Запуск автоматического тестирования API ====${NC}"
echo -e "${YELLOW}URL: ${URL}${NC}"

# Проверяем, установлен ли Python 3
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python 3 не установлен. Пожалуйста, установите Python 3 и попробуйте снова.${NC}"
    exit 1
fi

# Проверяем, есть ли файл requirements-test.txt
if [ ! -f "requirements-test.txt" ]; then
    echo -e "${RED}Файл requirements-test.txt не найден.${NC}"
    exit 1
fi

# Проверяем наличие скрипта тестирования
if [ ! -f "test_api_swagger.py" ]; then
    echo -e "${RED}Файл test_api_swagger.py не найден.${NC}"
    exit 1
fi

# Создаем виртуальное окружение, если его нет
if [ ! -d "venv_test" ]; then
    echo -e "${YELLOW}Создаем виртуальное окружение...${NC}"
    python3 -m venv venv_test
fi

# Активируем виртуальное окружение
echo -e "${YELLOW}Активируем виртуальное окружение...${NC}"
source venv_test/bin/activate

# Устанавливаем зависимости
echo -e "${YELLOW}Устанавливаем зависимости...${NC}"
pip install -r requirements-test.txt

# Делаем скрипт исполняемым
chmod +x test_api_swagger.py

# Запускаем тестирование с параметрами
echo -e "${YELLOW}Запускаем тестирование API...${NC}"
./test_api_swagger.py --url="${URL}" ${VERBOSE} ${SKIP_ERRORS} --output="${OUTPUT}"

# Сохраняем статус выполнения скрипта
TEST_STATUS=$?

# Деактивируем виртуальное окружение
deactivate

# Выводим сообщение о результате
if [ $TEST_STATUS -eq 0 ]; then
    echo -e "${GREEN}Тестирование API успешно завершено!${NC}"
else
    echo -e "${RED}Тестирование API завершено с ошибками.${NC}"
fi

# Указываем расположение файла с результатами
echo -e "${YELLOW}Результаты тестирования доступны в файле: ${OUTPUT}${NC}"

exit $TEST_STATUS 