# INTENT — Clanker

**Read this file first.** It explains why Clanker exists, the rules it must
follow, what it deliberately does not do, and how changes are made. If this
file and another document disagree, this file wins on *intent* (what we are
trying to do) and the specs win on *detail* (exactly how).

This file is static. It states what Clanker is and must be — not what has
shipped. Implementation status lives in specs and delivery records, never
here.

## Why Clanker exists

Clanker is a standalone character chat app: you create characters, talk with
them, and each character keeps its own memory so conversations continue
across sessions and devices. It runs on the phone (Expo) with its memory in
a local SQLite database (`clanker.db`) through the `expo-llm-wiki` memory
engine, and it syncs that memory through its own cloud backend on
Google Firebase / GCP.

Clanker is a standalone product, deliberately so. Its cloud backend is its
own, and the app is prepared
to be listed for sale: its assets are self-contained and transferable. It
does not sync through SynapseTree and is not planned to; the family shares
a memory engine and a glossary, not a cloud.

## Glossary

- **Character** — a persona the user creates, with its own memory entity in
  the wiki engine.
- **Memory engine** — `@equationalapplications/expo-llm-wiki`, the library
  that owns the facts, their lifecycle, and the words for that lifecycle.
  Clanker never writes engine tables directly.
- **The four states** — a fact is **live**, **superseded**, **forgotten**,
  or **gone**, and erasure makes its bytes unrecoverable. This file uses the
  engine glossary by reference and never invents its own meanings.
- **Forget / prune / erase** — the engine's verbs: forget removes from
  recall now; prune hard-deletes what is forgotten past retention; erase
  makes the bytes unrecoverable. Forget's promise is "gone from recall now,
  gone from disk at erase."
- **Tombstone** — a forgotten row kept for sync, carrying `deleted_at`.

## The rules

### 1. Memory lifecycle follows the engine glossary by reference

The four states and the verbs `supersede`/`expire`, `forget`, `runPrune`,
and `erase` mean what the engine says they mean — no local synonyms. We
never write `deleted_at` into the engine's tables ourselves and never use
it as an archive; an
archive is a superseded fact. Retention is a declared choice, stated here:
forgotten content is hard-deleted on device after 3 days, and events are
kept 14 days.

*Why:* a lifecycle word that means something different on one host poisons
the whole family's vocabulary.

### 2. Deleting a character forgets its whole entity, events included, before its rows go

Removing a character first calls `forget` on its whole entity (events
included) so recall stops at once and tombstones exist for sync, then
removes the character's own rows (characters, messages) that the engine
cannot see, then schedules erase. Deleting rows the engine owns without
forgetting first is a bug, not a shortcut.

*Why:* leftover wiki rows are memories the user asked to be gone.

### 3. Deleting an account wipes the local store and the server copy

Account deletion removes the account's cloud data and wipes or deletes the
local `clanker.db` — every character's memory included. The privacy page's
account-deletion promise is written to match what the code does, and this
rule is what the code must do.

*Why:* an account deletion that leaves the memory database behind breaks
the promise users read.

### 4. Our copy says "forgotten" until erase has run

User-facing text follows the verb that actually ran: "forgotten" after
forget, "deleted from this device" once prune's window has passed, and
"permanently removed" only after erase has run. Where a window still
applies, the copy names it — device and server windows — rather
than promising a removal that has not happened.

*Why:* "permanently removed" shown while a soft-delete window or a server
tombstone still holds the text is a false promise.

### 5. The server stores forgotten facts as hollow tombstones, and purges them

When a fact is forgotten, the sync server keeps only the tombstone — id,
`deleted_at`, `updated_at` — with title, body, and tags removed at the
moment of deletion, and purges hollow tombstones after 30 days. The server
never keeps forgotten fact text indefinitely.

*Why:* a tombstone that still carries the text is retention wearing a
deletion flag.

### 6. Out-of-file copies are named here, each with its retention

OKF exports the user takes and OS backups are the user's own files and
outside this file's promises. The Firebase tombstones follow rule 5.

### 7. Custody and roles

The local database is the user's. We are the controller for memory synced
to our cloud and for text sent to model providers; those providers, and the
Firebase/GCP backend, are named in the privacy page with their regions.
Source documents handed to the app are immutable host property: we never
rewrite them, and facts derived from them leave only by forget,
re-ingest, or account deletion.

*Why:* the founding principle of the LLM Wiki pattern — immutable source
files — is not ours to violate, and a user entrusting memory to our cloud
must be able to read who holds it.

## Out of scope (don't build these here)

- Syncing through SynapseTree, or any dependency on the family's cloud.
  Clanker's Firebase backend is its architecture, not a stopgap.
- Renaming or reinterpreting engine lifecycle states locally.
- "Permanently removed" copy anywhere erase has not run.

## How changes are made

1. **Spec first.** Write a spec under `specs/<name>/`, based on an
   investigation that reads the real code, and check it against this file
   before implementation.
2. **Amendments are deliberate.** Changes to this file go through
   pull-request review with a dated note of what changed and why.
3. **Review, then merge.** CI green and independent reviews pass before
   merge.
