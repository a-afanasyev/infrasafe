const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");

const app = express();
const port = 8080;

app.use(express.json());
//app.use(cors());
app.use(cors({
    origin: '*', // Разрешить всем источникам (в продакшн лучше указать конкретные домены)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static(path.join(__dirname, "public")));

// PostgreSQL connection
const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "smart_building_monitoring",
    password: "postgres",
    port: 5432,
});

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

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
