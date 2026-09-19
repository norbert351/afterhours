// Test driver: exercise custom Solana wallet auth against the LIVE server.
// Creates a fresh ed25519 keypair, gets a challenge, signs the message, verifies.
import { getPublicKey, sign, verify, hashes } from "@noble/ed25519";
import { randomBytes, createHash } from "node:crypto";
import bs58 from "bs58";
hashes.sha512 = (m) => new Uint8Array(createHash("sha512").update(m).digest());

const kp = randomBytes(32);
const pub = getPublicKey(kp);
const addr = bs58.encode(pub);

// 1) challenge
const ch = await (await fetch("http://localhost:8080/api/auth/wallet/challenge", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr }),
})).json();
console.log("challenge:", { nonce: ch.nonce, expiresAt: !!ch.expiresAt });
const message = ch.message;

// 2) sign
const sig = sign(new TextEncoder().encode(message), kp);
const sigB58 = bs58.encode(sig);
console.log("local self-check verify(ed25519):", verify(sig, new TextEncoder().encode(message), pub));

// 3) verify on server -> session cookie
const cookieJar = {};
const res = await fetch("http://localhost:8080/api/auth/wallet/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: addr, signature: sigB58 }),
});
const ver = await res.json();
const setCookie = res.headers.get("set-cookie") || "";
console.log("verify resp:", ver, "| set-cookie:", setCookie.slice(0, 40));
if (setCookie) {
  const token = setCookie.split(";")[0];
  const me = await (await fetch("http://localhost:8080/api/auth/me", { headers: { cookie: token } })).json();
  console.log("me after wallet sign-in:", me.handle ? { handle: me.handle.slice(0, 10) + "…", watchlist: me.watchlist } : me);
}
// 4) bad signature must fail
const bad = await (await fetch("http://localhost:8080/api/auth/wallet/verify", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: addr, signature: bs58.encode(sign(new TextEncoder().encode("wrong"), kp)) }),
})).json();
console.log("bad signature ->", bad.error);