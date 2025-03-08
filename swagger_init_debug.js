
window.onload = function() {
  // Build a system
  var url = window.location.search.match(/url=([^&]+)/);
  if (url && url.length > 1) {
    url = decodeURIComponent(url[1]);
  } else {
    url = window.location.origin;
  }
  var options = {
  "swaggerDoc": {
    "openapi": "3.0.0",
    "info": {
      "title": "Infrasafe API",
      "version": "1.0.0",
      "description": "API документация для системы мониторинга зданий"
    },
    "servers": [
      {
        "url": "http://localhost:3000/api",
        "description": "Development server"
      }
    ],
    "paths": {
      "/api/buildings": {
        "get": {
          "summary": "Получить список всех зданий",
          "description": "Возвращает список всех зданий с пагинацией",
          "parameters": [
            {
              "in": "query",
              "name": "page",
              "schema": {
                "type": "integer",
                "default": 1
              },
              "description": "Номер страницы"
            },
            {
              "in": "query",
              "name": "limit",
              "schema": {
                "type": "integer",
                "default": 10
              },
              "description": "Количество элементов на странице"
            },
            {
              "in": "query",
              "name": "sort",
              "schema": {
                "type": "string",
                "default": "building_id"
              },
              "description": "Поле для сортировки"
            },
            {
              "in": "query",
              "name": "order",
              "schema": {
                "type": "string",
                "enum": [
                  "asc",
                  "desc"
                ],
                "default": "asc"
              },
              "description": "Порядок сортировки"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ со списком зданий"
            }
          }
        },
        "post": {
          "summary": "Создать новое здание",
          "description": "Создает новое здание",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": [
                    "name",
                    "address",
                    "latitude",
                    "longitude"
                  ],
                  "properties": {
                    "name": {
                      "type": "string"
                    },
                    "address": {
                      "type": "string"
                    },
                    "latitude": {
                      "type": "number"
                    },
                    "longitude": {
                      "type": "number"
                    }
                  }
                }
              }
            }
          },
          "responses": {
            "201": {
              "description": "Здание успешно создано"
            },
            "400": {
              "description": "Ошибка валидации данных"
            }
          }
        }
      },
      "/api/buildings/{id}": {
        "get": {
          "summary": "Получить здание по ID",
          "description": "Возвращает одно здание по его ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID здания"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ с информацией о здании"
            },
            "404": {
              "description": "Здание не найдено"
            }
          }
        },
        "put": {
          "summary": "Обновить здание",
          "description": "Обновляет существующее здание по его ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID здания"
            }
          ],
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "name": {
                      "type": "string"
                    },
                    "address": {
                      "type": "string"
                    },
                    "latitude": {
                      "type": "number"
                    },
                    "longitude": {
                      "type": "number"
                    }
                  }
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Здание успешно обновлено"
            },
            "400": {
              "description": "Ошибка валидации данных"
            },
            "404": {
              "description": "Здание не найдено"
            }
          }
        },
        "delete": {
          "summary": "Удалить здание",
          "description": "Удаляет здание по его ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID здания"
            }
          ],
          "responses": {
            "200": {
              "description": "Здание успешно удалено"
            },
            "400": {
              "description": "Невозможно удалить здание с привязанными контроллерами"
            },
            "404": {
              "description": "Здание не найдено"
            }
          }
        }
      },
      "/api/controllers": {
        "get": {
          "summary": "Получить список всех контроллеров",
          "description": "Возвращает список всех контроллеров с пагинацией",
          "parameters": [
            {
              "in": "query",
              "name": "page",
              "schema": {
                "type": "integer",
                "default": 1
              },
              "description": "Номер страницы"
            },
            {
              "in": "query",
              "name": "limit",
              "schema": {
                "type": "integer",
                "default": 10
              },
              "description": "Количество элементов на странице"
            },
            {
              "in": "query",
              "name": "sort",
              "schema": {
                "type": "string",
                "default": "controller_id"
              },
              "description": "Поле для сортировки"
            },
            {
              "in": "query",
              "name": "order",
              "schema": {
                "type": "string",
                "enum": [
                  "asc",
                  "desc"
                ],
                "default": "asc"
              },
              "description": "Порядок сортировки"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ со списком контроллеров"
            }
          }
        },
        "post": {
          "summary": "Создать новый контроллер",
          "description": "Создает новый контроллер",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": [
                    "name",
                    "building_id",
                    "serial_number"
                  ],
                  "properties": {
                    "name": {
                      "type": "string"
                    },
                    "building_id": {
                      "type": "integer"
                    },
                    "serial_number": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string",
                      "enum": [
                        "online",
                        "offline",
                        "maintenance"
                      ],
                      "default": "offline"
                    },
                    "firmware_version": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "responses": {
            "201": {
              "description": "Контроллер успешно создан"
            },
            "400": {
              "description": "Ошибка валидации данных"
            }
          }
        }
      },
      "/api/controllers/{id}": {
        "get": {
          "summary": "Получить контроллер по ID",
          "description": "Возвращает один контроллер по его ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID контроллера"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ с информацией о контроллере"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        },
        "put": {
          "summary": "Обновить контроллер",
          "description": "Обновляет существующий контроллер по его ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID контроллера"
            }
          ],
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "name": {
                      "type": "string"
                    },
                    "building_id": {
                      "type": "integer"
                    },
                    "serial_number": {
                      "type": "string"
                    },
                    "firmware_version": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Контроллер успешно обновлен"
            },
            "400": {
              "description": "Ошибка валидации данных"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        },
        "delete": {
          "summary": "Удалить контроллер",
          "description": "Удаляет контроллер по его ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID контроллера"
            }
          ],
          "responses": {
            "200": {
              "description": "Контроллер успешно удален"
            },
            "400": {
              "description": "Невозможно удалить контроллер с привязанными метриками"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        }
      },
      "/api/controllers/building/{buildingId}": {
        "get": {
          "summary": "Получить контроллеры по ID здания",
          "description": "Возвращает список контроллеров, привязанных к зданию",
          "parameters": [
            {
              "in": "path",
              "name": "buildingId",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID здания"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ со списком контроллеров"
            }
          }
        }
      },
      "/api/controllers/{id}/metrics": {
        "get": {
          "summary": "Получить метрики контроллера",
          "description": "Возвращает список метрик для контроллера с возможностью фильтрации по дате",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID контроллера"
            },
            {
              "in": "query",
              "name": "startDate",
              "schema": {
                "type": "string",
                "format": "date-time"
              },
              "description": "Начальная дата (ISO формат)"
            },
            {
              "in": "query",
              "name": "endDate",
              "schema": {
                "type": "string",
                "format": "date-time"
              },
              "description": "Конечная дата (ISO формат)"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ со списком метрик"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        }
      },
      "/api/controllers/{id}/status": {
        "patch": {
          "summary": "Обновить статус контроллера",
          "description": "Обновляет статус существующего контроллера",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID контроллера"
            }
          ],
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": [
                    "status"
                  ],
                  "properties": {
                    "status": {
                      "type": "string",
                      "enum": [
                        "online",
                        "offline",
                        "maintenance"
                      ]
                    }
                  }
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Статус контроллера успешно обновлен"
            },
            "400": {
              "description": "Неверное значение статуса"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        }
      },
      "/api/metrics": {
        "get": {
          "summary": "Получить список всех метрик",
          "description": "Возвращает список всех метрик с пагинацией",
          "parameters": [
            {
              "in": "query",
              "name": "page",
              "schema": {
                "type": "integer",
                "default": 1
              },
              "description": "Номер страницы"
            },
            {
              "in": "query",
              "name": "limit",
              "schema": {
                "type": "integer",
                "default": 10
              },
              "description": "Количество элементов на странице"
            },
            {
              "in": "query",
              "name": "sort",
              "schema": {
                "type": "string",
                "default": "timestamp"
              },
              "description": "Поле для сортировки"
            },
            {
              "in": "query",
              "name": "order",
              "schema": {
                "type": "string",
                "enum": [
                  "asc",
                  "desc"
                ],
                "default": "desc"
              },
              "description": "Порядок сортировки"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ со списком метрик"
            }
          }
        },
        "post": {
          "summary": "Создать новую метрику",
          "description": "Создает новую запись метрики",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": [
                    "controller_id"
                  ],
                  "properties": {
                    "controller_id": {
                      "type": "integer"
                    },
                    "temperature": {
                      "type": "number"
                    },
                    "humidity": {
                      "type": "number"
                    },
                    "pressure": {
                      "type": "number"
                    },
                    "co2_level": {
                      "type": "number"
                    },
                    "voltage": {
                      "type": "number"
                    },
                    "timestamp": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          },
          "responses": {
            "201": {
              "description": "Метрика успешно создана"
            },
            "400": {
              "description": "Ошибка валидации данных"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        }
      },
      "/api/metrics/latest": {
        "get": {
          "summary": "Получить последние метрики для всех контроллеров",
          "description": "Возвращает последние записанные метрики для каждого контроллера",
          "responses": {
            "200": {
              "description": "Успешный ответ со списком последних метрик"
            }
          }
        }
      },
      "/api/metrics/controller/{controllerId}": {
        "get": {
          "summary": "Получить метрики по ID контроллера",
          "description": "Возвращает список метрик для конкретного контроллера с возможностью фильтрации по дате",
          "parameters": [
            {
              "in": "path",
              "name": "controllerId",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID контроллера"
            },
            {
              "in": "query",
              "name": "startDate",
              "schema": {
                "type": "string",
                "format": "date-time"
              },
              "description": "Начальная дата (ISO формат)"
            },
            {
              "in": "query",
              "name": "endDate",
              "schema": {
                "type": "string",
                "format": "date-time"
              },
              "description": "Конечная дата (ISO формат)"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ со списком метрик"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        }
      },
      "/api/metrics/{id}": {
        "get": {
          "summary": "Получить метрику по ID",
          "description": "Возвращает одну метрику по ее ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID метрики"
            }
          ],
          "responses": {
            "200": {
              "description": "Успешный ответ с информацией о метрике"
            },
            "404": {
              "description": "Метрика не найдена"
            }
          }
        },
        "delete": {
          "summary": "Удалить метрику",
          "description": "Удаляет метрику по ее ID",
          "parameters": [
            {
              "in": "path",
              "name": "id",
              "required": true,
              "schema": {
                "type": "integer"
              },
              "description": "ID метрики"
            }
          ],
          "responses": {
            "200": {
              "description": "Метрика успешно удалена"
            },
            "404": {
              "description": "Метрика не найдена"
            }
          }
        }
      },
      "/api/metrics/telemetry": {
        "post": {
          "summary": "Получить телеметрию от устройства",
          "description": "Принимает данные телеметрии от контроллера и сохраняет их как метрику",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": [
                    "controller_id"
                  ],
                  "properties": {
                    "controller_id": {
                      "type": "integer"
                    },
                    "temperature": {
                      "type": "number"
                    },
                    "humidity": {
                      "type": "number"
                    },
                    "pressure": {
                      "type": "number"
                    },
                    "co2_level": {
                      "type": "number"
                    },
                    "voltage": {
                      "type": "number"
                    },
                    "timestamp": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          },
          "responses": {
            "201": {
              "description": "Телеметрия успешно получена и сохранена"
            },
            "400": {
              "description": "Ошибка валидации данных"
            },
            "404": {
              "description": "Контроллер не найден"
            }
          }
        }
      }
    },
    "components": {},
    "tags": []
  },
  "customOptions": {}
};
  url = options.swaggerUrl || url
  var urls = options.swaggerUrls
  var customOptions = options.customOptions
  var spec1 = options.swaggerDoc
  var swaggerOptions = {
    spec: spec1,
    url: url,
    urls: urls,
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout"
  }
  for (var attrname in customOptions) {
    swaggerOptions[attrname] = customOptions[attrname];
  }
  var ui = SwaggerUIBundle(swaggerOptions)

  if (customOptions.oauth) {
    ui.initOAuth(customOptions.oauth)
  }

  if (customOptions.preauthorizeApiKey) {
    const key = customOptions.preauthorizeApiKey.authDefinitionKey;
    const value = customOptions.preauthorizeApiKey.apiKeyValue;
    if (!!key && !!value) {
      const pid = setInterval(() => {
        const authorized = ui.preauthorizeApiKey(key, value);
        if(!!authorized) clearInterval(pid);
      }, 500)

    }
  }

  if (customOptions.authAction) {
    ui.authActions.authorize(customOptions.authAction)
  }

  window.ui = ui
}
