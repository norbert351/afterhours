// AfterHours — real-time alert push. Fires a webhook (e.g. Telegram bot / n8n /
// any endpoint) when a strategy alert is produced. Best-effort — a delivery
// failure never blocks or rolls back the alert it accompanies.
export async function pushAlert(payload, webhookUrl = process.env.AH_ALERT_WEBHOOK_URL) {
  if (!webhookUrl) return { delivered: false, reason: "no AH_ALERT_WEBHOOK_URL configured" };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:
          `🔔 AfterHours\n${payload.text || ""}\nNAV: $${payload.navUsd ?? "—"} · ${new Date().toISOString()}`,
      }),
    });
    return { delivered: res.ok, status: res.status };
  } catch (e) {
    return { delivered: false, reason: e.message };
  }
}