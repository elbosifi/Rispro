import { Printer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/providers/auth-provider";
import { canAccessWorkstationPrinting } from "@/lib/workstation-printing-access";

export function WorkstationPrintingButton() {
  const navigate = useNavigate();
  const { user } = useAuth();
  if (!user || !canAccessWorkstationPrinting(user.role)) return null;
  return <button type="button" className="flex w-full items-center justify-start gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-muted" onClick={() => navigate("/workstation/printing")}><Printer className="h-4 w-4" />Workstation printing</button>;
}
