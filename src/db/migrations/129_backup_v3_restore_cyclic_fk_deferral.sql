-- Backup V3 restores all tables in one transaction and defers foreign-key
-- validation until commit. These two nullable references form a legitimate
-- cycle once a PACS auto-completion history row is linked back to its booking;
-- neither table can be inserted first when both constraints are immediate.
-- Deferral preserves full referential integrity while allowing the complete
-- consistent snapshot to be restored atomically.

alter table appointments_v2.bookings
  alter constraint bookings_auto_completion_check_fk
  deferrable initially immediate;

alter table appointments_v2.pacs_auto_completion_verification_history
  alter constraint pacs_auto_completion_verification_history_booking_id_fkey
  deferrable initially immediate;
