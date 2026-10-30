-- Opt-in only; existing reading sessions retain their per-tab launch profile.
alter table ohif_viewer_settings
  add column progressive_loading_enabled boolean not null default false;
