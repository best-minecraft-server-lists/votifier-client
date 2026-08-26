import crypto from "node:crypto";
import { privateKeyToPem, publicKeyToPem } from "./keys.js";
import { V1_BLOCK_SIZE, VotifierError, type Vote } from "./types.js";

export function buildV1Payload(vote: Vote): string {
  return `VOTE\n${vote.serviceName}\n${vote.username}\n${vote.address}\n${vote.timestamp}\n`;
}

export function parseV1Payload(payload: string): Vote {
  const lines = payload.split("\n");

  if (lines[0] !== "VOTE") {
    throw new VotifierError("MALFORMED_VOTE", `Expected a VOTE opcode, received "${lines[0] ?? ""}"`);
  }

  const timestamp = Number.parseInt(lines[4] ?? "", 10);

  return {
    serviceName: lines[1] ?? "",
    username: lines[2] ?? "",
    address: lines[3] ?? "",
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
  };
}

export function encryptV1(vote: Vote, publicKey: string): Buffer {
  const payload = Buffer.from(buildV1Payload(vote), "utf8");

  if (payload.length > V1_BLOCK_SIZE - 11) {
    throw new VotifierError(
      "PAYLOAD_TOO_LARGE",
      `Vote payload is ${payload.length} bytes, which does not fit in a 2048 bit RSA block`,
    );
  }

  return crypto.publicEncrypt(
    {
      key: publicKeyToPem(publicKey),
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    payload,
  );
}

export function decryptV1(block: Buffer, privateKey: string): Vote {
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyToPem(privateKey),
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    block,
  );

  return parseV1Payload(decrypted.toString("utf8"));
}
