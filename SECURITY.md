# Security Model — Territory Maker

This document explains how Territory Maker handles your Google Maps API key, why client-side key exposure is unavoidable with the Maps JavaScript API, and what mitigations are in place.

---

## Why the API Key Must Be Client-Side

The **Google Maps JavaScript API** is, by design, a browser-side library. It is loaded via a `<script>` tag pointing to `maps.googleapis.com`, and the API key is part of that URL. There is no way to hide this key from a determined observer using browser DevTools — this is a fundamental property of the Maps JS API architecture.

Google's own documentation acknowledges this and provides a mitigation: **HTTP referrer restrictions**. When a key is restricted to specific domains, Google rejects requests that originate from any other origin, even if someone copies the key.

The same constraint applies to the **Directions API** when called via the Maps JavaScript SDK (which Territory Maker uses). All routing requests go through the SDK — no direct HTTP calls are made from this application.

**Conclusion:** The key being visible in network traffic is expected and unavoidable. The correct response is to restrict it, not to hide it.

---

## Local Encryption Model

Although the key is necessarily sent to Google in plaintext (as part of the Maps API request), Territory Maker stores it locally in `localStorage` in encrypted form. This protects against:

- Browser extensions that scan `localStorage`
- Shared-device scenarios where another user opens DevTools
- Basic XSS attacks that try to exfiltrate `localStorage` contents

### Algorithm

| Property | Value |
|---|---|
| Cipher | AES-GCM |
| Key length | 256 bits |
| IV | Random 12 bytes (generated per save, stored alongside ciphertext) |
| Key derivation | PBKDF2 |
| PBKDF2 hash | SHA-256 |
| PBKDF2 iterations | 100 000 |
| PBKDF2 input | SHA-256 hash of device fingerprint |
| Device fingerprint | `navigator.userAgent + navigator.language + timezone` |

### Key derivation rationale

No user password is required. Instead, the encryption key is derived from a **device fingerprint**: a combination of the browser's user-agent string, language setting, and timezone. This fingerprint is hashed with SHA-256 before being fed into PBKDF2.

**Trade-offs:**

- The device fingerprint is not secret. However, an attacker who obtains the encrypted blob from `localStorage` still needs to reconstruct the exact fingerprint (including the precise user-agent) to decrypt it. This is a meaningful barrier against opportunistic theft but not against a targeted attacker with full device access.
- If the user changes browser, updates their OS (which changes the user-agent), or changes their timezone, the fingerprint will differ and the stored key will no longer be decryptable. In this case, Territory Maker silently discards the stored key and asks the user to re-enter it.

### What is stored

The `localStorage` key `tm_api_key` contains a string of the form:

```
base64(iv):base64(ciphertext)
```

Nothing else is stored. Territory Maker has no server, no analytics, no cookies.

---

## Threat Model

| Threat | Mitigation |
|---|---|
| Key copied from network traffic | Restrict key to your domain in Google Cloud Console |
| Key exfiltrated from `localStorage` | AES-GCM encryption with device-derived key |
| XSS on same origin reads `localStorage` | Encrypted — raw key not stored; Content-Security-Policy headers recommended on hosting |
| Another user on same device opens DevTools | Encrypted in `localStorage`; key not stored in plaintext |
| Attacker with full access to your device | No mitigation possible — physical access = game over |
| Google Maps quota abuse | Domain restriction + API key restrictions in GCP |

---

## Recommendations for Production Use

1. **Restrict your API key** to the exact domain(s) where Territory Maker is deployed (see [README.md](./README.md)).
2. **Set API restrictions** so the key can only call Maps JavaScript API and Directions API.
3. **Monitor your quota** in [Google Cloud Console](https://console.cloud.google.com/apis/dashboard) and set budget alerts.
4. **Use HTTPS** — the Maps JS API requires HTTPS in production; Cloudflare Pages provides this automatically.
5. **Content-Security-Policy** — if you self-host, add a CSP header that restricts script sources to `*.googleapis.com` and your own origin.

---

## Responsible Disclosure

If you find a security issue in Territory Maker, please open a GitHub issue or contact the maintainers directly. Do not publicly disclose vulnerabilities before a fix is available.
