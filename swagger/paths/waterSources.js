const WaterSource = require('../schemas/WaterSource');

module.exports = {
  "/api/water-sources": {
    get: {
      summary: "Получить список источников воды",
      description: "Возвращает список всех источников воды",
      tags: ["Water Sources"],
      parameters: [
        {
          in: "query",
          name: "status",
          schema: {
            type: "string",
            enum: ["active", "maintenance", "inactive"]
          },
          description: "Фильтр по статусу"
        },
        {
          in: "query",
          name: "quality_min",
          schema: {
            type: "number",
            minimum: 0,
            maximum: 100
          },
          description: "Минимальный рейтинг качества"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ со списком источников воды",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/WaterSource"
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
      summary: "Создать новый источник воды",
      description: "Создает новый источник воды",
      tags: ["Water Sources"],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/WaterSource"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Источник воды успешно создан",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/WaterSource"
                  }
                }
              }
            }
          }
        },
        "400": {
          description: "Ошибка валидации данных"
        }
      }
    }
  },
  "/api/water-sources/{id}": {
    get: {
      summary: "Получить источник воды по ID",
      description: "Возвращает один источник воды по его ID",
      tags: ["Water Sources"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID источника воды"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ с информацией об источнике воды",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/WaterSource"
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Источник воды не найден"
        }
      }
    },
    put: {
      summary: "Обновить источник воды",
      description: "Обновляет существующий источник воды",
      tags: ["Water Sources"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID источника воды"
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/WaterSource"
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Источник воды успешно обновлен",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/WaterSource"
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Источник воды не найден"
        }
      }
    },
    delete: {
      summary: "Удалить источник воды",
      description: "Удаляет источник воды по его ID",
      tags: ["Water Sources"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID источника воды"
        }
      ],
      responses: {
        "200": {
          description: "Источник воды успешно удален"
        },
        "404": {
          description: "Источник воды не найден"
        }
      }
    }
  },
  "/api/water-sources/{id}/metrics": {
    get: {
      summary: "Получить метрики источника воды",
      description: "Возвращает текущие метрики источника воды",
      tags: ["Water Sources"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID источника воды"
        }
      ],
      responses: {
        "200": {
          description: "Метрики источника воды",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      current_flow: {
                        type: "number",
                        description: "Текущий расход воды (м³/ч)"
                      },
                      pressure: {
                        type: "number",
                        description: "Текущее давление (бар)"
                      },
                      quality_rating: {
                        type: "number",
                        description: "Текущий рейтинг качества воды"
                      },
                      efficiency: {
                        type: "number",
                        description: "Эффективность работы (%)"
                      },
                      connected_buildings: {
                        type: "integer",
                        description: "Количество подключенных зданий"
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Источник воды не найден"
        }
      }
    }
  }
}; 