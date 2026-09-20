import * as orca from "@orca-so/whirlpools-sdk";
console.log("--- WhirlpoolContext.from ---");
console.log(orca.WhirlpoolContext.from.toString().slice(0,400));
console.log("\n--- buildDefaultAccountFetcher ---");
console.log(orca.buildDefaultAccountFetcher.toString().slice(0,200));
console.log("\n--- WhirlpoolAccountFetcher proto fns ---");
const p = orca.WhirlpoolAccountFetcher?.prototype;
console.log(Object.getOwnPropertyNames(p||{}).filter(n=>typeof p[n]==='function').join(", "));
console.log("\n--- ParsableWhirlpool ---");
console.log(Object.getOwnPropertyNames(orca.ParsableWhirlpool||{}).join(", "));
console.log("\n--- client getPool likely needs? WhirlpoolClientImpl.getPool ---");
console.log((orca.buildWhirlpoolClient|{} )?.toString?.());
try {
  // peek impl source
  const impl = (await import("@orca-so/whirlpools-sdk/dist/impl/whirlpool-client-impl.js")).default || {};
} catch(e) { console.log("(impl path:", e.message?.slice(0,60), ")"); }