import { useState } from 'react';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Building2 } from 'lucide-react';

interface AuthPageProps {
  t: any;
  onLogin: (email: string, password: string) => void;
  onGuestMode: () => void;
}

export function AuthPage({ t, onLogin, onGuestMode }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(email, password);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 neomorph">
        <div className="flex flex-col items-center gap-6">
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center">
            <Building2 className="w-8 h-8 text-accent-foreground" />
          </div>

          <div className="text-center">
            <h2>InfraSafe</h2>
            <p className="text-muted-foreground mt-2">
              {isLogin ? t.login : t.register}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                className="glass"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="glass"
                required
              />
            </div>

            <Button type="submit" className="w-full">
              {isLogin ? t.login : t.register}
            </Button>
          </form>

          {/* Toggle Login/Register */}
          <div className="text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-accent hover:underline"
            >
              {isLogin ? t.dontHaveAccount : t.alreadyHaveAccount}
            </button>
          </div>

          {/* Guest Mode */}
          <div className="w-full pt-4 border-t">
            <Button
              variant="outline"
              className="w-full"
              onClick={onGuestMode}
            >
              {t.continueAsGuest}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
