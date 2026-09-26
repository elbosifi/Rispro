import { NavLink, useNavigate } from "react-router-dom";
import { BookOpenText, ClipboardList, FileUp, GraduationCap, History, LogOut, NotebookTabs } from "lucide-react";
import { Button } from "@/components/shared";
import { requestNavigationWithUnsavedGuard } from "@/lib/unsaved-navigation-guard";
import { useTeachingAuth } from "../auth/teaching-auth-context";

export function TeachingLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { identity, logout } = useTeachingAuth();
  const canImport = Boolean(identity?.permissions.includes("teaching.author") || identity?.permissions.includes("teaching.admin"));
  const canLearn = Boolean(identity?.permissions.includes("teaching.learn"));
  const canAdministerQuestions = Boolean(identity?.permissions.some((permission) => ["teaching.author", "teaching.review", "teaching.publish", "teaching.admin"].includes(permission)));
  const signOut = () => requestNavigationWithUnsavedGuard(() => { void logout(); });
  const follow = (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    requestNavigationWithUnsavedGuard(() => navigate(path));
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <header className="flex min-h-16 items-center justify-between gap-4 border-b px-4 sm:px-6" style={{ borderColor: "var(--border)" }}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground" aria-hidden="true">
            <GraduationCap size={22} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">RISpro Teaching</p>
            <p className="truncate text-xs text-muted-foreground">Question Bank and Residency Education</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:block">{identity?.displayName}</span>
          <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out of Teaching">
            <LogOut size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-screen-2xl grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden border-e p-4 lg:block" style={{ borderColor: "var(--border)" }}>
          <nav aria-label="Teaching navigation" className="space-y-1">
            <NavLink
              to="/teaching/dashboard"
              onClick={(event) => follow(event, "/teaching/dashboard")}
              className={({ isActive }) => `flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? "bg-muted text-accent" : "text-foreground hover:bg-muted"}`}
            >
              <BookOpenText size={17} aria-hidden="true" />
              Dashboard
            </NavLink>
            {canLearn && <NavLink to="/teaching/progress" onClick={(event) => follow(event, "/teaching/progress")} className={({ isActive }) => `flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? "bg-muted text-accent" : "text-foreground hover:bg-muted"}`}>Progress</NavLink>}
            {canLearn && <NavLink to="/teaching/qbank" onClick={(event) => follow(event, "/teaching/qbank")} className={({ isActive }) => `flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? "bg-muted text-accent" : "text-foreground hover:bg-muted"}`}><ClipboardList size={17} aria-hidden="true" /> Learn Q-Bank</NavLink>}
            {canLearn && <NavLink to="/teaching/history" onClick={(event) => follow(event, "/teaching/history")} className={({ isActive }) => `flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? "bg-muted text-accent" : "text-foreground hover:bg-muted"}`}><History size={17} aria-hidden="true" /> Session History</NavLink>}
            {canAdministerQuestions && <NavLink to="/teaching/admin/questions" onClick={(event) => follow(event, "/teaching/admin/questions")} className={({ isActive }) => `flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? "bg-muted text-accent" : "text-foreground hover:bg-muted"}`}><NotebookTabs size={17} aria-hidden="true" /> Question Bank</NavLink>}
            {canImport && (
              <NavLink
                to="/teaching/admin/import"
                onClick={(event) => follow(event, "/teaching/admin/import")}
                className={({ isActive }) => `flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? "bg-muted text-accent" : "text-foreground hover:bg-muted"}`}
              >
                <FileUp size={17} aria-hidden="true" />
                Question Bank Import
              </NavLink>
            )}
          </nav>
        </aside>

        <div className="min-w-0">
          <nav aria-label="Teaching navigation" className="flex flex-wrap items-center border-b px-4 py-2 lg:hidden" style={{ borderColor: "var(--border)" }}>
            <NavLink to="/teaching/dashboard" onClick={(event) => follow(event, "/teaching/dashboard")} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-accent">
              <BookOpenText size={16} aria-hidden="true" />
              Dashboard
            </NavLink>
            {canLearn && <NavLink to="/teaching/progress" onClick={(event) => follow(event, "/teaching/progress")} className="ms-1 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted">Progress</NavLink>}
            {canLearn && <NavLink to="/teaching/qbank" onClick={(event) => follow(event, "/teaching/qbank")} className="ms-1 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted"><ClipboardList size={16} aria-hidden="true" /> Learn</NavLink>}
            {canLearn && <NavLink to="/teaching/history" onClick={(event) => follow(event, "/teaching/history")} className="ms-1 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted"><History size={16} aria-hidden="true" /> History</NavLink>}
            {canAdministerQuestions && <NavLink to="/teaching/admin/questions" onClick={(event) => follow(event, "/teaching/admin/questions")} className="ms-1 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted"><NotebookTabs size={16} aria-hidden="true" /> Questions</NavLink>}
            {canImport && (
              <NavLink to="/teaching/admin/import" onClick={(event) => follow(event, "/teaching/admin/import")} className="ms-2 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted">
                <FileUp size={16} aria-hidden="true" />
                Import
              </NavLink>
            )}
          </nav>
          <main className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
