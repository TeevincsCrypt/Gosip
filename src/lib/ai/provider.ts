import type { z } from "zod";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

export interface StructuredRequest<T> {
  agent: string;
  system: string;
  content: ContentPart[];
  schema: z.ZodType<T>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

/** The model returned output that does not satisfy the agent's schema. Retryable. */
export class AIOutputError extends Error {
  readonly retryable = true;
  constructor(message: string, readonly raw?: unknown) {
    super(message);
    this.name = "AIOutputError";
  }
}

/** The model declined. Not retried; surfaced to reviewers. */
export class AIRefusalError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "AIRefusalError";
  }
}

export class AITimeoutError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "AITimeoutError";
  }
}

/** Configuration / credential problems. Not retried. */
export class AIConfigError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}
