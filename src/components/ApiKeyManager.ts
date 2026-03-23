/**
 * ApiKeyManager — AES-GCM 256-bit encryption of the Google Maps API key,
 * stored in localStorage. The encryption key is derived with PBKDF2 from a
 * lightweight device fingerprint so no user-supplied password is needed.
 */

const STORAGE_KEY = "tm_api_key";
const PBKDF2_ITERATIONS = 100_000;
const IV_LENGTH = 12; // bytes for AES-GCM

// ─── Device fingerprint ───────────────────────────────────────────────────────

function getDeviceFingerprint(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${navigator.userAgent}|${navigator.language}|${tz}`;
}

async function fingerprintHash(fingerprint: string): Promise<ArrayBuffer> {
  const encoded = new TextEncoder().encode(fingerprint);
  return crypto.subtle.digest("SHA-256", encoded);
}

// ─── Key derivation ───────────────────────────────────────────────────────────

async function deriveEncryptionKey(fingerprint: string): Promise<CryptoKey> {
  const fingerprintBytes = await fingerprintHash(fingerprint);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    fingerprintBytes,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  // Use a static, public salt derived from the app name. The security model
  // relies on the device fingerprint being hard to forge, not on salt secrecy.
  const salt = new TextEncoder().encode("territory-maker-v1");

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypts the Google Maps API key and saves it to localStorage.
 */
export async function saveKey(apiKey: string): Promise<void> {
  const fingerprint = getDeviceFingerprint();
  const cryptoKey = await deriveEncryptionKey(fingerprint);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(apiKey);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoded,
  );

  const stored = `${toBase64(iv.buffer)}:${toBase64(ciphertext)}`;
  localStorage.setItem(STORAGE_KEY, stored);
}

/**
 * Reads and decrypts the stored API key. Returns null if none is stored or
 * decryption fails (e.g. different device/browser).
 */
export async function loadKey(): Promise<string | null> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  try {
    const [ivB64, cipherB64] = stored.split(":");
    if (!ivB64 || !cipherB64) return null;

    const fingerprint = getDeviceFingerprint();
    const cryptoKey = await deriveEncryptionKey(fingerprint);

    const iv = fromBase64(ivB64);
    const ciphertext = fromBase64(cipherB64);

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext,
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    // Decryption failed — key may be from a different browser/device
    return null;
  }
}

/**
 * Removes the stored encrypted key from localStorage.
 */
export function forgetKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Returns true if an encrypted key is present in localStorage.
 */
export function hasStoredKey(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
