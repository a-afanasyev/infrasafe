module.exports = {
  type: "object",
  required: ["name", "building_id", "serial_number"],
  properties: {
    controller_id: {
      type: "integer",
      description: "Уникальный идентификатор контроллера"
    },
    name: {
      type: "string",
      description: "Название контроллера"
    },
    building_id: {
      type: "integer",
      description: "ID здания, к которому привязан контроллер"
    },
    serial_number: {
      type: "string",
      description: "Серийный номер контроллера"
    },
    status: {
      type: "string",
      enum: ["online", "offline", "maintenance"],
      default: "offline",
      description: "Статус контроллера"
    },
    firmware_version: {
      type: "string",
      description: "Версия прошивки"
    },
    last_activity: {
      type: "string",
      format: "date-time",
      description: "Время последней активности"
    },
    created_at: {
      type: "string",
      format: "date-time",
      description: "Дата создания"
    },
    updated_at: {
      type: "string",
      format: "date-time",
      description: "Дата последнего обновления"
    }
  }
}; 