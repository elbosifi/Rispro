alter table teaching.question_revisions
  add column if not exists version integer not null default 1 check (version > 0);

alter table teaching.question_revision_assets
  add column if not exists alt_text text not null default '';

update teaching.question_revision_assets link
set alt_text = asset.alt_text
from teaching.assets asset
where asset.id = link.asset_id and (link.alt_text is null or link.alt_text = '');

-- Reverse lookup is used by the server-side tag filter on the editorial worklist.
create index if not exists teaching_question_revision_tags_tag_revision_idx
  on teaching.question_revision_tags(tag_id, question_revision_id);
