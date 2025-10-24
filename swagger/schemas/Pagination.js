module.exports = {
  type: "object",
  properties: {
    total: {
      type: "integer",
      description: "Общее количество записей"
    },
    page: {
      type: "integer",
      description: "Текущая страница"
    },
    per_page: {
      type: "integer",
      description: "Количество записей на странице"
    },
    total_pages: {
      type: "integer",
      description: "Общее количество страниц"
    },
    has_next: {
      type: "boolean",
      description: "Есть ли следующая страница"
    },
    has_prev: {
      type: "boolean",
      description: "Есть ли предыдущая страница"
    }
  }
}; 