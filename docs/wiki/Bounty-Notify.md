# ⚔️ Bounty Push Notifications (ntfy.sh)

The **Bounty Push Notifications** feature is a background poller that checks for active allied bounties in WareEra battles and sends instant push notifications to your mobile phone or desktop web browser using the free, open-source service [ntfy.sh](https://ntfy.sh).

---

## How It Works

1. **Background Polling & Publishing:** The script polls active battles in the background every 30 seconds and publishes newly detected bounties to community channels (e.g., `wia-bounty-{alliance}-casc`).
2. **Mirroring to your Personal Topic:** A cross-tab background poller checks the community topic every 3 seconds, filters the entries based on your configured **Notification Scope**, and mirrors matching alerts to your **Personal Topic** (e.g. `wia-user-{userId}`).
3. **Tab Deduplication & Locks:** If you have WareEra open in multiple browser tabs, a cross-tab lock ensures only one tab polls the topics and mirrors the alerts at any given time.
4. **Local Display (In-Game Popup & Browser Notification):** In addition to the ntfy push notification, bounty detections are immediately shown as a styled, stackable in-game popup toast at the top center of the page (8s duration, click redirects to the battle) and as a native desktop browser notification.

---

## Notification Scopes

You can choose which bounties to mirror to your personal topic:
* **All (`all`):** Mirrors all active community bounties (no country/alliance filter).
* **Allies (`allies`):** Mirrors only bounties targeting your own country, your alliance members, and your direct defensive pacts/allies.
* **Cascade (`cascade` - Default):** In addition to your own allies, this cascades to include the allies and defensive pacts of all member countries in your alliance.

---

## Personal Topic (ntfy.sh)

To receive push notifications, PROST configures a dedicated personal recipient topic:

* **Personal ntfy Topic:** Defaults to `wia-user-{yourPlayerId}`. This is the topic you subscribe to on your phone or desktop.
* **Topic Secret (optional):** To prevent others from guessing your topic URL, you can configure a secret (e.g. `secret123`). Your alerts will then be pushed to `wia-user-{yourPlayerId}-secret123`.
* **Direct Subscription Link:** Inside the PROST settings modal, click the link directly below the topic input field to quickly open and subscribe to your personal feed in your browser.

---

## Central Registry (`wia-bounty-topics`)

To coordinate active community notification topics, clients automatically announce their current alliance/country topics to the registry: **`wia-bounty-topics`**.

* **Privacy Protection:** The script only registers the public **base topic** (e.g. `wia-bounty-beer`) and **never reveals your personal topic or secret key to the public log.**
* **Anti-Spam:** Detections are cross-referenced with a 12-hour history to prevent duplicate registry announcements.

---

## Subscription Guide

### 📱 On Mobile (App)
1. Install the free **ntfy** app on your phone:
   * **Android:** Download from [Google Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy) or [F-Droid](https://f-droid.org/en/packages/io.heckel.ntfy/).
   * **iOS:** Download from [Apple App Store](https://apps.apple.com/us/app/ntfy/id1625396347).
2. Open the ntfy app and tap the **+** (Add subscription) button.
3. Enter your personal topic URL as displayed in your PROST settings (e.g., `wia-user-69fa68...` or `wia-user-69fa68...-YOURSECRET`).
4. Tap **Subscribe**. You will now receive all bounty alerts (and Pill Reminder warnings) directly as push notifications!

### 💻 On Desktop (Web Interface - No Account Required)
1. Click the subscription link in the PROST settings modal or navigate directly to `https://ntfy.sh/wia-user-[YOUR_ID]-[OPTIONAL_SECRET]`.
2. Click the **Subscribe** button in the web interface to enable browser push notifications.
3. Allow browser notifications for `ntfy.sh` when prompted. You will now receive desktop popup alerts.
