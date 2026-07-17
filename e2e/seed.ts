import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";

if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required to seed browser E2E data.");

const passwordHash = await bcrypt.hash("E2ePassword!2026", 10);
const users = [
  ["e2e_reception", "E2E Reception", "receptionist"],
  ["e2e_supervisor", "E2E Supervisor", "supervisor"],
  ["e2e_doctor", "E2E Doctor", "doctor"],
] as const;

try {
  for (const [username, fullName, role] of users) {
    await pool.query(
      "insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, $3, $4, true)",
      [username, fullName, passwordHash, role],
    );
  }
  console.log("Seeded synthetic E2E users: reception, supervisor, doctor.");
} finally {
  await pool.end();
}
