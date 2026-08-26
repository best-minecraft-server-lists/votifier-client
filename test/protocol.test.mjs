import test from "node:test";
import assert from "node:assert/strict";
import {
  VOTIFIER_V2_MAGIC,
  buildV1Payload,
  buildV2Message,
  decryptV1,
  encryptV1,
  generateKeyPair,
  generateToken,
  isV2Message,
  isPem,
  parseHandshake,
  parseV1Payload,
  pemToVotifier,
  publicKeyToPem,
  readV2Message,
  signPayload,
} from "../dist/index.js";

const keys = generateKeyPair(2048);

test("the v1 payload uses the documented newline layout", () => {
  const payload = buildV1Payload({
    serviceName: "example.com",
    username: "Notch",
    address: "203.0.113.7",
    timestamp: 1700000000000,
  });

  assert.equal(payload, "VOTE\nexample.com\nNotch\n203.0.113.7\n1700000000000\n");
  assert.deepEqual(parseV1Payload(payload), {
    serviceName: "example.com",
    username: "Notch",
    address: "203.0.113.7",
    timestamp: 1700000000000,
  });
});

test("parseV1Payload rejects a block that is not a VOTE", () => {
  assert.throws(() => parseV1Payload("NOPE\na\nb\nc\n1\n"), /Expected a VOTE opcode/);
});

test("a v1 block is exactly 256 bytes and decrypts back to the vote", () => {
  const vote = { serviceName: "s", username: "u", address: "1.2.3.4", timestamp: 42 };
  const block = encryptV1(vote, keys.votifierPublicKey);

  assert.equal(block.length, 256);
  assert.deepEqual(decryptV1(block, keys.votifierPrivateKey), vote);
});

test("the manual pkcs1 unpad path agrees with the native one", () => {
  const vote = { serviceName: "svc", username: "Player", address: "203.0.113.9", timestamp: 1700000000000 };
  const block = encryptV1(vote, keys.votifierPublicKey);

  assert.deepEqual(decryptV1(block, keys.votifierPrivateKey, { manualUnpad: true }), vote);
});

test("the manual unpad path rejects a block that is not valid pkcs1 type 2", () => {
  assert.throws(
    () => decryptV1(Buffer.alloc(256), keys.votifierPrivateKey, { manualUnpad: true }),
    /PKCS#1/,
  );
});

test("a v1 payload that cannot fit in one RSA block is rejected", () => {
  assert.throws(
    () => encryptV1({ serviceName: "s".repeat(300), username: "u", address: "1.2.3.4", timestamp: 1 }, keys.votifierPublicKey),
    /does not fit in a 2048 bit RSA block/,
  );
});

test("votifier base64 keys convert to pem and back", () => {
  assert.equal(isPem(keys.votifierPublicKey), false);
  assert.equal(isPem(publicKeyToPem(keys.votifierPublicKey)), true);
  assert.equal(pemToVotifier(publicKeyToPem(keys.votifierPublicKey)), keys.votifierPublicKey);
  assert.equal(publicKeyToPem(keys.publicKeyPem), keys.publicKeyPem.trim());
});

test("a v2 message carries the magic and a length prefix", () => {
  const token = generateToken();
  const message = buildV2Message(
    { serviceName: "s", username: "u", address: "1.2.3.4", timestamp: 1 },
    token,
    "challenge-value",
  );

  assert.equal(message.readUInt16BE(0), VOTIFIER_V2_MAGIC);
  assert.equal(message.readUInt16BE(2), message.length - 4);
  assert.equal(isV2Message(message), true);
});

test("readV2Message validates the hmac signature", () => {
  const token = generateToken();
  const vote = { serviceName: "s", username: "u", address: "1.2.3.4", timestamp: 7 };
  const message = buildV2Message(vote, token, "abc");

  const good = readV2Message(message, token);
  assert.equal(good.signatureValid, true);
  assert.equal(good.payload.username, "u");
  assert.equal(good.payload.challenge, "abc");
  assert.equal(good.consumed, message.length);

  const bad = readV2Message(message, generateToken());
  assert.equal(bad.signatureValid, false);
});

test("readV2Message waits for the whole frame", () => {
  const token = generateToken();
  const message = buildV2Message({ serviceName: "s", username: "u", address: "0.0.0.0", timestamp: 1 }, token, "c");

  assert.equal(readV2Message(message.subarray(0, 3), token), null);
  assert.equal(readV2Message(message.subarray(0, message.length - 1), token), null);
  assert.notEqual(readV2Message(message, token), null);
});

test("readV2Message rejects a frame without the magic", () => {
  assert.throws(() => readV2Message(Buffer.from([0x00, 0x01, 0x00, 0x00]), "t"), /magic/);
});

test("signPayload is stable and token dependent", () => {
  assert.equal(signPayload("hello", "token"), signPayload("hello", "token"));
  assert.notEqual(signPayload("hello", "token"), signPayload("hello", "other"));
});

test("parseHandshake reads the version and challenge", () => {
  assert.deepEqual(parseHandshake("VOTIFIER 2 abc123\n"), { version: "2", challenge: "abc123" });
  assert.deepEqual(parseHandshake("VOTIFIER 1.9 session\n"), { version: "1.9", challenge: "session" });
  assert.throws(() => parseHandshake("HELLO\n"), /Expected a VOTIFIER greeting/);
});
