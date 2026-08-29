export function getDatabaseBackupAccessConfig(env: NodeJS.ProcessEnv = process.env) {
  const configuredEnabled = env.RISPRO_DB_BACKUP_ACCESS_ENABLED === "true";
  const allowedHosts = String(env.RISPRO_DB_BACKUP_ALLOWED_IPS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    enabled: env.RISPRO_DB_MODE === "internal" && configuredEnabled,
    bindIp: String(env.RISPRO_DB_BACKUP_BIND_IP || ""),
    port: String(env.RISPRO_DB_BACKUP_PORT || "5432"),
    allowedHosts,
    readOnly: true,
    applyCommand: "./scripts/update-docker.sh",
  };
}
