const express = require('express');
const buildingController = require('../controllers/buildingController');
const router = express.Router();

/**
 * @swagger
 * /buildings:
 *   get:
 *     summary: Получить список всех зданий
 *     description: Возвращает список всех зданий с пагинацией
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Номер страницы
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Количество элементов на странице
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: building_id
 *         description: Поле для сортировки
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Порядок сортировки
 *     responses:
 *       200:
 *         description: Успешный ответ со списком зданий
 */
router.get('/', buildingController.getAllBuildings);

/**
 * @swagger
 * /buildings/{id}:
 *   get:
 *     summary: Получить здание по ID
 *     description: Возвращает одно здание по его ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID здания
 *     responses:
 *       200:
 *         description: Успешный ответ с информацией о здании
 *       404:
 *         description: Здание не найдено
 */
router.get('/:id', buildingController.getBuildingById);

/**
 * @swagger
 * /buildings:
 *   post:
 *     summary: Создать новое здание
 *     description: Создает новое здание
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - address
 *               - latitude
 *               - longitude
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       201:
 *         description: Здание успешно создано
 *       400:
 *         description: Ошибка валидации данных
 */
router.post('/', buildingController.createBuilding);

/**
 * @swagger
 * /buildings/{id}:
 *   put:
 *     summary: Обновить здание
 *     description: Обновляет существующее здание по его ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID здания
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Здание успешно обновлено
 *       404:
 *         description: Здание не найдено
 *       400:
 *         description: Ошибка валидации данных
 */
router.put('/:id', buildingController.updateBuilding);

/**
 * @swagger
 * /buildings/{id}:
 *   delete:
 *     summary: Удалить здание
 *     description: Удаляет здание по его ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID здания
 *     responses:
 *       200:
 *         description: Здание успешно удалено
 *       404:
 *         description: Здание не найдено
 *       400:
 *         description: Невозможно удалить здание с привязанными контроллерами
 */
router.delete('/:id', buildingController.deleteBuilding);

module.exports = router; 