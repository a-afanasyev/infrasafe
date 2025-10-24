const Metric = require('../schemas/Metric');

module.exports = {
  "/api/metrics": {
    get: {
      summary: "Получить список всех метрик",
      description: "Возвращает список всех метрик с пагинацией",
      tags: ["Metrics"],
      parameters: [
        {
          in: "query",
          name: "page",
          schema: {
            type: "integer",
            default: 1
          },
          description: "Номер страницы"
        },
        {
          in: "query",
          name: "limit",
          schema: {
            type: "integer",
            default: 10
          },
          description: "Количество элементов на странице"
        },
        {
          in: "query",
          name: "sort",
          schema: {
            type: "string",
            default: "timestamp"
          },
          description: "Поле для сортировки"
        },
        {
          in: "query",
          name: "order",
          schema: {
            type: "string",
            enum: ["asc", "desc"],
            default: "desc"
          },
          description: "Порядок сортировки"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ со списком метрик",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Metric"
                    }
                  },
                  pagination: {
                    type: "object",
                    properties: {
                      total: { type: "integer" },
                      page: { type: "integer" },
                      pages: { type: "integer" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    post: {
      summary: "Создать новую метрику",
      description: "Создает новую запись метрики",
      tags: ["Metrics"],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Metric"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Метрика успешно создана",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Metric"
                  }
                }
              }
            }
          }
        },
        "400": {
          description: "Ошибка валидации данных"
        },
        "404": {
          description: "Контроллер не найден"
        }
      }
    }
  },
  "/api/metrics/latest": {
    get: {
      summary: "Получить последние метрики для всех контроллеров",
      description: "Возвращает последние записанные метрики для каждого контроллера",
      tags: ["Metrics"],
      responses: {
        "200": {
          description: "Успешный ответ со списком последних метрик",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Metric"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api/metrics/controller/{controllerId}/aggregated": {
    get: {
      summary: "Получить агрегированные метрики",
      description: "Возвращает агрегированные данные для контроллера за период",
      tags: ["Metrics"],
      parameters: [
        {
          in: "path",
          name: "controllerId",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID контроллера"
        },
        {
          in: "query",
          name: "timeFrame",
          required: true,
          schema: {
            type: "string",
            enum: ["hour", "day", "week", "month"]
          },
          description: "Временной интервал для агрегации"
        },
        {
          in: "query",
          name: "startDate",
          schema: {
            type: "string",
            format: "date-time"
          },
          description: "Начальная дата (ISO формат)"
        },
        {
          in: "query",
          name: "endDate",
          schema: {
            type: "string",
            format: "date-time"
          },
          description: "Конечная дата (ISO формат)"
        }
      ],
      responses: {
        "200": {
          description: "Агрегированные метрики",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      temperature: {
                        type: "object",
                        properties: {
                          avg: { type: "number" },
                          min: { type: "number" },
                          max: { type: "number" }
                        }
                      },
                      humidity: {
                        type: "object",
                        properties: {
                          avg: { type: "number" },
                          min: { type: "number" },
                          max: { type: "number" }
                        }
                      },
                      pressure: {
                        type: "object",
                        properties: {
                          avg: { type: "number" },
                          min: { type: "number" },
                          max: { type: "number" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Контроллер не найден"
        },
        "400": {
          description: "Неверные параметры запроса"
        }
      }
    }
  },
  "/api/metrics/telemetry": {
    post: {
      summary: "Получить телеметрию от устройства",
      description: "Принимает данные телеметрии от контроллера и сохраняет их как метрику",
      tags: ["Metrics", "Telemetry"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Metric"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Телеметрия успешно получена и сохранена",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Metric"
                  }
                }
              }
            }
          }
        },
        "400": {
          description: "Ошибка валидации данных"
        },
        "404": {
          description: "Контроллер не найден"
        }
      }
    }
  }
}; 