import { PageContainer } from "@/components/layout/page-container";

export function PlaceholderPage({ route }: { route: string }) {
  return (
    <PageContainer>
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl mx-auto">🚧</div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-white">
            Page Not Yet Migrated
          </h2>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            The <code className="px-1.5 py-0.5 rounded text-xs font-mono bg-stone-100 dark:bg-stone-700">{route}</code> page
            is still being migrated from the legacy frontend.
          </p>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            You can access this functionality in the original app until migration is complete.
          </p>
        </div>
      </div>
    </PageContainer>
  );
}
