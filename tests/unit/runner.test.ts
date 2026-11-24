import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent } from "@/lib/agents/runner";
import { AIRefusalError, type AIProvider, type StructuredRequest } from "@/lib/ai/provider";

const schema = z.object({ answer: z.string(), score: z.number().min(0).max(1) });

function provider(behaviours: Array<(req: StructuredRequest<unknown>) => Promise<unknown>>): AIProvider & { calls: number } {
  const p = {
    name: "mock",
    model: "mock-model",
    calls: 0,
    async generateStructured<T>(req: StructuredRequest<T>) {
      const fn = behaviours[Math.min(p.calls, behaviours.length - 1)];
      p.calls += 1;
      const data = await fn(req as StructuredRequest<unknown>);
      return { data: data as T, model: "mock-model" };
    },
  };
  return p;
}

const req = { agent: "test", system: "s", content: [{ type: "text" as const, text: "x" }], schema };
const opts = { timeoutMs: 200, maxAttempts: 3, backoffMs: () => 0 };

describe("agent runner", () => {
  it("returns validated output on success", async () => {
    const p = provider([async () => ({ answer: "ok", score: 0.4 })]);
    const r = await runAgent(p, req, opts);
    expect(r.status).toBe("succeeded");
    expect(r.data).toEqual({ answer: "ok", score: 0.4 });
    expect(r.attempts).toBe(1);
  });

  it("rejects invalid AI output and retries", async () => {
    const p = provider([async () => ({ answer: "ok", score: 7 }), async () => ({ answer: "fixed", score: 0.9 })]);
    const r = await runAgent(p, req, opts);
    expect(r.status).toBe("succeeded");
    expect(r.attempts).toBe(2);
    expect(r.data?.answer).toBe("fixed");
  });

  it("fails after max attempts with persistent invalid output", async () => {
    const p = provider([async () => ({ wrong: true })]);
    const r = await runAgent(p, req, opts);
    expect(r.status).toBe("failed");
    expect(r.attempts).toBe(3);
    expect(r.data).toBeNull();
    expect(r.error).toMatch(/schema validation/);
  });

  it("times out a hanging agent and aborts the request", async () => {
    let aborted = false;
    const p = provider([
      (rq) =>
        new Promise((_, reject) => {
          rq.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    ]);
    const r = await runAgent(p, req, { ...opts, maxAttempts: 2 });
    expect(r.status).toBe("timed_out");
    expect(r.attempts).toBe(2);
    expect(aborted).toBe(true);
  });

  it("does not retry refusals", async () => {
    const p = provider([async () => { throw new AIRefusalError("declined"); }]);
    const r = await runAgent(p, req, opts);
    expect(r.status).toBe("failed");
    expect(r.attempts).toBe(1);
  });

  it("retries transient API errors", async () => {
    const p = provider([
      async () => { throw Object.assign(new Error("overloaded"), { status: 529 }); },
      async () => ({ answer: "ok", score: 1 }),
    ]);
    const r = await runAgent(p, req, opts);
    expect(r.status).toBe("succeeded");
    expect(p.calls).toBe(2);
  });
});
