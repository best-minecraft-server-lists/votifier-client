import crypto from "node:crypto";
import { VOTIFIER_V2_MAGIC, VotifierError, type Vote } from "./types.js";

export interface V2Payload extends Vote {
  challenge: string;
}

export function signPayload(payload: string, token: string): string {
  return crypto.createHmac("sha256", token).update(payload, "utf8").digest("base64");
}

export function buildV2Payload(vote: Vote, challenge: string): string {
  return JSON.stringify({
    serviceName: vote.serviceName,
    username: vote.username,
    address: vote.address,
    timestamp: vote.timestamp,
    challenge,
  });
}

export function buildV2Message(vote: Vote, token: string, challenge: string): Buffer {
  const payload = buildV2Payload(vote, challenge);
  const envelope = Buffer.from(
    JSON.stringify({ payload, signature: signPayload(payload, token) }),
    "utf8",
  );

  const header = Buffer.alloc(4);
  header.writeUInt16BE(VOTIFIER_V2_MAGIC, 0);
  header.writeUInt16BE(envelope.length, 2);

  return Buffer.concat([header, envelope]);
}

export function isV2Message(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer.readUInt16BE(0) === VOTIFIER_V2_MAGIC;
}

export interface ParsedV2Message {
  payload: V2Payload;
  signatureValid: boolean;
  consumed: number;
}

export function readV2Message(buffer: Buffer, token: string): ParsedV2Message | null {
  if (buffer.length < 4) {
    return null;
  }

  if (!isV2Message(buffer)) {
    throw new VotifierError("BAD_MAGIC", "Message does not start with the Votifier v2 magic 0x733a");
  }

  const length = buffer.readUInt16BE(2);
  if (buffer.length < 4 + length) {
    return null;
  }

  const envelopeText = buffer.subarray(4, 4 + length).toString("utf8");

  let envelope: { payload?: unknown; signature?: unknown };
  try {
    envelope = JSON.parse(envelopeText) as { payload?: unknown; signature?: unknown };
  } catch (error) {
    throw new VotifierError("MALFORMED_VOTE", `Envelope is not valid JSON: ${(error as Error).message}`);
  }

  if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string") {
    throw new VotifierError("MALFORMED_VOTE", "Envelope must contain string payload and signature fields");
  }

  const expected = Buffer.from(signPayload(envelope.payload, token), "base64");
  const actual = Buffer.from(envelope.signature, "base64");
  const signatureValid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(envelope.payload) as Record<string, unknown>;
  } catch (error) {
    throw new VotifierError("MALFORMED_VOTE", `Payload is not valid JSON: ${(error as Error).message}`);
  }

  return {
    payload: {
      serviceName: String(payload["serviceName"] ?? ""),
      username: String(payload["username"] ?? ""),
      address: String(payload["address"] ?? ""),
      timestamp: Number(payload["timestamp"] ?? 0),
      challenge: String(payload["challenge"] ?? ""),
    },
    signatureValid,
    consumed: 4 + length,
  };
}

export function parseHandshake(line: string): { version: string; challenge: string | null } {
  const parts = line.trim().split(/\s+/);

  if (parts[0] !== "VOTIFIER") {
    throw new VotifierError("BAD_HANDSHAKE", `Expected a VOTIFIER greeting, received "${line.trim()}"`);
  }

  return {
    version: parts[1] ?? "",
    challenge: parts[2] ?? null,
  };
}
