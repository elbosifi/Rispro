-- Existing tabs remain readable until expiry, but cannot recover without a
-- launch-time authorization snapshot. No credentials or image bytes are stored.
alter table viewer_launch_sessions add column recovery_state jsonb;
