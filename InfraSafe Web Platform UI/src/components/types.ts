export interface Building {
  id: string;
  lat: number;
  lng: number;
  address: string;
  status: 'normal' | 'warning' | 'error' | 'sensor' | 'unknown';
  temperature?: number;
  pressure?: number;
  waterLeak: boolean;
  gasLeak: boolean;
  powerStatus: boolean;
  heatingStatus: boolean;
  hotWaterStatus: boolean;
  coldWaterStatus: boolean;
  lastUpdate: string;
}
