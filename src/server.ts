import crypto from "node:crypto";
import net from "node:net";
import { decryptV1 } from "./v1.js";
import { isV2Message, readV2Message } from "./v2.js";
import { V1_BLOCK_SIZE, VotifierError, type Vote } from "./types.js";

export interface ReceivedVote {
  vote: Vote;
  protocol: "v1" | "v2";
  remoteAddress: string;
}

export interface VotifierServerOptions {
  port?: number;
  host?: string;
  token?: string;
  privateKey?: string;
  greeting?: string;
  onVote: (received: ReceivedVote) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export interface VotifierServer {
  port: number;
  close: () => Promise<void>;
}

export function createVotifierServer(options: VotifierServerOptions): Promise<VotifierServer> {
  if (!options.token && !options.privateKey) {
    throw new VotifierError("MISSING_CREDENTIALS", "Provide a token for v2, a private key for v1, or both");
  }

  const report = (error: Error): void => {
    options.onError?.(error);
  };

  const server = net.createServer((socket) => {
    const challenge = crypto.randomBytes(16).toString("hex");
    const version = options.token ? "2" : "1.9";
    socket.write(`${options.greeting ?? "VOTIFIER"} ${version} ${challenge}\n`);

    let buffered = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);

      void (async () => {
        try {
          if (isV2Message(buffered)) {
            if (!options.token) {
              throw new VotifierError("UNSUPPORTED", "Received a v2 vote but no token is configured");
            }

            const message = readV2Message(buffered, options.token);
            if (!message) {
              return;
            }
            buffered = buffered.subarray(message.consumed);

            if (!message.signatureValid) {
              socket.end(JSON.stringify({ status: "error", cause: "signature", error: "Signature is not valid" }));
              return;
            }
            if (message.payload.challenge !== challenge) {
              socket.end(JSON.stringify({ status: "error", cause: "challenge", error: "Challenge did not match" }));
              return;
            }

            await options.onVote({
              protocol: "v2",
              remoteAddress: socket.remoteAddress ?? "",
              vote: {
                serviceName: message.payload.serviceName,
                username: message.payload.username,
                address: message.payload.address,
                timestamp: message.payload.timestamp,
              },
            });

            socket.end(JSON.stringify({ status: "ok" }));
            return;
          }

          if (buffered.length < V1_BLOCK_SIZE) {
            return;
          }
          if (!options.privateKey) {
            throw new VotifierError("UNSUPPORTED", "Received a v1 vote but no private key is configured");
          }

          const block = buffered.subarray(0, V1_BLOCK_SIZE);
          buffered = buffered.subarray(V1_BLOCK_SIZE);

          await options.onVote({
            protocol: "v1",
            remoteAddress: socket.remoteAddress ?? "",
            vote: decryptV1(block, options.privateKey),
          });

          socket.end();
        } catch (error) {
          report(error as Error);
          socket.destroy();
        }
      })();
    });

    socket.on("error", report);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;

      resolve({
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
