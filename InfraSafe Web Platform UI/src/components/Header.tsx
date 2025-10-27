import { Building2, Moon, Sun, User, UserPlus } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from './ui/dropdown-menu';
import type { Language } from './translations';

interface HeaderProps {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  t: any;
  currentPage: string;
  setCurrentPage: (page: string) => void;
  isAuthenticated: boolean;
  isGuest?: boolean;
  onLogout: () => void;
}

export function Header({ 
  theme, 
  setTheme, 
  language, 
  setLanguage, 
  t, 
  currentPage,
  setCurrentPage,
  isAuthenticated,
  isGuest = false,
  onLogout 
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full neomorph">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo and Title */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentPage('dashboard')}>
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-accent/10">
            <img 
              src="https://images.unsplash.com/photo-1570566920413-fd6410fec24c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjB0ZWNoJTIwbG9nbyUyMGluZnJhc3RydWN0dXJlfGVufDF8fHx8MTc2MTI0ODQwOHww&ixlib=rb-4.1.0&q=80&w=1080"
              alt="InfraSafe Logo" 
              className="w-full h-full object-cover"
            />
          </div>
          <div className="hidden md:block">
            <h1 className="text-foreground">{t.appName}</h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="hidden lg:flex items-center gap-2">
          <Button 
            variant={currentPage === 'about' ? 'default' : 'ghost'}
            onClick={() => setCurrentPage('about')}
          >
            {t.about}
          </Button>
          <Button 
            variant={currentPage === 'documentation' ? 'default' : 'ghost'}
            onClick={() => setCurrentPage('documentation')}
          >
            {t.documentation}
          </Button>
          <Button 
            variant={currentPage === 'contacts' ? 'default' : 'ghost'}
            onClick={() => setCurrentPage('contacts')}
          >
            {t.contacts}
          </Button>
        </nav>

        {/* Right Side Controls */}
        <div className="flex items-center gap-2">
          {/* Guest Mode Indicator and Register Button */}
          {isGuest && (
            <>
              <Badge variant="secondary" className="hidden md:flex gap-1">
                {t.guestMode}
              </Badge>
              <Button
                variant="default"
                className="gap-2"
                onClick={() => setCurrentPage('auth')}
              >
                <UserPlus className="w-4 h-4" />
                <span className="hidden md:inline">
                  {t.register}
                </span>
              </Button>
            </>
          )}
          
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="rounded-full"
          >
            {theme === 'light' ? (
              <Moon className="w-5 h-5" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </Button>

          {/* Language Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                {language.toUpperCase()}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass">
              <DropdownMenuItem onClick={() => setLanguage('ru')}>
                Русский
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLanguage('en')}>
                English
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLanguage('uz')}>
                O'zbekcha
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <User className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass">
              {isAuthenticated ? (
                <>
                  {isGuest && (
                    <>
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        {t.guestMode}
                      </div>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => setCurrentPage('profile')}>
                    <User className="w-4 h-4 mr-2" />
                    {t.profile}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCurrentPage('settings')}>
                    {t.settings}
                  </DropdownMenuItem>
                  {isGuest && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setCurrentPage('auth')}>
                        <UserPlus className="w-4 h-4 mr-2" />
                        {t.createAccount}
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onLogout}>
                    {t.logout}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => setCurrentPage('auth')}>
                  {t.login}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
