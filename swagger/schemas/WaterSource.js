module.exports = {
  type: "object",
  required: ["name", "location", "capacity"],
  properties: {
    water_source_id: {
      type: "integer",
      description: "Уникальный идентификатор источника воды"
    },
    name: {
      type: "string",
      description: "Название источника воды"
    },
    location: {
      type: "string",
      description: "Местоположение источника"
    },
    capacity: {
      type: "number",
      description: "Мощность в кубометрах в час",
      minimum: 0
    },
    current_flow: {
      type: "number",
      description: "Текущий расход воды (м³/ч)",
      minimum: 0
    },
    pressure: {
      type: "number",
      description: "Текущее давление (бар)",
      minimum: 0
    },
    quality_rating: {
      type: "number",
      description: "Рейтинг качества воды (0-100)",
      minimum: 0,
      maximum: 100
    },
    status: {
      type: "string",
      enum: ["active", "maintenance", "inactive"],
      default: "active",
      description: "Статус источника воды"
    },
    last_maintenance: {
      type: "string",
      format: "date",
      description: "Дата последнего обслуживания"
    },
    next_maintenance: {
      type: "string",
      format: "date",
      description: "Дата следующего планового обслуживания"
    },
    created_at: {
      type: "string",
      format: "date-time",
      description: "Дата создания записи"
    },
    updated_at: {
      type: "string",
      format: "date-time",
      description: "Дата последнего обновления"
    }
  }
}; 