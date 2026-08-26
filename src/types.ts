export interface Vote {
  serviceName: string;
  username: string;
  address: string;
  timestamp: number;
}

export interface VotifierResponse {
  status: "ok" | "error";
  cause?: string;
  error?: string;
  raw: string;
}

export const VOTIFIER_V2_MAGIC = 0x733a;
export const V1_BLOCK_SIZE = 256;
export const DEFAULT_PORT = 8192;
export const DEFAULT_TIMEOUT = 5000;

export class VotifierError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VotifierError";
    this.code = code;
  }
}

export function normalizeVote(vote: Partial<Vote> & { username: string; serviceName: string }): Vote {
  return {
    serviceName: vote.serviceName,
    username: vote.username,
    address: vote.address ?? "127.0.0.1",
    timestamp: vote.timestamp ?? Date.now(),
  };
}
