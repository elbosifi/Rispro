# Outbound Email

RISpro stores one SMTP configuration row and a durable PostgreSQL email outbox. SMTP passwords are AES-256-GCM encrypted with `RISPRO_SECRET_ENCRYPTION_KEY`; generate it with `openssl rand -base64 32`, put it in the runtime environment, and restart RISpro. Backup V3 includes this managed environment key so restored encrypted SMTP credentials remain decryptable.

Configure Settings → Email & Notifications with the exact cPanel Email Accounts → mailbox → Connect Devices values. TLS uses secure SMTP (normally port 465); STARTTLS uses `requireTLS` (often port 587). Certificate validation is always enabled. Save the configuration, use Test Connection to run SMTP verification without sending mail, then use Send Test Email to enqueue a durable system-test message.

Outbox history means **Accepted by mail server**, not inbox delivery. Transient failures retry after 1, 5, and 30 minutes; after four attempts or a permanent SMTP failure the record is Failed. Disable Outbound email to prevent future business-email events; connection and deliberate system-test operations remain available. No clinical workflow sends email in Phase 1.
