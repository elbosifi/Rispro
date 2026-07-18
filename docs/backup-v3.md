# RISpro v3 Backup Archive Notes

v3 backup and restore preview support RISpro-generated stored ZIP archives only.
Arbitrary compressed ZIP archives are rejected.

Restore preview validates ZIP entry metadata before writing any file to staging:
path, prefix, entry type, compression method, duplicate status, per-file size, file count, and total uncompressed size are accepted first. Only then are entries extracted to a temporary staging directory.

Automated and manual V3 archives use stored-entry ZIP64 metadata. This removes
classic ZIP's 4 GiB and 65,535-entry format ceilings while restore preview still
enforces the archive limits recorded in `manifest.json`: 60,000 files, 3 GiB
per entry, and 3 GiB total uncompressed content. Operators should size staging
storage for at least 120% of the largest completed archive and may set
`BACKUP_V3_MIN_STAGING_FREE_BYTES` to a stricter site floor.

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

## Automated Backup V3 Control Center

Settings → Backup and Restore contains the automated control center. Supervisors
can select enabled destinations and queue a backup; only a recently
re-authenticated `super_admin` can save, test, pause, or edit a destination,
store the automated archive passphrase, or change a schedule. The server stores
destination credentials and the automated passphrase as AES-256-GCM encrypted
blobs; list and diagnostics responses expose only whether credentials are
configured, never their values.

`BACKUP_V3_MASTER_KEY` is the encryption root for these blobs. Preserve it in
the deployment secret manager and an independently protected recovery record.
Replacing or losing it intentionally makes old destination credentials and the
automated archive passphrase unreadable; RISpro fails closed until a
super-administrator re-enters credentials after key recovery or rotation.

An automated archive includes a PostgreSQL custom dump, app-owned storage,
selected document files, encrypted managed configuration, and a manifest with
checksums. PACS/Orthanc study data is intentionally excluded. Temporary archives
are written under `storage/backups/staging`; the worker refuses to begin when
free capacity is below the larger of one GiB (or
`BACKUP_V3_MIN_STAGING_FREE_BYTES`) and 120% of the largest prior archive.

Supported destinations are local approved roots, SMB, SFTP with a pinned SHA256
host key, and Nextcloud WebDAV with HTTPS and an app password. SMB uses
SMB2/SMB3 only. Copy is temporary-name → read-back checksum → atomic promotion;
a job is successful only when every selected destination verifies. OneDrive is
shown as unavailable until its delegated OAuth implementation is deployed.
It is isolated rather than emulated: the final integration requires a Microsoft
Entra app registration, a deployment redirect URI, and delegated
`Files.ReadWrite.AppFolder` consent. Routine destination operation remains in
the UI and must never require a Microsoft password or RISpro environment-file
editing.

### SMB transfer behavior and destination-copy retry

**Test** is a short connection and small write/delete probe. It proves the
application can authenticate and use the selected share; it is not a benchmark
for transferring a full archive. SMB2/SMB3 remains mandatory and credentials
are passed to `smbclient` only through a mode-restricted credential file.

Directory, rename, deletion, and Test operations use the configured short
connection/process timeout. Archive `put` and verified `get` retain that
`smbclient -t` network-stall guard, but use a separate whole-process deadline:
at least 10 minutes, calculated as archive size at a conservative 2 MiB/s plus
five minutes, and capped at two hours. A process deadline produces the safe
message `SMB archive transfer timed out.` rather than an authentication or
permission diagnosis. Promotion from `.partial` to the final filename occurs
only after successful read-back size and SHA-256 verification.

If a generated archive copied unsuccessfully to one or more destinations,
**Retry destination copy** queues a new auditable copy-only job for just the
failed/requested destinations. Before it runs, RISpro verifies the canonical
artifact is a `.rispro.zip` file inside `storage/backups/artifacts` with its
recorded size and SHA-256. It reuses those bytes and never regenerates an
archive. If the artifact is missing or changed, retry fails safely and the
operator must use **Run now** to intentionally generate a fresh backup.

`storage/backups` is intentionally excluded from archive content. This covers
staging `.part` files, retained artifacts, restore-verification scratch files,
and future backup-internal directories, while ordinary application files such
as uploads and worklists remain included.

For deployments running the old build, after confirming no backup job is
active, an operator may remove clearly identified orphaned remote `.partial`
files from the configured RISpro backup folder using the share's normal
administrative tools. Do not remove final `.rispro.zip` files selected by
retention. Review failed jobs and local `storage/backups/artifacts` before
removing older failed artifacts: preserve any artifact referenced by a failed
job that may need **Retry destination copy**. Old staging `.part` files left
by a stopped worker can be removed only after confirming no worker/job owns
them; they are never valid backup archives.

Schedules are persisted in `Africa/Tripoli` by default and use a persisted
`next_run_at`, so a restart or a delayed worker tick does not silently miss a
run. The default control-center retention preset is 7 daily, 4 weekly, and 12
monthly copies; the newest verified copy and an artifact's only verified copy
are never candidates for deletion. Retention deletions are recorded in the
audit trail. Local, SMB, SFTP, and Nextcloud deletion is limited to a verified
RISpro archive filename under the configured destination folder; unrelated
files are never selected. OneDrive retention remains unavailable until its
OAuth destination is configured.

## Routine UI operation and destination setup

Routine automated backup operation is entirely in **Settings → Backup and
Restore → Automated Backup V3 control center**. A recently re-authenticated
super administrator creates destinations, stores the automated archive
passphrase, creates schedules, chooses retention, runs a backup, reviews copy
verification, and queues restore verification. A supervisor may view health,
history, and downloads, and may queue an allowed manual backup without seeing
or changing credentials. The emergency command-line procedures below are not
needed for normal operation.

### Local storage

Choose **Local approved path** and enter an approved server path. By default
the approved root is `storage/backups`; deployments can additionally approve
roots with `BACKUP_V3_LOCAL_ROOTS`. RISpro rejects traversal and paths outside
those roots. Use **Test** to confirm read/write access and available space,
then select the destination for a Run now or schedule. The worker stages an
incomplete archive under `storage/backups/staging` and retains completed local
artifacts under `storage/backups/artifacts` for durable history, download, and
restore verification.

### Windows, NAS, and SMB/CIFS

Choose **SMB share** for Windows Server, Samba, Synology, QNAP, TrueNAS, or
another SMB2/SMB3 endpoint. Enter server/IP, share, optional subfolder,
username, password, and optional domain/workgroup, then use **Test**. RISpro
connects from the application itself; do not mount the share on the host and
do not enable SMB1. A failed test reports the safe server-side classification
without returning or logging the password. Check share permissions and free
space when a test cannot write a temporary probe file.

### Linux, NAS, and SFTP

Choose **SFTP** and enter host, port, username, an absolute remote folder, and
the server SHA256 host-key fingerprint. Select password or private-key
authentication; an optional private-key passphrase is stored only encrypted.
RISpro refuses an unknown or mismatched host key rather than silently trusting
it. Use **Test** to create, read, and remove a temporary probe file. SFTP
paths cannot escape the configured remote directory.

### Nextcloud WebDAV

Choose **Nextcloud WebDAV**, enter the HTTPS server URL, Nextcloud username,
remote folder, and a Nextcloud-generated app password. Do not use the normal
Nextcloud account password. RISpro creates the WebDAV folder when permitted,
uploads to a temporary name, reads it back for checksum verification, and then
promotes the completed archive. Certificate verification is always enforced;
an invalid certificate, authentication failure, or unavailable server appears
as a safe destination failure in the UI and diagnostics.

### OneDrive final milestone

OneDrive is intentionally isolated until a Microsoft Graph OAuth destination
is enabled. Its required Microsoft portal step is an Entra application
registration with a deployment redirect URI and delegated
`Files.ReadWrite.AppFolder` consent. The intended authorization flow is
browser-based and never asks for a Microsoft password or an RISpro environment
file edit. Once implemented, the UI will start authorization, show the account
identity and selected folder, and offer reconnect/revoke actions while keeping
tokens encrypted and masked. Until then select Local, SMB, SFTP, or Nextcloud.

### Scheduling, retention, and health

Schedules use `Africa/Tripoli` by default and support daily, weekdays, weekly,
and monthly timing. The available retention presets are 7 daily / 4 weekly /
12 monthly, 14 daily / 12 monthly, and 30 daily; custom daily, weekly, and
monthly counts are also supported. The newest verified archive and the only
verified copy of an artifact are never candidates for deletion. Retention
previews and deletions require recent supervisor re-authentication, record an
audit action, and never select files outside the configured RISpro folder.

The overview reports health, worker heartbeat, active work, last completed
backup, last verified copy, last successful restore verification, next run,
overdue schedules, and staging capacity. A warning or critical state should be
investigated before relying on a schedule. Common safe messages include missing
archive passphrase, low staging space, destination authentication failure,
host-key mismatch, WebDAV certificate/connectivity failure, and an overdue
schedule. Resolve the underlying configuration and use **Retry** rather than
editing history records.

### Server-loss and encryption-key recovery

Keep the encrypted archives, the automated archive passphrase recovery record,
and `BACKUP_V3_MASTER_KEY` in independently protected locations. Losing or
replacing the master key intentionally makes saved destination credentials and
the stored automated passphrase unreadable; restore the original key from the
deployment secret manager/recovery record, or re-enter each credential and
passphrase after a deliberate key rotation. If the main RISpro server is
unavailable, recover the application and database on isolated infrastructure,
then use the existing full Restore V3 preview, exact confirmation, safety
backup, and restart procedure. Do not point restore verification or recovery
at production storage until the normal restore safeguards are satisfied.

## Disposable Scheduled Restore Verification

Do not point restore verification at the live application database or
`/app/storage`. The optional compose override creates an isolated PostgreSQL 16
database named `rispro_restore_verify` and a separate verification volume:

```sh
export BACKUP_V3_RESTORE_VERIFY_PASSWORD='a-long-deployment-secret'
docker compose -f docker-compose.yml -f docker-compose.backup-verify.yml --profile backup-verify up -d --build
```

For a scheduled job with weekly or monthly restore verification, the worker
decrypts and validates the stored archive, restores only the PostgreSQL custom
dump to that disposable database, compares row counts with the manifest, and
copies files into a throwaway verification run directory for checksum checks.
The report, failure reason, worker heartbeat, latest successful archive, and
retention activity appear in System Diagnostics without secret values.
