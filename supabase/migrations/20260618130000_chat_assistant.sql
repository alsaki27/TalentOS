-- AI chatbot assistant (explicit, requested reversal of this app's prior "no AI
-- integrations" stance — see ROADMAP.md). Read-only tool-calling over the existing
-- tables; the assistant never writes to app data directly, only chats/tool-calls are
-- persisted here.

create table if not exists chat_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(user_id) on delete set null,
  title       text not null default 'New conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chat_conversations_user_idx on chat_conversations (user_id, updated_at desc);

create table if not exists chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'tool')),
  content         text not null,            -- text content, or JSON for tool calls/results
  tool_name       text,                      -- set when role = 'tool'
  created_at      timestamptz not null default now()
);
create index if not exists chat_messages_conversation_idx on chat_messages (conversation_id, created_at);
