import * as orca from "@orca-so/whirlpools-sdk";
console.log("toTx source:", orca.toTx.toString().slice(0,200));
// introspect common-sdk TransactionBuilder methods
import { TransactionBuilder } from "@orca-so/common-sdk";
console.log("\nTransactionBuilder proto fns:", Object.getOwnPropertyNames(TransactionBuilder?.prototype||{}).filter(n=>typeof TransactionBuilder.prototype[n]==='function').join(", "));