'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';

interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  role: string;
  batchYear: number;
  department: string;
  degree: string;
  membershipTier?: string;
  isVerified: boolean;
  profileCompleteness: number;
}

const normalizeUser = (rawUser: any): User => {
  return {
    id: rawUser.id,
    email: rawUser.email,
    fullName: rawUser.fullName,
    avatarUrl: rawUser.avatarUrl || rawUser.profilePhotoUrl || undefined,
    role: rawUser.role || rawUser.userRole || 'MEMBER',
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
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setAuthData: (data: { accessToken: string; refreshToken: string; user?: User }) => void;
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
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      setUser(null);
    }
  }, []);

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
    const { accessToken, refreshToken, user: userData } = response.data.data;

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

  const setAuthData = (data: { accessToken: string; refreshToken: string; user?: User }) => {
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    if (data.user) {
      setUser(normalizeUser(data.user));
    }
  };

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
