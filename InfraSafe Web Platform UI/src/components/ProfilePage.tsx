import { Card } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Building2, 
  Calendar, 
  Shield,
  Edit2,
  Camera,
  Save,
  Lock,
  Eye,
  EyeOff,
  Activity,
  Clock
} from 'lucide-react';
import { useState } from 'react';

interface ProfilePageProps {
  t: any;
  isGuest?: boolean;
}

export function ProfilePage({ t, isGuest = false }: ProfilePageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  
  // Mock user data
  const [userData, setUserData] = useState({
    firstName: 'Алишер',
    lastName: 'Усманов',
    email: 'alisher.usmanov@infrasafe.uz',
    phone: '+998 90 123 45 67',
    position: 'Главный инженер',
    department: 'Отдел мониторинга',
    city: 'Ташкент',
    address: 'ул. Амира Темура, 12',
    joinDate: '15 января 2023',
    lastActive: '23 октября 2025, 14:32',
    role: 'Администратор',
    avatar: '',
  });

  const handleSave = () => {
    setIsEditing(false);
    alert(t.profileUpdated);
  };

  const activityLog = [
    {
      action: t.language === 'ru' ? 'Вход в систему' : t.language === 'en' ? 'Logged in' : 'Tizimga kirish',
      date: '23 октября 2025, 14:32',
      device: 'Chrome, Windows 10',
      ip: '185.120.34.56'
    },
    {
      action: t.language === 'ru' ? 'Изменение настроек' : t.language === 'en' ? 'Settings changed' : 'Sozlamalar o\'zgartirildi',
      date: '22 октября 2025, 10:15',
      device: 'Chrome, Windows 10',
      ip: '185.120.34.56'
    },
    {
      action: t.language === 'ru' ? 'Просмотр объекта' : t.language === 'en' ? 'Viewed object' : 'Obyekt ko\'rildi',
      date: '21 октября 2025, 16:45',
      device: 'Chrome, Windows 10',
      ip: '185.120.34.56'
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="space-y-6">
        {/* Header with Avatar */}
        <Card className="p-6 neomorph">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="relative">
              <Avatar className="w-24 h-24 border-4 border-accent/20">
                <AvatarImage src={userData.avatar} />
                <AvatarFallback className="bg-accent/10">
                  <User className="w-12 h-12 text-accent" />
                </AvatarFallback>
              </Avatar>
              {!isGuest && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute bottom-0 right-0 w-8 h-8 rounded-full neomorph"
                >
                  <Camera className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <h1>{userData.firstName} {userData.lastName}</h1>
                <Badge variant="default" className="bg-accent">
                  {userData.role}
                </Badge>
                {isGuest && (
                  <Badge variant="secondary">
                    {t.guestMode}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  {userData.email}
                </span>
                <span className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  {userData.phone}
                </span>
                <span className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  {userData.city}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span className="text-sm">
                  {t.lastActive} {userData.lastActive}
                </span>
              </div>
            </div>

            {!isGuest && !isEditing && (
              <Button onClick={() => setIsEditing(true)} className="gap-2">
                <Edit2 className="w-4 h-4" />
                {t.edit}
              </Button>
            )}
          </div>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-3 neomorph">
            <TabsTrigger value="profile">
              <User className="w-4 h-4 mr-2" />
              {t.profile}
            </TabsTrigger>
            <TabsTrigger value="security">
              <Shield className="w-4 h-4 mr-2" />
              {t.security}
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="w-4 h-4 mr-2" />
              {t.activity}
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            <Card className="p-6 neomorph">
              <h3 className="mb-6">
                {t.language === 'ru' ? 'Личная информация' : 
                 t.language === 'en' ? 'Personal Information' : 'Shaxsiy ma\'lumotlar'}
              </h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">
                      {t.firstName}
                    </Label>
                    <Input 
                      id="firstName" 
                      value={userData.firstName}
                      onChange={(e) => setUserData({...userData, firstName: e.target.value})}
                      disabled={!isEditing || isGuest}
                      className="glass" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">
                      {t.lastName}
                    </Label>
                    <Input 
                      id="lastName" 
                      value={userData.lastName}
                      onChange={(e) => setUserData({...userData, lastName: e.target.value})}
                      disabled={!isEditing || isGuest}
                      className="glass" 
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="flex gap-2 items-center">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <Input 
                      id="email" 
                      type="email" 
                      value={userData.email}
                      onChange={(e) => setUserData({...userData, email: e.target.value})}
                      disabled={!isEditing || isGuest}
                      className="glass flex-1" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">
                    {t.phone}
                  </Label>
                  <div className="flex gap-2 items-center">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <Input 
                      id="phone" 
                      type="tel" 
                      value={userData.phone}
                      onChange={(e) => setUserData({...userData, phone: e.target.value})}
                      disabled={!isEditing || isGuest}
                      className="glass flex-1" 
                    />
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="position">
                      {t.position}
                    </Label>
                    <Input 
                      id="position" 
                      value={userData.position}
                      onChange={(e) => setUserData({...userData, position: e.target.value})}
                      disabled={!isEditing || isGuest}
                      className="glass" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="department">
                      {t.language === 'ru' ? 'Отдел' : t.language === 'en' ? 'Department' : 'Bo\'lim'}
                    </Label>
                    <Input 
                      id="department" 
                      value={userData.department}
                      onChange={(e) => setUserData({...userData, department: e.target.value})}
                      disabled={!isEditing || isGuest}
                      className="glass" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">
                    {t.language === 'ru' ? 'Адрес' : t.language === 'en' ? 'Address' : 'Manzil'}
                  </Label>
                  <div className="flex gap-2 items-center">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <Input 
                      id="address" 
                      value={userData.address}
                      onChange={(e) => setUserData({...userData, address: e.target.value})}
                      disabled={!isEditing || isGuest}
                      className="glass flex-1" 
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm">
                    {t.language === 'ru' ? 'Дата регистрации:' : 
                     t.language === 'en' ? 'Join date:' : 'Ro\'yxatdan o\'tgan sana:'} {userData.joinDate}
                  </span>
                </div>
              </div>

              {isEditing && !isGuest && (
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={() => setIsEditing(false)}>
                    {t.language === 'ru' ? 'Отмена' : t.language === 'en' ? 'Cancel' : 'Bekor qilish'}
                  </Button>
                  <Button onClick={handleSave} className="gap-2">
                    <Save className="w-4 h-4" />
                    {t.language === 'ru' ? 'Сохранить' : t.language === 'en' ? 'Save' : 'Saqlash'}
                  </Button>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6">
            {isGuest ? (
              <Card className="p-8 neomorph text-center">
                <Shield className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="mb-2">
                  {t.language === 'ru' ? 'Гостевой доступ' : 
                   t.language === 'en' ? 'Guest Access' : 'Mehmon kirishi'}
                </h3>
                <p className="text-muted-foreground">
                  {t.language === 'ru' ? 'Настройки безопасности недоступны в гостевом режиме' : 
                   t.language === 'en' ? 'Security settings are not available in guest mode' : 
                   'Xavfsizlik sozlamalari mehmon rejimida mavjud emas'}
                </p>
              </Card>
            ) : (
              <>
                <Card className="p-6 neomorph">
                  <h3 className="mb-6">
                    {t.language === 'ru' ? 'Изменить пароль' : 
                     t.language === 'en' ? 'Change Password' : 'Parolni o\'zgartirish'}
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="oldPassword">
                        {t.language === 'ru' ? 'Текущий пароль' : 
                         t.language === 'en' ? 'Current Password' : 'Joriy parol'}
                      </Label>
                      <div className="relative">
                        <Input 
                          id="oldPassword" 
                          type={showOldPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="glass pr-10" 
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowOldPassword(!showOldPassword)}
                        >
                          {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="newPassword">
                        {t.language === 'ru' ? 'Новый пароль' : 
                         t.language === 'en' ? 'New Password' : 'Yangi parol'}
                      </Label>
                      <div className="relative">
                        <Input 
                          id="newPassword" 
                          type={showNewPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="glass pr-10" 
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">
                        {t.language === 'ru' ? 'Подтвердите пароль' : 
                         t.language === 'en' ? 'Confirm Password' : 'Parolni tasdiqlang'}
                      </Label>
                      <Input 
                        id="confirmPassword" 
                        type="password"
                        placeholder="••••••••"
                        className="glass" 
                      />
                    </div>

                    <Button className="w-full gap-2">
                      <Lock className="w-4 h-4" />
                      {t.language === 'ru' ? 'Обновить пароль' : 
                       t.language === 'en' ? 'Update Password' : 'Parolni yangilash'}
                    </Button>
                  </div>
                </Card>

                <Card className="p-6 neomorph">
                  <h3 className="mb-6">
                    {t.language === 'ru' ? 'Двухфакторная аутентификация' : 
                     t.language === 'en' ? 'Two-Factor Authentication' : 'Ikki faktorli autentifikatsiya'}
                  </h3>
                  
                  <div className="flex items-center justify-between p-4 rounded-lg glass">
                    <div>
                      <p className="mb-1">
                        {t.language === 'ru' ? 'Статус: Отключена' : 
                         t.language === 'en' ? 'Status: Disabled' : 'Holat: O\'chirilgan'}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {t.language === 'ru' ? 'Повысьте безопасность вашего аккаунта' : 
                         t.language === 'en' ? 'Enhance your account security' : 
                         'Hisob xavfsizligini oshiring'}
                      </p>
                    </div>
                    <Button variant="outline">
                      {t.language === 'ru' ? 'Включить' : t.language === 'en' ? 'Enable' : 'Yoqish'}
                    </Button>
                  </div>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-6">
            <Card className="p-6 neomorph">
              <h3 className="mb-6">
                {t.language === 'ru' ? 'История активности' : 
                 t.language === 'en' ? 'Activity History' : 'Faollik tarixi'}
              </h3>
              
              <div className="space-y-3">
                {activityLog.map((log, index) => (
                  <div key={index} className="p-4 rounded-lg glass">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Activity className="w-4 h-4 text-accent" />
                          <p>{log.action}</p>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3" />
                            <span>{log.date}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span>{log.device}</span>
                            <Badge variant="outline" className="text-xs">
                              IP: {log.ip}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 text-center">
                <Button variant="outline" className="w-full">
                  {t.language === 'ru' ? 'Показать больше' : 
                   t.language === 'en' ? 'Show More' : 'Ko\'proq ko\'rsatish'}
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
