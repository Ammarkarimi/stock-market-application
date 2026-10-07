import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, onUnauthorized, setCsrfToken } from '@/lib/api';
import type { User } from '@/lib/types';
import { clearTicks } from '@/live/priceStore';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthResponse {
  user: User;
  csrfToken: string;
}

interface MeResponse {
  user: User | null;
  csrfToken: string | null;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  /** Clears local state after the server ended the session, with an explanation for the user. */
  endSession: (reason: string) => void;
  refreshUser: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const queryClient = useQueryClient();
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const applySession = useCallback((response: AuthResponse) => {
    setCsrfToken(response.csrfToken);
    setUser(response.user);
    setStatus('authenticated');
    return response.user;
  }, []);

  const clearSession = useCallback(() => {
    setCsrfToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
    clearTicks();
  }, [queryClient]);

  useEffect(() => {
    api
      .get<MeResponse>('/auth/me')
      .then((me) => (me.user && me.csrfToken ? applySession({ user: me.user, csrfToken: me.csrfToken }) : setStatus('anonymous')))
      .catch(() => setStatus('anonymous'));
  }, [applySession]);

  const endSession = useCallback(
    (reason: string) => {
      if (!userRef.current) return;
      clearSession();
      toast.warning('Signed out', { description: reason });
    },
    [clearSession],
  );

  useEffect(() => onUnauthorized(() => endSession('Your session has expired. Please sign in again.')), [endSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      queryClient.clear();
      return applySession(await api.post<AuthResponse>('/auth/login', { email, password }));
    },
    [applySession, queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      queryClient.clear();
      return applySession(await api.post<AuthResponse>('/auth/register', input));
    },
    [applySession, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the server call fails, forget the session locally.
    }
    clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await api.get<MeResponse>('/auth/me');
    if (me.user && me.csrfToken) applySession({ user: me.user, csrfToken: me.csrfToken });
    else endSession('Your session has expired. Please sign in again.');
  }, [applySession, endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, register, logout, endSession, refreshUser, updateUser: setUser }),
    [user, status, login, register, logout, endSession, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
