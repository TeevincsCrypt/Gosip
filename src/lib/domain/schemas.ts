import { z } from "zod";
import { CATEGORY_IDS } from "./constants";

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

export const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90"),
  longitude: z.number().finite().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180"),
});

export const reportSubmissionSchema = z
  .object({
    title: trimmed(5, 200, "Title"),
    description: trimmed(20, 5000, "Description"),
    category: z.enum(CATEGORY_IDS, { error: "Choose an incident category" }),
    locationText: trimmed(2, 300, "Location"),
    latitude: z.number().finite().nullable().optional(),
    longitude: z.number().finite().nullable().optional(),
    locationSource: z.enum(["map", "gps", "manual", "none"]).default("none"),
    locationAccuracyM: z.number().nonnegative().nullable().optional(),
    occurredAt: z.coerce.date({ error: "Incident date and time is required" }),
    anonymous: z.boolean().default(false),
    contactName: z.string().trim().max(120).optional().or(z.literal("")),
    contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
    contactEmail: z.string().trim().email("Contact email is not valid").max(200).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    const hasLat = v.latitude !== null && v.latitude !== undefined;
    const hasLng = v.longitude !== null && v.longitude !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({ code: "custom", path: ["latitude"], message: "Provide both latitude and longitude, or neither" });
    }
    if (hasLat && hasLng) {
      const parsed = coordinatesSchema.safeParse({ latitude: v.latitude, longitude: v.longitude });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
        }
      }
      if (v.latitude === 0 && v.longitude === 0) {
        ctx.addIssue({ code: "custom", path: ["latitude"], message: "0,0 is not a valid incident location" });
      }
    }
    if (v.occurredAt.getTime() > Date.now() + 60 * 60 * 1000) {
      ctx.addIssue({ code: "custom", path: ["occurredAt"], message: "Incident time cannot be in the future" });
    }
    if (v.occurredAt.getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: "custom", path: ["occurredAt"], message: "Incident time must be within the last year" });
    }
  });

export type ReportSubmission = z.infer<typeof reportSubmissionSchema>;

export const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"] as const;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  displayName: z.string().trim().min(1, "Name is required").max(80),
  organization: z.string().trim().max(120).optional().or(z.literal("")),
});

export const reviewActionSchema = z.object({
  action: z.enum([
    "verify", "reject", "dispute", "escalate", "deescalate", "resolve", "reopen", "note",
    "separate", "merge", "accept_evidence", "reject_evidence", "confirm_relationship", "reject_relationship",
  ]),
  reportId: z.string().uuid().optional(),
  targetReportId: z.string().uuid().optional(),
  clusterId: z.string().uuid().optional(),
  evidenceId: z.string().uuid().optional(),
  relationshipId: z.string().uuid().optional(),
  notes: z.string().trim().max(4000).optional(),
});
export type ReviewAction = z.infer<typeof reviewActionSchema>;
