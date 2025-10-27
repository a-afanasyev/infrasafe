import { Card } from './ui/card';
import { Building2, Activity, Shield, Users, Wifi, Cloud } from 'lucide-react';
import serendipityLogo from 'figma:asset/e75f234fc7eb829c0a9c6eb1330596b0f093eb89.png';

interface AboutPageProps {
  t: any;
}

export function AboutPage({ t }: AboutPageProps) {
  const features = [
    {
      icon: Activity,
      title: t.language === 'ru' ? 'Мониторинг в реальном времени' : 
            t.language === 'en' ? 'Real-time Monitoring' : 'Real vaqt monitoringi',
      description: t.language === 'ru' ? 'Отслеживайте состояние инфраструктуры 24/7' : 
                   t.language === 'en' ? 'Track infrastructure status 24/7' : 'Infratuzilma holatini 24/7 kuzating',
    },
    {
      icon: Shield,
      title: t.language === 'ru' ? 'Безопасность данных' : 
            t.language === 'en' ? 'Data Security' : 'Ma\'lumotlar xavfsizligi',
      description: t.language === 'ru' ? 'Шифрование и защита всех данных' : 
                   t.language === 'en' ? 'Encryption and protection of all data' : 'Barcha ma\'lumotlarni shifrlash va himoya qilish',
    },
    {
      icon: Users,
      title: t.language === 'ru' ? 'Управление доступом' : 
            t.language === 'en' ? 'Access Management' : 'Kirish huquqini boshqarish',
      description: t.language === 'ru' ? 'Гибкая система ролей и прав' : 
                   t.language === 'en' ? 'Flexible role and permission system' : 'Moslashuvchan rol va ruxsat tizimi',
    },
    {
      icon: Wifi,
      title: t.language === 'ru' ? 'IoT интеграция' : 
            t.language === 'en' ? 'IoT Integration' : 'IoT integratsiyasi',
      description: t.language === 'ru' ? 'Подключение различных датчиков и систем' : 
                   t.language === 'en' ? 'Connect various sensors and systems' : 'Turli sensorlar va tizimlarni ulash',
    },
    {
      icon: Cloud,
      title: t.language === 'ru' ? 'Облачная платформа' : 
            t.language === 'en' ? 'Cloud Platform' : 'Bulut platformasi',
      description: t.language === 'ru' ? 'Доступ из любой точки мира' : 
                   t.language === 'en' ? 'Access from anywhere in the world' : 'Dunyoning istalgan nuqtasidan kirish',
    },
    {
      icon: Building2,
      title: t.language === 'ru' ? 'Масштабируемость' : 
            t.language === 'en' ? 'Scalability' : 'Kengaytirilishi',
      description: t.language === 'ru' ? 'От одного дома до целого города' : 
                   t.language === 'en' ? 'From one building to entire city' : 'Bir uydan butun shahargacha',
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="space-y-8">
        {/* Hero Section */}
        <div className="text-center space-y-4">
          <div className="inline-flex w-20 h-20 rounded-2xl bg-accent items-center justify-center mb-4">
            <Building2 className="w-10 h-10 text-accent-foreground" />
          </div>
          <h1>{t.aboutTitle}</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {t.aboutDescription}
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card key={index} className="p-6 neomorph hover:shadow-lg transition-shadow">
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-accent" />
                  </div>
                  <h3>{feature.title}</h3>
                  <p className="text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12">
          {[
            { value: '1000+', label: t.language === 'ru' ? 'Домов' : t.language === 'en' ? 'Buildings' : 'Uylar' },
            { value: '5000+', label: t.language === 'ru' ? 'Датчиков' : t.language === 'en' ? 'Sensors' : 'Sensorlar' },
            { value: '99.9%', label: t.language === 'ru' ? 'Uptime' : t.language === 'en' ? 'Uptime' : 'Ishlash vaqti' },
            { value: '24/7', label: t.language === 'ru' ? 'Поддержка' : t.language === 'en' ? 'Support' : 'Qo\'llab-quvvatlash' },
          ].map((stat, index) => (
            <Card key={index} className="p-6 text-center neomorph">
              <div className="text-accent">{stat.value}</div>
              <p className="text-muted-foreground mt-2">{stat.label}</p>
            </Card>
          ))}
        </div>

        {/* Developed By Section */}
        <Card className="mt-12 p-8 neomorph bg-[#1A1D2B] border-[#1A1D2B]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <p className="text-muted-foreground mb-2">{t.developedBy}</p>
              <a 
                href="https://www.aisolutions.uz" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-accent hover:underline transition-all"
              >
                www.aisolutions.uz
              </a>
            </div>
            <div className="flex-shrink-0">
              <img 
                src="https://images.unsplash.com/photo-1694878981829-da6c6a172c44?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxsb2dvJTIwcGxhY2Vob2xkZXJ8ZW58MXx8fHwxNzYxMjQ4NzIzfDA&ixlib=rb-4.1.0&q=80&w=1080" 
                alt="Место для лого" 
                className="h-16 w-auto object-contain"
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
