import { useState, useRef } from 'react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Thermometer, Gauge, Droplet, Zap, Calendar, ZoomIn, ZoomOut, Maximize2, Home, Flame, Droplets } from 'lucide-react';
import { Button } from './ui/button';
import { Building } from './types';

interface MapViewProps {
  buildings: Building[];
  t: any;
}

export function MapView({ buildings, t }: MapViewProps) {
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const mapRef = useRef<HTMLDivElement>(null);

  // Status colors
  const statusColors: Record<string, string> = {
    normal: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    sensor: '#3B82F6',
    unknown: '#9CA3AF',
  };

  // Convert lat/lng to pixel coordinates (simplified projection)
  const latLngToPixel = (lat: number, lng: number) => {
    const centerLat = 41.2995;
    const centerLng = 69.2401;
    const scale = 10000;
    
    const x = (lng - centerLng) * scale * zoom + pan.x;
    const y = -(lat - centerLat) * scale * zoom + pan.y;
    
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoomIn = () => {
    setZoom(Math.min(zoom * 1.5, 5));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom / 1.5, 0.5));
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="w-full h-full relative rounded-2xl overflow-hidden neomorph">
      {/* Map Container */}
      <div
        ref={mapRef}
        className="w-full h-full bg-gradient-to-br from-blue-50 to-green-50 dark:from-gray-900 dark:to-gray-800 relative overflow-hidden cursor-move"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Grid Background */}
        <svg className="absolute inset-0 w-full h-full opacity-20">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Street Lines */}
        <svg className="absolute inset-0 w-full h-full">
          <g transform={`translate(${window.innerWidth / 2 + pan.x}, ${window.innerHeight / 2 + pan.y}) scale(${zoom})`}>
            {/* Horizontal streets */}
            {[-200, -100, 0, 100, 200].map((y, i) => (
              <line
                key={`h-${i}`}
                x1="-400"
                y1={y}
                x2="400"
                y2={y}
                stroke="currentColor"
                strokeWidth="2"
                className="text-muted-foreground opacity-30"
              />
            ))}
            {/* Vertical streets */}
            {[-300, -150, 0, 150, 300].map((x, i) => (
              <line
                key={`v-${i}`}
                x1={x}
                y1="-400"
                x2={x}
                y2="400"
                stroke="currentColor"
                strokeWidth="2"
                className="text-muted-foreground opacity-30"
              />
            ))}
          </g>
        </svg>

        {/* Buildings */}
        <div className="absolute inset-0 flex items-center justify-center">
          {buildings.map((building) => {
            const pos = latLngToPixel(building.lat, building.lng);
            return (
              <div
                key={building.id}
                className="absolute transition-all duration-200 hover:scale-125 cursor-pointer"
                style={{
                  left: `calc(50% + ${pos.x}px)`,
                  top: `calc(50% + ${pos.y}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
                onClick={() => setSelectedBuilding(building)}
              >
                {/* Building marker */}
                <div
                  className="w-8 h-8 rounded-full border-4 border-white shadow-lg animate-pulse"
                  style={{
                    backgroundColor: statusColors[building.status],
                  }}
                />
                {/* Building icon */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full mb-1">
                  <div className="w-6 h-8 bg-current opacity-60 rounded-t" style={{ color: statusColors[building.status] }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Map Controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <Button
            size="icon"
            variant="secondary"
            className="neomorph"
            onClick={handleZoomIn}
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="neomorph"
            onClick={handleZoomOut}
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="neomorph"
            onClick={handleReset}
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Map Attribution */}
        <div className="absolute bottom-4 left-4 text-xs text-muted-foreground glass px-3 py-1 rounded-lg">
          OpenStreetMap Compatible | Tashkent, Uzbekistan
        </div>
      </div>

      {/* Building Info Popup */}
      {selectedBuilding && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4 z-10">
          <Card className="w-full max-w-2xl p-6 neomorph animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setSelectedBuilding(null)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground z-10"
            >
              ✕
            </button>
            
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2 pr-8">
                <div className="flex items-center gap-3">
                  <Home className="w-6 h-6 text-accent" />
                  <h3 className="flex-1">{selectedBuilding.address}</h3>
                </div>
                <Badge
                  variant={selectedBuilding.status === 'error' ? 'destructive' : 'default'}
                  className={
                    selectedBuilding.status === 'normal' ? 'bg-green-500 text-white' :
                    selectedBuilding.status === 'warning' ? 'bg-yellow-500 text-white' :
                    selectedBuilding.status === 'sensor' ? 'bg-blue-500 text-white' :
                    selectedBuilding.status === 'unknown' ? 'bg-gray-400 text-white' : ''
                  }
                >
                  {t[selectedBuilding.status]}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {selectedBuilding.temperature && (
                  <div className="flex items-start gap-2">
                    <Thermometer className="w-5 h-5 text-accent mt-1" />
                    <div>
                      <p className="text-muted-foreground text-xs">{t.temperature}</p>
                      <p>{selectedBuilding.temperature.toFixed(1)}°C</p>
                    </div>
                  </div>
                )}

                {selectedBuilding.pressure && (
                  <div className="flex items-start gap-2">
                    <Gauge className="w-5 h-5 text-accent mt-1" />
                    <div>
                      <p className="text-muted-foreground text-xs">{t.pressure}</p>
                      <p>{selectedBuilding.pressure.toFixed(2)} bar</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2">
                  <Droplet className="w-5 h-5 text-accent mt-1" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.waterLeak}</p>
                    <p className="text-xs">{selectedBuilding.waterLeak ? '⚠️ Обнаружена' : '✓ Нет'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Zap className="w-5 h-5 text-accent mt-1" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.powerStatus}</p>
                    <p className="text-xs">{selectedBuilding.powerStatus ? '✓ Активно' : '⚠️ Отключено'}</p>
                  </div>
                </div>
              </div>

              {/* Utility Services Status */}
              <div className="pt-4 border-t">
                <h4 className="mb-3">Коммунальные службы</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="flex items-center gap-2">
                    <Zap className={`w-5 h-5 ${selectedBuilding.powerStatus ? 'text-green-500' : 'text-red-500'}`} />
                    <div>
                      <p className="text-xs text-muted-foreground">Электричество</p>
                      <p className="text-xs">{selectedBuilding.powerStatus ? '✓ Норма' : '⚠️ Отключено'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Droplets className={`w-5 h-5 ${selectedBuilding.coldWaterStatus ? 'text-blue-500' : 'text-red-500'}`} />
                    <div>
                      <p className="text-xs text-muted-foreground">Холодная вода</p>
                      <p className="text-xs">{selectedBuilding.coldWaterStatus ? '✓ Норма' : '⚠️ Отключено'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Droplets className={`w-5 h-5 ${selectedBuilding.hotWaterStatus ? 'text-orange-500' : 'text-red-500'}`} />
                    <div>
                      <p className="text-xs text-muted-foreground">Горячая вода</p>
                      <p className="text-xs">{selectedBuilding.hotWaterStatus ? '✓ Норма' : '⚠️ Отключено'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Flame className={`w-5 h-5 ${selectedBuilding.heatingStatus ? 'text-orange-600' : 'text-red-500'}`} />
                    <div>
                      <p className="text-xs text-muted-foreground">Отопление</p>
                      <p className="text-xs">{selectedBuilding.heatingStatus ? '✓ Норма' : '⚠️ Отключено'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-4 border-t mt-4">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <p className="text-muted-foreground text-xs">
                {t.lastUpdate}: {selectedBuilding.lastUpdate}
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
