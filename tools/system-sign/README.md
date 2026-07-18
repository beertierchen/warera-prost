# System Alert Channel — Operator Runbook

Signed broadcast channel for PROST. Lets push a **cryptographically
signed** notice (e.g. "critical update, old versions may break game rules") that
every client displays as a red sticky toast.

> The signing tool prints the exact `curl` you need.

## Trust model (why this is safe)

- Security is **Ed25519 signatures**. Clients only display a notice whose signature
  verifies against a public key **hardcoded in the script** (`SYSTEM_ALERT_PUBKEYS`
  in `warera-prost.user.js`).
- The matching **private key** lives only on your machine
  (`private-key.json`, git-ignored). It never ships, never posts.
- The list of authorized signers = the pubkeys in `SYSTEM_ALERT_PUBKEYS`. That list
  only changes by editing the source and merging. **Only the repo owner merges and
  publishes → only the owner can add or remove signers.** That is the trust anchor.
- The transport is a public message topic. Signatures — not secrecy — provide
  authenticity, so a reader learning the topic cannot forge a notice. Keeping the
  topic low-profile only reduces casual spam/noise on the channel; it is not the
  security boundary.

So the two things you must actually protect are:

1. **`private-key.json`** — whoever holds it can sign valid notices.
2. **Merge + publish access** (GitHub main + GreasyFork account) — whoever controls
   the release can add a signer. Guard both (branch protection, 2FA).

## Prerequisites

- Node.js with WebCrypto Ed25519 (Node 20+ recommended; verified on v26).
- `private-key.json` present in this directory (created by `keygen`, below).
- Keep `seq.json` — it is the monotonic replay counter (see Gotchas).

---

## A. Send a system alert

```bash
# 1. Sign (auto-increments seq.json, prints the envelope + a ready-to-run curl)
node tools/system-sign/sign.js sign "Your message here"

# 2. Run the curl it printed to publish the signed envelope.
```

Clients poll every 60s (10 min when the tab is backgrounded) and show the toast if:

- signature verifies against a key in `SYSTEM_ALERT_PUBKEYS`,
- `ts` is within 48h and not >60s in the future,
- `seq` is greater than the highest they've seen for that `kid` (replay guard).

**Optional second signer identity:** `node sign.js sign "msg" <kid>`
(kid must exist in `SYSTEM_ALERT_PUBKEYS`).

### Notes
- The payload is broadcast in the clear — **no secrets in the message text**.
- `seq` auto-increments from `seq.json`. Don't hand-edit it down.
- If a client already consumed this `seq`, it won't re-toast — sign again to bump.

---

## B. Create / rotate a signer key

> ⚠️ **`keygen` overwrites `private-key.json` in place.** Running it again destroys
> the current private key. The old pubkey stays in `SYSTEM_ALERT_PUBKEYS` but you can
> no longer sign for it. Back up first, or generate into a separate directory.

```bash
node tools/system-sign/sign.js keygen
```

It prints 32 raw public-key bytes:

```
Uint8Array.from([12, 34, ... , 250])
```

Add them to `SYSTEM_ALERT_PUBKEYS` in `warera-prost.user.js` with a **unique kid**:

```js
const SYSTEM_ALERT_PUBKEYS = [
  { kid: 'beertierchen', raw: Uint8Array.from([/* existing */]) },
  { kid: 'ops-2027',     raw: Uint8Array.from([/* new bytes */]) },
];
```

Then:

1. Commit + release (merge to main → GreasyFork). **Only the owner can do this** —
   that is what authorizes the new signer.
2. Sign with the new identity: `node sign.js sign "msg" ops-2027`.
3. Sequence is **per-kid**, so a brand-new kid starts at 0 on every client → its
   first message (`seq` 1) is accepted everywhere. No lockout.

### Revoke a signer
- Remove its `{ kid, raw }` entry from `SYSTEM_ALERT_PUBKEYS` and release. Its future
  messages stop verifying.

---

## Gotchas / operational notes

- **`seq.json` loss for the *same* kid bricks that kid.** Clients store the highest
  seq per kid; if you lose `seq.json` the tool restarts at 1, which every client
  rejects as a replay. Recovery = rotate to a new kid (Section B), which resets the
  per-kid counter cleanly.
- **One machine, one key.** The tool uses fixed paths (`private-key.json`, `seq.json`).
  A second signer on the same machine needs a separate working directory.
- **Server retention.** Messages persist on the transport for ~12h server-side, but
  the client freshness window is 48h — publish again if you need longer coverage.
- **Never commit** `private-key.json` or `seq.json` (already in `.gitignore`).
