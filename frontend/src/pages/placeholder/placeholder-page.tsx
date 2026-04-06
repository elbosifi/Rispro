import { PageContainer } from "@/components/layout/page-container";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";

export function PlaceholderPage({ route }: { route: string }) {
  const { language } = useLanguage();
  return (
    <PageContainer>
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl mx-auto">🚧</div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-white">
            {t(language, "placeholder.title")}
          </h2>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {t(language, "placeholder.desc", { route })}
          </p>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            {t(language, "placeholder.note")}
          </p>
        </div>
      </div>
    </PageContainer>
  );
}
