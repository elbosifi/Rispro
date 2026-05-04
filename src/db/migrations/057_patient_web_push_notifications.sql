-- Patient Web Push notification storage.
--
-- Subscriptions are browser/device scoped and may be linked to multiple
-- appointment bookings through patient_web_push_booking_subscriptions.

create table if not exists patient_web_push_subscriptions (
  id bigserial primary key,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  subscription_hash text not null,
  user_agent text,
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_web_push_subscriptions_hash_unique unique (subscription_hash)
);

create index if not exists patient_web_push_subscriptions_enabled_idx
  on patient_web_push_subscriptions(enabled)
  where enabled = true;

create table if not exists patient_web_push_booking_subscriptions (
  id bigserial primary key,
  subscription_id bigint not null references patient_web_push_subscriptions(id) on delete cascade,
  booking_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  patient_id bigint not null references patients(id) on delete cascade,
  appointment_reminder_24h boolean not null default true,
  appointment_rescheduled boolean not null default true,
  appointment_cancelled boolean not null default true,
  appointment_changed boolean not null default true,
  report_ready boolean not null default true,
  image_ready boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_web_push_booking_subscriptions_unique unique (subscription_id, booking_id)
);

create index if not exists patient_web_push_booking_subscriptions_booking_idx
  on patient_web_push_booking_subscriptions(booking_id, enabled);

create index if not exists patient_web_push_booking_subscriptions_patient_idx
  on patient_web_push_booking_subscriptions(patient_id, enabled);

create table if not exists patient_notification_events (
  id bigserial primary key,
  booking_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  patient_id bigint not null references patients(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'appointment_reminder_24h',
      'appointment_rescheduled',
      'appointment_cancelled',
      'appointment_changed',
      'report_ready',
      'image_ready',
      'test'
    )
  ),
  dedupe_key text not null,
  scheduled_for timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'sent', 'failed', 'skipped')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_notification_events_dedupe_unique unique (dedupe_key)
);

create index if not exists patient_notification_events_due_idx
  on patient_notification_events(status, scheduled_for, id);

create index if not exists patient_notification_events_booking_type_idx
  on patient_notification_events(booking_id, event_type);

create table if not exists patient_notification_deliveries (
  id bigserial primary key,
  event_id bigint not null references patient_notification_events(id) on delete cascade,
  subscription_id bigint not null references patient_web_push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'sent', 'failed', 'skipped')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_notification_deliveries_unique unique (event_id, subscription_id)
);

create index if not exists patient_notification_deliveries_due_idx
  on patient_notification_deliveries(status, attempt_count, id);

create index if not exists patient_notification_deliveries_event_idx
  on patient_notification_deliveries(event_id, status);

update system_settings
set setting_value = jsonb_build_object(
  'value',
  coalesce(system_settings.setting_value->'value', '{}'::jsonb) ||
  jsonb_build_object(
    'webPushEnabled', false,
    'webPushDefaultReminder24h', true,
    'webPushDefaultRescheduled', true,
    'webPushDefaultCancelled', true,
    'webPushDefaultChanged', true,
    'webPushDefaultReportReady', true,
    'webPushDefaultImageReady', false,
    'webPushCardTitleAr', 'تذكير وتنبيهات الموعد',
    'webPushCardTitleEn', 'Appointment reminders and alerts',
    'webPushCardBodyAr', 'يمكنك تفعيل تنبيهات المتصفح لهذا الموعد.',
    'webPushCardBodyEn', 'You can enable browser notifications for this appointment.',
    'webPushSubscribeButtonAr', 'تفعيل التنبيهات',
    'webPushSubscribeButtonEn', 'Enable notifications',
    'webPushUnsubscribeButtonAr', 'إيقاف التنبيهات',
    'webPushUnsubscribeButtonEn', 'Disable notifications',
    'webPushTestButtonAr', 'إرسال تنبيه تجريبي',
    'webPushTestButtonEn', 'Send test notification',
    'webPushUnsupportedMessageAr', 'تنبيهات المتصفح غير مدعومة على هذا الجهاز.',
    'webPushUnsupportedMessageEn', 'Browser notifications are not supported on this device.',
    'webPushDeniedMessageAr', 'تم رفض إذن التنبيهات من المتصفح.',
    'webPushDeniedMessageEn', 'Notification permission was denied in this browser.',
    'webPushAppointmentReminder24hTitle', 'Appointment reminder',
    'webPushAppointmentReminder24hBody', 'You have an appointment soon. Open your appointment page for details.',
    'webPushAppointmentRescheduledTitle', 'Appointment updated',
    'webPushAppointmentRescheduledBody', 'Your appointment date or time changed. Open your appointment page for details.',
    'webPushAppointmentCancelledTitle', 'Appointment cancelled',
    'webPushAppointmentCancelledBody', 'Your appointment has been cancelled. Open your appointment page for details.',
    'webPushAppointmentChangedTitle', 'Appointment updated',
    'webPushAppointmentChangedBody', 'Your appointment details changed. Open your appointment page for details.',
    'webPushReportReadyTitle', 'Report ready',
    'webPushReportReadyBody', 'Your report is ready. Open your appointment page for access options.',
    'webPushImageReadyTitle', 'Images ready',
    'webPushImageReadyBody', 'Your images are ready. Open your appointment page for access options.',
    'webPushTestTitle', 'Notifications enabled',
    'webPushTestBody', 'Browser notifications are enabled for this appointment.'
  )
)
where category = 'patient_qr_self_service'
  and setting_key = 'config';
