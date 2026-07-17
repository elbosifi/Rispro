const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "postgres"]);

export function assertSafeE2eEnvironment(env = process.env) {
  if (env.RISPRO_E2E !== "1") {
    throw new Error("Refusing E2E database operation: RISPRO_E2E=1 is required.");
  }
  if (env.NODE_ENV === "production" || env.RISPRO_DB_MODE === "external") {
    throw new Error("Refusing E2E database operation against a production or external DB mode.");
  }
  const rawUrl = env.TEST_DATABASE_URL || env.DATABASE_URL;
  if (!rawUrl) throw new Error("Refusing E2E database operation without TEST_DATABASE_URL or DATABASE_URL.");
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("Refusing E2E database operation: database URL is invalid."); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!ALLOWED_HOSTS.has(url.hostname) || !/(test|e2e)/i.test(database)) {
    throw new Error("Refusing E2E database operation: target must use localhost/127.0.0.1/postgres and a database name containing test or e2e.");
  }
  for (const unsafeKey of ["PRODUCTION_DATABASE_URL", "DATABASE_URL_PRODUCTION", "RISPRO_PRODUCTION"]) {
    if (env[unsafeKey]) throw new Error(`Refusing E2E database operation while ${unsafeKey} is set.`);
  }
  return { url: url.toString(), database, host: url.hostname };
}
