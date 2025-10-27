import { Card } from './ui/card';
import { Book, Code, FileText, Link2, Cpu, Database, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';
import { useState } from 'react';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';

interface DocumentationPageProps {
  t: any;
}

export function DocumentationPage({ t }: DocumentationPageProps) {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const docSections = [
    {
      id: 'user-guide',
      icon: Book,
      title: t.language === 'ru' ? 'Руководство пользователя' : 
            t.language === 'en' ? 'User Guide' : 'Foydalanuvchi qo\'llanmasi',
      description: t.language === 'ru' ? 'Полное руководство по использованию платформы' : 
                   t.language === 'en' ? 'Complete guide to using the platform' : 'Platformadan foydalanish bo\'yicha to\'liq qo\'llanma',
    },
    {
      id: 'api-reference',
      icon: Code,
      title: 'API Reference',
      description: t.language === 'ru' ? 'Документация REST API для разработчиков' : 
                   t.language === 'en' ? 'REST API documentation for developers' : 'Dasturchiler uchun REST API hujjatlari',
    },
    {
      id: 'iot-integration',
      icon: Cpu,
      title: t.language === 'ru' ? 'Интеграция IoT' : 
            t.language === 'en' ? 'IoT Integration' : 'IoT integratsiyasi',
      description: t.language === 'ru' ? 'Подключение датчиков и устройств' : 
                   t.language === 'en' ? 'Connecting sensors and devices' : 'Sensorlar va qurilmalarni ulash',
    },
    {
      id: 'data-model',
      icon: Database,
      title: t.language === 'ru' ? 'Модель данных' : 
            t.language === 'en' ? 'Data Model' : 'Ma\'lumotlar modeli',
      description: t.language === 'ru' ? 'Структура и схема базы данных' : 
                   t.language === 'en' ? 'Database structure and schema' : 'Ma\'lumotlar bazasi tuzilmasi va sxemasi',
    },
    {
      id: 'sdk-libraries',
      icon: FileText,
      title: t.language === 'ru' ? 'SDK и библиотеки' : 
            t.language === 'en' ? 'SDK & Libraries' : 'SDK va kutubxonalar',
      description: t.language === 'ru' ? 'Готовые решения для быстрой интеграции' : 
                   t.language === 'en' ? 'Ready-made solutions for quick integration' : 'Tez integratsiya uchun tayyor yechimlar',
    },
    {
      id: 'webhooks',
      icon: Link2,
      title: t.language === 'ru' ? 'Webhooks' : 
            t.language === 'en' ? 'Webhooks' : 'Webhooks',
      description: t.language === 'ru' ? 'Настройка уведомлений в реальном времени' : 
                   t.language === 'en' ? 'Setting up real-time notifications' : 'Real vaqt xabarnomalarini sozlash',
    },
  ];

  // Detailed content for each section
  const getDetailedContent = (sectionId: string) => {
    const content: any = {
      'user-guide': {
        ru: {
          title: 'Руководство пользователя',
          intro: 'Добро пожаловать в InfraSafe! Это руководство поможет вам освоить все возможности платформы.',
          sections: [
            {
              title: 'Начало работы',
              content: [
                'Войдите в систему используя свои учетные данные или используйте гостевой режим для ознакомления',
                'После входа вы увидите главную панель управления с интерактивной картой',
                'Используйте панель фильтров слева для поиска и фильтрации объектов',
                'Кликните на маркер на карте, чтобы увидеть детальную информацию об объекте'
              ]
            },
            {
              title: 'Работа с картой',
              content: [
                'Используйте колесико мыши для масштабирования карты',
                'Перетаскивайте карту, удерживая левую кнопку мыши',
                'Цвет маркера показывает статус объекта: 🟢 нормально, 🟠 внимание, 🔴 ошибка',
                'Нажмите на маркер, чтобы открыть всплывающее окно с информацией'
              ]
            },
            {
              title: 'Фильтрация данных',
              content: [
                'Используйте поиск по адресу для быстрого нахождения нужного объекта',
                'Выберите статус в фильтрах, чтобы показать только объекты с определенным состоянием',
                'Счетчики показывают количество объектов в каждой категории',
                'Кнопка "Обновить данные" загружает актуальную информацию с сервера'
              ]
            },
            {
              title: 'Профиль и настройки',
              content: [
                'Перейдите в раздел "Профиль" для управления своими данными',
                'В разделе "Настройки" можно настроить уведомления и API ключи',
                'Используйте переключатель темы для смены между светлой и темной темой',
                'Выберите предпочитаемый язык интерфейса: русский, английский или узбекский'
              ]
            }
          ]
        },
        en: {
          title: 'User Guide',
          intro: 'Welcome to InfraSafe! This guide will help you master all the features of the platform.',
          sections: [
            {
              title: 'Getting Started',
              content: [
                'Log in using your credentials or use guest mode to explore',
                'After logging in, you will see the main dashboard with an interactive map',
                'Use the filter panel on the left to search and filter objects',
                'Click on a marker on the map to see detailed information about the object'
              ]
            },
            {
              title: 'Working with the Map',
              content: [
                'Use the mouse wheel to zoom the map',
                'Drag the map by holding the left mouse button',
                'Marker color shows object status: 🟢 normal, 🟠 warning, 🔴 error',
                'Click on a marker to open a popup with information'
              ]
            },
            {
              title: 'Data Filtering',
              content: [
                'Use address search to quickly find the desired object',
                'Select a status in filters to show only objects with a certain state',
                'Counters show the number of objects in each category',
                'The "Refresh Data" button loads current information from the server'
              ]
            },
            {
              title: 'Profile and Settings',
              content: [
                'Go to the "Profile" section to manage your data',
                'In the "Settings" section, you can configure notifications and API keys',
                'Use the theme switcher to toggle between light and dark themes',
                'Select your preferred interface language: Russian, English, or Uzbek'
              ]
            }
          ]
        },
        uz: {
          title: 'Foydalanuvchi qo\'llanmasi',
          intro: 'InfraSafe ga xush kelibsiz! Ushbu qo\'llanma sizga platformaning barcha imkoniyatlarini o\'rganishga yordam beradi.',
          sections: [
            {
              title: 'Boshlash',
              content: [
                'O\'z hisobingiz bilan kiring yoki tanishish uchun mehmon rejimidan foydalaning',
                'Kirgandan so\'ng, interaktiv xarita bilan asosiy boshqaruv panelini ko\'rasiz',
                'Obyektlarni qidirish va filtrlash uchun chapdagi filtr panelidan foydalaning',
                'Obyekt haqida batafsil ma\'lumot olish uchun xaritadagi belgilarga bosing'
              ]
            },
            {
              title: 'Xarita bilan ishlash',
              content: [
                'Xaritani kattalashtirish uchun sichqoncha g\'ildiragidan foydalaning',
                'Chap tugmani bosib turgan holda xaritani suring',
                'Belgi rangi obyekt holatini ko\'rsatadi: 🟢 normal, 🟠 ogohlantirish, 🔴 xatolik',
                'Ma\'lumot oynasini ochish uchun belgilarga bosing'
              ]
            },
            {
              title: 'Ma\'lumotlarni filtrlash',
              content: [
                'Kerakli obyektni tez topish uchun manzil bo\'yicha qidiruvdan foydalaning',
                'Faqat ma\'lum holatdagi obyektlarni ko\'rsatish uchun filtrlarda holatni tanlang',
                'Hisoblagichlar har bir kategoriyada obyektlar sonini ko\'rsatadi',
                '"Ma\'lumotlarni yangilash" tugmasi serverdan joriy ma\'lumotlarni yuklaydi'
              ]
            },
            {
              title: 'Profil va sozlamalar',
              content: [
                'Ma\'lumotlaringizni boshqarish uchun "Profil" bo\'limiga o\'ting',
                '"Sozlamalar" bo\'limida bildirishnomalar va API kalitlarini sozlash mumkin',
                'Yorug\' va qorong\'i mavzular o\'rtasida almashtirish uchun mavzu tugmasidan foydalaning',
                'Interfeys tilini tanlang: rus, ingliz yoki o\'zbek'
              ]
            }
          ]
        }
      },
      'api-reference': {
        ru: {
          title: 'API Reference',
          intro: 'InfraSafe предоставляет REST API для интеграции с вашими приложениями и сервисами.',
          sections: [
            {
              title: 'Аутентификация',
              content: [
                'Все API запросы требуют API ключ в заголовке Authorization',
                'Формат: Authorization: Bearer YOUR_API_KEY',
                'API ключи можно создать в разделе Настройки → API ключи',
                'Храните ключи в безопасности и никогда не публикуйте их в открытом доступе'
              ]
            },
            {
              title: 'Основные эндпоинты',
              endpoints: [
                { method: 'GET', path: '/api/buildings', description: 'Получить список всех зданий' },
                { method: 'GET', path: '/api/buildings/{id}', description: 'Получить информацию о конкретном здании' },
                { method: 'GET', path: '/api/sensors', description: 'Получить данные со всех датчиков' },
                { method: 'GET', path: '/api/sensors/{id}', description: 'Получить данные с конкретного датчика' },
                { method: 'POST', path: '/api/alerts', description: 'Создать новое оповещение' },
                { method: 'GET', path: '/api/alerts', description: 'Получить список оповещений' },
              ]
            },
            {
              title: 'Пример запроса',
              code: `// Получение списка зданий
fetch('https://api.infrasafe.io/buildings', {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => {
  console.log('Здания:', data);
})
.catch(error => {
  console.error('Ошибка:', error);
});`
            },
            {
              title: 'Ограничения',
              content: [
                'Максимум 1000 запросов в час на один API ключ',
                'Размер ответа ограничен 10 МБ',
                'Используйте пагинацию для больших наборов данных',
                'При превышении лимита вы получите статус 429 (Too Many Requests)'
              ]
            }
          ]
        },
        en: {
          title: 'API Reference',
          intro: 'InfraSafe provides a REST API for integration with your applications and services.',
          sections: [
            {
              title: 'Authentication',
              content: [
                'All API requests require an API key in the Authorization header',
                'Format: Authorization: Bearer YOUR_API_KEY',
                'API keys can be created in Settings → API Keys',
                'Keep keys secure and never publish them publicly'
              ]
            },
            {
              title: 'Main Endpoints',
              endpoints: [
                { method: 'GET', path: '/api/buildings', description: 'Get list of all buildings' },
                { method: 'GET', path: '/api/buildings/{id}', description: 'Get information about a specific building' },
                { method: 'GET', path: '/api/sensors', description: 'Get data from all sensors' },
                { method: 'GET', path: '/api/sensors/{id}', description: 'Get data from a specific sensor' },
                { method: 'POST', path: '/api/alerts', description: 'Create a new alert' },
                { method: 'GET', path: '/api/alerts', description: 'Get list of alerts' },
              ]
            },
            {
              title: 'Request Example',
              code: `// Getting list of buildings
fetch('https://api.infrasafe.io/buildings', {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => {
  console.log('Buildings:', data);
})
.catch(error => {
  console.error('Error:', error);
});`
            },
            {
              title: 'Limits',
              content: [
                'Maximum 1000 requests per hour per API key',
                'Response size limited to 10 MB',
                'Use pagination for large datasets',
                'Exceeding the limit will result in 429 (Too Many Requests) status'
              ]
            }
          ]
        },
        uz: {
          title: 'API Reference',
          intro: 'InfraSafe ilovalaringiz va xizmatlaringiz bilan integratsiya uchun REST API taqdim etadi.',
          sections: [
            {
              title: 'Autentifikatsiya',
              content: [
                'Barcha API so\'rovlar Authorization sarlavhasida API kalitini talab qiladi',
                'Format: Authorization: Bearer YOUR_API_KEY',
                'API kalitlarini Sozlamalar → API kalitlar bo\'limida yaratish mumkin',
                'Kalitlarni xavfsiz saqlang va hech qachon oshkor nashr qilmang'
              ]
            },
            {
              title: 'Asosiy endpointlar',
              endpoints: [
                { method: 'GET', path: '/api/buildings', description: 'Barcha binolar ro\'yxatini olish' },
                { method: 'GET', path: '/api/buildings/{id}', description: 'Muayyan bino haqida ma\'lumot olish' },
                { method: 'GET', path: '/api/sensors', description: 'Barcha sensorlardan ma\'lumot olish' },
                { method: 'GET', path: '/api/sensors/{id}', description: 'Muayyan sensordan ma\'lumot olish' },
                { method: 'POST', path: '/api/alerts', description: 'Yangi ogohlantirish yaratish' },
                { method: 'GET', path: '/api/alerts', description: 'Ogohlantirishlar ro\'yxatini olish' },
              ]
            },
            {
              title: 'So\'rov namunasi',
              code: `// Binolar ro'yxatini olish
fetch('https://api.infrasafe.io/buildings', {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => {
  console.log('Binolar:', data);
})
.catch(error => {
  console.error('Xatolik:', error);
});`
            },
            {
              title: 'Cheklovlar',
              content: [
                'Bir API kalit uchun soatiga maksimal 1000 so\'rov',
                'Javob hajmi 10 MB bilan cheklangan',
                'Katta ma\'lumotlar to\'plamlari uchun paginatsiyadan foydalaning',
                'Limitdan oshsa 429 (Too Many Requests) statusini olasiz'
              ]
            }
          ]
        }
      },
      'iot-integration': {
        ru: {
          title: 'Интеграция IoT',
          intro: 'Подключите свои IoT устройства и датчики к платформе InfraSafe для мониторинга в реальном времени.',
          sections: [
            {
              title: 'Поддерживаемые протоколы',
              content: [
                'MQTT - для легковесной двунаправленной связи',
                'HTTP/HTTPS - для REST API интеграции',
                'WebSocket - для данных в реальном времени',
                'CoAP - для устройств с ограниченными ресурсами'
              ]
            },
            {
              title: 'Настройка MQTT',
              content: [
                'MQTT брокер: mqtt.infrasafe.io:1883 (для SSL: 8883)',
                'Формат топика: infrasafe/{building_id}/{sensor_type}',
                'Используйте API ключ как username и password',
                'Формат сообщений: JSON с timestamp и значениями'
              ]
            },
            {
              title: 'Типы датчиков',
              content: [
                'Температура - диапазон -40°C до +85°C',
                'Влажность - диапазон 0% до 100%',
                'Давление - диапазон 300 до 1100 гПа',
                'Утечка воды - булево значение (да/нет)',
                'Утечка газа - концентрация в ppm',
                'Электропитание - напряжение и ток'
              ]
            },
            {
              title: 'Пример отправки данных',
              code: `// MQTT публикация данных датчика
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://mqtt.infrasafe.io', {
  username: 'YOUR_API_KEY',
  password: 'YOUR_API_KEY'
});

client.on('connect', () => {
  const topic = 'infrasafe/building_123/temperature';
  const data = {
    timestamp: Date.now(),
    value: 22.5,
    unit: 'celsius'
  };
  client.publish(topic, JSON.stringify(data));
});`
            }
          ]
        },
        en: {
          title: 'IoT Integration',
          intro: 'Connect your IoT devices and sensors to the InfraSafe platform for real-time monitoring.',
          sections: [
            {
              title: 'Supported Protocols',
              content: [
                'MQTT - for lightweight bidirectional communication',
                'HTTP/HTTPS - for REST API integration',
                'WebSocket - for real-time data',
                'CoAP - for resource-constrained devices'
              ]
            },
            {
              title: 'MQTT Setup',
              content: [
                'MQTT broker: mqtt.infrasafe.io:1883 (for SSL: 8883)',
                'Topic format: infrasafe/{building_id}/{sensor_type}',
                'Use API key as username and password',
                'Message format: JSON with timestamp and values'
              ]
            },
            {
              title: 'Sensor Types',
              content: [
                'Temperature - range -40°C to +85°C',
                'Humidity - range 0% to 100%',
                'Pressure - range 300 to 1100 hPa',
                'Water leak - boolean value (yes/no)',
                'Gas leak - concentration in ppm',
                'Power supply - voltage and current'
              ]
            },
            {
              title: 'Data Sending Example',
              code: `// MQTT sensor data publishing
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://mqtt.infrasafe.io', {
  username: 'YOUR_API_KEY',
  password: 'YOUR_API_KEY'
});

client.on('connect', () => {
  const topic = 'infrasafe/building_123/temperature';
  const data = {
    timestamp: Date.now(),
    value: 22.5,
    unit: 'celsius'
  };
  client.publish(topic, JSON.stringify(data));
});`
            }
          ]
        },
        uz: {
          title: 'IoT integratsiyasi',
          intro: 'IoT qurilmalaringiz va sensorlaringizni real vaqtda monitoring qilish uchun InfraSafe platformasiga ulang.',
          sections: [
            {
              title: 'Qo\'llab-quvvatlanadigan protokollar',
              content: [
                'MQTT - yengil ikki tomonlama aloqa uchun',
                'HTTP/HTTPS - REST API integratsiyasi uchun',
                'WebSocket - real vaqt ma\'lumotlari uchun',
                'CoAP - resurslar cheklangan qurilmalar uchun'
              ]
            },
            {
              title: 'MQTT sozlash',
              content: [
                'MQTT broker: mqtt.infrasafe.io:1883 (SSL uchun: 8883)',
                'Mavzu formati: infrasafe/{building_id}/{sensor_type}',
                'API kalitini username va password sifatida ishlating',
                'Xabar formati: timestamp va qiymatlar bilan JSON'
              ]
            },
            {
              title: 'Sensor turlari',
              content: [
                'Harorat - diapazon -40°C dan +85°C gacha',
                'Namlik - diapazon 0% dan 100% gacha',
                'Bosim - diapazon 300 dan 1100 gPa gacha',
                'Suv oqishi - mantiqiy qiymat (ha/yo\'q)',
                'Gaz oqishi - ppm da konsentratsiya',
                'Elektr ta\'minoti - kuchlanish va tok'
              ]
            },
            {
              title: 'Ma\'lumot yuborish namunasi',
              code: `// MQTT sensor ma'lumotlarini nashr qilish
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://mqtt.infrasafe.io', {
  username: 'YOUR_API_KEY',
  password: 'YOUR_API_KEY'
});

client.on('connect', () => {
  const topic = 'infrasafe/building_123/temperature';
  const data = {
    timestamp: Date.now(),
    value: 22.5,
    unit: 'celsius'
  };
  client.publish(topic, JSON.stringify(data));
});`
            }
          ]
        }
      },
      'data-model': {
        ru: {
          title: 'Модель данных',
          intro: 'Понимание структуры данных InfraSafe поможет вам эффективно работать с API и интеграциями.',
          sections: [
            {
              title: 'Основные сущности',
              content: [
                'Building - здание с базовой информацией и местоположением',
                'Sensor - датчик, привязанный к зданию',
                'Alert - оповещение о событии или проблеме',
                'User - пользователь системы с ролями и правами'
              ]
            },
            {
              title: 'Структура Building',
              code: `{
  "id": "building_123",
  "address": "ул. Амира Темура, 12",
  "city": "Ташкент",
  "coordinates": {
    "lat": 41.311081,
    "lng": 69.240562
  },
  "status": "normal",
  "apartments": 120,
  "residents": 450,
  "createdAt": "2023-01-15T10:30:00Z",
  "updatedAt": "2025-10-23T14:32:00Z"
}`
            },
            {
              title: 'Структура Sensor',
              code: `{
  "id": "sensor_456",
  "buildingId": "building_123",
  "type": "temperature",
  "value": 22.5,
  "unit": "celsius",
  "status": "active",
  "lastUpdate": "2025-10-23T14:32:00Z",
  "threshold": {
    "min": 18,
    "max": 26
  }
}`
            },
            {
              title: 'Связи между сущностями',
              content: [
                'Одно здание может иметь множество датчиков',
                'Датчики генерируют оповещения при превышении порогов',
                'Пользователи могут иметь доступ к определенным зданиям',
                'Все изменения логируются для аудита'
              ]
            }
          ]
        },
        en: {
          title: 'Data Model',
          intro: 'Understanding the InfraSafe data structure will help you work effectively with the API and integrations.',
          sections: [
            {
              title: 'Main Entities',
              content: [
                'Building - building with basic information and location',
                'Sensor - sensor attached to a building',
                'Alert - notification about an event or problem',
                'User - system user with roles and permissions'
              ]
            },
            {
              title: 'Building Structure',
              code: `{
  "id": "building_123",
  "address": "Amir Temur St., 12",
  "city": "Tashkent",
  "coordinates": {
    "lat": 41.311081,
    "lng": 69.240562
  },
  "status": "normal",
  "apartments": 120,
  "residents": 450,
  "createdAt": "2023-01-15T10:30:00Z",
  "updatedAt": "2025-10-23T14:32:00Z"
}`
            },
            {
              title: 'Sensor Structure',
              code: `{
  "id": "sensor_456",
  "buildingId": "building_123",
  "type": "temperature",
  "value": 22.5,
  "unit": "celsius",
  "status": "active",
  "lastUpdate": "2025-10-23T14:32:00Z",
  "threshold": {
    "min": 18,
    "max": 26
  }
}`
            },
            {
              title: 'Entity Relationships',
              content: [
                'One building can have multiple sensors',
                'Sensors generate alerts when thresholds are exceeded',
                'Users can have access to specific buildings',
                'All changes are logged for audit'
              ]
            }
          ]
        },
        uz: {
          title: 'Ma\'lumotlar modeli',
          intro: 'InfraSafe ma\'lumotlar tuzilmasini tushunish API va integratsiyalar bilan samarali ishlashga yordam beradi.',
          sections: [
            {
              title: 'Asosiy obyektlar',
              content: [
                'Building - asosiy ma\'lumot va joylashuv bilan bino',
                'Sensor - binoga biriktirilgan sensor',
                'Alert - voqea yoki muammo haqida xabarnoma',
                'User - rollar va ruxsatlarga ega tizim foydalanuvchisi'
              ]
            },
            {
              title: 'Building tuzilmasi',
              code: `{
  "id": "building_123",
  "address": "Amir Temur ko'chasi, 12",
  "city": "Toshkent",
  "coordinates": {
    "lat": 41.311081,
    "lng": 69.240562
  },
  "status": "normal",
  "apartments": 120,
  "residents": 450,
  "createdAt": "2023-01-15T10:30:00Z",
  "updatedAt": "2025-10-23T14:32:00Z"
}`
            },
            {
              title: 'Sensor tuzilmasi',
              code: `{
  "id": "sensor_456",
  "buildingId": "building_123",
  "type": "temperature",
  "value": 22.5,
  "unit": "celsius",
  "status": "active",
  "lastUpdate": "2025-10-23T14:32:00Z",
  "threshold": {
    "min": 18,
    "max": 26
  }
}`
            },
            {
              title: 'Obyektlar o\'rtasidagi aloqalar',
              content: [
                'Bitta binoda ko\'plab sensorlar bo\'lishi mumkin',
                'Sensorlar chegaralar oshganda ogohlantirishlar yaratadi',
                'Foydalanuvchilar ma\'lum binolarga kirish huquqiga ega bo\'lishi mumkin',
                'Barcha o\'zgarishlar audit uchun qayd etiladi'
              ]
            }
          ]
        }
      },
      'sdk-libraries': {
        ru: {
          title: 'SDK и библиотеки',
          intro: 'Используйте готовые SDK для быстрой интеграции InfraSafe в ваши проекты.',
          sections: [
            {
              title: 'JavaScript/TypeScript SDK',
              content: [
                'Установка: npm install @infrasafe/sdk',
                'Полная типизация для TypeScript',
                'Поддержка async/await',
                'Автоматическая обработка ошибок и повторные попытки'
              ]
            },
            {
              title: 'Пример использования JavaScript SDK',
              code: `import InfraSafe from '@infrasafe/sdk';

const client = new InfraSafe({
  apiKey: 'YOUR_API_KEY'
});

// Получить список зданий
const buildings = await client.buildings.list();

// Получить данные датчика
const sensor = await client.sensors.get('sensor_123');

// Подписка на обновления в реальном времени
client.on('sensor:update', (data) => {
  console.log('Новые данные:', data);
});`
            },
            {
              title: 'Python SDK',
              content: [
                'Установка: pip install infrasafe',
                'Совместимость с Python 3.7+',
                'Асинхронная и синхронная версии',
                'Интеграция с pandas для анализа данных'
              ]
            },
            {
              title: 'Пример использования Python SDK',
              code: `from infrasafe import InfraSafe

client = InfraSafe(api_key='YOUR_API_KEY')

# Получить список зданий
buildings = client.buildings.list()

# Получить данные датчика
sensor = client.sensors.get('sensor_123')

# Создать оповещение
alert = client.alerts.create(
    building_id='building_123',
    type='temperature',
    message='Высокая температура'
)`
            },
            {
              title: 'Мобильные SDK',
              content: [
                'iOS SDK - Swift и Objective-C',
                'Android SDK - Kotlin и Java',
                'React Native SDK - кроссплатформенная разработка',
                'Flutter SDK - для iOS и Android одновременно'
              ]
            }
          ]
        },
        en: {
          title: 'SDK & Libraries',
          intro: 'Use ready-made SDKs for quick integration of InfraSafe into your projects.',
          sections: [
            {
              title: 'JavaScript/TypeScript SDK',
              content: [
                'Installation: npm install @infrasafe/sdk',
                'Full typing for TypeScript',
                'async/await support',
                'Automatic error handling and retries'
              ]
            },
            {
              title: 'JavaScript SDK Usage Example',
              code: `import InfraSafe from '@infrasafe/sdk';

const client = new InfraSafe({
  apiKey: 'YOUR_API_KEY'
});

// Get buildings list
const buildings = await client.buildings.list();

// Get sensor data
const sensor = await client.sensors.get('sensor_123');

// Subscribe to real-time updates
client.on('sensor:update', (data) => {
  console.log('New data:', data);
});`
            },
            {
              title: 'Python SDK',
              content: [
                'Installation: pip install infrasafe',
                'Compatible with Python 3.7+',
                'Async and sync versions',
                'Integration with pandas for data analysis'
              ]
            },
            {
              title: 'Python SDK Usage Example',
              code: `from infrasafe import InfraSafe

client = InfraSafe(api_key='YOUR_API_KEY')

# Get buildings list
buildings = client.buildings.list()

# Get sensor data
sensor = client.sensors.get('sensor_123')

# Create alert
alert = client.alerts.create(
    building_id='building_123',
    type='temperature',
    message='High temperature'
)`
            },
            {
              title: 'Mobile SDKs',
              content: [
                'iOS SDK - Swift and Objective-C',
                'Android SDK - Kotlin and Java',
                'React Native SDK - cross-platform development',
                'Flutter SDK - for iOS and Android simultaneously'
              ]
            }
          ]
        },
        uz: {
          title: 'SDK va kutubxonalar',
          intro: 'InfraSafe ni loyihalaringizga tez integratsiya qilish uchun tayyor SDK lardan foydalaning.',
          sections: [
            {
              title: 'JavaScript/TypeScript SDK',
              content: [
                'O\'rnatish: npm install @infrasafe/sdk',
                'TypeScript uchun to\'liq tip belgilash',
                'async/await qo\'llab-quvvatlash',
                'Avtomatik xatolarni qayta ishlash va takrorlash'
              ]
            },
            {
              title: 'JavaScript SDK dan foydalanish namunasi',
              code: `import InfraSafe from '@infrasafe/sdk';

const client = new InfraSafe({
  apiKey: 'YOUR_API_KEY'
});

// Binolar ro'yxatini olish
const buildings = await client.buildings.list();

// Sensor ma'lumotlarini olish
const sensor = await client.sensors.get('sensor_123');

// Real vaqt yangilanishlariga obuna bo'lish
client.on('sensor:update', (data) => {
  console.log('Yangi ma\\'lumot:', data);
});`
            },
            {
              title: 'Python SDK',
              content: [
                'O\'rnatish: pip install infrasafe',
                'Python 3.7+ bilan mos',
                'Asinxron va sinxron versiyalar',
                'Ma\'lumotlarni tahlil qilish uchun pandas bilan integratsiya'
              ]
            },
            {
              title: 'Python SDK dan foydalanish namunasi',
              code: `from infrasafe import InfraSafe

client = InfraSafe(api_key='YOUR_API_KEY')

# Binolar ro'yxatini olish
buildings = client.buildings.list()

# Sensor ma'lumotlarini olish
sensor = client.sensors.get('sensor_123')

# Ogohlantirish yaratish
alert = client.alerts.create(
    building_id='building_123',
    type='temperature',
    message='Yuqori harorat'
)`
            },
            {
              title: 'Mobil SDK lar',
              content: [
                'iOS SDK - Swift va Objective-C',
                'Android SDK - Kotlin va Java',
                'React Native SDK - krossplatforma ishlab chiqish',
                'Flutter SDK - iOS va Android uchun bir vaqtda'
              ]
            }
          ]
        }
      },
      'webhooks': {
        ru: {
          title: 'Webhooks',
          intro: 'Настройте webhooks для получения уведомлений о событиях в реальном времени.',
          sections: [
            {
              title: 'Что такое Webhooks',
              content: [
                'Webhooks - это HTTP колбэки, которые срабатывают при определенных событиях',
                'InfraSafe отправляет POST запрос на ваш URL при событии',
                'Полезно для интеграции с внешними системами',
                'Гарантированная доставка с повторными попытками'
              ]
            },
            {
              title: 'Настройка Webhook',
              content: [
                'Перейдите в Настройки → Webhooks',
                'Нажмите "Создать webhook"',
                'Укажите URL для получения уведомлений',
                'Выберите события, на которые хотите подписаться',
                'Сохраните секретный ключ для верификации запросов'
              ]
            },
            {
              title: 'Поддерживаемые события',
              content: [
                'sensor.update - обновление данных датчика',
                'alert.created - создание нового оповещения',
                'alert.resolved - решение оповещения',
                'building.status_changed - изменение статуса здания',
                'sensor.offline - датчик перешел в офлайн',
                'sensor.online - датчик вернулся в онлайн'
              ]
            },
            {
              title: 'Пример webhook обработчика',
              code: `const express = require('express');
const crypto = require('crypto');

app.post('/webhook', (req, res) => {
  // Верификация подписи
  const signature = req.headers['x-infrasafe-signature'];
  const payload = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', 'YOUR_WEBHOOK_SECRET')
    .update(payload)
    .digest('hex');
  
  if (signature !== hash) {
    return res.status(401).send('Invalid signature');
  }
  
  // Обработка события
  const { event, data } = req.body;
  console.log('Событие:', event, data);
  
  res.status(200).send('OK');
});`
            },
            {
              title: 'Формат webhook запроса',
              code: `{
  "event": "sensor.update",
  "timestamp": "2025-10-23T14:32:00Z",
  "data": {
    "sensorId": "sensor_123",
    "buildingId": "building_456",
    "type": "temperature",
    "value": 28.5,
    "unit": "celsius",
    "status": "warning"
  }
}`
            }
          ]
        },
        en: {
          title: 'Webhooks',
          intro: 'Set up webhooks to receive real-time event notifications.',
          sections: [
            {
              title: 'What are Webhooks',
              content: [
                'Webhooks are HTTP callbacks that trigger on specific events',
                'InfraSafe sends a POST request to your URL when an event occurs',
                'Useful for integration with external systems',
                'Guaranteed delivery with retries'
              ]
            },
            {
              title: 'Setting up a Webhook',
              content: [
                'Go to Settings → Webhooks',
                'Click "Create webhook"',
                'Specify URL to receive notifications',
                'Select events you want to subscribe to',
                'Save the secret key for request verification'
              ]
            },
            {
              title: 'Supported Events',
              content: [
                'sensor.update - sensor data update',
                'alert.created - new alert created',
                'alert.resolved - alert resolved',
                'building.status_changed - building status changed',
                'sensor.offline - sensor went offline',
                'sensor.online - sensor came back online'
              ]
            },
            {
              title: 'Webhook Handler Example',
              code: `const express = require('express');
const crypto = require('crypto');

app.post('/webhook', (req, res) => {
  // Signature verification
  const signature = req.headers['x-infrasafe-signature'];
  const payload = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', 'YOUR_WEBHOOK_SECRET')
    .update(payload)
    .digest('hex');
  
  if (signature !== hash) {
    return res.status(401).send('Invalid signature');
  }
  
  // Event processing
  const { event, data } = req.body;
  console.log('Event:', event, data);
  
  res.status(200).send('OK');
});`
            },
            {
              title: 'Webhook Request Format',
              code: `{
  "event": "sensor.update",
  "timestamp": "2025-10-23T14:32:00Z",
  "data": {
    "sensorId": "sensor_123",
    "buildingId": "building_456",
    "type": "temperature",
    "value": 28.5,
    "unit": "celsius",
    "status": "warning"
  }
}`
            }
          ]
        },
        uz: {
          title: 'Webhooks',
          intro: 'Real vaqt voqealar haqida xabarnomalar olish uchun webhooks sozlang.',
          sections: [
            {
              title: 'Webhooks nima',
              content: [
                'Webhooks - bu ma\'lum voqealarda ishga tushadigan HTTP kolbeklar',
                'InfraSafe voqea yuz berganda sizning URL ga POST so\'rov yuboradi',
                'Tashqi tizimlar bilan integratsiya uchun foydali',
                'Qayta urinishlar bilan kafolatlangan yetkazib berish'
              ]
            },
            {
              title: 'Webhook sozlash',
              content: [
                'Sozlamalar → Webhooks ga o\'ting',
                '"Webhook yaratish" tugmasini bosing',
                'Xabarnomalar olish uchun URL ni ko\'rsating',
                'Obuna bo\'lmoqchi bo\'lgan voqealarni tanlang',
                'So\'rovlarni tekshirish uchun maxfiy kalitni saqlang'
              ]
            },
            {
              title: 'Qo\'llab-quvvatlanadigan voqealar',
              content: [
                'sensor.update - sensor ma\'lumotlari yangilanishi',
                'alert.created - yangi ogohlantirish yaratildi',
                'alert.resolved - ogohlantirish hal qilindi',
                'building.status_changed - bino holati o\'zg ardi',
                'sensor.offline - sensor offlayn bo\'ldi',
                'sensor.online - sensor qayta onlayn bo\'ldi'
              ]
            },
            {
              title: 'Webhook ishlov berish namunasi',
              code: `const express = require('express');
const crypto = require('crypto');

app.post('/webhook', (req, res) => {
  // Imzo tekshiruvi
  const signature = req.headers['x-infrasafe-signature'];
  const payload = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', 'YOUR_WEBHOOK_SECRET')
    .update(payload)
    .digest('hex');
  
  if (signature !== hash) {
    return res.status(401).send('Invalid signature');
  }
  
  // Voqeani qayta ishlash
  const { event, data } = req.body;
  console.log('Voqea:', event, data);
  
  res.status(200).send('OK');
});`
            },
            {
              title: 'Webhook so\'rov formati',
              code: `{
  "event": "sensor.update",
  "timestamp": "2025-10-23T14:32:00Z",
  "data": {
    "sensorId": "sensor_123",
    "buildingId": "building_456",
    "type": "temperature",
    "value": 28.5,
    "unit": "celsius",
    "status": "warning"
  }
}`
            }
          ]
        }
      }
    };

    return content[sectionId]?.[t.language] || null;
  };

  const renderDetailedSection = (sectionId: string) => {
    const content = getDetailedContent(sectionId);
    if (!content) return null;

    const section = docSections.find(s => s.id === sectionId);
    if (!section) return null;

    const Icon = section.icon;

    return (
      <div className="space-y-6">
        {/* Back Button */}
        <Button 
          variant="outline" 
          onClick={() => setSelectedSection(null)}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.backToList}
        </Button>

        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-accent/10 flex items-center justify-center">
              <Icon className="w-8 h-8 text-accent" />
            </div>
            <div>
              <h1>{content.title}</h1>
              <p className="text-muted-foreground mt-2">
                {content.intro}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Content Sections */}
        <div className="space-y-8">
          {content.sections.map((sec: any, index: number) => (
            <Card key={index} className="p-6 neomorph">
              <h2 className="mb-4">{sec.title}</h2>
              
              {sec.content && (
                <ul className="space-y-3">
                  {sec.content.map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              )}

              {sec.endpoints && (
                <div className="space-y-2 mt-4">
                  {sec.endpoints.map((endpoint: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div className="flex flex-col md:flex-row md:items-center gap-3">
                        <Badge variant="outline" className={
                          endpoint.method === 'GET' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                          endpoint.method === 'POST' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                          'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                        }>
                          {endpoint.method}
                        </Badge>
                        <code className="flex-1 text-sm">{endpoint.path}</code>
                        <span className="text-sm text-muted-foreground">{endpoint.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sec.code && (
                <Card className="p-4 mt-4 bg-muted/20 neomorph">
                  <pre className="overflow-x-auto">
                    <code className="text-sm text-foreground">
                      {sec.code}
                    </code>
                  </pre>
                </Card>
              )}
            </Card>
          ))}
        </div>
      </div>
    );
  };

  // If a section is selected, show detailed view
  if (selectedSection) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {renderDetailedSection(selectedSection)}
      </div>
    );
  }

  // Otherwise show the list view
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-4">
          <h1>{t.docTitle}</h1>
          <p className="text-muted-foreground">
            {t.docDescription}
          </p>
        </div>

        {/* Documentation Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {docSections.map((section, index) => {
            const Icon = section.icon;
            return (
              <Card 
                key={index} 
                className="p-6 neomorph hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => setSelectedSection(section.id)}
              >
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                    <Icon className="w-6 h-6 text-accent" />
                  </div>
                  <h3>{section.title}</h3>
                  <p className="text-muted-foreground">
                    {section.description}
                  </p>
                  <Button variant="link" className="p-0 h-auto group-hover:translate-x-1 transition-transform">
                    {t.readMore}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
