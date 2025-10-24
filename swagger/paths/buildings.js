const Building = require('../schemas/Building');

module.exports = {
  "/api/buildings": {
    get: {
      summary: "Получить список всех зданий",
      description: "Возвращает список всех зданий с пагинацией",
      tags: ["Buildings"],
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
            default: "building_id"
          },
          description: "Поле для сортировки"
        },
        {
          in: "query",
          name: "order",
          schema: {
            type: "string",
            enum: ["asc", "desc"],
            default: "asc"
          },
          description: "Порядок сортировки"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ со списком зданий",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Building"
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
      summary: "Создать новое здание",
      description: "Создает новое здание",
      tags: ["Buildings"],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Building"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Здание успешно создано",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Building"
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
  "/api/buildings/search": {
    get: {
      summary: "Поиск зданий в радиусе",
      description: "Находит здания в заданном радиусе от указанных координат",
      tags: ["Buildings"],
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
          description: "Найденные здания с расстояниями",
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
                        { $ref: "#/components/schemas/Building" },
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
  },
  "/api/buildings/{id}": {
    get: {
      summary: "Получить здание по ID",
      description: "Возвращает одно здание по его ID",
      tags: ["Buildings"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID здания"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ с информацией о здании",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Building"
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Здание не найдено"
        }
      }
    },
    put: {
      summary: "Обновить здание",
      description: "Обновляет существующее здание по его ID",
      tags: ["Buildings"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID здания"
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Building"
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Здание успешно обновлено",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Building"
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
          description: "Здание не найдено"
        }
      }
    },
    delete: {
      summary: "Удалить здание",
      description: "Удаляет здание по его ID",
      tags: ["Buildings"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID здания"
        }
      ],
      responses: {
        "200": {
          description: "Здание успешно удалено"
        },
        "400": {
          description: "Невозможно удалить здание с привязанными контроллерами"
        },
        "404": {
          description: "Здание не найдено"
        }
      }
    }
  }
}; 