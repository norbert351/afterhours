// E2E: wallet auth + wallet-confirmed strategy add (real ed25519 signatures).
import bs58 from "bs58";
import * as ed25519 from "@noble/ed25519";
import { createHash, randomBytes } from "node:crypto";
ed25519.hashes.sha512 = (m) => new Uint8Array(createHash("sha512").update(m).digest());

const BASE = "http://localhost:8090";
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// 1) create a wallet keypair
const priv = randomBytes(32);
const pub = ed25519.getPublicKey(priv);
const address = bs58.encode(pub);
console.log("wallet address:", address.slice(0, 6) + "…" + address.slice(-4));

// 2) wallet sign-in (challenge -> sign -> verify)
const ch = await j(await fetch(`${BASE}/api/auth/wallet/challenge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) }));
const sig = ed25519.sign(new TextEncoder().encode(ch.body.message), priv);
const cj = new (await import("node:fs")).WriteStream("/tmp/ahWallet.txt");
const resp = await fetch(`${BASE}/api/auth/wallet/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, signature: Array.from(sig) }) });
const v = await resp.json();
console.log("wallet sign-in:", v.error || `ok short=${v.short}`);
// capture session cookie
const setCookie = resp.headers.get("set-cookie") || "";
const token = (setCookie.match(/ah_session=([^;]+)/) || [])[1];
cj.write("ah_session=" + token + ";"); cj.end();

// 3) strategy challenge for THIS wallet
const text = "buy SPACEX and OPENAI under 10% over mark";
const actCh = await j(await fetch(`${BASE}/api/v2/strategies/challenge`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `ah_session=${token}` }, body: JSON.stringify({ text }) }));
console.log("challenge ok:", !actCh.body.error, "| intent:", actCh.body.intent.slice(0, 40) + "…");
const aSig = ed25519.sign(new TextEncoder().encode(actCh.body.message), priv);

// 4) confirm with signature + address
const confirm = await fetch(`${BASE}/api/v2/strategies`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `ah_session=${token}` }, body: JSON.stringify({ text, type: "rotate_to_discount", address, signature: Array.from(aSig) }) });
const cf = await confirm.json();
console.log("confirm status:", confirm.status);
console.log("confirmed:", cf.confirmed, "| parsed:", cf.parsed?.summary);

// 5) verify confirmed strategy stored + isolated
const list = await fetch(`${BASE}/api/v2/strategies`, { headers: { Cookie: `ah_session=${token}` } }).then((r) => r.json());
const mine = list.filter((s) => s.authorAddress === address);
console.log("my confirmed strategies:", mine.length, "| confirmed flags:", mine.map((s) => s.confirmed));