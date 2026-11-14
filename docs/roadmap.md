# Roadmap — what gets built, in what order

> **roadmap.md** · v1.0 · 2026-11-13 ·
> This is the first roadmap for this repository. It holds one step,
> recorded on the owner's ruling of 2026-11-13. It is not an inventory of
> open work; that lives in the issue tracker. Changing the order is an
> amendment: say so in the pull request, don't drift.

## How to read this file

**Steps are ordered by gates, not by calendar.** Each step names the gate
that opens it. A step with an open gate is not late; it is waiting. This
file holds no dates for future work.

**Each step carries a promise class**, the same three the SynapseTree
and Curated Journal roadmaps use, and that the `expo-llm-wiki` roadmap
proposes ([equationalapplications/expo-llm-wiki#378](https://github.com/equationalapplications/expo-llm-wiki/issues/378)):

- **BINDING** — ruled: it will be built, in this order.
- **PLANNED** — decided in principle; its detail waits on a spec, an open
  decision, or an outside dependency. Its place in the order can move by
  amendment.
- **EXPLORATORY** — named so nobody builds it by accident. No commitment
  to build it at all.

**Done mark.** When a step completes, one dated line goes under its
heading: `Done — merged YYYY-MM-DD, PR #N`. It is written in the pull
request that completes the step.

## Step 1 — Attached documents as engine sources — PLANNED

Today a document attached in chat is handed to the wiki engine's
`ingestDocument()` (`src/components/ChatComposer.tsx`, through
`useCharacterWiki` and the `wikiMachine` ingest actor). The engine runs a
model to turn the document into facts, and only those facts can be found
afterwards.

The engine is planned to gain a source store: a document's text kept as
it is, indexed, and searched with no model call (`expo-llm-wiki`
`docs/ROADMAP.md`, step 4, in review as
[equationalapplications/expo-llm-wiki#378](https://github.com/equationalapplications/expo-llm-wiki/issues/378)).

This step moves the attach path to that store once it exists. An attached
document is then findable at once, with no model call.

The spec must say:

- what happens to documents already ingested;
- whether and when a model still extracts facts from an attached
  document;
- whether the facts the librarian writes point back to the document they
  came from (the engine's step 3,
  [equationalapplications/expo-llm-wiki#377](https://github.com/equationalapplications/expo-llm-wiki/issues/377)),
  and what such a pointer adds beyond the `sourceRef` facts carry today;
- which attachment types become sources, including images added through
  _Add to memory_, which reach the same `ingestDocument()` path today;
- where sources are stored and whether they sync with the character, as
  facts and photos already do;
- how a source is removed, and what happens when a changed copy of a
  document is attached again (today the old facts are forgotten first);
- how OKF export and import carry sources
  ([OKF Import & Export](okf-import-export.md));
- what, if anything, a search of sources costs in credits. This is not
  decided; converting a document to text already is.

_Gate:_ the engine release that ships the source store; then this
repository's spec; then the engine bump.

_Why here:_ its only outside dependency is the engine; the spec this
repository writes and the engine bump are inside the step itself. It is
listed now so that nobody builds a second document store beside the
engine in the meantime.
