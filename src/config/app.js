const express = require('express');
const cors = require('cors');
const path = require('path');
const errorHandler = require('../middleware/errorHandler');

const app = express();

// Настройка middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../../public')));

// Маршруты будут подключены в server.js

// Обработка ошибок
app.use(errorHandler);

module.exports = app; 