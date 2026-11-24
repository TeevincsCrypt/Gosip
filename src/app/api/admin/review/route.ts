import { handler, json } from "@/lib/http/api";
import { reviewActionSchema } from "@/lib/domain/schemas";
import { applyReviewAction } from "@/lib/services/review";

export const POST = handler(
  async (req, { actor }) => json(await applyReviewAction(actor, reviewActionSchema.parse(await req.json()))),
  { require: "staff" },
);
