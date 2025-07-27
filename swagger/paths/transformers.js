const Transformer = require('../schemas/Transformer');

module.exports = {
  "/api/transformers": {
    get: {
      summary: "Получить список всех трансформаторов",
      description: "Возвращает список всех трансформаторов",
      tags: ["Transformers"],
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
          name: "load_min",
          schema: {
            type: "number",
            minimum: 0,
            maximum: 100
          },
          description: "Минимальная загрузка в процентах"
        },
        {
          in: "query",
          name: "load_max",
          schema: {
            type: "number",
            minimum: 0,
            maximum: 100
          },
          description: "Максимальная загрузка в процентах"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ со списком трансформаторов",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Transformer"
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
      summary: "Создать новый трансформатор",
      description: "Создает новый трансформатор",
      tags: ["Transformers"],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Transformer"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Трансформатор успешно создан",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Transformer"
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
  "/api/transformers/{id}": {
    get: {
      summary: "Получить трансформатор по ID",
      description: "Возвращает один трансформатор по его ID",
      tags: ["Transformers"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "string"
          },
          description: "ID трансформатора"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ с информацией о трансформаторе",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Transformer"
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Трансформатор не найден"
        }
      }
    },
    put: {
      summary: "Обновить трансформатор",
      description: "Обновляет существующий трансформатор",
      tags: ["Transformers"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "string"
          },
          description: "ID трансформатора"
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Transformer"
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Трансформатор успешно обновлен",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Transformer"
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Трансформатор не найден"
        }
      }
    },
    delete: {
      summary: "Удалить трансформатор",
      description: "Удаляет трансформатор по его ID",
      tags: ["Transformers"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "string"
          },
          description: "ID трансформатора"
        }
      ],
      responses: {
        "200": {
          description: "Трансформатор успешно удален"
        },
        "404": {
          description: "Трансформатор не найден"
        }
      }
    }
  },
  "/api/transformers/search": {
    get: {
      summary: "Поиск трансформаторов в радиусе",
      description: "Находит трансформаторы в заданном радиусе от указанных координат",
      tags: ["Transformers"],
      parameters: [
        {
          in: "query",
          name: "latitude",
          required: true,
          schema: {
            type: "number",
            minimum: -90,
            maximum: 90
          },
          description: "Широта центральной точки"
        },
        {
          in: "query",
          name: "longitude",
          required: true,
          schema: {
            type: "number",
            minimum: -180,
            maximum: 180
          },
          description: "Долгота центральной точки"
        },
        {
          in: "query",
          name: "radius",
          required: true,
          schema: {
            type: "number",
            minimum: 0.1,
            maximum: 100
          },
          description: "Радиус поиска в километрах"
        }
      ],
      responses: {
        "200": {
          description: "Найденные трансформаторы с расстояниями",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      allOf: [
                        { $ref: "#/components/schemas/Transformer" },
                        {
                          type: "object",
                          properties: {
                            distance: {
                              type: "number",
                              description: "Расстояние в километрах"
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        },
        "400": {
          description: "Неверные параметры поиска"
        }
      }
    }
  }
}; 