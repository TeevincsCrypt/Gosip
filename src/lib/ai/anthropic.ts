import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "@/lib/config";
import {
  AIConfigError,
  AIOutputError,
  AIRefusalError,
  AITimeoutError,
  type AIProvider,
  type ContentPart,
  type StructuredRequest,
  type StructuredResult,
} from "./provider";

/**
 * Claude provider. Uses structured outputs (JSON schema derived from the
 * agent's Zod schema) and re-validates the parsed result with Zod.
 * The API key is read server-side only.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(readonly model: string = config.ai.model, apiKey: string | undefined = config.ai.apiKey) {
    if (!apiKey) throw new AIConfigError("ANTHROPIC_API_KEY is not configured");
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const content = req.content.map(toBlock);
    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? 16000,
          system: req.system,
          messages: [{ role: "user", content }],
          output_config: {
            format: betaZodOutputFormat(req.schema as never),
            effort: req.effort ?? "medium",
          },
          // Server-side fallback: if the primary model declines on a safety
          // classifier, the API retries on a fallback model in the same call.
          ...(config.ai.enableFallbacks
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
        },
        { signal: req.signal },
      );
    } catch (err) {
      if (req.signal?.aborted) throw new AITimeoutError(`${req.agent} agent timed out`);
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AIConfigError(`AI provider rejected credentials: ${err.message}`);
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new AIConfigError(`AI provider rejected the request: ${err.message}`);
      }
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AITimeoutError(`${req.agent} agent request timed out`);
      }
      if (err instanceof Anthropic.APIError) throw err; // 429/5xx: retryable by the runner
      // JSON / schema parse failures from the SDK helper
      throw new AIOutputError(`Invalid structured output: ${(err as Error).message}`);
    }

    if (response.stop_reason === "refusal") {
      throw new AIRefusalError(
        `Model declined (${response.stop_details?.category ?? "unspecified"}): ${response.stop_details?.explanation ?? ""}`.trim(),
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new AIOutputError("Model output was truncated (max_tokens)");
    }
    const parsed = req.schema.safeParse(response.parsed_output);
    if (!parsed.success) {
      throw new AIOutputError(`Output failed schema validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, response.parsed_output);
    }
    return {
      data: parsed.data,
      model: response.model,
      tokensIn: response.usage?.input_tokens,
      tokensOut: response.usage?.output_tokens,
    };
  }
}

function toBlock(part: ContentPart): Anthropic.Beta.BetaContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } };
}

export function createDefaultProvider(): AIProvider | null {
  if (!config.ai.apiKey) return null;
  return new AnthropicProvider();
}
