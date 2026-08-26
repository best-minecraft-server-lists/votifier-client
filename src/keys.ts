import crypto from "node:crypto";
import { VotifierError } from "./types.js";

function wrapPem(base64: string, label: string): string {
  const body = base64.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function isPem(value: string): boolean {
  return value.includes("-----BEGIN");
}

export function publicKeyToPem(key: string): string {
  const trimmed = key.trim();
  if (isPem(trimmed)) {
    return trimmed;
  }
  if (trimmed === "") {
    throw new VotifierError("INVALID_KEY", "Public key is empty");
  }
  return wrapPem(trimmed, "PUBLIC KEY");
}

export function privateKeyToPem(key: string): string {
  const trimmed = key.trim();
  if (isPem(trimmed)) {
    return trimmed;
  }
  if (trimmed === "") {
    throw new VotifierError("INVALID_KEY", "Private key is empty");
  }
  return wrapPem(trimmed, "PRIVATE KEY");
}

export function pemToVotifier(pem: string): string {
  return pem
    .replace(/-----(BEGIN|END)[^-]+-----/g, "")
    .replace(/\s+/g, "");
}

export interface GeneratedKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  votifierPublicKey: string;
  votifierPrivateKey: string;
}

export function generateKeyPair(modulusLength = 2048): GeneratedKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    votifierPublicKey: pemToVotifier(publicKey),
    votifierPrivateKey: pemToVotifier(privateKey),
  };
}

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}
