# Environment Preflight

Run this before validation on a new machine or after switching branches:

```powershell
npm run agent:preflight
```

The preflight reports:

- current git branch and working-tree status
- Node.js and npm versions
- Docker CLI and Docker engine availability
- whether `postgres:16-alpine` is already present locally
- whether `db:test:up` and `db:test:check` package scripts exist
- common Docker credential-helper failures on Mac
- missing required values in `codex-db-test.env`

The preflight does not start containers, run migrations, or edit env files. Do not route around Docker by using a production or personal PostgreSQL database.

## When CI should replace local Docker setup

Do not initialize or repair local Docker solely to run a full DB suite when pull-request CI already provides a clean PostgreSQL environment. Use local Docker for focused iterative DB work only when it is already operational. Use GitHub CI for the authoritative clean-environment DB suite.

Docker environment failures are environment findings, not product-code failures, and must not lead to product-code debugging. Push and rely on CI only after cheap relevant local checks pass. If CI fails, inspect only the failed job and the relevant log excerpt.

## Docker Classification

`npm run agent:preflight` prints a machine-readable Docker line:

```text
DOCKER_STATUS=<classification>
```

Classifications:

- `DOCKER_OK`: Docker command execution and daemon access worked.
- `DOCKER_NOT_INSTALLED`: Docker is not installed or is not on PATH.
- `DOCKER_DAEMON_NOT_RUNNING`: Docker is installed, but Docker Desktop or the daemon is not running.
- `DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT`: the shell, sandbox, or permissions blocked Docker execution. Examples include `spawnSync docker EPERM` and permission denied when connecting to the Docker socket.
- `DOCKER_CREDENTIAL_HELPER_BROKEN`: Docker credential helper is missing or broken. On Mac this often appears as a missing `docker-credential-desktop` or keychain helper error.
- `DOCKER_UNKNOWN_FAILURE`: Docker failed in a way the preflight cannot classify yet.

When Docker is `DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT`, stop debugging RISpro code. Run the same command on the host machine or in a shell with Docker access. Do not route around Docker unless explicitly approved.

`npm run db:test:check` is separate. It may pass if a disposable DB is already running on the configured port, even when preflight could not execute Docker. In that case, report both facts: Docker command execution was not verified, and the already-running DB connection check passed.

## Windows and Mac Handoff

1. Commit or create a patch before switching machines.
2. On the new machine, run `git pull` or apply the patch.
3. Run cheap relevant local checks.
4. If Docker is already operational and focused DB validation is useful, run `npm run agent:preflight`, `npm run db:test:up`, `npm run db:test:check`, and `npm run test:db:one -- <test-file>`.
5. Otherwise, use required GitHub pull-request CI for the full DB-backed suite and report it as pending.

## Stop or Continue

- For an environment/Docker task, stop when Docker is not installed, Docker Desktop is not running, Docker execution is blocked, or the credential helper is broken. Fix the environment first.
- Continue to targeted non-DB checks when the task does not need DB-backed validation.
- For product work, do not repair Docker just to run the full DB suite; use local DB tests only after `npm run db:test:up` and `npm run db:test:check` confirm the disposable DB target, or delegate the full suite to required GitHub pull-request CI.
- Never use a production or personal PostgreSQL database to bypass the portable Docker test DB flow.
