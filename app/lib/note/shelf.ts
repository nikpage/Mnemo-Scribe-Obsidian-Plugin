// [Filer]

/**
 * Where a note sits, in the order every screen lists them.
 *
 * - `normal`: in the lists, search and the AI.
 * - `archived`: out of the lists; search and the AI still read it.
 * - `cold`: out of the lists and the AI; kept, browsed and searched in its own view.
 * - `trash`: out of everything, restorable; a note app's copy goes to its trash.
 *
 * None of them erases the note's text.
 */
export const SHELVES = ["normal", "archived", "cold", "trash"] as const;
export type Shelf = (typeof SHELVES)[number];

/** The shelves search and the AI read. Every reader of the store filters by this. */
export const READ: Shelf[] = ["normal", "archived"];

/** The note apps a copy can be removed from (`recordings.removed_from`). */
export const APPS = ["obsidian", "joplin"] as const;
export type App = (typeof APPS)[number];

/** Each shelf's name on screen (`lib/i18n.ts`). */
export const SHELF_NAME = {
  normal: "shelfNormal",
  archived: "shelfArchived",
  cold: "shelfCold",
  trash: "shelfTrash",
} as const satisfies Record<Shelf, string>;
