# votifier-client — Minecraft Votifier Client and Test Server (`mc-votifier`)

[![CI](https://github.com/best-minecraft-server-lists/votifier-client/actions/workflows/ci.yml/badge.svg)](https://github.com/best-minecraft-server-lists/votifier-client/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mc-votifier.svg)](https://www.npmjs.com/package/mc-votifier)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A Node library and CLI to send and receive Minecraft Votifier votes. It implements both Votifier v1 (RSA) and v2 (token and HMAC-SHA256), and ships a built-in receiver so you can test a server's vote setup without waiting on a real server list. Zero dependencies.

```bash
npx mc-votifier send --host play.example.com --user Notch --token abc123
```

```
sent v2 vote for Notch
  handshake  VOTIFIER 2 9cdedea1c3e21f6414d9c72131b2802e
  service    bestcobblemonservers.net
  response   {"status":"ok"}
```

## Why this exists

Votifier is the protocol every Minecraft server list uses to tell a server "this player voted, give them their reward". When it does not work, the failure is almost always silent. The port is closed, the token has a stray newline, the server is on v2 but the list is sending v1, or the public key was copied with the PEM header still attached. None of that produces a useful error anywhere.

This package lets you send a real vote from your terminal and see exactly what the server says back, and lets you stand up a receiver to confirm what a list is actually sending you.

## Install

```bash
npm install mc-votifier
```

## Quick start

### Test that your server accepts votes

```bash
npx mc-votifier send --host play.example.com --port 8192 --user YourName --token YOUR_TOKEN
```

If the server is on Votifier v1, point at its public key instead:

```bash
npx mc-votifier send --host play.example.com --user YourName --key-file public.key --protocol v1
```

### See what a server list is sending you

Run a receiver on the port you gave the list, then trigger a vote on their site.

```bash
npx mc-votifier listen --port 8192 --token YOUR_TOKEN
```

```
listening for votes on port 8192, ctrl-c to stop
2026-08-26T12:13:21.886Z v2 Notch via bestcobblemonservers.net from 203.0.113.7
```

### Generate a fresh key pair and token

```bash
npx mc-votifier keygen
```

Prints a v2 token plus `public.key` and `private.key` in the exact base64 form Votifier and NuVotifier expect on disk.

## Usage

### Send a vote

```js
import { sendVote } from "mc-votifier";

const result = await sendVote({
  host: "play.example.com",
  port: 8192,
  username: "Notch",
  serviceName: "bestcobblemonservers.net",
  address: "203.0.113.7",
  token: process.env.VOTIFIER_TOKEN,
});

console.log(result.protocol);        // "v2"
console.log(result.response.status); // "ok"
```

### Force a protocol

By default `sendVote` reads the server's handshake and picks v2 when the server offers a challenge and you supplied a token, falling back to v1 otherwise. Override it when you want to test one specific path.

```js
await sendVote({ host, username, serviceName, publicKey, protocol: "v1" });
await sendVote({ host, username, serviceName, token, protocol: "v2" });
```

### Receive votes

```js
import { createVotifierServer } from "mc-votifier";

const server = await createVotifierServer({
  port: 8192,
  host: "0.0.0.0",
  token: process.env.VOTIFIER_TOKEN,
  onVote: ({ vote, protocol, remoteAddress }) => {
    console.log(`${vote.username} voted on ${vote.serviceName} (${protocol}) from ${remoteAddress}`);
  },
  onError: (error) => console.error(error),
});

// later
await server.close();
```

The receiver validates the HMAC signature and checks that the challenge it issued came back unchanged, so it rejects replayed and forged votes the same way NuVotifier does.

### Test your own vote handling in CI

Because the receiver binds to port `0` when you do not give it one, you can run a full round trip inside a unit test with no fixed ports and no network.

```js
import { createVotifierServer, sendVote, generateToken } from "mc-votifier";

const token = generateToken();
const votes = [];

const server = await createVotifierServer({ token, onVote: (v) => votes.push(v) });

await sendVote({
  host: "127.0.0.1",
  port: server.port,
  username: "TestPlayer",
  serviceName: "my-list",
  token,
});

await server.close();
console.log(votes[0].vote.username); // "TestPlayer"
```

### Work with keys

```js
import { generateKeyPair, publicKeyToPem, pemToVotifier } from "mc-votifier";

const keys = generateKeyPair(2048);

keys.votifierPublicKey;  // base64, ready to write to public.key
keys.votifierPrivateKey; // base64, ready to write to private.key
keys.publicKeyPem;       // standard PEM

publicKeyToPem(keys.votifierPublicKey); // add the PEM armour back
pemToVotifier(keys.publicKeyPem);       // strip it off again
```

`publicKeyToPem` accepts either form, so you can hand it whatever the server admin pasted you and it will do the right thing.

## CLI

```
mc-votifier send   --host <host> --user <name> [options]
mc-votifier listen [--port <port>] [--token <token>] [--key-file <file>]
mc-votifier keygen [--bits 2048]

Send options:
  --host <host>        Server hostname (required)
  --port <port>        Votifier port (default 8192)
  --user <name>        Player to credit the vote to (required)
  --service <name>     Vote site name (default mc-votifier)
  --address <ip>       Voter IP recorded in the vote (default 127.0.0.1)
  --token <token>      Votifier v2 token
  --key <base64>       Votifier v1 RSA public key, base64
  --key-file <file>    Read the key from a file instead
  --protocol <v1|v2>   Force a protocol (default: auto-detect)
  --timeout <ms>       Milliseconds before giving up (default 5000)
  --json               Print the result as JSON
```

## API reference

### `sendVote(options): Promise<SendResult>`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | `string` | required | Server hostname or IP. |
| `port` | `number` | `8192` | Votifier port. Note this is *not* the Minecraft port. |
| `username` | `string` | required | Player to credit. |
| `serviceName` | `string` | required | The voting site's name, as the server will log it. |
| `address` | `string` | `"127.0.0.1"` | Voter IP recorded inside the vote. |
| `timestamp` | `number` | `Date.now()` | Vote timestamp in milliseconds. |
| `token` | `string` | — | v2 token. Required for v2. |
| `publicKey` | `string` | — | v1 RSA public key, base64 or PEM. Required for v1. |
| `protocol` | `"v1" \| "v2" \| "auto"` | `"auto"` | Which protocol to speak. |
| `timeout` | `number` | `5000` | Milliseconds before giving up. |

Returns `{ protocol, handshake, vote, response }`. `response` is `null` for v1, which sends nothing back. Throws `VotifierError` on failure.

### `createVotifierServer(options): Promise<VotifierServer>`

| Option | Type | Description |
| --- | --- | --- |
| `port` | `number` | Port to bind. Defaults to `0`, meaning an OS-assigned free port. |
| `host` | `string` | Interface to bind. Defaults to `127.0.0.1`. |
| `token` | `string` | Accept v2 votes signed with this token. |
| `privateKey` | `string` | Accept v1 votes encrypted for this key, base64 or PEM. |
| `greeting` | `string` | Override the handshake product name. Defaults to `VOTIFIER`. |
| `onVote` | `(received) => void` | Called with `{ vote, protocol, remoteAddress }`. |
| `onError` | `(error) => void` | Called on malformed input and socket errors. |

At least one of `token` or `privateKey` is required. Returns `{ port, close() }`.

### Protocol helpers

Exported so you can build your own tooling or write tests against captured traffic.

| Function | Description |
| --- | --- |
| `buildV1Payload(vote)` | The newline-delimited v1 payload string. |
| `parseV1Payload(text)` | Parse that string back into a vote. |
| `encryptV1(vote, publicKey)` | Produce the 256-byte RSA block. |
| `decryptV1(block, privateKey, options?)` | Decrypt one back into a vote. |
| `buildV2Message(vote, token, challenge)` | Full framed v2 message including magic and length. |
| `readV2Message(buffer, token)` | Parse and verify a v2 frame. Returns `null` while the frame is incomplete. |
| `isV2Message(buffer)` | Check for the `0x733a` magic. |
| `signPayload(payload, token)` | Base64 HMAC-SHA256, the v2 signature. |
| `parseHandshake(line)` | Split `VOTIFIER 2 <challenge>` into its parts. |
| `generateKeyPair(bits?)` | Fresh RSA pair in both PEM and Votifier base64 form. |
| `generateToken(bytes?)` | Random hex token suitable for v2. |

### `VotifierError`

Every failure throws one, carrying a `code`.

| Code | Meaning |
| --- | --- |
| `CONNECTION_FAILED` | Could not reach the Votifier port. |
| `CONNECTION_CLOSED` | Server hung up before the handshake. |
| `TIMEOUT` | No handshake within the timeout. |
| `BAD_HANDSHAKE` | Greeting did not start with `VOTIFIER`. |
| `MISSING_TOKEN` | v2 requested without a token. |
| `MISSING_KEY` | v1 requested without a public key. |
| `NO_CHALLENGE` | Server offered v2 but sent no challenge. |
| `REJECTED` | Server refused the vote. `message` carries its stated cause. |
| `BAD_MAGIC` | Frame did not begin with `0x733a`. |
| `MALFORMED_VOTE` | Payload was not valid JSON or not a `VOTE` block. |
| `PAYLOAD_TOO_LARGE` | v1 vote does not fit in one RSA block. |
| `INVALID_KEY` | Key was empty or unreadable. |

## How the protocols work

### Votifier v1

The server greets you with `VOTIFIER 1.9 <session>`. You then send a single RSA block, PKCS#1 v1.5 padded and encrypted with the server's **public** key, containing five newline-terminated lines:

```
VOTE
<serviceName>
<username>
<address>
<timestamp>
```

With a 2048-bit key that block is exactly 256 bytes. The server sends nothing back and closes the connection, which is why a v1 vote that silently vanishes is so hard to diagnose. Anyone holding the public key can forge a vote, which is what v2 exists to fix.

### Votifier v2

The server greets you with `VOTIFIER 2 <challenge>`. You reply with a framed message:

```
uint16  magic = 0x733a
uint16  length of the JSON that follows
bytes   {"payload": "<inner json>", "signature": "<base64 hmac-sha256>"}
```

The inner payload is itself a JSON string containing `serviceName`, `username`, `address`, `timestamp` and the `challenge` the server just issued. The signature is HMAC-SHA256 over that exact payload string, keyed with the shared token. Echoing the challenge back is what stops a captured vote being replayed.

The server answers with `{"status":"ok"}` or `{"status":"error","cause":"...","error":"..."}`.

## Troubleshooting

| Symptom | Usual cause |
| --- | --- |
| `CONNECTION_FAILED` | Votifier port is firewalled, or you used the Minecraft port. Votifier defaults to `8192`. |
| `REJECTED` with cause `signature` | Token mismatch. Check for a trailing newline or a truncated copy and paste. |
| `REJECTED` with cause `challenge` | Something replayed an old vote, or a proxy is buffering the connection. |
| v1 vote sends fine but nothing happens | v1 servers never reply. Run `mc-votifier listen` on your own machine to confirm the list is really sending. |
| `INVALID_KEY` or a decrypt error | The `public.key` file should be bare base64 with no PEM header and no line breaks. `pemToVotifier()` will strip them for you. |

### A note on Node and PKCS#1 v1.5

Votifier v1 mandates RSA with PKCS#1 v1.5 padding. Node's support for that in `crypto.privateDecrypt` has moved around: it was disabled in 18.19.1, 20.11.1 and 21.6.2 in response to [CVE-2023-46809](https://nvd.nist.gov/vuln/detail/CVE-2023-46809) (the Marvin attack), then restored in later releases once implicit rejection was added.

`decryptV1` therefore tries the native path first and falls back to `RSA_NO_PADDING` with its own PKCS#1 unpadding on the Node versions that refuse. This is transparent, and the receiver works the same on every supported Node version. Pass `{ manualUnpad: true }` to force the fallback, which is what the test suite does so both paths stay covered.

Encryption is unaffected. `crypto.publicEncrypt` with PKCS#1 padding works everywhere, so sending v1 votes never hits this.

## Security notes

- Treat the v2 token like a password. Anyone with it can credit votes to any player.
- Votifier v1 is PKCS#1 v1.5 by specification, which is the padding scheme the Marvin attack targets. That is a property of the protocol, not of this library. Prefer v2, which uses HMAC and is not affected.
- Anyone with the v1 public key can forge votes. Prefer v2 wherever the server supports it.
- The receiver validates signatures with a timing-safe comparison and rejects mismatched challenges.
- This library does not rate limit. If you expose a receiver publicly, put your own limits in front of it.

## Related

Built and maintained by [Best Minecraft Server Lists](https://bestcobblemonservers.net).

- [Best Cobblemon servers](https://bestcobblemonservers.net) — live-pinged rankings, full Pokédex and free tools
- [Best Minecraft Prison servers](https://bestprisonservers.com) — top 10, ranked weekly on live player counts
- [Best Minecraft Skyblock servers](https://bestskyblockservers.net) — top 10, ranked weekly
- [Best Minecraft SMP servers](https://bestsmpservers.com) — top 10, ranked weekly
- [Best Minecraft Survival servers](https://bestsurvivalservers.com) — top 10, ranked weekly
- [Free rankings JSON API](https://bestprisonservers.com/api/rankings.json) — CC BY 4.0, no key required

Sister libraries:

- [mc-status](https://github.com/best-minecraft-server-lists/mc-status) — ping a Java or Bedrock server for players, version and MOTD
- [mc-motd](https://github.com/best-minecraft-server-lists/motd-parser) — render a MOTD to ANSI, HTML or plain text
- [mc-rankings-client](https://github.com/best-minecraft-server-lists/mc-rankings-client) — typed client for the rankings feeds above

## Contributing

Issues and pull requests are welcome. The test suite runs a full v1 and v2 round trip against the built-in receiver, so it needs no network access.

```bash
npm install
npm test
```

## License

MIT
