-- File attachments on chat messages. Text-based files (.txt/.md/.csv/.json/.log) have
-- their content extracted at upload time and stored in attachment_text so the assistant
-- can read them directly; other file types (images, PDFs, docs) are stored and shown to
-- the user, but their binary content isn't extracted/analyzed in this v1 — the model only
-- knows the filename/type for those, not the contents.

alter table chat_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_text text;
