#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Скрипт для автоматического тестирования всех эндпоинтов API, описанных в Swagger.
"""

import json
import sys
import requests
import random
import datetime
import argparse
from pprint import pprint
from urllib.parse import urljoin
from termcolor import colored

# Глобальные настройки
DEFAULT_BASE_URL = "http://localhost:3000"
API_BASE_URL = None
SWAGGER_URL = None

# Хранение созданных ресурсов для использования в связанных запросах
CREATED_RESOURCES = {
    "buildings": [],
    "controllers": [],
    "metrics": []
}


def parse_arguments():
    """Парсинг аргументов командной строки."""
    parser = argparse.ArgumentParser(description='Автоматическое тестирование API по спецификации Swagger.')
    parser.add_argument('--url', default=DEFAULT_BASE_URL, help='Базовый URL API (по умолчанию: http://localhost:3000)')
    parser.add_argument('--swagger-url', help='Прямой URL к Swagger-спецификации JSON')
    parser.add_argument('--output', default='api_test_results.json', help='Файл для сохранения результатов тестирования')
    parser.add_argument('--verbose', '-v', action='store_true', help='Подробный вывод')
    parser.add_argument('--skip-errors', action='store_true', help='Продолжать тестирование при ошибках')
    
    return parser.parse_args()


def setup_global_config(args):
    """Настройка глобальной конфигурации на основе переданных аргументов."""
    global API_BASE_URL, SWAGGER_URL
    
    API_BASE_URL = args.url
    
    if args.swagger_url:
        SWAGGER_URL = args.swagger_url
    else:
        SWAGGER_URL = urljoin(API_BASE_URL, "/api-docs/swagger-ui-init.js")


def extract_swagger_json():
    """Извлекает JSON-спецификацию Swagger из JavaScript-файла."""
    # Сначала пробуем получить напрямую через /api-docs/swagger.json
    try:
        direct_url = urljoin(API_BASE_URL, "/api-docs/swagger.json")
        print(colored(f"Пробуем получить спецификацию напрямую из {direct_url}", "cyan"))
        response = requests.get(direct_url)
        if response.status_code == 200:
            try:
                swagger_spec = response.json()
                print(colored("Успешно получена спецификация из swagger.json", "green"))
                return swagger_spec
            except json.JSONDecodeError:
                print(colored("Не удалось декодировать JSON из swagger.json", "yellow"))
    except Exception as e:
        print(colored(f"Ошибка при прямом запросе swagger.json: {str(e)}", "yellow"))
    
    # Если не получилось, пробуем извлечь из swagger-ui-init.js
    print(colored("Пробуем извлечь спецификацию из swagger-ui-init.js", "cyan"))
    try:
        response = requests.get(SWAGGER_URL)
        response.raise_for_status()
        
        # Извлекаем JSON-объект из JavaScript-файла
        js_content = response.text
        start_index = js_content.find('"swaggerDoc":')
        if start_index == -1:
            print(colored("Не удалось найти спецификацию Swagger в ответе", "red"))
            return None
            
        # Извлекаем JSON-часть
        json_str = js_content[start_index + len('"swaggerDoc":'):]
        
        # Находим конец JSON-объекта (перед закрывающей скобкой window.onload...)
        end_index = json_str.find(',"customOptions"')
        if end_index == -1:
            end_index = json_str.find(',"presets"')
        if end_index == -1:
            end_index = json_str.find(',"dom_id"')
        if end_index == -1:
            # Если специфические маркеры не найдены, ищем закрывающую фигурную скобку
            # но учитываем, что могут быть вложенные скобки
            brace_count = 1
            for i, char in enumerate(json_str):
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_index = i + 1
                        break
        
        if end_index == -1:
            print(colored("Не удалось определить конец JSON-объекта", "red"))
            return None
            
        json_str = json_str[:end_index]
        
        # Парсим JSON
        swagger_spec = json.loads(json_str)
        print(colored("Успешно извлечена спецификация из swagger-ui-init.js", "green"))
        return swagger_spec
    except Exception as e:
        print(colored(f"Ошибка при получении спецификации Swagger: {str(e)}", "red"))
        # Для отладки
        try:
            print(colored(f"Начало извлеченной строки JSON: {json_str[:100]}...", "yellow"))
            print(colored(f"Конец извлеченной строки JSON: ...{json_str[-100:]}", "yellow"))
        except:
            pass
        
        # Последняя попытка - попробовать открыть файл вручную и извлечь JSON
        try:
            print(colored("Попытка извлечь JSON вручную...", "cyan"))
            # Сохраняем содержимое в файл для ручного анализа
            with open("swagger_init_debug.js", "w", encoding="utf-8") as f:
                f.write(js_content)
            print(colored("Содержимое swagger-ui-init.js сохранено в файл swagger_init_debug.js", "yellow"))
            
            # Пытаемся извлечь JSON более грубым способом
            start_marker = '"swaggerDoc":'
            start_pos = js_content.find(start_marker) + len(start_marker)
            # Ищем баланс скобок
            open_braces = 0
            json_content = ""
            capture = False
            
            for char in js_content[start_pos:]:
                if not capture and char == '{':
                    capture = True
                
                if capture:
                    json_content += char
                    if char == '{':
                        open_braces += 1
                    elif char == '}':
                        open_braces -= 1
                        if open_braces == 0:
                            break
            
            if json_content:
                swagger_spec = json.loads(json_content)
                print(colored("Успешно извлечена спецификация ручным методом!", "green"))
                return swagger_spec
        except Exception as e:
            print(colored(f"Все методы извлечения спецификации Swagger не удались: {str(e)}", "red"))
        
        return None


def generate_test_data(path, method, parameters, request_body=None):
    """Генерирует тестовые данные для запроса."""
    path_lower = path.lower()
    data = {}
    
    # Генерация данных для параметров запроса
    for param in parameters:
        if param.get("in") == "query":
            # Используем значения по умолчанию для параметров запроса
            if "default" in param.get("schema", {}):
                data[param["name"]] = param["schema"]["default"]
    
    # Генерация тела запроса для POST/PUT
    if method.lower() in ["post", "put", "patch"] and request_body:
        body_data = {}
        
        # Здания
        if "buildings" in path_lower:
            body_data = {
                "name": f"Тестовое здание {random.randint(1000, 9999)}",
                "address": f"ул. Тестовая, {random.randint(1, 100)}",
                "town": "Москва",
                "latitude": 55.751244 + random.uniform(-0.01, 0.01),
                "longitude": 37.618423 + random.uniform(-0.01, 0.01),
                "region": "Центральный",
                "management_company": "ООО Тест",
                "hot_water": random.choice([True, False])
            }
        
        # Контроллеры
        elif "controllers" in path_lower:
            building_id = 1  # По умолчанию
            if CREATED_RESOURCES["buildings"]:
                building_id = CREATED_RESOURCES["buildings"][0].get("building_id", 1)
                
            body_data = {
                "serial_number": f"SN-TEST-{random.randint(10000, 99999)}",
                "vendor": "Test Vendor",
                "model": f"Model-{random.randint(100, 999)}",
                "building_id": building_id,
                "status": random.choice(["online", "offline", "maintenance"])
            }
            
            # Для обновления статуса
            if "status" in path_lower:
                body_data = {
                    "status": random.choice(["online", "offline", "maintenance"])
                }
        
        # Метрики
        elif "metrics" in path_lower:
            controller_id = 1  # По умолчанию
            if CREATED_RESOURCES["controllers"]:
                controller_id = CREATED_RESOURCES["controllers"][0].get("controller_id", 1)
                
            timestamp = datetime.datetime.now().isoformat()
            
            body_data = {
                "controller_id": controller_id,
                "timestamp": timestamp,
                "electricity_ph1": random.uniform(210.0, 230.0),
                "electricity_ph2": random.uniform(210.0, 230.0),
                "electricity_ph3": random.uniform(210.0, 230.0),
                "amperage_ph1": random.uniform(8.0, 12.0),
                "amperage_ph2": random.uniform(8.0, 12.0),
                "amperage_ph3": random.uniform(8.0, 12.0),
                "cold_water_pressure": random.uniform(4.0, 6.0),
                "cold_water_temp": random.uniform(5.0, 15.0),
                "hot_water_in_pressure": random.uniform(4.0, 5.0),
                "hot_water_out_pressure": random.uniform(3.5, 4.5),
                "hot_water_in_temp": random.uniform(60.0, 70.0),
                "hot_water_out_temp": random.uniform(40.0, 50.0),
                "air_temp": random.uniform(18.0, 25.0),
                "humidity": random.uniform(30.0, 60.0),
                "leak_sensor": random.choice([True, False])
            }
            
            # Для телеметрии аналогичные данные
            if "telemetry" in path_lower:
                body_data = {
                    "serial_number": CREATED_RESOURCES["controllers"][0].get("serial_number", "SN-TEST-00000") if CREATED_RESOURCES["controllers"] else "SN-TEST-00000",
                    "timestamp": timestamp,
                    "metrics": {
                        "electricity_ph1": random.uniform(210.0, 230.0),
                        "electricity_ph2": random.uniform(210.0, 230.0),
                        "electricity_ph3": random.uniform(210.0, 230.0),
                        "amperage_ph1": random.uniform(8.0, 12.0),
                        "amperage_ph2": random.uniform(8.0, 12.0),
                        "amperage_ph3": random.uniform(8.0, 12.0),
                        "cold_water_pressure": random.uniform(4.0, 6.0),
                        "cold_water_temp": random.uniform(5.0, 15.0),
                        "hot_water_in_pressure": random.uniform(4.0, 5.0),
                        "hot_water_out_pressure": random.uniform(3.5, 4.5),
                        "hot_water_in_temp": random.uniform(60.0, 70.0),
                        "hot_water_out_temp": random.uniform(40.0, 50.0),
                        "air_temp": random.uniform(18.0, 25.0),
                        "humidity": random.uniform(30.0, 60.0),
                        "leak_sensor": random.choice([True, False])
                    }
                }
        
        return data, body_data
    
    return data, None


def format_path_with_params(path, path_params=None):
    """Заменяет параметры пути в URL."""
    if not path_params:
        return path
        
    for key, value in path_params.items():
        path = path.replace(f"{{{key}}}", str(value))
    
    return path


def test_endpoint(path, method_data, method):
    """Тестирует один эндпоинт и возвращает результат."""
    try:
        # Получаем параметры из swagger-спецификации
        parameters = method_data.get("parameters", [])
        request_body = method_data.get("requestBody", None)
        
        # Готовим данные для запроса
        query_params, body_data = generate_test_data(path, method, parameters, request_body)
        
        # Подготавливаем параметры пути
        path_params = {}
        for param in parameters:
            if param.get("in") == "path":
                param_name = param["name"]
                # Используем ID созданных ресурсов для параметров пути
                if "id" in param_name.lower() and "building" in param_name.lower():
                    if CREATED_RESOURCES["buildings"]:
                        path_params[param_name] = CREATED_RESOURCES["buildings"][0]["building_id"]
                    else:
                        path_params[param_name] = 1
                elif "id" in param_name.lower() and "controller" in param_name.lower():
                    if CREATED_RESOURCES["controllers"]:
                        path_params[param_name] = CREATED_RESOURCES["controllers"][0]["controller_id"]
                    else:
                        path_params[param_name] = 1
                elif "id" in param_name.lower():
                    # Общий случай для ID
                    resource_type = None
                    if "buildings" in path.lower():
                        resource_type = "buildings"
                    elif "controllers" in path.lower():
                        resource_type = "controllers"
                    elif "metrics" in path.lower():
                        resource_type = "metrics"
                    
                    if resource_type and CREATED_RESOURCES[resource_type]:
                        key = f"{resource_type[:-1]}_id"
                        path_params[param_name] = CREATED_RESOURCES[resource_type][0][key]
                    else:
                        path_params[param_name] = 1
        
        # Форматируем URL с учетом параметров пути
        formatted_path = format_path_with_params(path, path_params)
        url = urljoin(API_BASE_URL, formatted_path)
        
        # Делаем запрос к API
        response = None
        if method.lower() == "get":
            response = requests.get(url, params=query_params)
        elif method.lower() == "post":
            response = requests.post(url, params=query_params, json=body_data)
        elif method.lower() == "put":
            response = requests.put(url, params=query_params, json=body_data)
        elif method.lower() == "patch":
            response = requests.patch(url, params=query_params, json=body_data)
        elif method.lower() == "delete":
            response = requests.delete(url, params=query_params)
        
        # Проверяем ответ
        if response and 200 <= response.status_code < 300:
            status = "УСПЕХ"
            status_color = "green"
            
            # Сохраняем созданные ресурсы для использования в других тестах
            if method.lower() == "post" and response.status_code == 201:
                try:
                    resource_data = response.json()
                    if "buildings" in path.lower():
                        CREATED_RESOURCES["buildings"].append(resource_data)
                    elif "controllers" in path.lower() and "status" not in path.lower():
                        CREATED_RESOURCES["controllers"].append(resource_data)
                    elif "metrics" in path.lower() and "telemetry" not in path.lower():
                        CREATED_RESOURCES["metrics"].append(resource_data)
                except:
                    pass
        else:
            status = "ОШИБКА"
            status_color = "red"
        
        # Формируем результат тестирования
        result = {
            "path": formatted_path,
            "method": method.upper(),
            "status_code": response.status_code if response else None,
            "status": status,
            "response": response.json() if response and response.headers.get("content-type", "").startswith("application/json") else None,
            "query_params": query_params,
            "body_data": body_data
        }
        
        print(colored(f"[{status}] {method.upper()} {formatted_path} - {response.status_code if response else 'Нет ответа'}", status_color))
        return result
        
    except Exception as e:
        print(colored(f"Ошибка при тестировании {method.upper()} {path}: {str(e)}", "red"))
        return {
            "path": path,
            "method": method.upper(),
            "status": "ОШИБКА",
            "error": str(e)
        }


def run_tests(swagger_spec):
    """Запускает тесты для всех эндпоинтов из спецификации Swagger."""
    if not swagger_spec:
        return []
    
    paths = swagger_spec.get("paths", {})
    results = []
    
    # Сначала выполним GET-запросы
    for path, methods in paths.items():
        for method, method_data in methods.items():
            if method.lower() == "get":
                result = test_endpoint(path, method_data, method)
                results.append(result)
    
    # Затем POST-запросы для создания ресурсов
    for path, methods in paths.items():
        for method, method_data in methods.items():
            if method.lower() == "post":
                result = test_endpoint(path, method_data, method)
                results.append(result)
    
    # Затем PUT/PATCH-запросы для обновления ресурсов
    for path, methods in paths.items():
        for method, method_data in methods.items():
            if method.lower() in ["put", "patch"]:
                result = test_endpoint(path, method_data, method)
                results.append(result)
    
    # И наконец DELETE-запросы
    for path, methods in paths.items():
        for method, method_data in methods.items():
            if method.lower() == "delete":
                result = test_endpoint(path, method_data, method)
                results.append(result)
    
    return results


def save_test_results(results, filename="api_test_results.json"):
    """Сохраняет результаты тестирования в JSON-файл."""
    try:
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(colored(f"Результаты тестирования сохранены в файл {filename}", "green"))
    except Exception as e:
        print(colored(f"Ошибка при сохранении результатов: {str(e)}", "red"))


def calculate_statistics(results):
    """Рассчитывает статистику тестирования."""
    total = len(results)
    success = len([r for r in results if r.get("status") == "УСПЕХ"])
    failed = total - success
    
    stats = {
        "total": total,
        "success": success,
        "failed": failed,
        "success_rate": (success / total * 100) if total > 0 else 0
    }
    
    return stats


def print_statistics(stats):
    """Выводит статистику тестирования в консоль."""
    print("\n" + "=" * 50)
    print(colored("СТАТИСТИКА ТЕСТИРОВАНИЯ", "cyan"))
    print("=" * 50)
    print(f"Всего эндпоинтов: {stats['total']}")
    print(colored(f"Успешно: {stats['success']} ({stats['success_rate']:.2f}%)", "green"))
    print(colored(f"Ошибок: {stats['failed']}", "red" if stats['failed'] > 0 else "green"))
    print("=" * 50 + "\n")


def main():
    """Основная функция скрипта."""
    # Парсинг аргументов командной строки
    args = parse_arguments()
    
    # Настройка глобальной конфигурации
    setup_global_config(args)
    
    print(colored("Начинаем тестирование API через Swagger...", "cyan"))
    print(colored(f"Базовый URL API: {API_BASE_URL}", "cyan"))
    
    # Получаем спецификацию Swagger
    swagger_spec = extract_swagger_json()
    if not swagger_spec:
        print(colored("Не удалось получить спецификацию Swagger. Завершаем работу.", "red"))
        sys.exit(1)
    
    # Запускаем тесты
    print(colored("\nЗапускаем тесты для всех эндпоинтов...", "cyan"))
    results = run_tests(swagger_spec)
    
    # Рассчитываем и выводим статистику
    stats = calculate_statistics(results)
    print_statistics(stats)
    
    # Сохраняем результаты
    save_test_results(results, args.output)
    
    # Возвращаем статус выполнения
    if stats["failed"] > 0 and not args.skip_errors:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main() 