// Privy auth island — mounted into the vanilla landing/dashboard pages.
// Provides a global window.__privyLogin() that opens Privy's modal and posts the
// resulting ID token to /api/auth/privy (verified server-side with the App
// Secret). The App ID is exposed via a script-src data attr, never the secret.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

const APP_ID = window.__PRIVY_APP_ID__;

function Bridge() {
  const { login, authenticated, getAccessToken } = usePrivy();
  window.__privyLogin = async () => {
    try {
      await login();
    } catch (e) {
      window.__privyResult = { error: e?.message || "login cancelled" };
      return;
    }
    try {
      const idToken = await getAccessToken();
      if (!idToken) { window.__privyResult = { error: "no token after login" }; return; }
      const r = await fetch("/api/auth/privy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify({ idToken }),
      });
      window.__privyResult = await r.json();
    } catch (e) {
      window.__privyResult = { error: e?.message || "token exchange failed" };
    }
  };
  return null;
}

if (APP_ID) {
  const el = document.getElementById("privy-root") || document.body.appendChild(document.createElement("div"));
  el.id = "privy-root";
  createRoot(el).render(
    <StrictMode>
      <PrivyProvider appId={APP_ID} config={{ loginMethods: ["wallet"], appearance: { theme: "dark" } }}>
        <Bridge />
      </PrivyProvider>
    </StrictMode>,
  );
} else {
  window.__privyLogin = null;
}