#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { sendVote } from "./client.js";
import { createVotifierServer } from "./server.js";
import { generateKeyPair, generateToken } from "./keys.js";
import { VotifierError } from "./types.js";

const USAGE = `mc-votifier - send and receive Minecraft Votifier votes

Usage:
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

Listen options:
  --port <port>        Port to bind (default 8192)
  --token <token>      Accept v2 votes signed with this token
  --key-file <file>    Accept v1 votes encrypted for this private key

Examples:
  mc-votifier send --host play.example.com --user Notch --token abc123
  mc-votifier send --host play.example.com --user Notch --key-file public.key --protocol v1
  mc-votifier listen --port 8192 --token abc123
  mc-votifier keygen
`;

function readFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith("--")) {
      continue;
    }

    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, "true");
      continue;
    }

    flags.set(name, next);
    index += 1;
  }

  return flags;
}

function resolveKey(flags: Map<string, string>): string | undefined {
  const file = flags.get("key-file");
  if (file) {
    return readFileSync(file, "utf8");
  }
  return flags.get("key");
}

async function runSend(flags: Map<string, string>): Promise<number> {
  const host = flags.get("host");
  const user = flags.get("user");

  if (!host || !user) {
    process.stderr.write("--host and --user are required\n");
    return 2;
  }

  const protocol = flags.get("protocol");
  const port = Number.parseInt(flags.get("port") ?? "", 10);
  const timeout = Number.parseInt(flags.get("timeout") ?? "", 10);

  const result = await sendVote({
    host,
    port: Number.isFinite(port) ? port : undefined,
    timeout: Number.isFinite(timeout) ? timeout : undefined,
    username: user,
    serviceName: flags.get("service") ?? "mc-votifier",
    address: flags.get("address"),
    token: flags.get("token"),
    publicKey: resolveKey(flags),
    protocol: protocol === "v1" || protocol === "v2" ? protocol : "auto",
  });

  if (flags.has("json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`sent ${result.protocol} vote for ${result.vote.username}\n`);
  process.stdout.write(`  handshake  ${result.handshake}\n`);
  process.stdout.write(`  service    ${result.vote.serviceName}\n`);
  process.stdout.write(`  response   ${result.response ? result.response.raw : "(none, v1 servers stay silent)"}\n`);
  return 0;
}

async function runListen(flags: Map<string, string>): Promise<number> {
  const port = Number.parseInt(flags.get("port") ?? "8192", 10);
  const keyFile = flags.get("key-file");

  const server = await createVotifierServer({
    port: Number.isFinite(port) ? port : 8192,
    host: "0.0.0.0",
    token: flags.get("token"),
    privateKey: keyFile ? readFileSync(keyFile, "utf8") : undefined,
    onVote: (received) => {
      process.stdout.write(
        `${new Date(received.vote.timestamp).toISOString()} ${received.protocol} ${received.vote.username} via ${received.vote.serviceName} from ${received.remoteAddress}\n`,
      );
    },
    onError: (error) => {
      process.stderr.write(`error: ${error.message}\n`);
    },
  });

  process.stdout.write(`listening for votes on port ${server.port}, ctrl-c to stop\n`);
  return new Promise((resolve) => {
    process.on("SIGINT", () => {
      void server.close().then(() => resolve(0));
    });
  });
}

function runKeygen(flags: Map<string, string>): number {
  const bits = Number.parseInt(flags.get("bits") ?? "2048", 10);
  const pair = generateKeyPair(Number.isFinite(bits) ? bits : 2048);

  process.stdout.write(`token (Votifier v2)\n${generateToken()}\n\n`);
  process.stdout.write(`public.key (Votifier v1)\n${pair.votifierPublicKey}\n\n`);
  process.stdout.write(`private.key (Votifier v1)\n${pair.votifierPrivateKey}\n`);
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const flags = readFlags(argv);

  if (command === undefined || command === "-h" || command === "--help" || flags.has("help")) {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }

  try {
    switch (command) {
      case "send":
        return await runSend(flags);
      case "listen":
        return await runListen(flags);
      case "keygen":
        return runKeygen(flags);
      default:
        process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof VotifierError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = 1;
  });
