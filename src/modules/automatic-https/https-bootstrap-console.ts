import { BootstrapError, issueBootstrapCode } from "./https-bootstrap.js";
import { allowBootstrapClient } from "./https-service.js";
import { pool } from "../../db/pool.js";

try {
  if (process.argv.length > 3) throw new BootstrapError("Specify at most one administrator workstation IPv4 address.");
  if (process.argv[2]) await allowBootstrapClient(process.argv[2]);
  const result = await issueBootstrapCode();
  console.log(`Temporary HTTPS: https://${result.ip}:3443/settings?section=deployment_identity`);
  console.log(`Certificate SHA-256 fingerprint: ${result.fingerprint}`);
  console.log(`Single-use authorization code (expires in 5 minutes): ${result.code}`);
  console.log("Compare the browser certificate fingerprint before accepting its temporary exception.");
  if (process.argv[2]) console.log("The specified client IP is allowed temporarily; host/network firewall restrictions still apply.");
} catch (error) {
  console.error(`Bootstrap is unavailable. ${error instanceof BootstrapError ? error.message : "Check the database and Caddy service on the server."}`);
  process.exitCode = 1;
} finally { await pool.end(); }
