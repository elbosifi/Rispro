import { Alert, Button, LoadingState } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";

export function DictionaryLoadStatus({ isPending, isError, isFetching, hasData, onRetry }: {
  isPending: boolean; isError: boolean; isFetching: boolean; hasData: boolean; onRetry: () => void;
}) {
  const { t } = useLanguage();
  if (isError) return (
    <Alert variant="error" role="alert" className="space-y-2">
      <p>{t(hasData ? "nameDictionary.refreshFailed" : "nameDictionary.loadFailed")}</p>
      <Button type="button" variant="secondary" size="sm" disabled={isFetching} onClick={onRetry}>{t("nameDictionary.retry")}</Button>
    </Alert>
  );
  return isPending ? <LoadingState message={t("settings.loading")} /> : null;
}
