const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const port = 8080;
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }
});

app.use(express.json());
// Настройка CORS для разрешения доступа с любого источника
app.use(cors({
    origin: '*', // Разрешить всем источникам (в продакшн лучше указать конкретные домены)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static(path.join(__dirname, "public")));

// PostgreSQL connection
const pool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "172.17.0.8", // правильный IP-адрес контейнера БД
    database: process.env.DB_NAME || "postgres", // правильное имя базы данных
    password: process.env.DB_PASSWORD || "postgres",
    port: process.env.DB_PORT || 5432,
});

// Кэш для данных (используется при недоступности БД)
let cachedMetricsData = [];
let lastCacheUpdateTime = null;

// Функция для проверки соединения с БД
async function checkDatabaseConnection() {
    try {
        const client = await pool.connect();
        client.release();
        console.log('Соединение с базой данных установлено успешно');
        return true;
    } catch (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
        return false;
    }
}

// Функция для загрузки данных из резервного источника в случае недоступности БД
async function loadFallbackData() {
    console.log('Загрузка резервных данных...');
    try {
        // Проверяем, есть ли у нас кэшированные данные и не устарели ли они
        if (cachedMetricsData.length > 0 && lastCacheUpdateTime) {
            const cacheAge = Date.now() - lastCacheUpdateTime;
            console.log(`Используем кэшированные данные (возраст: ${Math.round(cacheAge/1000)} секунд)`);
            return cachedMetricsData;
        }
        
        // Если нет кэшированных данных, пытаемся загрузить из локального файла
        try {
            const fs = require('fs');
            const fallbackDataPath = path.join(__dirname, 'data', 'fallback_metrics.json');
            
            if (fs.existsSync(fallbackDataPath)) {
                const data = JSON.parse(fs.readFileSync(fallbackDataPath, 'utf8'));
                console.log('Загружены данные из резервного файла:', fallbackDataPath);
                return data;
            }
        } catch (fsErr) {
            console.error('Ошибка при чтении резервного файла:', fsErr);
        }
        
        // Если и файл не доступен, возвращаем пустой массив
        return [];
    } catch (err) {
        console.error('Ошибка при загрузке резервных данных:', err);
        return [];
    }
}

// Функция для сохранения резервной копии данных
async function saveFallbackData(data) {
    try {
        const fs = require('fs');
        const fallbackDataPath = path.join(__dirname, 'data', 'fallback_metrics.json');
        
        // Создаем директорию, если она не существует
        if (!fs.existsSync(path.join(__dirname, 'data'))) {
            fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        }
        
        fs.writeFileSync(fallbackDataPath, JSON.stringify(data, null, 2));
        console.log('Резервная копия данных сохранена в:', fallbackDataPath);
    } catch (err) {
        console.error('Ошибка при сохранении резервной копии данных:', err);
    }
}

// WebSocket connection
io.on("connection", (socket) => {
    console.log("Клиент подключился");
    
    // Отправка начальных данных при подключении
    sendInitialData(socket);
    
    // Прослушивание событий от клиента
    socket.on("disconnect", () => {
        console.log("Клиент отключился");
    });
});

// Модифицированная функция для отправки начальных данных клиенту
async function sendInitialData(socket) {
    try {
        const dbConnected = await checkDatabaseConnection();
        
        if (dbConnected) {
            const result = await pool.query(`
                SELECT 
                    b.building_id,
                    b.name AS building_name,
                    b.latitude, 
                    b.longitude,
                    COALESCE(m.electricity_ph1, NULL) AS electricity_ph1,
                    COALESCE(m.electricity_ph2, NULL) AS electricity_ph2,
                    COALESCE(m.electricity_ph3, NULL) AS electricity_ph3,
                    COALESCE(m.cold_water_pressure, NULL) AS cold_water_pressure,
                    COALESCE(m.hot_water_in_pressure, NULL) AS hot_water_in_pressure,
                    COALESCE(m.hot_water_out_pressure, NULL) AS hot_water_out_pressure,
                    COALESCE(m.hot_water_in_temp, NULL) AS hot_water_in_temp,
                    COALESCE(m.hot_water_out_temp, NULL) AS hot_water_out_temp,
                    COALESCE(m.leak_sensor, NULL) AS leak_sensor,
                    COALESCE(m.air_temp, NULL) AS air_temp,
                    COALESCE(m.humidity, NULL) AS humidity,
                    c.controller_id
                FROM buildings b
                LEFT JOIN controllers c ON b.building_id = c.building_id
                LEFT JOIN metrics m ON c.controller_id = m.controller_id;
            `);
            
            // Кэшируем данные для использования в резервном режиме
            cachedMetricsData = result.rows;
            lastCacheUpdateTime = Date.now();
            
            // Сохраняем копию в файл для долгосрочного хранения
            saveFallbackData(result.rows);
            
            socket.emit("initialData", result.rows);
        } else {
            // Если БД недоступна, используем резервные данные
            const fallbackData = await loadFallbackData();
            socket.emit("initialData", fallbackData);
            socket.emit("connectionStatus", { status: "database_offline", message: "База данных недоступна. Используются кэшированные данные." });
        }
    } catch (err) {
        console.error("Error fetching initial data:", err);
        
        // В случае ошибки также используем резервные данные
        const fallbackData = await loadFallbackData();
        socket.emit("initialData", fallbackData);
        socket.emit("connectionStatus", { status: "error", message: "Ошибка получения данных. Используются кэшированные данные." });
    }
}

// Функция для рассылки обновлений всем подключенным клиентам
async function broadcastMetricsUpdate() {
    try {
        const dbConnected = await checkDatabaseConnection();
        
        if (dbConnected) {
            const result = await pool.query(`
                SELECT 
                    b.building_id,
                    b.name AS building_name,
                    b.latitude, 
                    b.longitude,
                    COALESCE(m.electricity_ph1, NULL) AS electricity_ph1,
                    COALESCE(m.electricity_ph2, NULL) AS electricity_ph2,
                    COALESCE(m.electricity_ph3, NULL) AS electricity_ph3,
                    COALESCE(m.cold_water_pressure, NULL) AS cold_water_pressure,
                    COALESCE(m.hot_water_in_pressure, NULL) AS hot_water_in_pressure,
                    COALESCE(m.hot_water_out_pressure, NULL) AS hot_water_out_pressure,
                    COALESCE(m.hot_water_in_temp, NULL) AS hot_water_in_temp,
                    COALESCE(m.hot_water_out_temp, NULL) AS hot_water_out_temp,
                    COALESCE(m.leak_sensor, NULL) AS leak_sensor,
                    COALESCE(m.air_temp, NULL) AS air_temp,
                    COALESCE(m.humidity, NULL) AS humidity,
                    c.controller_id
                FROM buildings b
                LEFT JOIN controllers c ON b.building_id = c.building_id
                LEFT JOIN metrics m ON c.controller_id = m.controller_id;
            `);
            
            // Обновляем кэш
            cachedMetricsData = result.rows;
            lastCacheUpdateTime = Date.now();
            
            // Сохраняем копию в файл для резервного использования
            saveFallbackData(result.rows);
            
            io.emit("metricsUpdate", result.rows);
            io.emit("connectionStatus", { status: "online", message: "Соединение с базой данных установлено." });
        } else {
            // Если БД недоступна, отправляем статус и используем кэшированные данные (если есть)
            if (cachedMetricsData.length > 0) {
                io.emit("metricsUpdate", cachedMetricsData);
            }
            io.emit("connectionStatus", { status: "database_offline", message: "База данных недоступна. Используются кэшированные данные." });
        }
    } catch (err) {
        console.error("Error broadcasting metrics update:", err);
        
        // В случае ошибки также отправляем статус
        if (cachedMetricsData.length > 0) {
            io.emit("metricsUpdate", cachedMetricsData);
        }
        io.emit("connectionStatus", { status: "error", message: "Ошибка получения данных. Используются кэшированные данные." });
    }
}

// 🔹 Get all buildings
app.get("/api/buildings", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM buildings ORDER BY building_id ASC");
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching buildings:", err);
        res.status(500).send("Database error");
    }
});

// 🔹 Get all controllers
app.get("/api/controllers", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM controllers ORDER BY serial_number ASC");
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching controllers:", err);
        res.status(500).send("Database error");
    }
});

// 🔹 Get all metrics (For Map Visualization)
app.get("/api/metrics", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.building_id,
                b.name AS building_name,
                b.latitude, 
                b.longitude,
                COALESCE(m.electricity_ph1, NULL) AS electricity_ph1,
                COALESCE(m.electricity_ph2, NULL) AS electricity_ph2,
                COALESCE(m.electricity_ph3, NULL) AS electricity_ph3,
                COALESCE(m.cold_water_pressure, NULL) AS cold_water_pressure,
                COALESCE(m.hot_water_in_pressure, NULL) AS hot_water_in_pressure,
                COALESCE(m.hot_water_out_pressure, NULL) AS hot_water_out_pressure,
                COALESCE(m.hot_water_in_temp, NULL) AS hot_water_in_temp,
                COALESCE(m.hot_water_out_temp, NULL) AS hot_water_out_temp,
                COALESCE(m.leak_sensor, NULL) AS leak_sensor,
                COALESCE(m.air_temp, NULL) AS air_temp,
                COALESCE(m.humidity, NULL) AS humidity,
                c.controller_id
            FROM buildings b
            LEFT JOIN controllers c ON b.building_id = c.building_id
            LEFT JOIN metrics m ON c.controller_id = m.controller_id;
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching metrics:", err);
        res.status(500).send("Database error");
    }
});


// 🔹 Add a new building
app.post("/api/buildings", async (req, res) => {
    const { name, address, town, latitude, longitude, management_company } = req.body;
    if (!name || !address || !latitude || !longitude) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const result = await pool.query(
            "INSERT INTO buildings (name, address, town, latitude, longitude, management_company) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [name, address, town, latitude, longitude, management_company]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error inserting building:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// 🔹 Add a new controller
app.post("/api/controllers", async (req, res) => {
    const { serial_number, vendor, model, building_id, status } = req.body;

    if (!serial_number || !building_id || !status) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const result = await pool.query(
            "INSERT INTO controllers (serial_number, vendor, model, building_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [serial_number, vendor, model, building_id, status]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error inserting controller:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// 🔹 Add a new metric (for sensors data)
app.post("/api/metrics", async (req, res) => {
    const {
        controller_id, timestamp, electricity_ph1, electricity_ph2, electricity_ph3,
        amperage_ph1, amperage_ph2, amperage_ph3,
        cold_water_pressure, cold_water_temp,
        hot_water_in_pressure, hot_water_out_pressure,
        hot_water_in_temp, hot_water_out_temp,
        leak_sensor, air_temp, humidity
    } = req.body;

    if (!controller_id || !timestamp) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const result = await pool.query(
            `INSERT INTO metrics (controller_id, timestamp, electricity_ph1, electricity_ph2, electricity_ph3, 
                                  amperage_ph1, amperage_ph2, amperage_ph3, cold_water_pressure, cold_water_temp, 
                                  hot_water_in_pressure, hot_water_out_pressure, hot_water_in_temp, hot_water_out_temp, 
                                  leak_sensor, air_temp, humidity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
            [controller_id, timestamp, electricity_ph1, electricity_ph2, electricity_ph3,
                amperage_ph1, amperage_ph2, amperage_ph3, cold_water_pressure, cold_water_temp,
                hot_water_in_pressure, hot_water_out_pressure, hot_water_in_temp, hot_water_out_temp,
                leak_sensor, air_temp, humidity]
        );
        
        // Отправляем обновление всем клиентам после добавления новых метрик
        broadcastMetricsUpdate();
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error inserting metric:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// 🔹 Delete a building
app.delete("/api/buildings/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query("DELETE FROM buildings WHERE building_id=$1 RETURNING *", [id]);

        if (result.rowCount === 0) {
            res.status(404).json({ error: "Building not found" });
        } else {
            res.json({ message: "Building deleted successfully", deleted: result.rows[0] });
        }
    } catch (err) {
        console.error("Error deleting building:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// 🔹 Delete a controller
app.delete("/api/controllers/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query("DELETE FROM controllers WHERE controller_id=$1 RETURNING *", [id]);

        if (result.rowCount === 0) {
            res.status(404).json({ error: "Controller not found" });
        } else {
            res.json({ message: "Controller deleted successfully", deleted: result.rows[0] });
        }
    } catch (err) {
        console.error("Error deleting controller:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// Настроим уведомление при изменении данных в базе
// Установим интервал для периодической проверки новых данных (если не используем триггеры в БД)
const UPDATE_INTERVAL = 30000; // 30 секунд
setInterval(broadcastMetricsUpdate, UPDATE_INTERVAL);

// Start server
server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
