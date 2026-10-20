// [utils]

/**
 * Work that outlives a request, started. On Netlify (`SITE_ID` is set there
 * at run time) it goes to the named background function, which answers 202 at
 * once and has fifteen minutes; only the app starts one, with the cron key.
 * `next dev` has none and cuts no request short, so there it runs here.
 *
 * False when the background function did not take it: the caller marks its
 * row failed and lets go of its claim, since nothing else will.
 */
export async function startBackground(name: string, body: object, base: string, here: () => Promise<void>): Promise<boolean> {
  if (!process.env.SITE_ID) {
    await here();
    return true;
  }
  const started = await fetch(new URL(`/.netlify/functions/${name}`, base), {
    method: "POST",
    headers: { "x-cron-key": process.env.CRON_SECRET ?? "" },
    body: JSON.stringify(body),
  }).catch((err: unknown) => err);
  if (started instanceof Response && started.status === 202) return true;
  console.error(`${name} did not start:`, started instanceof Response ? `answered ${started.status}` : started);
  return false;
}
