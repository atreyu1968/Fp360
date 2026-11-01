import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function getMfaKey() {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error("SESSION_SECRET must be configured for MFA");
  return createHmac("sha256", sessionSecret).update("redfp360:mfa:v1").digest();
}

function encodeBase32(input: Buffer) {
  let value = 0;
  let bits = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string) {
  const normalized = input.toUpperCase().replace(/=+$/g, "");
  let value = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) throw new Error("Invalid stored MFA secret");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function createTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMfaKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptTotpSecret(encrypted: string) {
  const [ivPart, tagPart, ciphertextPart] = encrypted.split(".");
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error("Invalid stored MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", getMfaKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function totpCodeAt(secret: string, timestampMs: number) {
  const counter = BigInt(Math.floor(timestampMs / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, timestampMs = Date.now()) {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const candidate = Buffer.from(normalized);
  for (const step of [-1, 0, 1]) {
    const expected = Buffer.from(totpCodeAt(secret, timestampMs + step * 30_000));
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

export function createRecoveryCodes(count = 10) {
  const codes = Array.from({ length: count }, () => {
    const raw = randomBytes(6).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
  return {
    codes,
    hashes: codes.map((code) => hashRecoveryCode(code)),
  };
}

export function hashRecoveryCode(code: string) {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return createHmac("sha256", getMfaKey()).update(`recovery:${normalized}`).digest("hex");
}

export function verifyRecoveryCode(code: string, hashes: string[]) {
  const candidateHash = hashRecoveryCode(code);
  return hashes.findIndex((stored) => {
    const candidate = Buffer.from(candidateHash);
    const expected = Buffer.from(stored);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export function totpProvisioningUri(email: string, secret: string) {
  const issuer = "RED FP360";
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
