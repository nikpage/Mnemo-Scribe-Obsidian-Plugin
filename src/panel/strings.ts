// [Guru, Librarian]

import { type Lang, type TranslationKey, type Vars, fill, t as appWords } from "@/lib/i18n";

/**
 * The panel's words: the app's own (`src/lib/i18n.ts`), and `OWN`, the few
 * only the plugins say — connecting, syncing, recording from the header.
 */

const OWN = {
  en: {
    tabHome: "Home",
    tabSearch: "Search",
    tabWeb: "Web",
    tabNote: "This note",
    tabSync: "Sync",
    tipPanelRecord: "Records a voice note from here. It is transcribed, summarised and filed, then synced into your notes app.",
    tipTabHome: "Your dashboard: what needs you, open to-dos, and the notes added last.",
    tipTabSearch: "Find notes by their words (free), by meaning, or ask a question answered from your notes only.",
    tipTabNote: "Key details and related notes for the note open in your app.",
    tipTabSync: "Choose which folders or notebooks sync, and run a sync now.",
    tipSyncNow: "Pulls Scribe's newest notes into your app and sends back what you changed here. It also runs by itself; press it when you want it now.",
    tipImportNew: "Offers the notes in your synced places that Scribe does not have yet, priced before you confirm. Use it after adding files here.",
    tipPlace: "Ticked places sync both ways, with the ones inside them. Unticking stops syncing; nothing is deleted.",
    tipConnect: "Connects this device to your Scribe account with the token from Settings.",
    tipTopUp: "Buy more credits for Brain readings, Ask and imports.",
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
    tipChooseToSync: "Opens the Sync tab, where you choose which folders or notebooks are kept in step with Scribe.",
    tipPanelStatus: "Where syncing stands now. Open the Sync tab to run it again or to choose what syncs.",
    tipPanelBalance: "Credits pay for transcription, Brain readings and answers. Top up from here when they run low.",
    tipConnectKey: "Paste the connection key made on Scribe's Settings page. It lets this app sync with your account.",
  },
  cs: {
    tabHome: "Domů",
    tabSearch: "Hledat",
    tabWeb: "Síť",
    tabNote: "Tato poznámka",
    tabSync: "Synchronizace",
    tipPanelRecord: "Nahraje hlasovou poznámku odsud. Přepíše se, shrne a zařadí a pak se synchronizuje do vaší aplikace s poznámkami.",
    tipTabHome: "Váš přehled: co na vás čeká, otevřené úkoly a naposledy přidané poznámky.",
    tipTabSearch: "Hledejte poznámky podle slov (zdarma), podle významu, nebo položte otázku zodpovězenou jen z vašich poznámek.",
    tipTabNote: "Klíčové údaje a související poznámky k poznámce otevřené ve vaší aplikaci.",
    tipTabSync: "Vyberte, které složky nebo sešity se synchronizují, a spusťte synchronizaci.",
    tipSyncNow: "Stáhne nejnovější poznámky ze Scribe do aplikace a pošle zpět, co jste tady změnili. Běží i samo; stiskněte, když to chcete hned.",
    tipImportNew: "Nabídne poznámky v synchronizovaných místech, které Scribe ještě nemá, nejdřív s cenou. Použijte po přidání souborů sem.",
    tipPlace: "Zaškrtnutá místa se synchronizují oběma směry, i ta uvnitř. Odškrtnutí synchronizaci zastaví; nic se nemaže.",
    tipConnect: "Připojí toto zařízení k vašemu účtu Scribe pomocí tokenu z Nastavení.",
    tipTopUp: "Dokoupí kredity na čtení Mozku, Zeptat se a importy.",
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
    tipChooseToSync: "Otevře záložku Synchronizace, kde vyberete, které složky nebo sešity se mají se Scribe udržovat shodné.",
    tipPanelStatus: "Jak si synchronizace právě stojí. Na záložce Synchronizace ji můžete spustit znovu nebo vybrat, co se synchronizuje.",
    tipPanelBalance: "Kredity platí přepis, čtení Mozku a odpovědi. Když dochází, můžete je odsud doplnit.",
    tipConnectKey: "Vložte klíč připojení vytvořený na stránce Nastavení ve Scribe. Díky němu se tato aplikace synchronizuje s vaším účtem.",
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
