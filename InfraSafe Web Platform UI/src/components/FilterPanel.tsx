import { Search, RefreshCw, Home, AlertCircle, AlertTriangle, Activity, HelpCircle, ChevronDown, ChevronUp, Zap, Droplets, Flame } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Building } from './types';
import { useState } from 'react';

interface FilterPanelProps {
  t: any;
  activeFilter: string;
  setActiveFilter: (filter: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onRefresh: () => void;
  counts: {
    all: number;
    normal: number;
    warning: number;
    error: number;
    sensor: number;
    unknown: number;
  };
  buildings: Building[];
}

export function FilterPanel({ 
  t, 
  activeFilter, 
  setActiveFilter,
  searchQuery,
  setSearchQuery,
  onRefresh,
  counts,
  buildings
}: FilterPanelProps) {
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (id: string) => {
    setOpenCategories(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filters = [
    { id: 'all', label: t.allObjects, icon: Home, color: 'bg-muted', count: counts.all },
    { id: 'normal', label: t.normal, icon: Activity, color: 'bg-green-500', count: counts.normal },
    { id: 'warning', label: t.warning, icon: AlertTriangle, color: 'bg-yellow-500', count: counts.warning },
    { id: 'error', label: t.error, icon: AlertCircle, color: 'bg-red-500', count: counts.error },
    { id: 'sensor', label: t.sensor, icon: Activity, color: 'bg-blue-500', count: counts.sensor },
    { id: 'unknown', label: t.unknown, icon: HelpCircle, color: 'bg-gray-400', count: counts.unknown },
  ];

  const getBuildingsByStatus = (status: string) => {
    if (status === 'all') return buildings;
    return buildings.filter(b => b.status === status);
  };

  return (
    <div className="w-full lg:w-80 h-full neomorph p-4 flex flex-col gap-4 overflow-y-auto">
      <div>
        <h3>{t.filters}</h3>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={t.search}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 glass"
        />
      </div>

      {/* Refresh Button */}
      <Button 
        onClick={onRefresh} 
        className="w-full gap-2"
        variant="outline"
      >
        <RefreshCw className="w-4 h-4" />
        {t.refreshData}
      </Button>

      {/* Filter Buttons with Expandable Lists */}
      <div className="flex flex-col gap-2">
        {filters.map((filter) => {
          const Icon = filter.icon;
          const isActive = activeFilter === filter.id;
          const isOpen = openCategories[filter.id] || false;
          const buildingList = getBuildingsByStatus(filter.id);
          
          return (
            <Collapsible
              key={filter.id}
              open={isOpen}
              onOpenChange={() => toggleCategory(filter.id)}
            >
              <div className={`rounded-lg ${isActive ? 'neomorph-active' : 'neomorph'} overflow-hidden transition-all duration-300`}>
                <div className="flex items-center gap-2 p-3">
                  <CollapsibleTrigger className="flex items-center gap-3 flex-1">
                    <div className={`w-3 h-3 rounded-full ${filter.color} flex-shrink-0`} />
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left">{filter.label}</span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </CollapsibleTrigger>
                  <Badge 
                    variant={isActive ? 'secondary' : 'outline'}
                    className="cursor-pointer flex-shrink-0"
                    onClick={() => setActiveFilter(filter.id)}
                  >
                    {filter.count}
                  </Badge>
                </div>

                <CollapsibleContent className="border-t border-border/50">
                  <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
                    {buildingList.length > 0 ? (
                      buildingList.map((building) => (
                        <div
                          key={building.id}
                          className="glass rounded-lg p-2 flex items-center gap-2 hover:bg-accent/10 transition-colors cursor-pointer"
                          onClick={() => setActiveFilter(filter.id)}
                        >
                          <div className="flex gap-1">
                            <Zap 
                              className={`w-4 h-4 ${building.powerStatus ? 'text-green-500' : 'text-red-500'}`} 
                            />
                            <Droplets 
                              className={`w-4 h-4 ${building.coldWaterStatus ? 'text-blue-500' : 'text-red-500'}`} 
                            />
                            <Droplets 
                              className={`w-4 h-4 ${building.hotWaterStatus ? 'text-orange-500' : 'text-red-500'}`} 
                            />
                            <Flame 
                              className={`w-4 h-4 ${building.heatingStatus ? 'text-orange-600' : 'text-red-500'}`} 
                            />
                          </div>
                          <span className="text-sm flex-1">{building.address}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        {t.noData || 'Нет данных'}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
