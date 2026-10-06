# Mnemo

Scribe in Obsidian, on desktop and phone.

The folders you choose sync both ways with Scribe. Notes recorded on your
phone land beside the notes they belong with, edits you make here go back,
and a side panel brings Scribe's reading of your notes into the vault.

Needs a Scribe account.

## Install

Until Mnemo is in the Community plugins store, install it with BRAT:

1. Settings → Community plugins → Browse → install and enable **BRAT**.
2. BRAT → **Add beta plugin** → paste this repository's GitHub link → Add.
3. Enable **Mnemo** under Community plugins.

BRAT keeps it updated like any other plugin.

Then open Mnemo's settings:

- **Device token** — Scribe → Settings → Connect a device. Shown once.
- **Folders that sync** — tick any folders, or the whole vault. Ticking one
  offers its files for import into Scribe and says what that costs first.

## What it does

- **Files stay where you put them.** A note is rewritten in place, never
  moved. Moving a file to another folder adds that folder's words as tags.
- **New notes land where their tags fit.** A note recorded elsewhere goes to
  the synced folder whose notes share most of its tags, if one clearly
  leads; otherwise to the inbox (**From Scribe**). A notice says where.
- **Tags are one set.** Front-matter `tags:` and the note's tags in Scribe are
  the same list; change either side and the other follows on the next sync.
- **Nothing is deleted without asking.** Deleting a synced file asks whether
  to delete it in Scribe too. A note deleted in Scribe goes to the vault's
  trash.
- **Edited in both places:** Scribe's copy is written to the file and yours is
  kept beside it as `<name> (conflict YYYY-MM-DD).md`.

## The panel

The brain icon opens it. On the open note, its folder, or the whole vault:
**Next** (What next, with Elaborate under each heading), **Ask** (a written
answer, each citation opens its note), **Details** (amounts, dates, people),
**Related**, **Search** (words free; semantic search on a press), **Themes**,
and **Clients** when you keep them.

Paid actions show their cost in credits on the button and are refused at
zero, with a link to top up. Your balance sits at the top of the panel.

## Recording

The microphone icon, or **Mnemo: Record a note**. Audio is kept on this
device until Scribe has it and goes straight to Scribe's storage. The note
arrives in the vault once transcribed.

## Building

```bash
npm ci
npm run build
```

Pushing a tag equal to the version in `manifest.json` releases `main.js`,
`manifest.json` and `styles.css` (`.github/workflows/release.yml`).
