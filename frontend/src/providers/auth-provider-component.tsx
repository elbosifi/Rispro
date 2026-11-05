import { useEffect, useState, type ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/shared';
import { requestNavigationWithUnsavedGuard } from '@/lib/unsaved-navigation-guard';
import { canAccessModule } from '@/lib/module-access';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { changeOwnPassword, fetchCurrentSession, getPasskeyLoginOptions, getPasskeyReauthOptions, login as loginApi, logout as logoutApi, reAuthSupervisor, verifyPasskeyLogin, verifyPasskeyReauth } from "@/lib/api-hooks";
import { startAuthentication } from "@simplewebauthn/browser";
import type { User } from "@/types/api";
import { AuthContext } from "./auth-provider";
import { clearPatientDirectorySearch } from "@/lib/navigation/patient-navigation";
import { clearRegistrationSearch } from "@/pages/registrations/registration-query";
import { clearCalendarSearch } from "@/lib/navigation/calendar-navigation";
import { clearModuleLastLocations } from "@/lib/navigation/module-last-location";
import { clearQueueSearch } from "@/lib/navigation/queue-navigation";
import { clearWorklistMonitorSearch } from "@/lib/navigation/worklist-monitor-navigation";
import { clearComparisonsSearch } from "@/lib/navigation/comparisons-navigation";
import { clearDoctorProtocolsSearch } from "@/lib/navigation/doctor-protocols-navigation";

function safeLogoutTarget(returnTo: string): string {
  return returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/\\") ? returnTo : "/";
}

class SessionRevokedError extends Error {}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isTransitioning, setIsTransitioning] = useState(false);

  const { data: user, isLoading, error: sessionError } = useQuery<User | null>({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const current = await fetchCurrentSession();
      const previous = queryClient.getQueryData<User | null>(['auth-session']);
      if (previous && (!current || previous.id !== current.id || previous.moduleAccess?.modules.some(m => m.effective && !canAccessModule(current, m.id)))) throw new SessionRevokedError('Session authorization changed.');
      return current;
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    meta: { suppressGlobalToast: true }
  });

  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['auth-session'] }); };
    window.addEventListener('rispro-authorization-changed', refresh);
    return () => window.removeEventListener('rispro-authorization-changed', refresh);
  }, [queryClient]);

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
    mutationFn: (returnTo: string) => {
      void returnTo;
      return logoutApi();
    },
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: (_, returnTo) => {
      clearPatientDirectorySearch();
      clearRegistrationSearch();
      clearCalendarSearch();
      clearQueueSearch();
      clearWorklistMonitorSearch();
      clearComparisonsSearch();
      clearDoctorProtocolsSearch();
      clearModuleLastLocations();
      queryClient.setQueryData(["auth-session"], null);
      queryClient.clear();
      window.location.href = safeLogoutTarget(returnTo);
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

  const logout = async (returnTo = "/") => {
    await logoutMutation.mutateAsync(returnTo);
  };

  const reAuth = async (password: string) => {
    await reAuthMutation.mutateAsync(password);
  };

  const reAuthWithPasskey = async () => {
    const options = await getPasskeyReauthOptions();
    const response = await startAuthentication({ optionsJSON: options as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
    const userData = await verifyPasskeyReauth(response);
    queryClient.setQueryData(["auth-session"], (current: User | null | undefined) => ({
      ...(current ?? {}),
      ...userData,
      recentSupervisorReauth: true,
    }));
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading: isLoading || isTransitioning || changePasswordMutation.isPending || logoutMutation.isPending,
        login,
        loginWithPasskey,
        logout,
        reAuth,
        reAuthWithPasskey,
        changePassword
      }}
    >
      {children}
      <Dialog open={sessionError instanceof SessionRevokedError} onClose={() => {}}>
        <DialogContent maxWidth="480px">
          <DialogTitle>Session access changed / تغيّر الوصول للجلسة</DialogTitle>
          <DialogDescription>Sign in again to use your current module access. Local work remains on this screen until you choose to leave. / يرجى تسجيل الدخول مجدداً. يبقى عملك المحلي في هذه الشاشة حتى تختار المغادرة.</DialogDescription>
          <Button onClick={() => requestNavigationWithUnsavedGuard(() => window.location.assign('/login'))}>Sign in / تسجيل الدخول</Button>
        </DialogContent>
      </Dialog>
    </AuthContext.Provider>
  );
}
