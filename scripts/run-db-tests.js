import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, 'codex-db-test.env');

const env = { ...process.env };
const text = fs.readFileSync(envPath, 'utf8');

for (const rawLine of text.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  const equalsIndex = line.indexOf('=');
  if (equalsIndex === -1) continue;

  env[line.slice(0, equalsIndex).trim()] = line.slice(equalsIndex + 1).trim();
}

const commands = [
  ['run', 'db:test:check'],
  ['run', 'test:backend:db'],
];

for (const args of commands) {
  const command = npmScriptCommand(args);
  const result = spawnSync(command.command, command.args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function npmScriptCommand(args) {
  if (process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}
