// Build the Privy auth island bundle with esbuild.
//   node scripts/build-privy.mjs   (writes public/privy-auth.js)
import { build } from "esbuild";

await build({
  entryPoints: ["privy/privy-island.jsx"],
  bundle: true,
  format: "iife",
  minify: true,
  jsx: "automatic",
  outfile: "public/privy-auth.js",
  external: [],
  target: "es2020",
  logLevel: "info",
});
console.log("built public/privy-auth.js");