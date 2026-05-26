# RISpro v3 Backup Archive Notes

v3 backup and restore preview support RISpro-generated stored ZIP archives only.
Arbitrary compressed ZIP archives are rejected.

Restore preview validates ZIP entry metadata before writing any file to staging:
path, prefix, entry type, compression method, duplicate status, per-file size, file count, and total uncompressed size are accepted first. Only then are entries extracted to a temporary staging directory.

ZIP64 is not implemented. v3 defaults stay below classic ZIP boundaries:
max files 60000, max single file 3 GiB, and max total uncompressed size 3 GiB.

Pre-restore database safety backup prefers `pg_dump -Fc` using `execFile` arguments.
The database URL is passed through the child process environment and is not logged
or placed in the command argument list by RISpro.
The current Dockerfile does not install `postgresql-client`, so app containers built from
that image should be expected to use the v3 snapshot fallback unless
`postgresql-client` is added to the runtime image.

`POST /api/admin/restore/v3` is intentionally blocked until the full app-stack
restore is complete. The current executable endpoint is
`POST /api/admin/restore/v3/db-only`, which restores database rows only and
returns `restoreIncomplete: true`, `storageRestored: false`, and
`envRestored: false`.

The DB-only endpoint is experimental. It is not a full RISpro restore because it
does not replace app-owned storage, restore external documents, or write `.env`.
Before production use, run the live DB integration test against a disposable
PostgreSQL database:

```powershell
$env:BACKUP_V3_DB_RESTORE_INTEGRATION="1"
$env:TEST_DATABASE_URL="postgresql://user:password@host:5432/throwaway_rispro_restore_test"
node --import tsx --test src/services/backup-v3-db-restore.integration.test.ts
```
