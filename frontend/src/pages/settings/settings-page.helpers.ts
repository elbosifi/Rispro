export function isReAuthRequiredError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error || "");

  return (
    message.includes("re-authentication") ||
    message.includes("403")
  );
}
