import { AIConfigError, AIOutputError, AIRefusalError, AITimeoutError, type AIProvider, type StructuredRequest } from "@/lib/ai/provider";

export type AgentRunStatus = "succeeded" | "failed" | "timed_out";

export interface AgentRunResult<T> {
  status: AgentRunStatus;
  data: T | null;
  attempts: number;
  error: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
}

export interface RunOptions {
  timeoutMs: number;
  maxAttempts: number;
  /** Delay between retries; injectable for tests. */
  backoffMs?: (attempt: number) => number;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof AIRefusalError || err instanceof AIConfigError) return false;
  if (err instanceof AIOutputError || err instanceof AITimeoutError) return true;
  // Network / 429 / 5xx errors surfaced by the SDK
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return status === 408 || status === 409 || status === 429 || status >= 500;
  return true;
}

/**
 * Run one agent with a hard timeout per attempt, schema-validated output and
 * bounded retries. Never throws: failures are returned so the orchestrator can
 * preserve other agents' findings and mark the investigation incomplete.
 */
export async function runAgent<T>(
  provider: AIProvider,
  request: Omit<StructuredRequest<T>, "signal">,
  opts: RunOptions,
): Promise<AgentRunResult<T>> {
  const started = Date.now();
  let lastError: unknown = null;
  let timedOut = false;
  let attempts = 0;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    attempts = attempt;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AITimeoutError(`${request.agent} agent exceeded ${opts.timeoutMs} ms`));
      }, opts.timeoutMs);
    });
    try {
      const result = await Promise.race([
        provider.generateStructured({ ...request, signal: controller.signal }),
        timeout,
      ]);
      // Defence in depth: validate even if the provider already did.
      const parsed = request.schema.safeParse(result.data);
      if (!parsed.success) {
        throw new AIOutputError(`Output failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      }
      return {
        status: "succeeded",
        data: parsed.data,
        attempts,
        error: null,
        model: result.model,
        tokensIn: result.tokensIn ?? null,
        tokensOut: result.tokensOut ?? null,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      lastError = err;
      timedOut = err instanceof AITimeoutError;
      if (!isRetryable(err) || attempt === opts.maxAttempts) break;
      const wait = opts.backoffMs ? opts.backoffMs(attempt) : 750 * 2 ** (attempt - 1);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : String(lastError);
  return {
    status: timedOut ? "timed_out" : "failed",
    data: null,
    attempts,
    error: message.slice(0, 2000),
    model: provider.model,
    tokensIn: null,
    tokensOut: null,
    durationMs: Date.now() - started,
  };
}
