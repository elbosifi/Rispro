import { useQuery } from "@tanstack/react-query";
import { fetchTeachingIdentity } from "./teaching-api";

export function useTeachingIdentity(identitySubject: string | null, enabled = true) {
  return useQuery({
    queryKey: ["teaching", "me", identitySubject],
    queryFn: fetchTeachingIdentity,
    enabled: Boolean(identitySubject) && enabled,
    staleTime: 1000 * 60,
    retry: false,
    meta: { suppressGlobalToast: true },
  });
}
