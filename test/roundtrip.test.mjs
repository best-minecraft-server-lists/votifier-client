import test from "node:test";
import assert from "node:assert/strict";
import {
  createVotifierServer,
  generateKeyPair,
  generateToken,
  sendVote,
} from "../dist/index.js";

const keys = generateKeyPair(2048);
const token = generateToken();

async function withServer(options, body) {
  const received = [];
  const errors = [];
  const server = await createVotifierServer({
    ...options,
    onVote: (vote) => {
      received.push(vote);
    },
    onError: (error) => {
      errors.push(error);
    },
  });

  try {
    return await body(server, received, errors);
  } finally {
    await server.close();
  }
}

test("a v2 vote survives a full round trip", async () => {
  await withServer({ token }, async (server, received) => {
    const result = await sendVote({
      host: "127.0.0.1",
      port: server.port,
      username: "Notch",
      serviceName: "bestcobblemonservers.net",
      address: "203.0.113.7",
      token,
    });

    assert.equal(result.protocol, "v2");
    assert.equal(result.response.status, "ok");
    assert.equal(received.length, 1);
    assert.equal(received[0].protocol, "v2");
    assert.equal(received[0].vote.username, "Notch");
    assert.equal(received[0].vote.serviceName, "bestcobblemonservers.net");
    assert.equal(received[0].vote.address, "203.0.113.7");
  });
});

test("a v1 vote survives a full round trip", async () => {
  await withServer({ privateKey: keys.votifierPrivateKey }, async (server, received) => {
    const result = await sendVote({
      host: "127.0.0.1",
      port: server.port,
      username: "Herobrine",
      serviceName: "bestprisonservers.com",
      publicKey: keys.votifierPublicKey,
      protocol: "v1",
    });

    assert.equal(result.protocol, "v1");
    assert.equal(received.length, 1);
    assert.equal(received[0].protocol, "v1");
    assert.equal(received[0].vote.username, "Herobrine");
    assert.equal(received[0].vote.serviceName, "bestprisonservers.com");
  });
});

test("auto-detect prefers v2 when the server offers a challenge and a token is supplied", async () => {
  await withServer({ token, privateKey: keys.votifierPrivateKey }, async (server) => {
    const result = await sendVote({
      host: "127.0.0.1",
      port: server.port,
      username: "AutoPicked",
      serviceName: "test",
      token,
      publicKey: keys.votifierPublicKey,
    });

    assert.equal(result.protocol, "v2");
  });
});

test("auto-detect falls back to v1 when no token is supplied", async () => {
  await withServer({ privateKey: keys.votifierPrivateKey }, async (server, received) => {
    const result = await sendVote({
      host: "127.0.0.1",
      port: server.port,
      username: "Fallback",
      serviceName: "test",
      publicKey: keys.votifierPublicKey,
    });

    assert.equal(result.protocol, "v1");
    assert.equal(received[0].vote.username, "Fallback");
  });
});

test("a wrong v2 token is rejected by the server", async () => {
  await withServer({ token }, async (server, received) => {
    await assert.rejects(
      sendVote({
        host: "127.0.0.1",
        port: server.port,
        username: "Impostor",
        serviceName: "test",
        token: generateToken(),
      }),
      (error) => {
        assert.equal(error.code, "REJECTED");
        assert.equal(error.message, "signature");
        return true;
      },
    );

    assert.equal(received.length, 0);
  });
});

test("sending v2 without a token fails before anything is written", async () => {
  await withServer({ token }, async (server) => {
    await assert.rejects(
      sendVote({ host: "127.0.0.1", port: server.port, username: "x", serviceName: "t", protocol: "v2" }),
      /MISSING_TOKEN|needs the server's token/,
    );
  });
});

test("sending v1 without a public key fails before anything is written", async () => {
  await withServer({ privateKey: keys.votifierPrivateKey }, async (server) => {
    await assert.rejects(
      sendVote({ host: "127.0.0.1", port: server.port, username: "x", serviceName: "t", protocol: "v1" }),
      /MISSING_KEY|needs the server's RSA public key/,
    );
  });
});

test("connecting to a port with nothing on it reports a connection failure", async () => {
  await assert.rejects(
    sendVote({ host: "127.0.0.1", port: 1, username: "x", serviceName: "t", token, timeout: 1500 }),
    (error) => {
      assert.equal(["CONNECTION_FAILED", "TIMEOUT", "CONNECTION_CLOSED"].includes(error.code), true);
      return true;
    },
  );
});

test("unicode usernames and service names survive both protocols", async () => {
  await withServer({ token, privateKey: keys.votifierPrivateKey }, async (server, received) => {
    await sendVote({
      host: "127.0.0.1",
      port: server.port,
      username: "Ünïcøde",
      serviceName: "tëst.example",
      token,
    });

    assert.equal(received[0].vote.username, "Ünïcøde");
    assert.equal(received[0].vote.serviceName, "tëst.example");
  });
});
