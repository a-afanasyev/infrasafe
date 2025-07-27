const Controller = require('../schemas/Controller');

module.exports = {
  "/api/controllers": {
    get: {
      summary: "Получить список всех контроллеров",
      description: "Возвращает список всех контроллеров с пагинацией",
      tags: ["Controllers"],
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
            default: "controller_id"
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
        },
        {
          in: "query",
          name: "status",
          schema: {
            type: "string",
            enum: ["online", "offline", "maintenance"]
          },
          description: "Фильтр по статусу"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ со списком контроллеров",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Controller"
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
      summary: "Создать новый контроллер",
      description: "Создает новый контроллер",
      tags: ["Controllers"],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Controller"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Контроллер успешно создан",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Controller"
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
  "/api/controllers/{id}": {
    get: {
      summary: "Получить контроллер по ID",
      description: "Возвращает один контроллер по его ID",
      tags: ["Controllers"],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID контроллера"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ с информацией о контроллере",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Controller"
                  }
                }
              }
            }
          }
        },
        "404": {
          description: "Контроллер не найден"
        }
      }
    },
    put: {
      summary: "Обновить контроллер",
      description: "Обновляет существующий контроллер по его ID",
      tags: ["Controllers"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID контроллера"
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Controller"
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Контроллер успешно обновлен",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    $ref: "#/components/schemas/Controller"
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
    },
    delete: {
      summary: "Удалить контроллер",
      description: "Удаляет контроллер по его ID",
      tags: ["Controllers"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID контроллера"
        }
      ],
      responses: {
        "200": {
          description: "Контроллер успешно удален"
        },
        "400": {
          description: "Невозможно удалить контроллер с привязанными метриками"
        },
        "404": {
          description: "Контроллер не найден"
        }
      }
    }
  },
  "/api/controllers/building/{buildingId}": {
    get: {
      summary: "Получить контроллеры по ID здания",
      description: "Возвращает список контроллеров, привязанных к зданию",
      tags: ["Controllers"],
      parameters: [
        {
          in: "path",
          name: "buildingId",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID здания"
        }
      ],
      responses: {
        "200": {
          description: "Успешный ответ со списком контроллеров",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Controller"
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
  "/api/controllers/{id}/status": {
    patch: {
      summary: "Обновить статус контроллера",
      description: "Обновляет статус существующего контроллера",
      tags: ["Controllers"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: {
            type: "integer"
          },
          description: "ID контроллера"
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: {
                  type: "string",
                  enum: ["online", "offline", "maintenance"]
                }
              }
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Статус контроллера успешно обновлен"
        },
        "400": {
          description: "Неверное значение статуса"
        },
        "404": {
          description: "Контроллер не найден"
        }
      }
    }
  }
}; 