const LoginRequest = require('../schemas/LoginRequest');
const RegisterRequest = require('../schemas/RegisterRequest');

module.exports = {
  "/api/auth/login": {
    post: {
      summary: "Авторизация пользователя",
      description: "Авторизует пользователя и возвращает JWT токен",
      tags: ["Authentication"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/LoginRequest"
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Успешная авторизация",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  token: { type: "string" },
                  refreshToken: { type: "string" }
                }
              }
            }
          }
        },
        "401": {
          description: "Неверные учетные данные"
        }
      }
    }
  },
  "/api/auth/register": {
    post: {
      summary: "Регистрация нового пользователя",
      description: "Создает нового пользователя в системе",
      tags: ["Authentication"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/RegisterRequest"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Пользователь успешно зарегистрирован"
        },
        "400": {
          description: "Ошибка валидации данных"
        },
        "409": {
          description: "Пользователь уже существует"
        }
      }
    }
  },
  "/api/auth/profile": {
    get: {
      summary: "Получить профиль текущего пользователя",
      description: "Возвращает информацию о текущем авторизованном пользователе",
      tags: ["Authentication"],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Информация о пользователе",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  username: { type: "string" },
                  role: { type: "string" },
                  created_at: { type: "string", format: "date-time" }
                }
              }
            }
          }
        },
        "401": {
          description: "Отсутствует токен авторизации"
        }
      }
    }
  },
  "/api/auth/refresh": {
    post: {
      summary: "Обновление токенов",
      description: "Обновляет access и refresh токены",
      tags: ["Authentication"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["refreshToken"],
              properties: {
                refreshToken: { type: "string" }
              }
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Токены обновлены",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  token: { type: "string" },
                  refreshToken: { type: "string" }
                }
              }
            }
          }
        },
        "401": {
          description: "Недействительный refresh токен"
        }
      }
    }
  },
  "/api/auth/logout": {
    post: {
      summary: "Выход из системы",
      description: "Выход из системы с добавлением токена в черный список",
      tags: ["Authentication"],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Успешный выход из системы"
        },
        "401": {
          description: "Отсутствует токен авторизации"
        }
      }
    }
  }
}; 