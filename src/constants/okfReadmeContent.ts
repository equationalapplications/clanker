export function buildOkfReadmeContent(): string {
  return `# Open Knowledge Format (OKF) Export

## What's Inside

This ZIP contains your character's complete memory export, including:

- **Facts** - everything your character knows or has learned
- **Tasks** - goals and actions your character is tracking
- **Timeline** - chronological log of events and interactions
- **Connections** - explicit links showing how facts and tasks relate to each other

This bundle conforms to the llm-wiki OKF profile, version 1 (see the root
index.md "profile" key). Timeline entries carry stable ids, so restoring the
same backup twice never duplicates your history, and edge links live in each
entry's "## Related" section. Profile reference:
https://github.com/equationalapplications/expo-llm-wiki/blob/main/docs/okf-profile.md

## File Layout

\`\`\`
index.md                    # Overview of exported entities
README.md                   # This file
entities/
  {character-id}/
    index.md                # Character's fact and task catalog
    log.md                  # Chronological event timeline
    facts/
      {id}.md               # Individual facts with metadata
    tasks/
      {id}.md               # Individual tasks with metadata
\`\`\`

## How to Use This Export

### 1. View Locally

Unzip this file and open it in any markdown viewer:

- **Obsidian** (free, recommended for graph visualization)
- **VS Code** with markdown preview
- **Apple Notes** or any standard markdown reader
- **GitHub** or GitLab

### 2. Back It Up

Store this ZIP in your preferred cloud storage or external drive as a complete backup of your character's knowledge.

### 3. Share or Migrate

If you use other OKF-compatible tools, import this ZIP into them. The standard format helps keep your data portable.

### 4. Restore or Clone

Bring this bundle back into Clanker any time from a character's settings
("Import OKF Backup") or the characters list ("From Bundle"). Restoring
merges new facts in (or replaces existing facts/tasks, if you choose Replace)
into the *same* character; creating from a bundle clones everything into a
*new* character instead.

## What's Not Included (V1)

This export focuses on your character's memories and how they connect:

- **Ontology/Taxonomy Rules** - If your character has ontology rules defined, they are not included in this version.
- **Training/Fine-tuning Data** - This is a knowledge snapshot, not model weights.

## Privacy

This export is generated entirely on your device, offline. It is never uploaded unless you choose to do so. Your data is yours to keep, share, or delete.

## Need Help?

For more details on OKF and this export feature, visit:
https://equationalapplications.com/memory-export-with-okf

---

Generated: ${new Date().toISOString()}`
}
