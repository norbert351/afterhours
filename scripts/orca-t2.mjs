import * as orca from "@orca-so/whirlpools-sdk";
console.log("--- toTokenAmount sig ---");
console.log(orca.toTokenAmount.toString());
const t = orca.toTokenAmount(3300000n, 9);
console.log("toTokenAmount(3300000,9) ->", JSON.stringify(t, (k,v)=>typeof v==='bigint'?(v.toString()+'n'):v, 2));
console.log("type:", typeof t, "| eq?", typeof t?.eq, "| keys:", t ? Object.getOwnPropertyNames(t) : null);