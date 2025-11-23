# 📖 Примеры кода для миграции фронтенда с картой

## Конкретные примеры "До → После" для компонентов карты

---

## 1. Sidebar со статусами зданий

### ❌ ДО (текущее)

**HTML (index.html, lines 46-92):**
```html
<div id="sidebar" class="collapsed">
    <div class="sidebar-content">
        <div id="ok-group" class="status-group">
            <div class="group-header">
                <div class="icon normal-icon"></div>
                <span class="group-title">Нет проблем</span>
                <span class="group-counter">0</span>
            </div>
            <div class="status-items"></div>
        </div>
        <!-- ... остальные группы -->
    </div>
    <button class="sidebar-toggle" id="sidebarToggle">
        <img src="public/images/toggle-icon.svg" alt="Toggle">
    </button>
</div>
```

**CSS (style.css, lines 228-600+):**
```css
#sidebar {
    position: absolute;
    top: 50%;
    left: 10px;
    transform: translateY(-50%);
    width: 320px;
    max-height: calc(100vh - 250px);
    background-color: rgba(248, 248, 248, 0.85);
    /* ... 100+ строк стилей */
}

#sidebar.collapsed {
    width: 60px;
    padding: 10px;
}

/* ... множество медиа-запросов и переходов */
```

**JavaScript (script.js, lines 636-1423):**
```javascript
function initCollapsibleGroups() {
    const groupHeaders = document.querySelectorAll('.group-header');
    groupHeaders.forEach(header => {
        header.onclick = function(event) {
            event.stopPropagation();
            this.classList.toggle('collapsed');
            // ... сложная логика управления состоянием
        };
    });
}

// Инициализация сайдбара
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');

sidebarToggle.onclick = function(e) {
    sidebar.classList.toggle('collapsed');
    // ... обновление состояний групп
};
```

**Итого:** ~230 строк кода (HTML + CSS + JS)

---

### ✅ ПОСЛЕ (с shadcn/ui)

**Создаем компонент (components/map/MapStatusSidebar.tsx):**

```typescript
import { useState } from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { 
  CheckCircle2, 
  AlertTriangle, 
  Droplet, 
  AlertCircle, 
  XCircle,
  ChevronDown,
  Zap,
  Flame
} from "lucide-react"
import { cn } from "@/lib/utils"

// Типы данных
interface BuildingStatus {
  id: number
  name: string
  hasElectricity: boolean
  hasColdWater: boolean
  hasHotWater: boolean
  hasLeak: boolean
  electricityStatus: 'ok' | 'warning' | 'critical'
  waterStatus: 'ok' | 'warning' | 'critical'
}

interface StatusGroup {
  id: 'ok' | 'warning' | 'leak' | 'critical' | 'no-controller'
  title: string
  icon: typeof CheckCircle2
  count: number
  items: BuildingStatus[]
  color: string
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
}

interface MapStatusSidebarProps {
  statusGroups: StatusGroup[]
  onBuildingClick: (building: BuildingStatus) => void
}

export function MapStatusSidebar({ statusGroups, onBuildingClick }: MapStatusSidebarProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar 
        collapsible="icon" 
        className="border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      >
        <SidebarContent>
          <ScrollArea className="h-[calc(100vh-180px)] px-2">
            {statusGroups.map((group) => (
              <Collapsible 
                key={group.id} 
                defaultOpen={group.count > 0}
                className="mb-2"
              >
                <SidebarGroup>
                  <CollapsibleTrigger asChild>
                    <SidebarGroupLabel className="cursor-pointer hover:bg-accent rounded-md transition-colors p-2">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <group.icon className={cn("h-5 w-5", group.color)} />
                          <span className="font-medium">{group.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={group.badgeVariant} className="h-5">
                            {group.count}
                          </Badge>
                          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                      </div>
                    </SidebarGroupLabel>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent className="mt-1">
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {group.items.map((building) => (
                          <SidebarMenuItem key={building.id}>
                            <SidebarMenuButton 
                              onClick={() => onBuildingClick(building)}
                              className="w-full justify-start hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex items-center gap-2 overflow-hidden w-full">
                                {/* Статусные иконки */}
                                <div className="flex gap-1">
                                  {building.hasElectricity && (
                                    <Zap className={cn(
                                      "h-3 w-3",
                                      building.electricityStatus === 'ok' ? "text-green-500" :
                                      building.electricityStatus === 'warning' ? "text-yellow-500" :
                                      "text-red-500"
                                    )} />
                                  )}
                                  {building.hasColdWater && (
                                    <Droplet className="h-3 w-3 text-blue-500" />
                                  )}
                                  {building.hasHotWater && (
                                    <Flame className="h-3 w-3 text-red-500" />
                                  )}
                                  {building.hasLeak && (
                                    <AlertTriangle className="h-3 w-3 text-orange-500 animate-pulse" />
                                  )}
                                </div>
                                <span className="truncate text-sm">{building.name}</span>
                              </div>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            ))}
          </ScrollArea>
        </SidebarContent>
        
        {/* Trigger для сворачивания sidebar */}
        <div className="absolute top-2 -right-4">
          <SidebarTrigger />
        </div>
      </Sidebar>
    </SidebarProvider>
  )
}
```

**Использование в главной странице:**

```typescript
// Подготовка данных для sidebar
const prepareStatusGroups = (buildings: BuildingMetrics[]): StatusGroup[] => {
  const groups = {
    ok: { items: [], icon: CheckCircle2, color: "text-green-500", badgeVariant: "default" },
    warning: { items: [], icon: AlertTriangle, color: "text-yellow-500", badgeVariant: "warning" },
    leak: { items: [], icon: Droplet, color: "text-blue-500", badgeVariant: "secondary" },
    critical: { items: [], icon: AlertCircle, color: "text-red-500", badgeVariant: "destructive" },
    'no-controller': { items: [], icon: XCircle, color: "text-gray-500", badgeVariant: "outline" },
  }

  buildings.forEach(building => {
    const status = determineBuildingStatus(building)
    groups[status].items.push(building)
  })

  return [
    { id: 'ok', title: 'Нет проблем', count: groups.ok.items.length, ...groups.ok },
    { id: 'warning', title: 'Предупреждение', count: groups.warning.items.length, ...groups.warning },
    { id: 'leak', title: 'Вода в подвале', count: groups.leak.items.length, ...groups.leak },
    { id: 'critical', title: 'Авария', count: groups.critical.items.length, ...groups.critical },
    { id: 'no-controller', title: 'Нет контроллера', count: groups['no-controller'].items.length, ...groups['no-controller'] },
  ]
}

// Использование
function MapPage() {
  const [buildings, setBuildings] = useState<BuildingMetrics[]>([])
  const statusGroups = prepareStatusGroups(buildings)

  const handleBuildingClick = (building: BuildingStatus) => {
    // Переместить карту к зданию и открыть popup
    map.flyTo([building.latitude, building.longitude], 16, { duration: 0.5 })
  }

  return (
    <>
      <MapStatusSidebar 
        statusGroups={statusGroups}
        onBuildingClick={handleBuildingClick}
      />
      <div id="map" />
    </>
  )
}
```

**Итого:** ~120 строк кода

**Экономия:** ~110 строк (48%)

---

## 2. Popup для маркера здания

### ❌ ДО

**JavaScript (script.js, lines 1121-1183):**
```javascript
const popupContent = `
    <div>
        <strong>${item.building_name}</strong><br>
        <table>
            <tr>
                <td><img src="${electricityImage}" style="width: 20px;" /></td>
                <td ${!item.electricity_ph1 ? "class='blinking-text-red'" : ''}>${item.electricity_ph1 !== null ? item.electricity_ph1 + "V" : "Нет данных"}</td>
                <!-- ... много вложенного HTML -->
            </tr>
        </table>
    </div>
`;
marker.bindPopup(popupContent);
```

**Проблемы:**
- 🚫 HTML в строках
- 🚫 Inline стили
- 🚫 XSS риски
- 🚫 Нет интерактивности
- 🚫 Сложно поддерживать

---

### ✅ ПОСЛЕ

**Создаем React компонент для Leaflet popup:**

```typescript
// components/map/BuildingPopup.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Zap, Droplet, Flame, AlertTriangle, Activity } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/date-utils"

interface BuildingPopupProps {
  building: BuildingMetrics
  onShowMetrics?: () => void
  onShowDetails?: () => void
}

export function BuildingPopup({ building, onShowMetrics, onShowDetails }: BuildingPopupProps) {
  const hasController = building.controller_id !== null

  // Определяем общий статус
  const isElectricityOk = building.electricity_ph1 > 200 && building.electricity_ph1 < 240
  const isColdWaterOk = building.cold_water_pressure > 1
  const hasLeak = building.leak_sensor

  const getOverallStatus = () => {
    if (hasLeak) return { variant: "destructive", text: "Протечка!", icon: Droplet, animate: true }
    if (!isElectricityOk || !isColdWaterOk) return { variant: "warning", text: "Предупреждение", icon: AlertTriangle }
    return { variant: "default", text: "Норма", icon: CheckCircle2, className: "bg-green-500" }
  }

  const status = getOverallStatus()

  return (
    <Card className="min-w-[320px] border-0">
      <CardHeader className="pb-3">
        <div className="space-y-2">
          <CardTitle className="text-base leading-tight">
            {building.building_name}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {building.address}, {building.town}
          </p>
          <Badge 
            variant={status.variant as any}
            className={cn(
              "w-fit",
              status.className,
              status.animate && "animate-pulse"
            )}
          >
            <status.icon className="h-3 w-3 mr-1" />
            {status.text}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {hasController && hasMetrics ? (
          <>
            {/* Электроснабжение */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Zap className="h-4 w-4 text-yellow-500" />
                <span>Электроснабжение</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Ф1', value: building.electricity_ph1 },
                  { label: 'Ф2', value: building.electricity_ph2 },
                  { label: 'Ф3', value: building.electricity_ph3 },
                ].map((phase) => {
                  const isOk = phase.value > 200 && phase.value < 240
                  return (
                    <div 
                      key={phase.label}
                      className={cn(
                        "p-1.5 rounded-md text-center text-xs font-medium",
                        isOk 
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" 
                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
                      )}
                    >
                      <div className="font-bold">{phase.label}</div>
                      <div>{phase.value ? `${phase.value}В` : 'N/A'}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <Separator />

            {/* Водоснабжение */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Droplet className="h-4 w-4 text-blue-500" />
                <span>Водоснабжение</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">ХВС:</span>
                  <div className="flex gap-2">
                    <Badge variant={isColdWaterOk ? "outline" : "destructive"} className="h-5">
                      {building.cold_water_pressure} бар
                    </Badge>
                    <Badge variant="outline" className="h-5">
                      {building.cold_water_temp}°C
                    </Badge>
                  </div>
                </div>
                
                {building.hot_water && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">ГВС подача:</span>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="h-5">
                          {building.hot_water_in_temp}°C
                        </Badge>
                        <Badge variant="outline" className="h-5">
                          {building.hot_water_in_pressure} бар
                        </Badge>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">ГВС обратка:</span>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="h-5">
                          {building.hot_water_out_temp}°C
                        </Badge>
                        <Badge variant="outline" className="h-5">
                          {building.hot_water_out_pressure} бар
                        </Badge>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {hasLeak && (
              <>
                <Separator />
                <div className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-950 rounded-md">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 animate-pulse" />
                    <span className="text-sm font-semibold text-red-600">Датчик протечки</span>
                  </div>
                  <Badge variant="destructive">Протечка!</Badge>
                </div>
              </>
            )}

            <Separator />

            {/* Время обновления */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                <span>Обновлено:</span>
              </div>
              <span>{formatRelativeTime(building.timestamp)}</span>
            </div>

            {/* Кнопки действий */}
            <div className="flex gap-2 pt-2">
              <Button 
                size="sm" 
                variant="outline" 
                className="flex-1"
                onClick={onShowMetrics}
              >
                <Activity className="mr-1.5 h-3.5 w-3.5" />
                Метрики
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                className="flex-1"
                onClick={onShowDetails}
              >
                ℹ️ Детали
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <XCircle className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Контроллер не подключен
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Использование с Leaflet:**

```typescript
// utils/leaflet-react-popup.tsx
import ReactDOM from 'react-dom/client'
import L from 'leaflet'

/**
 * Создает Leaflet popup с React компонентом
 */
export function createReactPopup<T>(
  Component: React.ComponentType<T>,
  props: T
): L.Popup {
  const container = document.createElement('div')
  const root = ReactDOM.createRoot(container)
  root.render(<Component {...props} />)

  const popup = L.popup({
    minWidth: 320,
    maxWidth: 400,
    className: 'react-popup'
  })
  popup.setContent(container)

  return popup
}

// Использование
const marker = L.circleMarker([lat, lng], circleOptions)

// Создаем popup с React компонентом
const popup = createReactPopup(BuildingPopup, {
  building: buildingData,
  onShowMetrics: () => openMetricsDialog(buildingData.id),
  onShowDetails: () => openDetailsDialog(buildingData.id)
})

marker.bindPopup(popup)
```

**Итого:** ~150 строк компонента + 20 строк утилиты = 170 строк

**Было:** ~250 строк inline HTML strings + CSS

**Экономия:** 32% кода + значительное улучшение читаемости и безопасности

---

## 3. Toast уведомления

### ❌ ДО (script.js, lines 378-512)

```javascript
class ToastManager {
    constructor() {
        this.container = this.createContainer();
        this.queue = [];
        this.maxVisible = 5;
    }

    show(message, type = 'info', duration = 4000) {
        // ... 100+ строк кода
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        // Ручное создание элементов
        // Ручное управление анимациями
        // Ручная очередь
        // ...
        
        this.container.appendChild(toast);
    }
}

// + 80+ строк CSS для анимаций и стилей
```

**Итого:** ~215 строк (JS + CSS)

---

### ✅ ПОСЛЕ

**Установка:**
```bash
npx shadcn@latest add sonner
```

**Настройка (в корневом компоненте):**
```typescript
// App.tsx или main layout
import { Toaster } from "sonner"

export default function App() {
  return (
    <>
      <MapPage />
      <Toaster 
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }
        }}
        richColors
        closeButton
        expand={false}
      />
    </>
  )
}
```

**Использование:**
```typescript
import { toast } from "sonner"

// Простые уведомления
toast.success("Данные обновлены")
toast.error("Ошибка загрузки")
toast.warning("Обнаружена протечка в здании #45")

// С промисом (автоматическое управление состояниями)
toast.promise(
  loadMapData(),
  {
    loading: "Загрузка данных карты...",
    success: (data) => `Загружено ${data.length} зданий`,
    error: "Ошибка при загрузке данных"
  }
)

// С описанием и действием
toast.success("Обновление завершено", {
  description: `Обновлено ${buildingsCount} зданий`,
  action: {
    label: "Просмотреть",
    onClick: () => focusOnUpdatedBuildings()
  },
  duration: 5000
})

// С кастомным JSX
toast.custom((t) => (
  <div className="flex items-center gap-3 p-4">
    <AlertTriangle className="h-5 w-5 text-orange-500" />
    <div>
      <p className="font-semibold">Внимание!</p>
      <p className="text-sm text-muted-foreground">
        Обнаружено {criticalCount} критических проблем
      </p>
    </div>
    <Button size="sm" onClick={() => toast.dismiss(t)}>
      Закрыть
    </Button>
  </div>
))
```

**Итого:** 3-5 строк на вызов + 10 строк настройки = 15 строк

**Было:** 215 строк класса ToastManager

**Экономия:** 93% кода!

---

## 4. Skeleton Loaders

### ❌ ДО

**JavaScript + CSS (script.js, lines 291-578):**
```javascript
// Создание skeleton для карты
function createMapSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.id = 'map-skeleton';
    skeleton.className = 'skeleton-map';
    return skeleton;
}

// + CSS стили (script.js, lines 291-374)
const sidebarStyles = document.createElement('style');
sidebarStyles.textContent = `
    .skeleton {
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: skeleton-loading 1.5s infinite;
    }
    /* ... еще 80+ строк CSS */
`;
```

**Итого:** ~150 строк

---

### ✅ ПОСЛЕ

```bash
npx shadcn@latest add skeleton
```

**Компонент (components/map/MapSkeleton.tsx):**
```typescript
import { Skeleton } from "@/components/ui/skeleton"
import { MapIcon } from "lucide-react"

export function MapSkeleton() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30 backdrop-blur-sm z-[999]">
      <div className="text-center space-y-4">
        <div className="relative">
          <MapIcon className="h-16 w-16 text-muted-foreground/50 animate-pulse" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-3 w-24 mx-auto" />
        </div>
      </div>
    </div>
  )
}

export function SidebarGroupSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-8 ml-auto rounded-full" />
      </div>
      <div className="space-y-2 pl-7">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  )
}

export function LayerControlSkeleton() {
  return (
    <div className="w-80 space-y-3 p-4">
      <Skeleton className="h-6 w-32" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Использование:**
```typescript
function MapPage() {
  const [isLoading, setIsLoading] = useState(true)

  if (isLoading) {
    return (
      <>
        <MapSkeleton />
        <div className="absolute top-4 left-4">
          <SidebarGroupSkeleton />
        </div>
      </>
    )
  }

  return <Map data={data} />
}
```

**Итого:** ~70 строк

**Было:** 150 строк

**Экономия:** 53% кода

---

## 5. Панель управления слоями карты

### ❌ ДО (map-layers-control.js, lines 65-224)

```javascript
createLayerControl() {
    const controlDiv = L.DomUtil.create('div', 'layers-control-panel');
    
    const header = document.createElement('div');
    header.className = 'layers-header';
    // ... 100+ строк ручного создания DOM
    
    return controlDiv;
}
```

---

### ✅ ПОСЛЕ

```typescript
// components/map/LayersControl.tsx
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, X } from "lucide-react"

interface LayerConfig {
  id: string
  name: string
  icon: string
  visible: boolean
  count: number
}

interface LayersControlProps {
  baseLayers: { id: string, name: string, icon: string }[]
  overlayLayers: LayerConfig[]
  selectedBaseLayer: string
  onBaseLayerChange: (id: string) => void
  onOverlayToggle: (id: string, visible: boolean) => void
  className?: string
}

export function LayersControl({
  baseLayers,
  overlayLayers,
  selectedBaseLayer,
  onBaseLayerChange,
  onOverlayToggle,
  className
}: LayersControlProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Card className={cn("w-80 shadow-lg", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            🗺️ Слои карты
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronDown className={cn(
              "h-4 w-4 transition-transform",
              collapsed && "rotate-180"
            )} />
          </Button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-4">
          {/* Базовые слои */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Базовые слои
            </Label>
            <RadioGroup value={selectedBaseLayer} onValueChange={onBaseLayerChange}>
              {baseLayers.map((layer) => (
                <div key={layer.id} className="flex items-center space-x-2">
                  <RadioGroupItem value={layer.id} id={layer.id} />
                  <Label htmlFor={layer.id} className="cursor-pointer text-sm flex items-center gap-2">
                    <span>{layer.icon}</span>
                    {layer.name}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <Separator />

          {/* Overlay слои */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Объекты инфраструктуры
            </Label>
            <div className="space-y-2">
              {overlayLayers.map((layer) => (
                <div key={layer.id} className="flex items-center justify-between group">
                  <div className="flex items-center space-x-2 flex-1">
                    <Switch
                      id={layer.id}
                      checked={layer.visible}
                      onCheckedChange={(checked) => onOverlayToggle(layer.id, checked)}
                      className="data-[state=checked]:bg-green-500"
                    />
                    <Label 
                      htmlFor={layer.id} 
                      className="cursor-pointer text-sm flex items-center gap-2 flex-1"
                    >
                      <span>{layer.icon}</span>
                      <span className="flex-1">{layer.name}</span>
                    </Label>
                  </div>
                  <Badge 
                    variant={layer.visible ? "default" : "outline"}
                    className={cn(
                      "ml-2 transition-all",
                      layer.visible ? "bg-green-500" : ""
                    )}
                  >
                    {layer.count}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
```

**Использование:**
```typescript
<LayersControl
  baseLayers={[
    { id: 'map', name: 'Карта', icon: '🗺️' },
    { id: 'satellite', name: 'Спутник', icon: '🛰️' },
    { id: 'terrain', name: 'Рельеф', icon: '🏔️' },
  ]}
  overlayLayers={[
    { id: 'buildings', name: 'Здания', icon: '🏢', visible: true, count: 45 },
    { id: 'transformers', name: 'Трансформаторы', icon: '⚡', visible: false, count: 12 },
    // ...
  ]}
  selectedBaseLayer="map"
  onBaseLayerChange={handleBaseLayerChange}
  onOverlayToggle={handleOverlayToggle}
  className="absolute top-4 right-4 z-[1000]"
/>
```

**Итого:** ~120 строк

**Было:** ~200 строк

**Экономия:** 40% кода

---

## 🎯 Итоговая таблица экономии

| Компонент | До | После | Экономия | Приоритет |
|-----------|-----|-------|----------|-----------|
| Sidebar | 230 | 120 | **48%** | ⚡ Высокий |
| Popup | 250 | 170 | **32%** | ⚡ Высокий |
| Toast | 215 | 15 | **93%** | 📝 Средний |
| Skeleton | 150 | 70 | **53%** | 📝 Средний |
| Layer Control | 200 | 120 | **40%** | 📝 Средний |
| Update Control | 100 | 70 | **30%** | 📌 Низкий |
| **ВСЕГО** | **1145** | **565** | **51%** | - |

---

## 🚀 Быстрый старт (2 часа до результата)

### Шаг 1: Установка (15 минут)
```bash
npx shadcn@latest init
npx shadcn@latest add sonner skeleton badge
```

### Шаг 2: Замена Toast (30 минут)
```typescript
// Было
window.showToast('Данные загружены', 'success')

// Стало
import { toast } from "sonner"
toast.success('Данные загружены')
```

### Шаг 3: Обновление skeleton (45 минут)
- Создать MapSkeleton компонент
- Заменить showMapSkeleton() на <MapSkeleton />

### Шаг 4: Улучшение popup (30 минут)
- Создать BuildingPopup компонент
- Интегрировать с Leaflet через createReactPopup()

**Итого: ~2 часа и вы увидите значительные улучшения! 🎉**

---

## 📚 Следующие шаги

1. **Прочитайте** [Основной анализ shadcn/ui](./shadcn-ui-analysis.md)
2. **Изучите** [Краткое резюме](./shadcn-ui-quick-summary.md)
3. **Начните** с замены Toast на sonner (30 минут)
4. **Продолжайте** с остальными компонентами

**Удачи с миграцией! 🚀**

