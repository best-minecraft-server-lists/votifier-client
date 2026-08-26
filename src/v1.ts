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

function unpadPkcs1Type2(raw: Buffer): Buffer {
  let offset = raw[0] === 0x00 ? 1 : 0;

  if (raw[offset] !== 0x02) {
    throw new VotifierError("DECRYPT_FAILED", "Decrypted block is not PKCS#1 v1.5 type 2");
  }
  offset += 1;

  const paddingStart = offset;
  while (offset < raw.length && raw[offset] !== 0x00) {
    offset += 1;
  }

  if (offset >= raw.length || offset - paddingStart < 8) {
    throw new VotifierError("DECRYPT_FAILED", "Decrypted block has malformed PKCS#1 padding");
  }

  return raw.subarray(offset + 1);
}

export interface DecryptV1Options {
  manualUnpad?: boolean;
}

export function decryptV1(block: Buffer, privateKey: string, options: DecryptV1Options = {}): Vote {
  const key = privateKeyToPem(privateKey);

  const manual = (): Buffer =>
    unpadPkcs1Type2(crypto.privateDecrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, block));

  let decrypted: Buffer;
  if (options.manualUnpad) {
    decrypted = manual();
  } else {
    try {
      decrypted = crypto.privateDecrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, block);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_INVALID_ARG_VALUE") {
        throw new VotifierError("DECRYPT_FAILED", (error as Error).message);
      }
      decrypted = manual();
    }
  }

  return parseV1Payload(decrypted.toString("utf8"));
}
