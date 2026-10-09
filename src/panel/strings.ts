// [Guru, Librarian]

import { type Lang, type TranslationKey, type Vars, fill, t as appWords } from "@/lib/i18n";

/**
 * The panel's words: the app's own (`src/lib/i18n.ts`), and `OWN`, the few
 * only the plugins say — connecting, syncing, recording from the header.
 */

const OWN = {
  en: {
    tabSearch: "Search",
    tabNote: "This note",
    tabSync: "Sync",
    record: "Record",
    recordStop: "Stop {time}",
    connectHint: "In Mnemo Scribe, open Settings, name this device and press Connect a device. Paste the token it shows here.",
    connect: "Connect",
    openANote: "Open a Mnemo Scribe note to see its key details and related notes.",
    syncNow: "Sync now",
    importNew: "Import new notes",
    placesFolders: "Folders that sync",
    placesNotebooks: "Notebooks that sync",
    placesHint: "Ticked ones sync both ways, the ones inside them included. Ticking one offers its notes for import, priced first. Unticking deletes nothing.",
    wholeVault: "Whole vault",
    allNotebooks: "All notebooks",
    chooseToSync: "Choose what syncs",
    topUp: "Top up",
    offline: "Not reachable. Check the connection and try again.",
  },
  cs: {
    tabSearch: "Hledat",
    tabNote: "Tato poznámka",
    tabSync: "Synchronizace",
    record: "Nahrát",
    recordStop: "Zastavit {time}",
    connectHint: "V Mnemo Scribe otevřete Nastavení, pojmenujte toto zařízení a stiskněte Připojit zařízení. Zobrazený token vložte sem.",
    connect: "Připojit",
    openANote: "Otevřete poznámku z Mnemo Scribe a uvidíte její klíčové údaje a související poznámky.",
    syncNow: "Synchronizovat",
    importNew: "Importovat nové poznámky",
    placesFolders: "Složky, které se synchronizují",
    placesNotebooks: "Sešity, které se synchronizují",
    placesHint: "Zaškrtnuté se synchronizují oběma směry, i ty uvnitř. Zaškrtnutí nabídne jejich poznámky k importu, nejdřív s cenou. Odškrtnutí nic nemaže.",
    wholeVault: "Celý trezor",
    allNotebooks: "Všechny sešity",
    chooseToSync: "Vyberte, co se synchronizuje",
    topUp: "Dobít",
    offline: "Nedostupné. Zkontrolujte připojení a zkuste to znovu.",
  },
} as const;

export type { Lang, Vars };
export type Key = keyof (typeof OWN)["en"] | TranslationKey;

/** The language this app runs in: Czech when it says so, else English. */
export function langOf(): Lang {
  return typeof navigator !== "undefined" && navigator.language.slice(0, 2) === "cs" ? "cs" : "en";
}

/** A word in `lang`: the plugins' own, else the app's, both through the app's `t()`. */
export function t(lang: Lang, key: Key, vars?: Vars): string {
  if (key in OWN.en) {
    const own: Record<string, string> = OWN[lang];
    return fill(own[key] ?? (OWN.en as Record<string, string>)[key], lang, vars);
  }
  return appWords(key as TranslationKey, lang, vars);
}
