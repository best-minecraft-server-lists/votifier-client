import net from "node:net";
import { encryptV1 } from "./v1.js";
import { buildV2Message, parseHandshake } from "./v2.js";
import {
  DEFAULT_PORT,
  DEFAULT_TIMEOUT,
  VotifierError,
  normalizeVote,
  type Vote,
  type VotifierResponse,
} from "./types.js";

export interface SendOptions {
  host: string;
  port?: number;
  timeout?: number;
  username: string;
  serviceName: string;
  address?: string;
  timestamp?: number;
  token?: string;
  publicKey?: string;
  protocol?: "v1" | "v2" | "auto";
}

export interface SendResult {
  protocol: "v1" | "v2";
  handshake: string;
  vote: Vote;
  response: VotifierResponse | null;
}

interface Session {
  socket: net.Socket;
  handshake: string;
}

function openSession(host: string, port: number, timeout: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffered = "";
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };

    const timer = setTimeout(() => {
      fail(new VotifierError("TIMEOUT", `No handshake from ${host}:${port} within ${timeout}ms`));
    }, timeout);

    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline === -1) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners("data");
      resolve({ socket, handshake: buffered.slice(0, newline) });
    });

    socket.on("error", (error) => {
      fail(new VotifierError("CONNECTION_FAILED", error.message));
    });

    socket.on("close", () => {
      fail(new VotifierError("CONNECTION_CLOSED", "Server closed the connection before sending a handshake"));
    });
  });
}

function awaitResponse(socket: net.Socket, timeout: number): Promise<VotifierResponse | null> {
  return new Promise((resolve) => {
    let buffered = "";
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();

      const text = buffered.trim();
      if (text === "") {
        resolve(null);
        return;
      }

      try {
        const parsed = JSON.parse(text) as { status?: unknown; cause?: unknown; error?: unknown };
        resolve({
          status: parsed.status === "ok" ? "ok" : "error",
          cause: typeof parsed.cause === "string" ? parsed.cause : undefined,
          error: typeof parsed.error === "string" ? parsed.error : undefined,
          raw: text,
        });
      } catch {
        resolve({ status: "error", error: "Response was not valid JSON", raw: text });
      }
    };

    const timer = setTimeout(finish, timeout);

    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      if (buffered.includes("}")) {
        finish();
      }
    });
    socket.on("close", finish);
    socket.on("error", finish);
  });
}

export async function sendVote(options: SendOptions): Promise<SendResult> {
  const port = options.port ?? DEFAULT_PORT;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const vote = normalizeVote(options);

  const session = await openSession(options.host, port, timeout);
  const greeting = parseHandshake(session.handshake);

  const wanted = options.protocol ?? "auto";
  const serverSpeaksV2 = greeting.version.startsWith("2") && greeting.challenge !== null;

  let protocol: "v1" | "v2";
  if (wanted === "auto") {
    protocol = serverSpeaksV2 && options.token ? "v2" : "v1";
  } else {
    protocol = wanted;
  }

  if (protocol === "v2") {
    if (!options.token) {
      session.socket.destroy();
      throw new VotifierError("MISSING_TOKEN", "Votifier v2 needs the server's token");
    }
    if (greeting.challenge === null) {
      session.socket.destroy();
      throw new VotifierError("NO_CHALLENGE", "Server handshake did not include a v2 challenge");
    }

    session.socket.write(buildV2Message(vote, options.token, greeting.challenge));
    const response = await awaitResponse(session.socket, timeout);

    if (response && response.status === "error") {
      throw new VotifierError("REJECTED", response.cause ?? response.error ?? "Server rejected the vote");
    }

    return { protocol, handshake: session.handshake, vote, response };
  }

  if (!options.publicKey) {
    session.socket.destroy();
    throw new VotifierError("MISSING_KEY", "Votifier v1 needs the server's RSA public key");
  }

  session.socket.write(encryptV1(vote, options.publicKey));
  const response = await awaitResponse(session.socket, Math.min(timeout, 1000));

  return { protocol, handshake: session.handshake, vote, response };
}
