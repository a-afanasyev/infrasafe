module.exports = {
  type: "object",
  required: ["name", "address", "latitude", "longitude"],
  properties: {
    building_id: {
      type: "integer",
      description: "Уникальный идентификатор здания"
    },
    name: {
      type: "string",
      description: "Название здания"
    },
    address: {
      type: "string",
      description: "Адрес здания"
    },
    latitude: {
      type: "number",
      description: "Широта",
      minimum: -90,
      maximum: 90
    },
    longitude: {
      type: "number",
      description: "Долгота",
      minimum: -180,
      maximum: 180
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