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
The Docker runtime image installs `postgresql-client`, so `pg_dump` should be
available in app containers. If `pg_dump` is unavailable at runtime, RISpro falls
back to a current v3 snapshot safety backup and records that fallback method in
the safety metadata.

`POST /api/admin/restore/v3` is implemented behind the release flag
`RESTORE_V3_FULL_ENABLED=true`. The default is disabled and returns
`V3 full restore is disabled by configuration.`

The DB-only endpoint is experimental. It is not a full RISpro restore because it
does not replace app-owned storage, restore external documents, or write `.env`.
It is disabled unless `RESTORE_V3_DB_ONLY_ENABLED=true`.
Before production use, run the live DB integration test against a disposable
PostgreSQL database:

```powershell
$env:BACKUP_V3_DB_RESTORE_INTEGRATION="1"
$env:TEST_DATABASE_URL="postgresql://user:password@host:5432/throwaway_rispro_restore_test"
node --import tsx --test src/services/backup-v3-db-restore.integration.test.ts
```

## Disposable Full Restore Staging Validation

Run this only against disposable resources. Never point it at live RISpro data.

1. Create a disposable PostgreSQL database.
2. Create a disposable app-owned storage root.
3. Create a disposable allowlisted external document root.
4. Create a disposable `.env` path.
5. Start RISpro with `RESTORE_V3_FULL_ENABLED=true` and disposable config paths.
6. Generate a v3 backup from known fixture data.
7. Mutate DB rows, app-owned storage files, external document files, and `.env`.
8. Upload the backup to `POST /api/admin/restore/v3` with multipart fields:
   `backup`, `passphrase`, and `confirmation=RESTORE RISPRO`.
9. Verify the response includes `restartRequired: true` and no secret values.

Required success checks:

- DB rows match the backup.
- Sequences are reseeded.
- App-owned storage is mirrored exactly.
- Extra local app-owned storage files are removed.
- External document files from the archive are restored selectively.
- Unrelated external document files are preserved.
- Managed `.env` keys are restored.
- Unrelated local `.env` keys are preserved.
- `NODE_ENV` and `PORT` remain local deployment values.
- Response and logs do not expose secrets.

Required failure-mode checks:

- Validation failure changes nothing.
- Safety-backup failure changes nothing.
- DB restore failure rolls back and does not touch filesystem or `.env`.
- Storage failure after DB commit returns partial failure with safety paths.
- External document partial failure reports restored and failed files.
- `.env` failure reports partial failure.
- Restore lock prevents concurrent full restore.

Storage restore note:

- Nested app-owned runtime directories under `/app/storage` such as uploads,
  Sante HL7 outbox, and DICOM worklist roots are restore boundaries.
- If storage restore reports `EBUSY`, `EPERM`, or `ENOTEMPTY` while removing a
  mounted app-owned directory, treat it as a recoverable storage algorithm case
  only after this boundary-preserving restore fix is deployed.
- Do not retry blindly after an `EBUSY` partial failure on an unpatched build.
  Confirm the patched restore preserves the mounted directory and replaces its
  contents instead of removing the directory itself.

Docker deployment smoke:

```powershell
docker build -t rispro-restore-smoke .
docker run --rm rispro-restore-smoke pg_dump --version
```

If Docker is unavailable on the validation machine, this remains a required
deployment smoke before enabling `RESTORE_V3_FULL_ENABLED=true` in production.
