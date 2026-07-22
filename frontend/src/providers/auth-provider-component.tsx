import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { changeOwnPassword, fetchCurrentSession, getPasskeyLoginOptions, login as loginApi, logout as logoutApi, reAuthSupervisor, verifyPasskeyLogin } from "@/lib/api-hooks";
import { startAuthentication } from "@simplewebauthn/browser";
import type { User } from "@/types/api";
import { AuthContext } from "./auth-provider";

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

  const changePasswordMutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      changeOwnPassword(currentPassword, newPassword),
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: (userData) => {
      queryClient.setQueryData(["auth-session"], userData);
    }
  });

  const login = async (username: string, password: string): Promise<User> => {
    setIsTransitioning(true);
    return loginMutation.mutateAsync({ username, password });
  };

  const loginWithPasskey = async (): Promise<User> => {
    setIsTransitioning(true);
    try {
      const options = await getPasskeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      const userData = await verifyPasskeyLogin(response);
      queryClient.setQueryData(["auth-session"], userData);
      return userData;
    } finally {
      setIsTransitioning(false);
    }
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const reAuth = async (password: string) => {
    await reAuthMutation.mutateAsync(password);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading: isLoading || isTransitioning || changePasswordMutation.isPending,
        login,
        loginWithPasskey,
        logout,
        reAuth,
        changePassword
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
