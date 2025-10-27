import { Card } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Mail, Phone, MapPin, Send } from 'lucide-react';
import { useState } from 'react';

interface ContactsPageProps {
  t: any;
}

export function ContactsPage({ t }: ContactsPageProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', formData);
    // Reset form
    setFormData({ name: '', email: '', message: '' });
    alert(t.language === 'ru' ? 'Сообщение отправлено!' : 
          t.language === 'en' ? 'Message sent!' : 'Xabar yuborildi!');
  };

  const contactInfo = [
    {
      icon: Mail,
      title: 'Email',
      value: 'info@infrasafe.io',
      link: 'mailto:info@infrasafe.io',
    },
    {
      icon: Phone,
      title: t.language === 'ru' ? 'Телефон' : t.language === 'en' ? 'Phone' : 'Telefon',
      value: '+998 71 123 45 67',
      link: 'tel:+998711234567',
    },
    {
      icon: MapPin,
      title: t.language === 'ru' ? 'Адрес' : t.language === 'en' ? 'Address' : 'Manzil',
      value: t.language === 'ru' ? 'г. Ташкент, ул. Амира Темура, 12' : 
             t.language === 'en' ? 'Tashkent, Amir Temur St., 12' : 'Toshkent, Amir Temur ko\'chasi, 12',
      link: null,
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1>{t.contactsTitle}</h1>
          <p className="text-muted-foreground">
            {t.language === 'ru' ? 'Свяжитесь с нами для получения дополнительной информации' : 
             t.language === 'en' ? 'Contact us for more information' : 'Qo\'shimcha ma\'lumot olish uchun biz bilan bog\'laning'}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Contact Form */}
          <Card className="p-8 neomorph">
            <h3 className="mb-6">{t.contactForm}</h3>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">{t.yourName}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.language === 'ru' ? 'Иван Иванов' : t.language === 'en' ? 'John Doe' : 'Ism Familiya'}
                  className="glass"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t.yourEmail}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="example@email.com"
                  className="glass"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">{t.message}</Label>
                <Textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder={t.language === 'ru' ? 'Ваше сообщение...' : 
                               t.language === 'en' ? 'Your message...' : 'Sizning xabaringiz...'}
                  className="glass min-h-[150px]"
                  required
                />
              </div>

              <Button type="submit" className="w-full gap-2">
                <Send className="w-4 h-4" />
                {t.send}
              </Button>
            </form>
          </Card>

          {/* Contact Info */}
          <div className="space-y-6">
            {contactInfo.map((info, index) => {
              const Icon = info.icon;
              return (
                <Card key={index} className="p-6 neomorph hover:shadow-lg transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-accent" />
                    </div>
                    <div className="flex-1">
                      <h4 className="mb-2">{info.title}</h4>
                      {info.link ? (
                        <a 
                          href={info.link} 
                          className="text-muted-foreground hover:text-accent transition-colors"
                        >
                          {info.value}
                        </a>
                      ) : (
                        <p className="text-muted-foreground">{info.value}</p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}

            {/* Map Placeholder */}
            <Card className="p-4 neomorph h-64 flex items-center justify-center bg-muted/20">
              <div className="text-center text-muted-foreground">
                <MapPin className="w-12 h-12 mx-auto mb-2" />
                <p>{t.language === 'ru' ? 'Карта расположения' : 
                    t.language === 'en' ? 'Location Map' : 'Joylashuv xaritasi'}</p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
