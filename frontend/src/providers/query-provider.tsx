import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { pushToast } from "@/lib/toast";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onSuccess: (_data, _variables, _context, mutation) => {
            if (mutation.options.meta?.suppressGlobalToast) return;
            const title = (mutation.options.meta?.toastSuccessTitle as string | undefined) || "Task completed";
            const message =
              (mutation.options.meta?.toastSuccessMessage as string | undefined) ||
              "The operation finished successfully.";
            pushToast({ type: "success", title, message });
          },
          onError: (error, _variables, _context, mutation) => {
            if (mutation.options.meta?.suppressGlobalToast) return;
            const title = (mutation.options.meta?.toastErrorTitle as string | undefined) || "Task failed";
            const message = error instanceof Error ? error.message : "The operation could not be completed.";
            pushToast({ type: "error", title, message });
          }
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
