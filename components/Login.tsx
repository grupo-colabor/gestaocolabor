import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from "../contexts/AuthContext";
import { Eye, EyeOff, LogIn, Loader2, AlertCircle, Shield } from 'lucide-react';

/**
 * ✅ COMO USAR A LOGO:
 *
 * Opção 1 - Arquivo local:
 *   1. Coloque a imagem em: /assets/logo.png
 *   2. O componente tentará carregar automaticamente
 *
 * Opção 2 - Via props:
 *   <Login logoUrl="https://suaempresa.com/logo.png" />
 *
 * Opção 3 - Importação direta (descomente abaixo):
 *   import logoImage from '../assets/logo.png';
 *   E use: logoUrl={logoImage}
 */

interface LoginProps {
  /** URL da logo (opcional) */
  logoUrl?: string;
  /** Texto alternativo da logo */
  logoAlt?: string;
}

export default function Login({ logoUrl, logoAlt = 'COLABOR - Desenvolvimento Profissional' }: LoginProps) {
  const { signIn, loading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message ?? 'Erro ao fazer login');
    }
  }

  // Tenta carregar logo de /assets/logo.png se não passar por props
  const displayLogo = logoUrl || '/assets/logo.png';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-green-50">
      {/* Container principal */}
      <div className="w-full max-w-md px-6 py-8">
        {/* Card de Login */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Header com Logo */}
          <div className="bg-gradient-to-r from-green-600 to-green-700 px-8 py-10 text-center">
            <div className="inline-flex items-center justify-center bg-white rounded-2xl p-4 shadow-lg mb-4">
              {!logoError ? (
                <img
                  src={displayLogo}
                  alt={logoAlt}
                  className="h-16 w-auto object-contain"
                  onError={() => setLogoError(true)}
                />
              ) : (
                // Fallback: ícone se a logo não carregar
                <div className="flex flex-col items-center">
                  <Shield className="h-12 w-12 text-green-600" />
                  <span className="text-[10px] font-black text-green-700 mt-1 tracking-tight">COLABOR</span>
                </div>
              )}
            </div>
            <h1 className="text-white text-xl font-bold tracking-tight">
              Training Manager
            </h1>
            <p className="text-green-100 text-sm mt-1">
              Sistema de Gestão de Treinamentos
            </p>
          </div>

          {/* Formulário */}
          <div className="px-8 py-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Campo Email */}
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2"
                >
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="seu.email@empresa.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm
                           focus:ring-2 focus:ring-green-500 focus:border-green-500
                           outline-none transition-all placeholder:text-gray-400"
                />
              </div>

              {/* Campo Senha */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2"
                >
                  Senha
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-xl text-sm
                             focus:ring-2 focus:ring-green-500 focus:border-green-500
                             outline-none transition-all placeholder:text-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
                             hover:text-gray-600 transition-colors p-1"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Mensagem de Erro */}
              {error && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl animate-fade-in">
                  <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                  <div>
                    <p className="text-sm font-semibold text-red-700">Falha no login</p>
                    <p className="text-xs text-red-600 mt-0.5">{error}</p>
                  </div>
                </div>
              )}

              {/* Botão de Login */}
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm uppercase tracking-wider
                          flex items-center justify-center gap-2 transition-all shadow-lg
                          ${loading
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white hover:shadow-xl active:scale-[0.98]'
                          }`}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    <LogIn size={18} />
                    Entrar
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 border-t border-gray-100">
            <p className="text-center text-xs text-gray-400">
              COLABOR &copy; {new Date().getFullYear()} - Desenvolvimento Profissional e Segurança do Trabalho
            </p>
          </div>
        </div>

        {/* Texto auxiliar */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Problemas para acessar? Entre em contato com o administrador.
        </p>
      </div>
    </div>
  );
}
