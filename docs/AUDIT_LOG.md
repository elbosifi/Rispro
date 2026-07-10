# Audit Log Explorer

The administrative Audit Log is a read-only explorer over immutable `audit_log` rows. `GET /api/audit` defaults to page 1 with 25 rows and accepts page sizes 25, 50, and 100. Ordering is always `created_at desc, id desc`.

Category and outcome are derived deterministically at query time and returned with each row. The default Settings tab is Important; Security, Automated, Other, and All remain available. Unknown actions are retained as Other. Automated rows are intentionally left ungrouped in this implementation so pagination, export, and the immutable event trail remain unambiguous; repeated background noise is controlled by the default Important filter.

The API searches only actor fields, entity/action identifiers, and selected status/outcome/result/code fields from the old and new values. Sensitive keys are redacted recursively at the API and CSV boundaries. The collapsed list avoids patient names and clinical content; the technical section shows only the sanitized structured values.

CSV export uses the active non-pagination filters and streams the complete matching result in bounded batches. It does not export only the visible page. The `115_audit_log_explorer_indexes.sql` migration adds the stable ordering index and the actor/entity/action filter indexes; derived categories are not persisted or backfilled.

System Diagnostics remains a separate super-admin-only Settings section backed by `system_diagnostic_events`, with request correlation and its own redaction and resolution workflow.
