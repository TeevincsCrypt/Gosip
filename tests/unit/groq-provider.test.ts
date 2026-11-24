import { describe, expect, it } from "vitest";
import Groq from "groq-sdk";
import { z } from "zod";
import { GroqProvider, toStrictJsonSchema } from "@/lib/ai/groq";
import { AIOutputError } from "@/lib/ai/provider";

const schema = z.object({ answer: z.string(), score: z.number().min(0).max(1), tags: z.array(z.string()) });

type Call = { model: string; response_format: { type: string }; messages: { role: string; content: unknown }[] };

function fakeClient(responses: Array<(call: Call) => unknown>) {
  const calls: Call[] = [];
  const client = {
    chat: {
      completions: {
        create: async (body: Call) => {
          calls.push(body);
          const fn = responses[Math.min(calls.length - 1, responses.length - 1)];
          return fn(body);
        },
      },
    },
  };
  return { client: client as unknown as Pick<Groq, "chat">, calls };
}

const ok = (content: string, model = "m") => ({ model, choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
const req = { agent: "test", system: "sys", schema, content: [{ type: "text" as const, text: "hello" }] };

describe("Groq provider", () => {
  it("builds a strict JSON schema from Zod", () => {
    const js = toStrictJsonSchema(schema) as { additionalProperties: boolean; required: string[]; properties: Record<string, { description?: string; minimum?: number }> };
    expect(js.additionalProperties).toBe(false);
    expect(js.required).toEqual(["answer", "score", "tags"]);
    expect(js.properties.score.minimum).toBeUndefined();
    expect(js.properties.score.description).toMatch(/minimum/);
  });

  it("requests json_schema output and validates it", async () => {
    const { client, calls } = fakeClient([() => ok('{"answer":"x","score":0.5,"tags":[]}')]);
    const p = new GroqProvider({ client, model: "text-model", visionModel: "vision-model" });
    const r = await p.generateStructured(req);
    expect(r.data.answer).toBe("x");
    expect(r.tokensIn).toBe(5);
    expect(calls[0].model).toBe("text-model");
    expect(calls[0].response_format.type).toBe("json_schema");
  });

  it("routes image requests to the vision model as data URLs", async () => {
    const { client, calls } = fakeClient([() => ok('{"answer":"x","score":1,"tags":["a"]}')]);
    const p = new GroqProvider({ client, model: "text-model", visionModel: "vision-model" });
    await p.generateStructured({ ...req, content: [{ type: "text", text: "see" }, { type: "image", mediaType: "image/jpeg", base64: "QUJD" }] });
    expect(calls[0].model).toBe("vision-model");
    const parts = calls[0].messages[1].content as { type: string; image_url?: { url: string } }[];
    expect(parts[1].image_url?.url).toBe("data:image/jpeg;base64,QUJD");
  });

  it("falls back to JSON mode when a model rejects json_schema", async () => {
    const badRequest = new Groq.BadRequestError(400, { message: "response_format json_schema is not supported by this model" }, "response_format json_schema is not supported by this model", new Headers());
    const { client, calls } = fakeClient([
      () => { throw badRequest; },
      () => ok('<think>hmm</think>```json\n{"answer":"y","score":0.1,"tags":[]}\n```'),
      () => ok('{"answer":"z","score":0.2,"tags":[]}'),
    ]);
    const p = new GroqProvider({ client, model: "text-model", visionModel: "vision-model" });
    const r = await p.generateStructured(req);
    expect(r.data.answer).toBe("y");
    expect(calls[1].response_format.type).toBe("json_object");
    expect(String(calls[1].messages[0].content)).toMatch(/JSON schema/);
    await p.generateStructured(req); // remembered: goes straight to JSON mode
    expect(calls[2].response_format.type).toBe("json_object");
  });

  it("rejects invalid or out-of-range output as a retryable output error", async () => {
    const p1 = new GroqProvider({ client: fakeClient([() => ok("not json")]).client, model: "m", visionModel: "v" });
    await expect(p1.generateStructured(req)).rejects.toBeInstanceOf(AIOutputError);
    const p2 = new GroqProvider({ client: fakeClient([() => ok('{"answer":"x","score":9,"tags":[]}')]).client, model: "m", visionModel: "v" });
    await expect(p2.generateStructured(req)).rejects.toThrow(/schema validation/);
  });

  it("treats truncated output as an output error", async () => {
    const truncated = { model: "m", choices: [{ finish_reason: "length", message: { content: '{"answer":' } }] };
    const p = new GroqProvider({ client: fakeClient([() => truncated]).client, model: "m", visionModel: "v" });
    await expect(p.generateStructured(req)).rejects.toThrow(/truncated/);
  });
});
