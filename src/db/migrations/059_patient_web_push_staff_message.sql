-- Allow manually triggered staff messages to subscribed patient browsers.

alter table patient_notification_events
  drop constraint if exists patient_notification_events_event_type_check;

alter table patient_notification_events
  add constraint patient_notification_events_event_type_check check (
    event_type in (
      'appointment_reminder_24h',
      'appointment_rescheduled',
      'appointment_cancelled',
      'appointment_changed',
      'report_ready',
      'image_ready',
      'test',
      'staff_message'
    )
  );
