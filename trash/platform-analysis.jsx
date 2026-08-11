import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const COLORS = {
  infrasafe: "#3b82f6",
  uk: "#8b5cf6",
  accent: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  bg: "#0f172a",
  card: "#1e293b",
  cardHover: "#334155",
  border: "#334155",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textDim: "#64748b",
};

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

const techStackData = [
  { category: "Backend", infrasafe: "Node.js 20 / Express.js", uk: "Python 3.11 / FastAPI + Aiogram 3" },
  { category: "Database", infrasafe: "PostgreSQL 15 + PostGIS", uk: "PostgreSQL 15 + Redis 7" },
  { category: "ORM", infrasafe: "Нет (raw SQL через pg Pool)", uk: "SQLAlchemy 2.x + Alembic" },
  { category: "Frontend", infrasafe: "Vanilla JS + Leaflet + Chart.js", uk: "React 18 + TypeScript + shadcn/ui" },
  { category: "Auth", infrasafe: "JWT (access + refresh + blacklist)", uk: "JWT (python-jose + passlib)" },
  { category: "Docs", infrasafe: "Swagger / OpenAPI 3.0", uk: "OpenAPI 3.0.3 + FastAPI auto-docs" },
  { category: "Testing", infrasafe: "Jest (175 тестов)", uk: "Pytest (67/82 тестов)" },
  { category: "Container", infrasafe: "Docker Compose (3 сервиса)", uk: "Docker Compose (6 сервисов)" },
  { category: "AI", infrasafe: "—", uk: "SmartDispatcher (4 алгоритма)" },
  { category: "Real-time", infrasafe: "Polling / MV refresh", uk: "WebSocket + Redis Pub/Sub" },
];

const metricsComparison = [
  { name: "Таблиц БД", infrasafe: 18, uk: 23 },
  { name: "API эндпоинтов", infrasafe: 60, uk: 45 },
  { name: "Сервисов", infrasafe: 10, uk: 38 },
  { name: "Тестов", infrasafe: 175, uk: 82 },
  { name: "Docker сервисов", infrasafe: 3, uk: 6 },
];

const radarData = [
  { subject: "Безопасность", infrasafe: 90, uk: 70 },
  { subject: "Масштабируемость", infrasafe: 75, uk: 85 },
  { subject: "Real-time", infrasafe: 50, uk: 90 },
  { subject: "Тестирование", infrasafe: 95, uk: 65 },
  { subject: "AI/ML", infrasafe: 10, uk: 80 },
  { subject: "UI/UX", infrasafe: 60, uk: 85 },
  { subject: "Мониторинг", infrasafe: 95, uk: 40 },
  { subject: "Интеграции", infrasafe: 70, uk: 75 },
];

const infrasafeDbTables = [
  { name: "Core", value: 3, label: "users, buildings, controllers" },
  { name: "Metrics", value: 2, label: "metrics, analytics_history" },
  { name: "Power", value: 3, label: "transformers, lines, power_transformers" },
  { name: "Water", value: 4, label: "water_lines, suppliers, sources, points" },
  { name: "Alerts", value: 3, label: "infrastructure_alerts, alerts, alert_types" },
  { name: "Auth", value: 2, label: "refresh_tokens, token_blacklist" },
  { name: "Other", value: 1, label: "logs" },
];

const ukDbTables = [
  { name: "Users", value: 4, label: "users, documents, verifications, access" },
  { name: "Requests", value: 3, label: "requests, assignments, ratings" },
  { name: "Shifts", value: 5, label: "shifts, schedules, assignments, transfers, templates" },
  { name: "Address", value: 3, label: "yards, buildings, apartments" },
  { name: "System", value: 4, label: "notifications, audit_logs, plans, webhook_outbox" },
  { name: "User links", value: 1, label: "user_apartments" },
];

const integrationPhases = [
  { phase: 1, name: "Foundation", status: "done", desc: "DB, модели, роуты, админ UI, логирование" },
  { phase: 2, name: "Building Sync", status: "planned", desc: "UK → InfraSafe синхронизация зданий" },
  { phase: 3, name: "Alert → Request", status: "planned", desc: "Алерты InfraSafe → заявки UK" },
  { phase: 4, name: "Request → Alert Feedback", status: "planned", desc: "Обратная связь UK → InfraSafe" },
  { phase: 5, name: "Map Layer", status: "planned", desc: "Визуализация интеграции на карте" },
];

const securityFeatures = {
  infrasafe: [
    "Default-deny JWT middleware",
    "Rate limiting (7 стратегий)",
    "HMAC-SHA256 webhook verification",
    "SQL injection whitelist validation",
    "XSS protection (DOMPurify + Helmet CSP)",
    "Account locking (5 attempts)",
    "Token blacklist + refresh rotation",
    "Correlation ID tracing",
    "Replay protection (300s tolerance)",
    "Timing-safe comparison",
  ],
  uk: [
    "JWT access + refresh tokens",
    "Role-based access (3 роли)",
    "Telegram initData validation",
    "Pydantic input validation",
    "CORS configuration",
    "Rate limiting (slowapi)",
    "Audit logging",
    "Redis session management",
  ],
};

function Badge({ children, color = "blue" }) {
  const colors = {
    blue: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    purple: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    green: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    yellow: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    red: "bg-red-500/20 text-red-300 border-red-500/30",
    gray: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[color]}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`rounded-xl border border-slate-700 bg-slate-800/80 backdrop-blur-sm p-5 ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children, icon }) {
  return (
    <h2 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
      <span className="text-2xl">{icon}</span>
      {children}
    </h2>
  );
}

function TabButton({ active, onClick, children, color }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? `bg-${color === "blue" ? "blue" : "purple"}-500/20 text-${color === "blue" ? "blue" : "purple"}-300 border border-${color === "blue" ? "blue" : "purple"}-500/40`
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
      }`}
      style={active ? { backgroundColor: color === "blue" ? "rgba(59,130,246,0.15)" : color === "purple" ? "rgba(139,92,246,0.15)" : "rgba(16,185,129,0.15)", borderColor: color === "blue" ? "rgba(59,130,246,0.3)" : color === "purple" ? "rgba(139,92,246,0.3)" : "rgba(16,185,129,0.3)", color: color === "blue" ? "#93c5fd" : color === "purple" ? "#c4b5fd" : "#6ee7b7" } : {}}
    >
      {children}
    </button>
  );
}

export default function PlatformAnalysis() {
  const [activeTab, setActiveTab] = useState("overview");
  const [securityTab, setSecurityTab] = useState("infrasafe");

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-4 md:p-8" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header className="text-center mb-8">
        <div className="inline-flex items-center gap-3 mb-3">
          <span className="text-4xl">🏗️</span>
          <h1 className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">
            Анализ платформ
          </h1>
          <span className="text-4xl">📊</span>
        </div>
        <p className="text-slate-400 text-lg">InfraSafe + UK Management — экосистема управления недвижимостью</p>
        <div className="flex justify-center gap-4 mt-3">
          <Badge color="blue">InfraSafe v1.0.1</Badge>
          <Badge color="purple">UK Management v2.1.0</Badge>
          <Badge color="green">Интеграция: Phase 1</Badge>
        </div>
      </header>

      {/* Navigation */}
      <nav className="flex flex-wrap gap-2 justify-center mb-8">
        {[
          { id: "overview", label: "Обзор", icon: "📋" },
          { id: "tech", label: "Стек", icon: "⚙️" },
          { id: "metrics", label: "Метрики", icon: "📊" },
          { id: "db", label: "База данных", icon: "🗄️" },
          { id: "security", label: "Безопасность", icon: "🔒" },
          { id: "integration", label: "Интеграция", icon: "🔗" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
              activeTab === tab.id
                ? "bg-slate-700 text-white shadow-lg shadow-slate-900/50"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Overview */}
      {activeTab === "overview" && (
        <div className="space-y-6 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* InfraSafe Card */}
            <Card>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-xl">🏢</div>
                <div>
                  <h3 className="text-lg font-bold text-blue-300">InfraSafe</h3>
                  <p className="text-xs text-slate-400">IoT-мониторинг инфраструктуры</p>
                </div>
              </div>
              <p className="text-sm text-slate-300 mb-4">
                Платформа мониторинга инженерных систем многоквартирных домов. Электроснабжение, водоснабжение, отопление — в реальном времени на интерактивной карте.
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Язык бэкенда</span><span className="text-blue-300">Node.js / Express</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Фронтенд</span><span className="text-blue-300">Vanilla JS + Leaflet</span></div>
                <div className="flex justify-between"><span className="text-slate-400">БД</span><span className="text-blue-300">PostgreSQL + PostGIS</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Тестов</span><span className="text-emerald-300">175 ✓</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Зданий (тест)</span><span className="text-blue-300">17 (Ташкент)</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Лицензия</span><span className="text-slate-300">Apache 2.0</span></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge color="blue">JWT Default-Deny</Badge>
                <Badge color="blue">Circuit Breaker</Badge>
                <Badge color="blue">PostGIS</Badge>
                <Badge color="blue">25+ Analytics</Badge>
              </div>
            </Card>

            {/* UK Management Card */}
            <Card>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-xl">🤖</div>
                <div>
                  <h3 className="text-lg font-bold text-purple-300">UK Management</h3>
                  <p className="text-xs text-slate-400">Управление заявками ЖК</p>
                </div>
              </div>
              <p className="text-sm text-slate-300 mb-4">
                Telegram-бот + веб-дашборд для управления заявками. Жители подают, исполнители выполняют, менеджеры контролируют. AI-диспетчеризация.
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Язык бэкенда</span><span className="text-purple-300">Python / FastAPI + Aiogram</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Фронтенд</span><span className="text-purple-300">React + TypeScript</span></div>
                <div className="flex justify-between"><span className="text-slate-400">БД</span><span className="text-purple-300">PostgreSQL + Redis</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Сервисов</span><span className="text-emerald-300">38 (9 async)</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Хэндлеров бота</span><span className="text-purple-300">30</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Языки</span><span className="text-slate-300">RU / UZ</span></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge color="purple">AI Dispatcher</Badge>
                <Badge color="purple">WebSocket</Badge>
                <Badge color="purple">Kanban</Badge>
                <Badge color="purple">3 роли</Badge>
              </div>
            </Card>
          </div>

          {/* Radar Chart */}
          <Card>
            <SectionTitle icon="🎯">Сравнительный профиль</SectionTitle>
            <ResponsiveContainer width="100%" height={380}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
                <Radar name="InfraSafe" dataKey="infrasafe" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                <Radar name="UK Management" dataKey="uk" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} strokeWidth={2} />
                <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 13 }} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} />
              </RadarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* Tech Stack */}
      {activeTab === "tech" && (
        <div className="max-w-5xl mx-auto space-y-6">
          <Card>
            <SectionTitle icon="⚙️">Технологический стек</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-3 px-4 text-slate-400 font-medium">Категория</th>
                    <th className="text-left py-3 px-4 font-medium" style={{ color: "#93c5fd" }}>🏢 InfraSafe</th>
                    <th className="text-left py-3 px-4 font-medium" style={{ color: "#c4b5fd" }}>🤖 UK Management</th>
                  </tr>
                </thead>
                <tbody>
                  {techStackData.map((row, i) => (
                    <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-300">{row.category}</td>
                      <td className="py-3 px-4 text-slate-300">{row.infrasafe}</td>
                      <td className="py-3 px-4 text-slate-300">{row.uk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <h3 className="text-base font-bold text-blue-300 mb-3">InfraSafe — Архитектурные паттерны</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                {["Трёхслойная архитектура (Controllers → Services → Models)", "Circuit Breaker для аналитики", "Multi-layer кэширование (in-memory + Redis-ready)", "Материализованные представления (transformer load)", "PostGIS для геопространственных запросов", "Партиционированные таблицы (analytics_history)", "Alert cooldown (15 мин дедупликация)", "Default-deny JWT middleware"].map((p, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">▸</span>
                    {p}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h3 className="text-base font-bold text-purple-300 mb-3">UK Management — Архитектурные паттерны</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                {["Async-first сервисная архитектура (9 async + 29 sync)", "AI-диспетчеризация (4 алгоритма: greedy, genetic, annealing, hybrid)", "WebSocket + Redis Pub/Sub для real-time", "Telegram WebApp SDK интеграция", "FSM (Finite State Machine) для диалогов бота", "Pydantic схемы валидации", "Webhook outbox pattern для надёжной доставки", "Multi-role RBAC (applicant, executor, manager)"].map((p, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-purple-400 mt-0.5">▸</span>
                    {p}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {/* Metrics */}
      {activeTab === "metrics" && (
        <div className="max-w-5xl mx-auto space-y-6">
          <Card>
            <SectionTitle icon="📊">Количественное сравнение</SectionTitle>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={metricsComparison} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} />
                <Legend wrapperStyle={{ color: "#94a3b8" }} />
                <Bar dataKey="infrasafe" name="InfraSafe" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="uk" name="UK Management" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Строк SQL-схемы", infra: "990", uk: "~600 (Alembic)", icon: "🗄️" },
              { label: "API rate limiters", infra: "7 стратегий", uk: "slowapi", icon: "🚦" },
              { label: "Строк кода", infra: "~8,000+", uk: "12,500+", icon: "💻" },
              { label: "Языки UI", infra: "RU", uk: "RU / UZ / EN", icon: "🌐" },
            ].map((m, i) => (
              <Card key={i} className="text-center">
                <div className="text-2xl mb-1">{m.icon}</div>
                <div className="text-xs text-slate-400 mb-2">{m.label}</div>
                <div className="text-sm">
                  <span className="text-blue-300">{m.infra}</span>
                  <span className="text-slate-500 mx-1.5">vs</span>
                  <span className="text-purple-300">{m.uk}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Database */}
      {activeTab === "db" && (
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <h3 className="text-base font-bold text-blue-300 mb-3">InfraSafe — 18 таблиц</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={infrasafeDbTables} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name} (${value})`} labelLine={{ stroke: "#64748b" }}>
                    {infrasafeDbTables.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} formatter={(value, name, props) => [props.payload.label, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 text-xs text-slate-400 space-y-1">
                <p>PostGIS geometry (POINT/LINESTRING, SRID 4326) на всех инфраструктурных таблицах</p>
                <p>JSONB для main_path/branches (линии электро и водоснабжения)</p>
                <p>Партиционированная analytics_history по месяцам</p>
                <p>Материализованные представления (mv_transformer_load_realtime)</p>
              </div>
            </Card>

            <Card>
              <h3 className="text-base font-bold text-purple-300 mb-3">UK Management — 23 таблицы</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={ukDbTables} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name} (${value})`} labelLine={{ stroke: "#64748b" }}>
                    {ukDbTables.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} formatter={(value, name, props) => [props.payload.label, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 text-xs text-slate-400 space-y-1">
                <p>JSON-массив ролей (user.roles) + active_role для мульти-ролевой модели</p>
                <p>Номера заявок YYMMDD-NNN (строковые, не INT)</p>
                <p>Webhook outbox для надёжной доставки исходящих вебхуков</p>
                <p>Audit log для полной трассировки действий пользователей</p>
              </div>
            </Card>
          </div>

          <Card>
            <SectionTitle icon="🔗">Точки пересечения БД</SectionTitle>
            <div className="bg-slate-900/50 rounded-lg p-4 text-sm font-mono">
              <div className="text-slate-400 mb-2">/* InfraSafe buildings ↔ UK buildings */</div>
              <div className="text-blue-300">InfraSafe.buildings.external_id <span className="text-emerald-400">→</span> <span className="text-purple-300">UK.buildings.id</span></div>
              <div className="text-slate-500 mt-1">// UUID-связь, soft delete через uk_deleted_at</div>
              <div className="text-slate-400 mt-3 mb-2">/* Webhook integration */</div>
              <div className="text-purple-300">UK.webhook_outbox <span className="text-emerald-400">→</span> <span className="text-blue-300">InfraSafe.webhooks/uk/*</span></div>
              <div className="text-slate-500 mt-1">// HMAC-SHA256, replay protection, idempotency via event_id</div>
              <div className="text-slate-400 mt-3 mb-2">/* Future: Alert → Request pipeline */</div>
              <div className="text-blue-300">InfraSafe.infrastructure_alerts <span className="text-yellow-400">→?→</span> <span className="text-purple-300">UK.requests</span></div>
              <div className="text-slate-500 mt-1">// Phase 3 planned — alert_rules + alert_request_map</div>
            </div>
          </Card>
        </div>
      )}

      {/* Security */}
      {activeTab === "security" && (
        <div className="max-w-5xl mx-auto space-y-6">
          <Card>
            <SectionTitle icon="🔒">Механизмы безопасности</SectionTitle>
            <div className="flex gap-2 mb-4">
              <TabButton active={securityTab === "infrasafe"} onClick={() => setSecurityTab("infrasafe")} color="blue">
                🏢 InfraSafe
              </TabButton>
              <TabButton active={securityTab === "uk"} onClick={() => setSecurityTab("uk")} color="purple">
                🤖 UK Management
              </TabButton>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {securityFeatures[securityTab].map((feature, i) => (
                <div key={i} className="flex items-start gap-2 text-sm p-3 rounded-lg bg-slate-900/50">
                  <span className={securityTab === "infrasafe" ? "text-blue-400" : "text-purple-400"}>✓</span>
                  <span className="text-slate-300">{feature}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-bold text-slate-200 mb-3">Матрица доступа InfraSafe (основные группы)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-3 text-slate-400">Маршрут</th>
                    <th className="text-center py-2 px-3 text-slate-400">Доступ</th>
                    <th className="text-center py-2 px-3 text-slate-400">Rate Limit</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { route: "POST /auth/login", access: "Public", rl: "10/мин", color: "green" },
                    { route: "POST /metrics/telemetry", access: "Public", rl: "120/мин", color: "green" },
                    { route: "GET /buildings-metrics", access: "Optional Auth", rl: "—", color: "yellow" },
                    { route: "POST /webhooks/uk/*", access: "HMAC", rl: "60/мин", color: "yellow" },
                    { route: "/buildings, /controllers...", access: "JWT", rl: "60/мин", color: "blue" },
                    { route: "/analytics", access: "JWT", rl: "30/мин", color: "blue" },
                    { route: "/admin/*", access: "JWT + Admin", rl: "20/мин", color: "red" },
                    { route: "/integration/*", access: "JWT + Admin", rl: "20/мин", color: "red" },
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-slate-700/30">
                      <td className="py-2 px-3 text-slate-300 font-mono">{row.route}</td>
                      <td className="py-2 px-3 text-center"><Badge color={row.color}>{row.access}</Badge></td>
                      <td className="py-2 px-3 text-center text-slate-400">{row.rl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Integration */}
      {activeTab === "integration" && (
        <div className="max-w-5xl mx-auto space-y-6">
          <Card>
            <SectionTitle icon="🔗">План интеграции (5 фаз)</SectionTitle>
            <div className="space-y-3">
              {integrationPhases.map((phase) => (
                <div key={phase.phase} className={`flex items-center gap-4 p-4 rounded-lg ${phase.status === "done" ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-900/50 border border-slate-700/50"}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${phase.status === "done" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}>
                    {phase.phase}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{phase.name}</span>
                      <Badge color={phase.status === "done" ? "green" : "gray"}>
                        {phase.status === "done" ? "✓ Готово" : "Планируется"}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-400 mt-0.5">{phase.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle icon="🏗️">Архитектура интеграции</SectionTitle>
            <div className="bg-slate-900/50 rounded-lg p-6 text-sm font-mono leading-relaxed">
              <div className="text-center text-slate-500 mb-4">─── Webhook Flow ───</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="text-center p-4 rounded-lg border border-purple-500/30 bg-purple-500/5">
                  <div className="text-purple-300 font-bold mb-1">UK Management</div>
                  <div className="text-xs text-slate-400">webhook_outbox</div>
                  <div className="text-xs text-slate-400">HMAC-SHA256 signing</div>
                  <div className="text-xs text-slate-400">Retry with backoff</div>
                </div>
                <div className="text-center">
                  <div className="text-emerald-400 text-lg">→ POST /webhooks/uk/* →</div>
                  <div className="text-xs text-slate-500 mt-1">HMAC verified</div>
                  <div className="text-xs text-slate-500">Replay protected (300s)</div>
                  <div className="text-xs text-slate-500">Rate limited (60/min)</div>
                </div>
                <div className="text-center p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
                  <div className="text-blue-300 font-bold mb-1">InfraSafe</div>
                  <div className="text-xs text-slate-400">ukIntegrationService</div>
                  <div className="text-xs text-slate-400">integration_log (audit)</div>
                  <div className="text-xs text-slate-400">Building sync / Alert map</div>
                </div>
              </div>
              <div className="text-center text-slate-500 mt-6 mb-4">─── Future: Alert Pipeline ───</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center opacity-60">
                <div className="text-center p-4 rounded-lg border border-blue-500/20 border-dashed">
                  <div className="text-blue-300 font-bold mb-1">InfraSafe Alerts</div>
                  <div className="text-xs text-slate-400">infrastructure_alerts</div>
                  <div className="text-xs text-slate-400">alert_rules (mapping)</div>
                </div>
                <div className="text-center">
                  <div className="text-yellow-400 text-lg">→ Phase 3 →</div>
                  <div className="text-xs text-slate-500 mt-1">Alert → Request pipeline</div>
                </div>
                <div className="text-center p-4 rounded-lg border border-purple-500/20 border-dashed">
                  <div className="text-purple-300 font-bold mb-1">UK Requests</div>
                  <div className="text-xs text-slate-400">Auto-create requests</div>
                  <div className="text-xs text-slate-400">alert_request_map</div>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle icon="📋">Ключевые файлы интеграции</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-bold text-blue-300 mb-2">InfraSafe (receiver)</h4>
                <ul className="space-y-1 text-xs text-slate-400 font-mono">
                  <li>src/services/ukIntegrationService.js</li>
                  <li>src/routes/webhookRoutes.js</li>
                  <li>src/routes/integrationRoutes.js</li>
                  <li>src/utils/webhookValidation.js</li>
                  <li>src/models/IntegrationConfig.js</li>
                  <li>src/models/IntegrationLog.js</li>
                  <li>src/models/AlertRule.js</li>
                  <li>src/models/AlertRequestMap.js</li>
                  <li>database/migrations/011_uk_integration.sql</li>
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-bold text-purple-300 mb-2">UK Management (sender)</h4>
                <ul className="space-y-1 text-xs text-slate-400 font-mono">
                  <li>docker-compose.yml (INFRASAFE_WEBHOOK_*)</li>
                  <li>webhook_outbox table</li>
                  <li>HMAC-SHA256 signature generation</li>
                  <li>Retry logic with backoff</li>
                </ul>
                <h4 className="text-sm font-bold text-slate-300 mt-4 mb-2">Спецификация</h4>
                <ul className="space-y-1 text-xs text-slate-400 font-mono">
                  <li>docs/superpowers/specs/</li>
                  <li>  2026-03-24-infrasafe-uk-</li>
                  <li>  integration-v2-design.md</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      )}

      <footer className="text-center mt-12 text-xs text-slate-500">
        InfraSafe v1.0.1 + UK Management v2.1.0 — Экосистема управления недвижимостью (Ташкент)
      </footer>
    </div>
  );
}
