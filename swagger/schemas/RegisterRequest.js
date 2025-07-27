module.exports = {
  type: "object",
  required: ["username", "password"],
  properties: {
    username: {
      type: "string",
      description: "Имя пользователя"
    },
    password: {
      type: "string",
      description: "Пароль пользователя",
      format: "password",
      minLength: 6
    },
    role: {
      type: "string",
      enum: ["user", "admin"],
      default: "user",
      description: "Роль пользователя"
    }
  }
}; 