import { issueBootstrapCode } from "./https-bootstrap.js";
import { pool } from "../../db/pool.js";

try {
  const result = await issueBootstrapCode();
  console.log(`Temporary HTTPS: https://${result.ip}:3443/settings?section=deployment_identity`);
  console.log(`Certificate SHA-256 fingerprint: ${result.fingerprint}`);
  console.log(`Single-use authorization code (expires in 5 minutes): ${result.code}`);
  console.log("Compare the browser certificate fingerprint before accepting its temporary exception.");
} catch {
  console.error("Bootstrap is unavailable. Check the private LAN address and Caddy service on the server.");
  process.exitCode = 1;
} finally { await pool.end(); }
