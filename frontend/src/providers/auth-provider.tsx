import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchCurrentSession, login as loginApi, logout as logoutApi, reAuthSupervisor } from "@/lib/api-hooks";
import type { User } from "@/types/api";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reAuth: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isTransitioning, setIsTransitioning] = useState(false);

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["auth-session"],
    queryFn: fetchCurrentSession,
    staleTime: 1000 * 60 * 5,
    retry: false
  });

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      loginApi(username, password),
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: (userData) => {
      queryClient.setQueryData(["auth-session"], userData);
    },
    onSettled: () => {
      setIsTransitioning(false);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: logoutApi,
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: () => {
      queryClient.setQueryData(["auth-session"], null);
      queryClient.clear();
      window.location.href = "/";
    }
  });

  const reAuthMutation = useMutation({
    mutationFn: (password: string) => reAuthSupervisor(password),
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: (userData) => {
      queryClient.setQueryData(["auth-session"], { ...userData, recentSupervisorReauth: true });
    }
  });

  const login = async (username: string, password: string) => {
    setIsTransitioning(true);
    await loginMutation.mutateAsync({ username, password });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const reAuth = async (password: string) => {
    await reAuthMutation.mutateAsync(password);
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading: isLoading || isTransitioning,
        login,
        logout,
        reAuth
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
