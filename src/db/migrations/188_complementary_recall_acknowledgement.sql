alter table appointments_v2.complementary_recall_requests
  add column if not exists reception_acknowledged_at timestamptz,
  add column if not exists reception_acknowledged_by_user_id bigint references users(id) on delete set null;
