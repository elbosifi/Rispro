import { Card } from "@/components/shared";

export function TeachingDashboardPage() {
  return (
    <section aria-labelledby="teaching-dashboard-title">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching</p>
        <h1 id="teaching-dashboard-title" className="mt-1 text-2xl font-semibold text-foreground">Question Bank and Residency Education</h1>
      </header>
      <Card className="p-6 sm:p-8">
        <p className="text-sm text-muted-foreground">Teaching workspace initialized.</p>
      </Card>
    </section>
  );
}
