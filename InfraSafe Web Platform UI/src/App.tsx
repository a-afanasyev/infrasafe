import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { AuthPage } from './components/AuthPage';
import { AboutPage } from './components/AboutPage';
import { DocumentationPage } from './components/DocumentationPage';
import { ContactsPage } from './components/ContactsPage';
import { SettingsPage } from './components/SettingsPage';
import { ProfilePage } from './components/ProfilePage';
import { useTranslations, type Language } from './components/translations';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner@2.0.3';
import './styles/globals.css';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [language, setLanguage] = useState<Language>('ru');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  const t = useTranslations(language);

  // Apply theme to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Handle login
  const handleLogin = (email: string, password: string) => {
    // Mock authentication
    console.log('Login attempt:', email);
    setIsAuthenticated(true);
    setCurrentPage('dashboard');
    toast.success(
      t.language === 'ru' ? 'Вход выполнен успешно!' :
      t.language === 'en' ? 'Login successful!' :
      'Muvaffaqiyatli kirildi!'
    );
  };

  // Handle guest mode
  const handleGuestMode = () => {
    setIsGuest(true);
    setCurrentPage('dashboard');
    toast.info(
      t.language === 'ru' ? 'Вы вошли как гость' :
      t.language === 'en' ? 'You are in guest mode' :
      'Siz mehmon sifatida kirdingiz'
    );
  };

  // Handle logout
  const handleLogout = () => {
    setIsAuthenticated(false);
    setIsGuest(false);
    setCurrentPage('auth');
    toast.info(
      t.language === 'ru' ? 'Вы вышли из системы' :
      t.language === 'en' ? 'You have logged out' :
      'Siz tizimdan chiqdingiz'
    );
  };

  // Render current page
  const renderPage = () => {
    if (!isAuthenticated && !isGuest && currentPage === 'dashboard') {
      return <AuthPage t={t} onLogin={handleLogin} onGuestMode={handleGuestMode} />;
    }

    switch (currentPage) {
      case 'dashboard':
        return <Dashboard t={t} isGuest={isGuest} onRegister={() => setCurrentPage('auth')} />;
      case 'about':
        return <AboutPage t={t} />;
      case 'documentation':
        return <DocumentationPage t={t} />;
      case 'contacts':
        return <ContactsPage t={t} />;
      case 'settings':
        return <SettingsPage t={t} />;
      case 'profile':
        return <ProfilePage t={t} isGuest={isGuest} />;
      case 'auth':
        return <AuthPage t={t} onLogin={handleLogin} onGuestMode={handleGuestMode} />;
      default:
        return <Dashboard t={t} isGuest={isGuest} onRegister={() => setCurrentPage('auth')} />;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        theme={theme}
        setTheme={setTheme}
        language={language}
        setLanguage={setLanguage}
        t={t}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        isAuthenticated={isAuthenticated || isGuest}
        isGuest={isGuest}
        onLogout={handleLogout}
      />
      
      <main className="w-full">
        {renderPage()}
      </main>

      <Toaster 
        position="bottom-right"
        theme={theme}
        richColors
      />
    </div>
  );
}
