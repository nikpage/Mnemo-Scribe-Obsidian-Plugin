// The esbuild settings every plugin builds the app's screens with (Obsidian
// here, Joplin in `joplin-plugin/build.mjs`). The app's files are built as
// they are; `tsconfig.json`'s `paths` swaps the few parts that differ in a
// plugin, for every file in the bundle, the app's included.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** One copy of React and SWR in a bundle, whichever folder a file sits in. */
const once = {
  name: "one-react",
  setup(build) {
    const from = existsSync(join(here, "node_modules/react")) ? here : join(here, "..");
    build.onResolve({ filter: /^(react|react-dom|swr|lucide-react)(\/.*)?$/ }, (args) =>
      args.resolveDir === from ? undefined : build.resolve(args.path, { kind: args.kind, resolveDir: from })
    );
  },
};

export const appBuild = {
  tsconfig: join(here, "tsconfig.json"),
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [once],
};
