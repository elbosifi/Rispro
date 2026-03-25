import dotenv from "dotenv";

dotenv.config();

function requireEnv(name, fallback = "") {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret: requireEnv("JWT_SECRET"),
  cookieName: process.env.COOKIE_NAME || "rispro_session",
  seedSupervisorUsername: process.env.SEED_SUPERVISOR_USERNAME || "admin",
  seedSupervisorPassword: process.env.SEED_SUPERVISOR_PASSWORD || "ChangeMe123!",
  seedSupervisorFullName: process.env.SEED_SUPERVISOR_FULL_NAME || "Supervisor"
};
