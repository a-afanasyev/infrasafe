import { Card } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Separator } from './ui/separator';
import { User, Key, Bell, Cpu, Save } from 'lucide-react';
import { useState } from 'react';

interface SettingsPageProps {
  t: any;
}

export function SettingsPage({ t }: SettingsPageProps) {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [telegramNotifications, setTelegramNotifications] = useState(true);

  const handleSave = () => {
    alert(t.language === 'ru' ? 'Настройки сохранены!' : 
          t.language === 'en' ? 'Settings saved!' : 'Sozlamalar saqlandi!');
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="space-y-8">
        <div>
          <h1>{t.settings}</h1>
          <p className="text-muted-foreground mt-2">
            {t.language === 'ru' ? 'Управление настройками вашего аккаунта' : 
             t.language === 'en' ? 'Manage your account settings' : 'Hisob sozlamalarini boshqarish'}
          </p>
        </div>

        {/* Profile Settings */}
        <Card className="p-6 neomorph">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-accent" />
            <h3>{t.profile}</h3>
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">
                  {t.language === 'ru' ? 'Имя' : t.language === 'en' ? 'First Name' : 'Ism'}
                </Label>
                <Input id="firstName" placeholder="John" className="glass" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">
                  {t.language === 'ru' ? 'Фамилия' : t.language === 'en' ? 'Last Name' : 'Familiya'}
                </Label>
                <Input id="lastName" placeholder="Doe" className="glass" />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input id="email" type="email" placeholder="user@example.com" className="glass" />
            </div>
          </div>
        </Card>

        {/* API Keys */}
        <Card className="p-6 neomorph">
          <div className="flex items-center gap-3 mb-6">
            <Key className="w-5 h-5 text-accent" />
            <h3>{t.apiKeys}</h3>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mapApiKey">
                {t.language === 'ru' ? 'API ключ карты' : t.language === 'en' ? 'Map API Key' : 'Xarita API kaliti'}
              </Label>
              <Input 
                id="mapApiKey" 
                type="password" 
                placeholder="YOUR_MAP_API_KEY" 
                className="glass"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="platformApiKey">
                {t.language === 'ru' ? 'API ключ платформы' : t.language === 'en' ? 'Platform API Key' : 'Platforma API kaliti'}
              </Label>
              <div className="flex gap-2">
                <Input 
                  id="platformApiKey" 
                  type="password" 
                  value="sk_live_xxxxxxxxxxxxxxxxxxxx" 
                  className="glass"
                  readOnly
                />
                <Button variant="outline">
                  {t.language === 'ru' ? 'Копировать' : t.language === 'en' ? 'Copy' : 'Nusxalash'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Notifications */}
        <Card className="p-6 neomorph">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-5 h-5 text-accent" />
            <h3>{t.notifications}</h3>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Email {t.notifications}</Label>
                <p className="text-muted-foreground">
                  {t.language === 'ru' ? 'Получать уведомления на email' : 
                   t.language === 'en' ? 'Receive notifications via email' : 'Email orqali xabarnomalar olish'}
                </p>
              </div>
              <Switch 
                checked={emailNotifications} 
                onCheckedChange={setEmailNotifications}
              />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>SMS {t.notifications}</Label>
                <p className="text-muted-foreground">
                  {t.language === 'ru' ? 'Получать SMS уведомления' : 
                   t.language === 'en' ? 'Receive SMS notifications' : 'SMS xabarnomalarini olish'}
                </p>
              </div>
              <Switch 
                checked={smsNotifications} 
                onCheckedChange={setSmsNotifications}
              />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Telegram {t.notifications}</Label>
                <p className="text-muted-foreground">
                  {t.language === 'ru' ? 'Получать уведомления в Telegram' : 
                   t.language === 'en' ? 'Receive notifications via Telegram' : 'Telegram orqali xabarnomalar olish'}
                </p>
              </div>
              <Switch 
                checked={telegramNotifications} 
                onCheckedChange={setTelegramNotifications}
              />
            </div>
          </div>
        </Card>

        {/* Devices */}
        <Card className="p-6 neomorph">
          <div className="flex items-center gap-3 mb-6">
            <Cpu className="w-5 h-5 text-accent" />
            <h3>{t.devices}</h3>
          </div>
          
          <div className="space-y-3">
            {[
              { name: 'Temperature Sensor #1', status: 'online', lastSeen: '2 min ago' },
              { name: 'Pressure Sensor #2', status: 'online', lastSeen: '5 min ago' },
              { name: 'Water Leak Detector #3', status: 'offline', lastSeen: '2 hours ago' },
            ].map((device, index) => (
              <div key={index} className="flex items-center justify-between p-3 rounded-lg glass">
                <div>
                  <p>{device.name}</p>
                  <p className="text-muted-foreground">{device.lastSeen}</p>
                </div>
                <div className={`px-3 py-1 rounded-full ${
                  device.status === 'online' 
                    ? 'bg-green-500/10 text-green-500' 
                    : 'bg-gray-500/10 text-gray-500'
                }`}>
                  {device.status}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} className="gap-2">
            <Save className="w-4 h-4" />
            {t.language === 'ru' ? 'Сохранить изменения' : 
             t.language === 'en' ? 'Save Changes' : 'O\'zgarishlarni saqlash'}
          </Button>
        </div>
      </div>
    </div>
  );
}
