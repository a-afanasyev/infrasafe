import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, Area, AreaChart } from "recharts";

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#f97316"];

function Badge({ children, color = "blue" }) {
  const c = { blue: "#3b82f6", purple: "#8b5cf6", green: "#10b981", yellow: "#f59e0b", red: "#ef4444", gray: "#64748b", cyan: "#06b6d4", orange: "#f97316" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: `${c[color]}22`, color: c[color], border: `1px solid ${c[color]}44` }}>
      {children}
    </span>
  );
}

function Card({ children, className = "", style = {} }) {
  return (
    <div className={className} style={{ borderRadius: 14, border: "1px solid #1e293b", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", padding: 24, ...style }}>
      {children}
    </div>
  );
}

function StatCard({ icon, value, label, sub, color = "#3b82f6" }) {
  return (
    <div style={{ borderRadius: 14, border: "1px solid #1e293b", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
        <span style={{ fontSize: 26 }}>{icon}</span>{title}
      </h2>
      {subtitle && <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0 36px" }}>{subtitle}</p>}
    </div>
  );
}

function ProgressBar({ value, max = 100, color = "#3b82f6", label, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: "#cbd5e1" }}>{label}</span>
        <span style={{ fontSize: 13, color, fontWeight: 600 }}>{value}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "#1e293b", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(value / max) * 100}%`, borderRadius: 4, background: `linear-gradient(90deg, ${color}, ${color}88)`, transition: "width 0.5s" }} />
      </div>
      {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── DATA ───

const userJourney = [
  { stage: "Датчик / IoT", infrasafe: "Контроллер снимает метрики", uk: "—" },
  { stage: "Обнаружение", infrasafe: "Автоматический алерт по порогу", uk: "Житель замечает проблему" },
  { stage: "Фиксация", infrasafe: "infrastructure_alerts + карта", uk: "Заявка через Telegram бота" },
  { stage: "Маршрутизация", infrasafe: "Admin видит в панели", uk: "AI-диспетчер или менеджер" },
  { stage: "Исполнение", infrasafe: "Инженер проверяет на карте", uk: "Исполнитель берёт в работу" },
  { stage: "Контроль", infrasafe: "Мониторинг показателей", uk: "Менеджер на Kanban-доске" },
  { stage: "Закрытие", infrasafe: "Алерт resolved", uk: "Житель принимает / оценивает" },
  { stage: "Аналитика", infrasafe: "25+ эндпоинтов, MV, history", uk: "KPI-дашборд, рейтинги" },
];

const marketFit = [
  { dimension: "Проактивность", score: 92, desc: "IoT = проблемы до жалоб", color: "#3b82f6" },
  { dimension: "Скорость реакции", score: 78, desc: "Telegram = мгновенные заявки", color: "#8b5cf6" },
  { dimension: "Прозрачность", score: 85, desc: "Карта + Kanban = всё видно", color: "#10b981" },
  { dimension: "Автоматизация", score: 70, desc: "AI-диспетчер + auto-alerts", color: "#f59e0b" },
  { dimension: "Масштабируемость", score: 80, desc: "Docker + PostGIS + Redis", color: "#06b6d4" },
  { dimension: "Многоязычность", score: 55, desc: "RU основной, UZ в процессе", color: "#ec4899" },
];

const revenueStreams = [
  { name: "SaaS подписка\n(за здание/мес)", value: 35 },
  { name: "IoT оборудование\n(контроллеры)", value: 25 },
  { name: "Внедрение и\nнастройка", value: 20 },
  { name: "Техподдержка\n(план)", value: 12 },
  { name: "Аналитика\n(premium)", value: 8 },
];

const competitiveRadar = [
  { feature: "IoT мониторинг", ours: 95, competitors: 60 },
  { feature: "Управление заявками", ours: 85, competitors: 75 },
  { feature: "Telegram бот", ours: 90, competitors: 30 },
  { feature: "AI-диспетчеризация", ours: 80, competitors: 20 },
  { feature: "Интерактивная карта", ours: 90, competitors: 40 },
  { feature: "Мультиязычность", ours: 55, competitors: 50 },
  { feature: "Мобильное приложение", ours: 40, competitors: 70 },
  { feature: "Интеграции", ours: 65, competitors: 60 },
];

const adoptionProjection = [
  { month: "Q2'26", buildings: 17, users: 50, requests: 0 },
  { month: "Q3'26", buildings: 40, users: 200, requests: 150 },
  { month: "Q4'26", buildings: 80, users: 600, requests: 500 },
  { month: "Q1'27", buildings: 150, users: 1500, requests: 1200 },
  { month: "Q2'27", buildings: 300, users: 4000, requests: 3500 },
  { month: "Q3'27", buildings: 500, users: 8000, requests: 7000 },
];

const riskMatrix = [
  { risk: "Отказ IoT-контроллеров", impact: "Высокий", probability: "Средняя", mitigation: "Heartbeat мониторинг, автопереключение на polling", status: "mitigated" },
  { risk: "Масштабирование БД", impact: "Высокий", probability: "Низкая", mitigation: "Партиционирование, Redis кэш, MV", status: "mitigated" },
  { risk: "WebSocket недоступен", impact: "Средний", probability: "Средняя", mitigation: "Fallback на polling, reconnect logic", status: "partial" },
  { risk: "Качество локализации UZ", impact: "Средний", probability: "Высокая", mitigation: "План улучшения локализации (12-17 дней)", status: "active" },
  { risk: "Зависимость от Telegram", impact: "Высокий", probability: "Низкая", mitigation: "WebApp как standalone fallback, React dashboard", status: "partial" },
  { risk: "Webhook интеграция fails", impact: "Средний", probability: "Средняя", mitigation: "Outbox pattern, retry, HMAC, replay protect", status: "mitigated" },
];

const roadmapItems = [
  { q: "Q2 2026", items: [
    { name: "UK Integration Phase 2-3", status: "in-progress", desc: "Building sync + Alert→Request pipeline" },
    { name: "Локализация UZ завершение", status: "in-progress", desc: "38 хардкодированных строк → get_text()" },
    { name: "Критические баги UK", status: "in-progress", desc: "BOT-3, BOT-4, WEB-3 — роли, WebSocket" },
  ]},
  { q: "Q3 2026", items: [
    { name: "Единая карта", status: "planned", desc: "Здания InfraSafe + статусы заявок UK на одной карте" },
    { name: "Frontend Redesign merge", status: "planned", desc: "Новый фронтенд с design tokens, dark/light theme" },
    { name: "Mobile PWA", status: "planned", desc: "Progressive Web App для исполнителей" },
  ]},
  { q: "Q4 2026", items: [
    { name: "Предиктивная аналитика", status: "planned", desc: "ML-модели прогнозирования отказов оборудования" },
    { name: "UK Integration Phase 4-5", status: "planned", desc: "Request feedback + Map Layer визуализация" },
    { name: "Multi-tenant", status: "planned", desc: "Поддержка нескольких управляющих компаний" },
  ]},
  { q: "Q1 2027", items: [
    { name: "Микросервисная миграция UK", status: "planned", desc: "9 сервисов, отдельные контейнеры" },
    { name: "Marketplace интеграций", status: "planned", desc: "API для внешних УК-систем и ERP" },
    { name: "Коммерческий запуск", status: "planned", desc: "SaaS-платформа для рынка Узбекистана" },
  ]},
];

const unitEconomics = [
  { metric: "CAC (привлечение УК)", value: "$500-1,000", note: "Демо + пилот 1 здание" },
  { metric: "ARPU / здание / мес", value: "$30-80", note: "Зависит от числа датчиков" },
  { metric: "IoT контроллер (CAPEX)", value: "$200-400", note: "Промышленный ПК + датчики" },
  { metric: "Payback period", value: "6-10 мес", note: "На здание с 8+ контроллерами" },
  { metric: "Churn risk", value: "Низкий", note: "Высокая стоимость переключения (IoT lock-in)" },
  { metric: "Gross margin", value: "70-80%", note: "SaaS + минимальные серверные расходы" },
];

export default function ProductAnalysis() {
  const [tab, setTab] = useState("product");

  const tabs = [
    { id: "product", label: "Продукт", icon: "🎯" },
    { id: "journey", label: "User Journey", icon: "🔄" },
    { id: "market", label: "Рынок", icon: "📈" },
    { id: "economics", label: "Экономика", icon: "💰" },
    { id: "risks", label: "Риски", icon: "⚠️" },
    { id: "roadmap", label: "Roadmap", icon: "🗺️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#020617", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32, maxWidth: 800, margin: "0 auto 32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 40 }}>🏠</span>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #10b981)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Продуктовый анализ экосистемы
          </h1>
        </div>
        <p style={{ color: "#64748b", fontSize: 16, margin: 0 }}>
          InfraSafe + UK Management — единая платформа для управляющих компаний
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
          <Badge color="blue">IoT мониторинг</Badge>
          <Badge color="purple">Telegram бот</Badge>
          <Badge color="green">React дашборд</Badge>
          <Badge color="cyan">AI-диспетчер</Badge>
          <Badge color="orange">PostGIS карты</Badge>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 28, flexWrap: "wrap" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
            background: tab === t.id ? "#1e293b" : "transparent",
            color: tab === t.id ? "#f1f5f9" : "#64748b",
            boxShadow: tab === t.id ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
            transition: "all 0.2s"
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* ═══ PRODUCT TAB ═══ */}
        {tab === "product" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Value Proposition */}
            <Card>
              <SectionHeader icon="💎" title="Ценностное предложение" subtitle="Почему УК выберут нашу платформу" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                <div style={{ padding: 20, borderRadius: 12, background: "#0f172a", border: "1px solid #1e3a5f" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🔮</div>
                  <h3 style={{ color: "#3b82f6", fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Проактивный мониторинг</h3>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                    IoT-датчики обнаруживают проблемы ДО жалоб жителей. Перегрузка трансформатора, утечка воды, перекос фаз — система алертит автоматически с 15-минутным cooldown дедупликацией.
                  </p>
                </div>
                <div style={{ padding: 20, borderRadius: 12, background: "#0f172a", border: "1px solid #2e1065" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>⚡</div>
                  <h3 style={{ color: "#8b5cf6", fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Мгновенная реакция</h3>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                    Telegram-бот для жителей + AI-диспетчер для назначения исполнителей. 4 алгоритма оптимизации (greedy, genetic, annealing, hybrid) учитывают специализацию, загрузку и геолокацию.
                  </p>
                </div>
                <div style={{ padding: 20, borderRadius: 12, background: "#0f172a", border: "1px solid #064e3b" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🗺️</div>
                  <h3 style={{ color: "#10b981", fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Полная прозрачность</h3>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                    Интерактивная PostGIS-карта с реальными данными, Kanban-доска заявок, KPI-аналитика. Каждый участник видит актуальный статус: житель, исполнитель, менеджер.
                  </p>
                </div>
              </div>
            </Card>

            {/* Platform Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              <StatCard icon="🏢" value="17" label="Зданий (пилот)" sub="Ташкент" color="#3b82f6" />
              <StatCard icon="📡" value="34" label="IoT-метрик" sub="В реальном времени" color="#06b6d4" />
              <StatCard icon="🤖" value="30" label="Хэндлеров бота" sub="Aiogram 3" color="#8b5cf6" />
              <StatCard icon="🧠" value="38" label="Сервисов" sub="9 async + 29 sync" color="#10b981" />
              <StatCard icon="🔌" value="85+" label="API эндпоинтов" sub="REST + WebSocket" color="#f59e0b" />
              <StatCard icon="🧪" value="257" label="Тестов" sub="175 + 82" color="#ec4899" />
            </div>

            {/* Competitive Radar */}
            <Card>
              <SectionHeader icon="🏆" title="Конкурентный профиль" subtitle="Наша экосистема vs типичные УК-решения на рынке Узбекистана" />
              <ResponsiveContainer width="100%" height={360}>
                <RadarChart data={competitiveRadar} cx="50%" cy="50%" outerRadius="68%">
                  <PolarGrid stroke="#1e293b" />
                  <PolarAngleAxis dataKey="feature" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#475569", fontSize: 10 }} />
                  <Radar name="Наша платформа" dataKey="ours" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} strokeWidth={2} />
                  <Radar name="Конкуренты (avg)" dataKey="competitors" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} strokeDasharray="5 5" />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, color: "#e2e8f0", fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            </Card>

            {/* Target Audience */}
            <Card>
              <SectionHeader icon="👥" title="Целевая аудитория" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                {[
                  { role: "Управляющая компания", icon: "🏛️", needs: "Контроль инфраструктуры, снижение аварий, отчётность", persona: "Директор УК, 40+, принимает решения о закупках" },
                  { role: "Главный инженер", icon: "🔧", needs: "Мониторинг в реальном времени, алерты, карта объектов", persona: "Технический специалист, 35+, работает с картой и аналитикой" },
                  { role: "Менеджер заявок", icon: "📋", needs: "Kanban, назначение исполнителей, KPI", persona: "Диспетчер/менеджер, 25-45, Telegram + веб-дашборд" },
                  { role: "Житель", icon: "🏠", needs: "Быстрая подача заявки, статус, прозрачность", persona: "Любой возраст, Telegram как основной канал" },
                ].map((a, i) => (
                  <div key={i} style={{ padding: 16, borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b" }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>{a.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#f1f5f9", marginBottom: 6 }}>{a.role}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, marginBottom: 6 }}>{a.needs}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>{a.persona}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ═══ USER JOURNEY TAB ═══ */}
        {tab === "journey" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <Card>
              <SectionHeader icon="🔄" title="Единый User Journey" subtitle="Как две платформы работают вместе от обнаружения проблемы до закрытия" />
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 700 }}>
                  {userJourney.map((step, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr 40px 1fr", gap: 12, alignItems: "center", padding: "14px 0", borderBottom: i < userJourney.length - 1 ? "1px solid #1e293b" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#64748b" }}>{i + 1}</div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{step.stage}</span>
                      </div>
                      <div style={{ fontSize: 12, color: step.infrasafe === "—" ? "#334155" : "#93c5fd", padding: "8px 12px", borderRadius: 8, background: step.infrasafe === "—" ? "transparent" : "#1e3a5f22", border: step.infrasafe === "—" ? "1px dashed #1e293b" : "1px solid #1e3a5f44" }}>
                        {step.infrasafe !== "—" && <span style={{ marginRight: 6 }}>🏢</span>}
                        {step.infrasafe}
                      </div>
                      <div style={{ textAlign: "center", color: "#334155", fontSize: 16 }}>
                        {step.infrasafe !== "—" && step.uk !== "—" ? "⟷" : step.infrasafe !== "—" ? "→" : "←"}
                      </div>
                      <div style={{ fontSize: 12, color: step.uk === "—" ? "#334155" : "#c4b5fd", padding: "8px 12px", borderRadius: 8, background: step.uk === "—" ? "transparent" : "#2e106522", border: step.uk === "—" ? "1px dashed #1e293b" : "1px solid #2e106544" }}>
                        {step.uk !== "—" && <span style={{ marginRight: 6 }}>🤖</span>}
                        {step.uk}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🔗" title="Сценарии интеграции" subtitle="Конкретные use-cases объединённой платформы" />
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  { title: "Авария водоснабжения", flow: "Датчик давления → InfraSafe алерт (CRITICAL) → Webhook → UK создаёт заявку → AI назначает сантехника → Житель видит в Telegram → Исполнитель чинит → Датчик подтверждает норму → Алерт resolved", color: "#3b82f6" },
                  { title: "Перегрузка трансформатора", flow: "Метрики тока/напряжения → load_percent > 85% → WARNING алерт → Менеджер видит на карте → Превентивная заявка → Перераспределение нагрузки → Мониторинг фаз → OK", color: "#f59e0b" },
                  { title: "Жалоба жителя на отопление", flow: "Житель: 'Нет отопления' → Telegram → Заявка → Менеджер проверяет InfraSafe карту → Видит: heat_source OK, но температура подачи низкая → Диагностика → Назначение → Решение", color: "#8b5cf6" },
                ].map((s, i) => (
                  <div key={i} style={{ padding: 16, borderRadius: 12, background: "#0f172a", borderLeft: `3px solid ${s.color}` }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: s.color, marginBottom: 8 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>{s.flow}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader icon="📱" title="Каналы взаимодействия по ролям" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1e293b" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Роль</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>Telegram бот</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>React Dashboard</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>InfraSafe карта</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>Admin Panel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { role: "Житель", tg: "primary", dash: "view", map: "—", admin: "—" },
                      { role: "Исполнитель", tg: "primary", dash: "secondary", map: "view", admin: "—" },
                      { role: "Менеджер", tg: "alerts", dash: "primary", map: "primary", admin: "—" },
                      { role: "Администратор", tg: "—", dash: "secondary", map: "primary", admin: "primary" },
                    ].map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: "#cbd5e1" }}>{r.role}</td>
                        {["tg", "dash", "map", "admin"].map(ch => (
                          <td key={ch} style={{ padding: "10px 12px", textAlign: "center" }}>
                            {r[ch] === "primary" ? <Badge color="green">Основной</Badge> :
                             r[ch] === "secondary" ? <Badge color="blue">Вспомогательный</Badge> :
                             r[ch] === "view" ? <Badge color="gray">Просмотр</Badge> :
                             r[ch] === "alerts" ? <Badge color="yellow">Уведомления</Badge> :
                             <span style={{ color: "#334155" }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ═══ MARKET TAB ═══ */}
        {tab === "market" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <Card>
              <SectionHeader icon="📈" title="Product-Market Fit" subtitle="Оценка соответствия продукта рынку УК Узбекистана" />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {marketFit.map((m, i) => (
                  <ProgressBar key={i} value={m.score} color={m.color} label={m.dimension} sub={m.desc} />
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🌍" title="Рыночный контекст" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                <div style={{ padding: 16, borderRadius: 10, background: "#0f172a" }}>
                  <h4 style={{ color: "#10b981", fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>Возможности</h4>
                  <ul style={{ margin: 0, paddingLeft: 16, color: "#94a3b8", fontSize: 12, lineHeight: 2 }}>
                    <li>Растущий рынок строительства МКД в Узбекистане</li>
                    <li>Государственная программа цифровизации ЖКХ</li>
                    <li>Telegram — доминирующий мессенджер (85%+ проникновение)</li>
                    <li>Низкая конкуренция в сегменте IoT для ЖКХ</li>
                    <li>Потребность в прозрачности управления для жителей</li>
                  </ul>
                </div>
                <div style={{ padding: 16, borderRadius: 10, background: "#0f172a" }}>
                  <h4 style={{ color: "#f59e0b", fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>Вызовы</h4>
                  <ul style={{ margin: 0, paddingLeft: 16, color: "#94a3b8", fontSize: 12, lineHeight: 2 }}>
                    <li>Консервативность УК в принятии технологий</li>
                    <li>Необходимость физической установки IoT-датчиков</li>
                    <li>Узбекская локализация требует доработки</li>
                    <li>Отсутствие мобильного приложения (только PWA плановый)</li>
                    <li>Зависимость от стабильности интернета для IoT</li>
                  </ul>
                </div>
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🚀" title="Прогноз роста" subtitle="Оптимистичный сценарий при активных продажах" />
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={adoptionProjection}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, color: "#e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Area type="monotone" dataKey="buildings" name="Зданий" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
                  <Area type="monotone" dataKey="users" name="Пользователей" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} />
                  <Area type="monotone" dataKey="requests" name="Заявок/мес" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <SectionHeader icon="🥊" title="Конкурентные преимущества" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {[
                  { icon: "🔗", title: "Единая экосистема", desc: "IoT + заявки + карта = нет аналогов в регионе", badge: "Уникальное" },
                  { icon: "🤖", title: "Telegram-first", desc: "Не нужно ставить приложение, 85% уже в Telegram", badge: "Барьер входа = 0" },
                  { icon: "🧠", title: "AI-диспетчер", desc: "4 алгоритма оптимизации назначений", badge: "Передовое" },
                  { icon: "🗺️", title: "PostGIS карты", desc: "Геопространственная аналитика и визуализация", badge: "Проф. уровень" },
                  { icon: "📊", title: "25+ аналитик", desc: "Circuit Breaker, MV, партиционирование", badge: "Enterprise" },
                  { icon: "🔐", title: "Default-deny JWT", desc: "7 rate limiters, HMAC webhooks, audit trail", badge: "Безопасность" },
                ].map((a, i) => (
                  <div key={i} style={{ padding: 14, borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b" }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{a.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9", marginBottom: 4 }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, lineHeight: 1.5 }}>{a.desc}</div>
                    <Badge color="cyan">{a.badge}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ═══ ECONOMICS TAB ═══ */}
        {tab === "economics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <Card>
              <SectionHeader icon="💰" title="Модель монетизации" subtitle="Распределение потенциальных источников дохода" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "center" }}>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={revenueStreams} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} label={({ name, value }) => `${value}%`} labelLine={{ stroke: "#475569" }}>
                      {revenueStreams.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, color: "#e2e8f0", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {revenueStreams.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: PIE_COLORS[i], flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: "#cbd5e1", flex: 1 }}>{s.name.replace(/\n/g, " ")}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: PIE_COLORS[i] }}>{s.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <SectionHeader icon="📊" title="Unit Economics" subtitle="Ключевые экономические метрики" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                {unitEconomics.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{m.metric}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{m.note}</div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#10b981" }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🏗️" title="Стоимость разработки (текущий статус)" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ padding: 16, borderRadius: 10, background: "#0f172a", border: "1px solid #1e3a5f" }}>
                  <h4 style={{ color: "#3b82f6", fontSize: 14, margin: "0 0 12px" }}>🏢 InfraSafe</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#94a3b8" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Бэкенд (10 сервисов)</span><span style={{ color: "#3b82f6" }}>~8,000 строк</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Фронтенд (legacy)</span><span style={{ color: "#3b82f6" }}>~4,000 строк</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>БД схема</span><span style={{ color: "#3b82f6" }}>990 строк SQL</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Тесты</span><span style={{ color: "#10b981" }}>175 (100% pass)</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Документация</span><span style={{ color: "#3b82f6" }}>27+ документов</span></div>
                  </div>
                </div>
                <div style={{ padding: 16, borderRadius: 10, background: "#0f172a", border: "1px solid #2e1065" }}>
                  <h4 style={{ color: "#8b5cf6", fontSize: 14, margin: "0 0 12px" }}>🤖 UK Management</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#94a3b8" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Бот + API (38 сервисов)</span><span style={{ color: "#8b5cf6" }}>~12,500 строк</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>React фронтенд</span><span style={{ color: "#8b5cf6" }}>~5,000 строк</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Alembic миграции</span><span style={{ color: "#8b5cf6" }}>3 версии</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Тесты</span><span style={{ color: "#f59e0b" }}>82 (82% pass)</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Локализация</span><span style={{ color: "#8b5cf6" }}>RU + UZ (в процессе)</span></div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ═══ RISKS TAB ═══ */}
        {tab === "risks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <Card>
              <SectionHeader icon="⚠️" title="Матрица рисков" subtitle="Идентифицированные риски и стратегии митигации" />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {riskMatrix.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto 2fr auto", gap: 12, alignItems: "center", padding: "12px 16px", borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{r.risk}</div>
                    <Badge color={r.impact === "Высокий" ? "red" : "yellow"}>{r.impact}</Badge>
                    <Badge color={r.probability === "Высокая" ? "red" : r.probability === "Средняя" ? "yellow" : "green"}>{r.probability}</Badge>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{r.mitigation}</div>
                    <Badge color={r.status === "mitigated" ? "green" : r.status === "partial" ? "yellow" : "orange"}>
                      {r.status === "mitigated" ? "Закрыт" : r.status === "partial" ? "Частично" : "Активный"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🐛" title="Текущие критические проблемы" subtitle="Требуют немедленного внимания" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {[
                  { id: "BOT-3", title: "Исполнители не могут начать смену", desc: "Проверка legacy-поля role вместо active_role в shift handler", severity: "Critical", project: "UK" },
                  { id: "BOT-4", title: "@require_role не работает для callbacks", desc: "Декоратор проверки ролей падает на callback_query handlers", severity: "Critical", project: "UK" },
                  { id: "WEB-3", title: "WebSocket 403 Forbidden", desc: "Real-time обновления через WebSocket заблокированы", severity: "High", project: "UK" },
                  { id: "INFRA-1", title: "admin.js монолит (~2300 строк)", desc: "Затрудняет поддержку и развитие admin panel", severity: "Medium", project: "InfraSafe" },
                ].map((bug, i) => (
                  <div key={i} style={{ padding: 14, borderRadius: 10, background: "#0f172a", borderLeft: `3px solid ${bug.severity === "Critical" ? "#ef4444" : bug.severity === "High" ? "#f59e0b" : "#64748b"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <Badge color={bug.project === "UK" ? "purple" : "blue"}>{bug.project}</Badge>
                      <Badge color={bug.severity === "Critical" ? "red" : bug.severity === "High" ? "yellow" : "gray"}>{bug.severity}</Badge>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9", marginBottom: 4 }}>{bug.id}: {bug.title}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{bug.desc}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🛡️" title="Технический долг" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <h4 style={{ color: "#3b82f6", fontSize: 14, margin: "0 0 12px" }}>InfraSafe</h4>
                  <ProgressBar value={25} color="#3b82f6" label="Монолитные JS файлы" sub="admin.js + script.js нужен рефакторинг" />
                  <ProgressBar value={20} color="#3b82f6" label="No repository pattern" sub="Модели с raw SQL затрудняют тестирование" />
                  <ProgressBar value={15} color="#3b82f6" label="console.error vs Winston" sub="Часть кода не использует логгер" />
                  <ProgressBar value={10} color="#3b82f6" label="Дублирование water routes" sub="Код дублируется между water-related файлами" />
                </div>
                <div>
                  <h4 style={{ color: "#8b5cf6", fontSize: 14, margin: "0 0 12px" }}>UK Management</h4>
                  <ProgressBar value={40} color="#8b5cf6" label="Хардкодированные строки" sub="~38 строк без локализации" />
                  <ProgressBar value={30} color="#8b5cf6" label="Legacy role field" sub="user.role вместо active_role в нескольких местах" />
                  <ProgressBar value={25} color="#8b5cf6" label="Покрытие тестами" sub="82% pass rate (67/82), нужны новые тесты" />
                  <ProgressBar value={20} color="#8b5cf6" label="WebSocket reconnection" sub="Нет robust reconnection logic" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ═══ ROADMAP TAB ═══ */}
        {tab === "roadmap" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <Card>
              <SectionHeader icon="🗺️" title="Product Roadmap" subtitle="Стратегический план развития экосистемы Q2 2026 — Q1 2027" />
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {roadmapItems.map((quarter, qi) => (
                  <div key={qi}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: qi === 0 ? "#10b98133" : "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: qi === 0 ? "#10b981" : "#64748b" }}>
                        {quarter.q.split(" ")[0]}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>{quarter.q}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {qi === 0 ? "Текущий квартал" : qi === 1 ? "Следующий квартал" : `Через ${qi} кварталов`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, marginLeft: 50 }}>
                      {quarter.items.map((item, ii) => (
                        <div key={ii} style={{ padding: 14, borderRadius: 10, background: "#0f172a", border: `1px solid ${item.status === "in-progress" ? "#10b98144" : "#1e293b"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: "#cbd5e1" }}>{item.name}</span>
                            <Badge color={item.status === "in-progress" ? "green" : "gray"}>
                              {item.status === "in-progress" ? "В работе" : "План"}
                            </Badge>
                          </div>
                          <div style={{ fontSize: 12, color: "#94a3b8" }}>{item.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🎯" title="Стратегические цели на 2026-2027" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                {[
                  { icon: "🏢", goal: "500 зданий", period: "К Q3 2027", metric: "Подключенных к мониторингу" },
                  { icon: "👥", goal: "8,000 пользователей", period: "К Q3 2027", metric: "Активных в Telegram" },
                  { icon: "🔗", goal: "Full integration", period: "К Q4 2026", metric: "5 фаз интеграции завершены" },
                  { icon: "🌐", goal: "3 города", period: "К Q1 2027", metric: "Ташкент, Самарканд, Бухара" },
                  { icon: "💰", goal: "Breakeven", period: "К Q2 2027", metric: "SaaS выручка покрывает расходы" },
                  { icon: "📱", goal: "Mobile PWA", period: "К Q3 2026", metric: "Для исполнителей в поле" },
                ].map((g, i) => (
                  <div key={i} style={{ padding: 16, borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b", textAlign: "center" }}>
                    <div style={{ fontSize: 30, marginBottom: 6 }}>{g.icon}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{g.goal}</div>
                    <div style={{ fontSize: 12, color: "#10b981", fontWeight: 600, marginTop: 4 }}>{g.period}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{g.metric}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

      </div>

      <footer style={{ textAlign: "center", marginTop: 40, fontSize: 12, color: "#334155" }}>
        InfraSafe + UK Management — Продуктовый анализ экосистемы управления недвижимостью — Март 2026
      </footer>
    </div>
  );
}
