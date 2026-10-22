'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { authApi, isTwoFactorChallenge, type TwoFactorChallenge } from '@/lib/api';
import { normalizeRole, type Role } from '@/lib/roles';

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  /** Canonical role, always normalized via `normalizeRole` (PRD §9.1). */
  role: Role;
  /** Alias of `role` matching the server field name. */
  userRole: Role;
  /** ALUMNI / STUDENT etc. Not an access-control role. */
  roleType?: string;
  batchYear: number;
  department: string;
  degree: string;
  membershipTier?: string;
  isVerified: boolean;
  profileCompleteness: number;
}

export const normalizeUser = (rawUser: any): User => {
  const role = normalizeRole(rawUser);
  return {
    id: rawUser.id,
    email: rawUser.email,
    fullName: rawUser.fullName,
    avatarUrl: rawUser.avatarUrl || rawUser.profilePhotoUrl || undefined,
    role,
    userRole: role,
    roleType: rawUser.roleType || undefined,
    batchYear: rawUser.batchYear || new Date().getFullYear(),
    department: rawUser.department || 'Unknown',
    degree: rawUser.degree || 'Unknown',
    membershipTier: rawUser.membershipTier?.name || rawUser.membershipTier || undefined,
    isVerified: Boolean(rawUser.isVerified),
    profileCompleteness: rawUser.profileCompleteness || 0,
  };
};

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<TwoFactorChallenge | void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setAuthData: (data: { accessToken: string; refreshToken: string; user?: unknown }) => void;
  /** Clear tokens and local session state without calling the server. */
  clearSession: () => void;
  setOAuthTokens: (accessToken: string, refreshToken: string) => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  fullName: string;
  batchYear: number;
  department: string;
  degree: string;
  roleType?: string;
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

/** Read the user id from an access token's payload (no verification; UI hint only). */
const tokenUserId = (token: string): string | null => {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json)?.userId ?? null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const router = useRouter();

  const refreshUser = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        setUser(null);
        return;
      }
      const response = await authApi.me();
      setUser(normalizeUser(response.data.data));
    } catch (error) {
      // Only a server rejection ends the session. A network blip or 5xx keeps the
      // tokens, otherwise the storage event would sign out every other open tab too.
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
      setUser(null);
    }
  }, []);

  const userIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);

  // Keep tabs in sync: `storage` fires in every OTHER tab when one writes
  // localStorage. Rotated tokens need no action (requests read storage lazily);
  // a logout or a sign-in as someone else does.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (e.key !== null && e.key !== 'accessToken') return;
      const token = localStorage.getItem('accessToken');
      if (!token) {
        setUser(null);
        return;
      }
      if (tokenUserId(token) !== userIdRef.current) {
        void refreshUser();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshUser]);

  // Check auth status on mount
  React.useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      await refreshUser();
      setIsLoading(false);
    };
    checkAuth();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    const result = response.data.data;
    // 2FA accounts get a challenge instead of tokens; the caller must finish
    // via twoFactorApi.verify2FA(result.twoFactorToken, otp).
    if (isTwoFactorChallenge(result)) return result;
    const { accessToken, refreshToken, user: userData } = result;

    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    setUser(normalizeUser(userData));

    router.push('/dashboard');
  };

  const register = async (data: RegisterData) => {
    await authApi.register(data);
    router.push('/login?registered=true');
  };

  const logout = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      await authApi.logout(refreshToken || undefined);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      setUser(null);
      router.push('/login');
    }
  };

  const setAuthData = (data: { accessToken: string; refreshToken: string; user?: unknown }) => {
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    if (data.user) {
      setUser(normalizeUser(data.user));
    }
  };

  const clearSession = React.useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  }, []);

  // For OAuth login - store tokens and fetch user from API
  const setOAuthTokens = async (accessToken: string, refreshToken: string) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    await refreshUser();
  };

  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshUser,
    setAuthData,
    clearSession,
    setOAuthTokens,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
