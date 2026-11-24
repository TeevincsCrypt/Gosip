/**
 * Seed the clearly-labelled SYNTHETIC demonstration scenario.
 *
 *   npm run db:seed                 # insert synthetic reports + run correlation
 *   npm run db:seed -- --reset      # remove previously seeded synthetic data first
 *   npm run db:seed -- --investigate  # also run real AI investigations (needs GROQ_API_KEY)
 *
 * Seeded reports go through the same createReport + correlation code paths as
 * real submissions. No investigation results are fabricated: AI findings exist
 * only if --investigate runs the real agents.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

async function main() {
  const { SEED_REPORTS, SCENARIO_NAME } = await import("../db/seed/scenario");
  const { getSql, closeSql } = await import("@/lib/db/client");
  const { createReport } = await import("@/lib/services/reports");
  const { correlateReport } = await import("@/lib/services/correlation");
  const { runInvestigation } = await import("@/lib/services/investigation");
  const { reportSubmissionSchema } = await import("@/lib/domain/schemas");
  const { isAiConfigured } = await import("@/lib/config");
  const args = new Set(process.argv.slice(2));
  const sql = getSql();

  try {
    if (args.has("--reset")) {
      const clusters = await sql`select id from public.incident_clusters where is_synthetic`;
      if (clusters.length) await sql`delete from public.incident_events where cluster_id in ${sql(clusters.map((c) => c.id))}`;
      await sql`delete from public.reports where is_synthetic`;
      await sql`delete from public.incident_clusters where is_synthetic`;
      console.log("removed previous synthetic data");
    }
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from public.reports where is_synthetic`;
    if (count > 0 && !args.has("--reset")) {
      console.log(`${count} synthetic reports already exist. Use --reset to re-seed.`);
      return;
    }

    console.log(`Seeding ${SCENARIO_NAME}: ${SEED_REPORTS.length} SYNTHETIC reports`);
    const ordered = [...SEED_REPORTS].sort((a, b) => b.minutesAgo - a.minutesAgo);
    const created: { id: string; reference: string; key: string }[] = [];
    for (const r of ordered) {
      const occurredAt = new Date(Date.now() - r.minutesAgo * 60_000);
      const input = reportSubmissionSchema.parse({
        title: r.title,
        description: r.description,
        category: r.category,
        locationText: r.locationText,
        latitude: r.latitude,
        longitude: r.longitude,
        locationSource: r.latitude === null ? "none" : "map",
        occurredAt: occurredAt.toISOString(),
        anonymous: r.anonymous,
      });
      const res = await createReport({ kind: "anonymous" }, input, [], {
        fingerprint: `synthetic:${r.submitter}`,
        synthetic: true,
      });
      await correlateReport(res.id);
      created.push({ id: res.id, reference: res.reference, key: r.key });
      console.log(`  ${res.reference}  ${r.key.padEnd(12)} ${r.title}`);
    }

    if (args.has("--investigate")) {
      if (!isAiConfigured()) {
        console.log("--investigate requested but GROQ_API_KEY is not set; skipping AI investigations.");
      } else {
        for (const c of created) {
          process.stdout.write(`  investigating ${c.reference} ... `);
          const out = await runInvestigation(c.id, { trigger: "seed" });
          console.log(out.status);
        }
      }
    }
    const clusters = await sql`select reference, title, report_count, independent_source_count from public.incident_clusters where is_synthetic and status = 'active'`;
    console.log("\nclusters:");
    for (const c of clusters) console.log(`  ${c.reference}  ${c.title}  (${c.report_count} reports, ${c.independent_source_count} independent)`);
  } finally {
    await closeSql();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
