import { useState, useMemo } from 'react';
import { FilterPanel } from './FilterPanel';
import { MapView } from './MapView';
import { Building } from './types';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { UserPlus, Info } from 'lucide-react';

interface DashboardProps {
  t: any;
  isGuest?: boolean;
  onRegister?: () => void;
}

// Mock data
const generateMockBuildings = (): Building[] => {
  const statuses: Array<'normal' | 'warning' | 'error' | 'sensor' | 'unknown'> = 
    ['normal', 'warning', 'error', 'sensor', 'unknown'];
  
  const addresses = [
    'ул. Амира Темура, 12',
    'ул. Навои, 45',
    'ул. Чиланзарская, 23',
    'просп. Мустакиллик, 78',
    'ул. Бунёдкор, 34',
    'ул. Шота Руставели, 56',
    'ул. Абая, 89',
    'ул. Лабзак, 15',
    'ул. Ойбек, 67',
    'ул. Фараби, 43',
    'ул. Космонавтов, 92',
    'ул. Беруни, 28',
  ];

  return addresses.map((address, index) => ({
    id: `building-${index}`,
    lat: 41.2995 + (Math.random() - 0.5) * 0.05,
    lng: 69.2401 + (Math.random() - 0.5) * 0.05,
    address,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    temperature: 18 + Math.random() * 8,
    pressure: 1.5 + Math.random() * 0.5,
    waterLeak: Math.random() > 0.85,
    gasLeak: Math.random() > 0.95,
    powerStatus: Math.random() > 0.05,
    heatingStatus: Math.random() > 0.1,
    hotWaterStatus: Math.random() > 0.1,
    coldWaterStatus: Math.random() > 0.05,
    lastUpdate: new Date(Date.now() - Math.random() * 3600000).toLocaleString('ru-RU'),
  }));
};

export function Dashboard({ t, isGuest = false, onRegister }: DashboardProps) {
  const [buildings] = useState<Building[]>(generateMockBuildings());
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredBuildings = useMemo(() => {
    let filtered = buildings;

    // Filter by status
    if (activeFilter !== 'all') {
      filtered = filtered.filter((b) => b.status === activeFilter);
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter((b) =>
        b.address.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  }, [buildings, activeFilter, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: buildings.length,
      normal: buildings.filter((b) => b.status === 'normal').length,
      warning: buildings.filter((b) => b.status === 'warning').length,
      error: buildings.filter((b) => b.status === 'error').length,
      sensor: buildings.filter((b) => b.status === 'sensor').length,
      unknown: buildings.filter((b) => b.status === 'unknown').length,
    };
  }, [buildings]);

  const handleRefresh = () => {
    // In real app, this would fetch new data
    console.log('Refreshing data...');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] gap-4 p-4">
      {/* Guest Mode Banner */}
      {isGuest && (
        <Alert className="neomorph border-accent/50">
          <Info className="h-4 w-4 text-accent" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              {t.guestLimited}
            </span>
            <Button 
              onClick={onRegister}
              className="gap-2 flex-shrink-0"
              size="sm"
            >
              <UserPlus className="w-4 h-4" />
              {t.register}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col lg:flex-row flex-1 gap-4 min-h-0">
        <FilterPanel
          t={t}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onRefresh={handleRefresh}
          counts={counts}
          buildings={buildings}
        />
        
        <div className="flex-1 h-full">
          <MapView buildings={filteredBuildings} t={t} />
        </div>
      </div>
    </div>
  );
}
