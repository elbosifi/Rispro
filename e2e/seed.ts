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
  await pool.query(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
     values
       ('اختبار تشابه واحد', 'E2E Similar One', '100000000001', 'اختبار تشابه واحد', 'M', 41, '0910000001', 'national_id', '100000000001'),
       ('اختبار تشابه اثنان', 'E2E Similar Two', '100000000002', 'اختبار تشابه اثنان', 'F', 39, '0910000002', 'national_id', '100000000002')`,
  );
  console.log("Seeded synthetic E2E users: reception, supervisor, doctor.");
} finally {
  await pool.end();
}
