# ⚔️ Bounty Push Notifications (ntfy.sh)

The **Bounty Push Notifications** feature is a background poller that checks for active allied bounties in WareEra battles and sends instant push notifications to your mobile phone or desktop web browser using the free, open-source service [ntfy.sh](https://ntfy.sh).

---

## How It Works

1. **Background Polling:** The script polls active battles in the background every 30 seconds.
2. **Tab Deduplication:** If you have WareEra open in multiple browser tabs, a cross-tab lock ensures only one tab polls the server at a time.
3. **Multi-device Staggering:** If you have WareEra open on different devices (e.g. PC and laptop), a randomized stagger delay (0–10s) and a double read-back check on the ntfy.sh history prevent duplicate notifications for the same bounty.
4. **Target Filtering:** Pushes are only triggered for active, unpaid bounties matching your configured notification scope.

---

## Notification Scopes

You can choose between three notification scopes in the settings dialog:
* **All (`all`):** Sends notifications for all active bounties in the game (no country/alliance filter).
* **Allies (`allies`):** Filters bounties for your own country, your alliance members, and your own defensive pacts/allies.
* **Cascade (`cascade` - Default):** In addition to your own allies, this cascades to include the allies and defensive pacts of all countries in your alliance.

---

## Topic Naming Scheme

By default, the script dynamically generates a public ntfy topic name based on your in-game identity and selected scope:
* **Scope `all`:** `wia-bounty-all`
* **Scope `allies`:** `wia-bounty-{alliance}` (or `wia-bounty-{country}` if you are not in an alliance).
* **Scope `cascade`:** `wia-bounty-{alliance}-casc` (or `wia-bounty-{country}-casc` if you are not in an alliance).

*Note: Special characters in country or alliance names are automatically stripped (e.g. `b.e.e.r.` becomes `beer` -> `wia-bounty-beer-casc`).*

### Custom Topic & Topic Secrets
If you want to use a custom topic name, you can type it in the **ntfy topic (base)** field. 

To keep your notifications private and prevent other players from spying on your alerts, add a secret key in the **Topic secret (optional)** field. This will append the secret to your topic URL (e.g. `wia-bounty-beer-x7q2`), ensuring only those who know the secret can listen.

---

## Central Registry (`wia-bounty-topics`)

To coordinate active notification topics, the script automatically logs its activation on a central directory topic: **`wia-bounty-topics`**.

* **Privacy Protection:** The script only logs the **base topic** (e.g. `wia-bounty-beer`) and **never leaks your Topic Secret** to the public log.
* **Announced details:** The registration message displays your base topic name, your country/alliance, and the activation timestamp.
* **Anti-Spam:** Before logging, the client checks the 12-hour history of `wia-bounty-topics` and skips sending the message if your topic is already registered.

You can visit [https://ntfy.sh/wia-bounty-topics](https://ntfy.sh/wia-bounty-topics) in your browser to see a list of all active bounty topics being utilized by the community.

---

## Subscription Guide

### 📱 On Mobile (App)
1. Install the free **ntfy** app on your phone:
   * **Android:** Download from [Google Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy) or [F-Droid](https://f-droid.org/en/packages/io.heckel.ntfy/).
   * **iOS:** Download from [Apple App Store](https://apps.apple.com/us/app/ntfy/id1625396347).
2. Open the ntfy app.
3. Tap the **+** (Add subscription) button.
4. Enter the topic name shown in your PROST settings (e.g. `wia-bounty-beer-casc` or `wia-bounty-beer-casc-YOURSECRET`).
5. Tap **Subscribe**. You will now receive instant push notifications on your phone!

### 💻 On Desktop (Web Interface - No Account Required)
No registration, app installation, or user account is needed to receive notifications on your PC.
1. Open your web browser and go to `https://ntfy.sh/[YOUR_TOPIC]` (replace `[YOUR_TOPIC]` with the effective topic displayed in your PROST settings).
2. Click the **Subscribe** button in the web interface to enable web push notifications.
3. Ensure browser notifications are permitted for `ntfy.sh`. You will receive desktop popup alerts whenever a bounty becomes active.
