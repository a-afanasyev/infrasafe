module.exports = {
  "/api/analytics/transformers": {
    get: {
      summary: "Получить все трансформаторы с аналитикой",
      description: "Возвращает список трансформаторов с данными аналитики",
      tags: ["Analytics"],
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
          name: "overloaded_only",
          schema: {
            type: "boolean"
          },
          description: "Только перегруженные (>80%)"
        }
      ],
      responses: {
        "200": {
          description: "Список трансформаторов с аналитикой",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        transformer: {
                          $ref: "#/components/schemas/Transformer"
                        },
                        analytics: {
                          type: "object",
                          properties: {
                            avg_load_24h: {
                              type: "number",
                              description: "Средняя загрузка за 24 часа"
                            },
                            peak_load_24h: {
                              type: "number",
                              description: "Пиковая загрузка за 24 часа"
                            },
                            connected_buildings: {
                              type: "integer",
                              description: "Количество подключенных зданий"
                            },
                            total_power_consumption: {
                              type: "number",
                              description: "Общее потребление энергии (кВт·ч)"
                            },
                            efficiency: {
                              type: "number",
                              description: "Эффективность работы (%)"
                            }
                          }
                        }
                      }
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
  "/api/analytics/transformers/overloaded": {
    get: {
      summary: "Получить перегруженные трансформаторы",
      description: "Возвращает список перегруженных трансформаторов",
      tags: ["Analytics"],
      parameters: [
        {
          in: "query",
          name: "threshold",
          schema: {
            type: "number",
            default: 80,
            minimum: 0,
            maximum: 100
          },
          description: "Порог загрузки в %"
        }
      ],
      responses: {
        "200": {
          description: "Перегруженные трансформаторы",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        transformer: {
                          $ref: "#/components/schemas/Transformer"
                        },
                        overload_data: {
                          type: "object",
                          properties: {
                            current_load: {
                              type: "number",
                              description: "Текущая загрузка (%)"
                            },
                            duration: {
                              type: "integer",
                              description: "Длительность перегрузки (минуты)"
                            },
                            affected_buildings: {
                              type: "integer",
                              description: "Количество затронутых зданий"
                            },
                            risk_level: {
                              type: "string",
                              enum: ["low", "medium", "high"],
                              description: "Уровень риска"
                            }
                          }
                        }
                      }
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
  "/api/analytics/buildings/consumption": {
    get: {
      summary: "Анализ потребления по зданиям",
      description: "Возвращает аналитику потребления энергии по зданиям",
      tags: ["Analytics"],
      parameters: [
        {
          in: "query",
          name: "period",
          schema: {
            type: "string",
            enum: ["day", "week", "month", "year"],
            default: "month"
          },
          description: "Период анализа"
        },
        {
          in: "query",
          name: "building_id",
          schema: {
            type: "integer"
          },
          description: "ID конкретного здания (опционально)"
        }
      ],
      responses: {
        "200": {
          description: "Аналитика потребления",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      total_consumption: {
                        type: "number",
                        description: "Общее потребление (кВт·ч)"
                      },
                      average_daily: {
                        type: "number",
                        description: "Среднее дневное потребление"
                      },
                      peak_consumption: {
                        type: "number",
                        description: "Пиковое потребление"
                      },
                      consumption_by_building: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            building_id: { type: "integer" },
                            consumption: { type: "number" },
                            trend: {
                              type: "string",
                              enum: ["increasing", "stable", "decreasing"]
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}; 