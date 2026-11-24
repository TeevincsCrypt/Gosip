import "server-only";
import Groq from "groq-sdk";
import { z } from "zod";
import { config } from "@/lib/config";
import {
  AIConfigError,
  AIOutputError,
  AITimeoutError,
  type AIProvider,
  type ContentPart,
  type StructuredRequest,
  type StructuredResult,
} from "./provider";

type GroqClient = Pick<Groq, "chat">;

/**
 * Convert a Zod schema into a JSON schema suitable for strict structured
 * outputs: every object closes with additionalProperties:false, lists all of
 * its properties as required, and numeric bounds move into the description
 * (Zod still enforces them after the response arrives).
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    const bounds: string[] = [];
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema") continue;
      if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"].includes(k)) {
        bounds.push(`${k}: ${JSON.stringify(v)}`);
        continue;
      }
      out[k] = visit(v);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as object);
    }
    if (bounds.length) out.description = [out.description, `(${bounds.join(", ")})`].filter(Boolean).join(" ");
    return out;
  };
  return visit(raw) as Record<string, unknown>;
}

function stripReasoning(text: string): string {
  // Some reasoning models emit <think>…</think> before the answer.
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJson(text: string): unknown {
  const cleaned = stripReasoning(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Groq provider. Text-only agents use AI_MODEL; agents that receive images use
 * AI_VISION_MODEL. Structured outputs are requested with a strict JSON schema;
 * if a model rejects json_schema, the provider falls back to JSON mode with
 * the schema in the instructions. Either way the result is validated with Zod.
 */
export class GroqProvider implements AIProvider {
  readonly name = "groq";
  readonly model: string;
  readonly visionModel: string;
  private client: GroqClient;
  /** Models observed to reject json_schema response_format in this process. */
  private jsonModeOnly = new Set<string>();

  constructor(opts: { apiKey?: string; model?: string; visionModel?: string; client?: GroqClient } = {}) {
    this.model = opts.model ?? config.ai.model;
    this.visionModel = opts.visionModel ?? config.ai.visionModel;
    if (opts.client) {
      this.client = opts.client;
    } else {
      const apiKey = opts.apiKey ?? config.ai.apiKey;
      if (!apiKey) throw new AIConfigError("GROQ_API_KEY is not configured");
      this.client = new Groq({ apiKey, maxRetries: 2 });
    }
  }

  private modelFor(req: StructuredRequest<unknown>): string {
    return req.content.some((c) => c.type === "image") ? this.visionModel : this.model;
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = this.modelFor(req as StructuredRequest<unknown>);
    const schema = toStrictJsonSchema(req.schema);
    const useJsonMode = this.jsonModeOnly.has(model);
    try {
      return await this.call(req, model, schema, useJsonMode);
    } catch (err) {
      // The model does not support json_schema: remember and retry in JSON mode.
      if (!useJsonMode && err instanceof Groq.BadRequestError && /response_format|json_schema|structured/i.test(err.message)) {
        this.jsonModeOnly.add(model);
        return this.call(req, model, schema, true);
      }
      throw err;
    }
  }

  private async call<T>(req: StructuredRequest<T>, model: string, schema: Record<string, unknown>, jsonMode: boolean): Promise<StructuredResult<T>> {
    const system = jsonMode
      ? `${req.system}\n\nRespond with a single JSON object only, no prose, that validates against this JSON schema:\n${JSON.stringify(schema)}`
      : `${req.system}\n\nRespond only with JSON that matches the provided schema.`;
    const content = req.content.map(toPart);
    let completion;
    try {
      completion = await this.client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          temperature: 0.2,
          max_completion_tokens: req.maxTokens ?? 8192,
          response_format: jsonMode
            ? { type: "json_object" }
            : { type: "json_schema", json_schema: { name: `${req.agent}_findings`, schema, strict: true } },
          ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: req.effort ?? "medium" } : {}),
        },
        { signal: req.signal },
      );
    } catch (err) {
      if (req.signal?.aborted || err instanceof Groq.APIUserAbortError) throw new AITimeoutError(`${req.agent} agent timed out`);
      if (err instanceof Groq.AuthenticationError || err instanceof Groq.PermissionDeniedError) {
        throw new AIConfigError(`Groq rejected the credentials: ${err.message}`);
      }
      if (err instanceof Groq.NotFoundError) throw new AIConfigError(`Groq model not found (${model}). Check AI_MODEL / AI_VISION_MODEL.`);
      if (err instanceof Groq.APIConnectionTimeoutError) throw new AITimeoutError(`${req.agent} agent request timed out`);
      if (err instanceof Groq.BadRequestError) {
        // Groq returns 400 when generated JSON fails schema validation; treat as retryable output error.
        if (/json_validate_failed|failed to generate|validation/i.test(err.message)) throw new AIOutputError(`Groq structured output failed: ${err.message}`);
        throw err;
      }
      throw err; // 429 / 5xx / network: the runner decides whether to retry
    }

    const choice = completion.choices[0];
    if (!choice?.message?.content) throw new AIOutputError("Empty response from model");
    if (choice.finish_reason === "length") throw new AIOutputError("Model output was truncated (max tokens)");

    let parsedJson: unknown;
    try {
      parsedJson = extractJson(choice.message.content);
    } catch {
      throw new AIOutputError("Model did not return valid JSON", choice.message.content.slice(0, 500));
    }
    const parsed = req.schema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AIOutputError(
        `Output failed schema validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        parsedJson,
      );
    }
    return {
      data: parsed.data,
      model: completion.model ?? model,
      tokensIn: completion.usage?.prompt_tokens,
      tokensOut: completion.usage?.completion_tokens,
    };
  }
}

function toPart(part: ContentPart): Groq.Chat.ChatCompletionContentPart {
  if (part.type === "text") return { type: "text", text: part.text };
  return { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.base64}` } };
}

export function createDefaultProvider(): AIProvider | null {
  if (!config.ai.apiKey) return null;
  return new GroqProvider();
}
