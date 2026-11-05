import { Printer } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { workstationPath } from '@/lib/module-access';
import { requestNavigationWithUnsavedGuard } from '@/lib/unsaved-navigation-guard';
import { useAuth } from "@/providers/auth-provider";
import { canAccessWorkstationPrinting } from "@/lib/workstation-printing-access";

export function WorkstationPrintingButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  if (!user || !canAccessWorkstationPrinting(user.role)) return null;
  const path = workstationPath(user, location.pathname);
  if (!path) return null;
  return <button type="button" className="flex w-full items-center justify-start gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-muted" onClick={() => requestNavigationWithUnsavedGuard(() => navigate(path))}><Printer className="h-4 w-4" />Workstation printing</button>;
}
