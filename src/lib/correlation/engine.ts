/**
 * GOS-IP cross-report correlation engine.
 *
 * Deterministic and explainable: every relationship is the product of five
 * measurable components (geographic, temporal, category, semantic, evidence)
 * combined with fixed weights and gated by hard geographic/temporal limits.
 * No AI guesswork decides whether two reports are linked.
 */
import { RELATED_CATEGORIES, categoryLabel, type Category } from "@/lib/domain/constants";

export interface CorrelationReport {
  id: string;
  reference: string;
  title: string;
  description: string;
  category: Category;
  locationText: string;
  latitude: number | null;
  longitude: number | null;
  occurredAt: Date;
  /** Opaque key identifying the submitter (reporter id or HMAC fingerprint). */
  submitterKey: string | null;
  evidence: { id: string; sha256: string; phash: string | null }[];
}

export interface CorrelationParams {
  radiusKm: number;
  windowHours: number;
  threshold: number;
}

export const DEFAULT_PARAMS: CorrelationParams = { radiusKm: 8, windowHours: 48, threshold: 0.55 };

export const WEIGHTS = { geo: 0.3, temporal: 0.2, category: 0.2, semantic: 0.2, evidence: 0.1 } as const;

/** Perceptual-hash Hamming distance at or below which two images are treated as near-duplicates. */
export const NEAR_DUPLICATE_HAMMING = 10;

export type RelationshipType = "corroborating" | "related" | "possible_duplicate";

export interface PairScore {
  a: string;
  b: string;
  eligible: boolean;
  score: number;
  components: { geo: number; temporal: number; category: number; semantic: number; evidence: number | null };
  distanceKm: number | null;
  deltaMinutes: number;
  independent: boolean;
  type: RelationshipType | null;
  sharedTerms: string[];
  imageMatches: { a: string; b: string; kind: "exact" | "near"; distance: number }[];
  explanation: string;
  rejectionReason: string | null;
}

// ---------------------------------------------------------------------------
// Geometry & time
// ---------------------------------------------------------------------------

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Text similarity (TF-IDF cosine)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  (
    "a an the and or but if then than so of to in on at by for with from into onto over under near " +
    "is are was were be been being am do does did done has have had having this that these those it its " +
    "there here as about after before during while not no yes very just also can could would should will " +
    "may might must our we us you your they them their he she his her i me my mine some any all more most " +
    "other such only own same too again further once up down out off what which who whom whose when where why how " +
    "around across along because until between through each few both nor per via still now today currently reported report reports"
  ).split(/\s+/),
);

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(stem);
}

export class TfIdf {
  private df = new Map<string, number>();
  private n = 0;
  private vectors = new Map<string, Map<string, number>>();
  private raw = new Map<string, string[]>();

  add(id: string, text: string) {
    const tokens = tokenize(text);
    this.raw.set(id, tokens);
    this.n += 1;
    for (const t of new Set(tokens)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.vectors.delete(id);
  }

  private vector(id: string): Map<string, number> {
    const cached = this.vectors.get(id);
    if (cached) return cached;
    const tokens = this.raw.get(id) ?? [];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    for (const [t, c] of tf) {
      // Smoothed IDF keeps small corpora (2-3 docs) meaningful.
      const idf = Math.log((1 + this.n) / (1 + (this.df.get(t) ?? 0))) + 1;
      vec.set(t, (1 + Math.log(c)) * idf);
    }
    this.vectors.set(id, vec);
    return vec;
  }

  cosine(a: string, b: string): number {
    const va = this.vector(a);
    const vb = this.vector(b);
    let dot = 0;
    for (const [t, w] of va) {
      const wb = vb.get(t);
      if (wb) dot += w * wb;
    }
    const na = Math.sqrt([...va.values()].reduce((s, w) => s + w * w, 0));
    const nb = Math.sqrt([...vb.values()].reduce((s, w) => s + w * w, 0));
    if (!na || !nb) return 0;
    return Math.min(1, dot / (na * nb));
  }

  sharedTerms(a: string, b: string, limit = 6): string[] {
    const va = this.vector(a);
    const vb = this.vector(b);
    return [...va.entries()]
      .filter(([t]) => vb.has(t))
      .map(([t, w]) => [t, w * (vb.get(t) ?? 0)] as const)
      .sort((x, y) => y[1] - x[1])
      .slice(0, limit)
      .map(([t]) => t);
  }
}

// ---------------------------------------------------------------------------
// Image similarity
// ---------------------------------------------------------------------------

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function compareEvidence(a: CorrelationReport["evidence"], b: CorrelationReport["evidence"]) {
  const matches: PairScore["imageMatches"] = [];
  for (const ea of a) {
    for (const eb of b) {
      if (ea.sha256 === eb.sha256) {
        matches.push({ a: ea.id, b: eb.id, kind: "exact", distance: 0 });
      } else if (ea.phash && eb.phash) {
        const d = hammingHex(ea.phash, eb.phash);
        if (d <= NEAR_DUPLICATE_HAMMING) matches.push({ a: ea.id, b: eb.id, kind: "near", distance: d });
      }
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Pair scoring
// ---------------------------------------------------------------------------

function categoryScore(a: Category, b: Category): number {
  if (a === b) return 1;
  if (RELATED_CATEGORIES[a]?.includes(b) || RELATED_CATEGORIES[b]?.includes(a)) return 0.6;
  return 0;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function formatDelta(minutes: number) {
  if (minutes < 90) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export function scorePair(
  a: CorrelationReport,
  b: CorrelationReport,
  params: CorrelationParams,
  tfidf: TfIdf,
): PairScore {
  const deltaMinutes = Math.abs(a.occurredAt.getTime() - b.occurredAt.getTime()) / 60000;
  const base: PairScore = {
    a: a.id < b.id ? a.id : b.id,
    b: a.id < b.id ? b.id : a.id,
    eligible: false,
    score: 0,
    components: { geo: 0, temporal: 0, category: 0, semantic: 0, evidence: null },
    distanceKm: null,
    deltaMinutes: round3(deltaMinutes),
    independent: true,
    type: null,
    sharedTerms: [],
    imageMatches: [],
    explanation: "",
    rejectionReason: null,
  };

  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) {
    base.rejectionReason = "At least one report has no coordinates, so geographic proximity cannot be established.";
    return base;
  }

  const distanceKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
  base.distanceKm = round3(distanceKm);
  const windowMinutes = params.windowHours * 60;

  const geo = distanceKm <= params.radiusKm ? 1 - distanceKm / params.radiusKm : 0;
  const temporal = deltaMinutes <= windowMinutes ? 1 - deltaMinutes / windowMinutes : 0;
  const category = categoryScore(a.category, b.category);
  const semantic = tfidf.cosine(a.id, b.id);
  const imageMatches = compareEvidence(a.evidence, b.evidence);
  const hasEvidenceBoth = a.evidence.length > 0 && b.evidence.length > 0;
  const evidence = hasEvidenceBoth
    ? imageMatches.length > 0
      ? Math.max(...imageMatches.map((m) => 1 - m.distance / 64))
      : 0
    : null;

  base.components = {
    geo: round3(geo),
    temporal: round3(temporal),
    category: round3(category),
    semantic: round3(semantic),
    evidence: evidence === null ? null : round3(evidence),
  };
  base.sharedTerms = tfidf.sharedTerms(a.id, b.id);
  base.imageMatches = imageMatches;

  // Hard gates — never link reports outside the configured radius/window.
  if (distanceKm > params.radiusKm) {
    base.rejectionReason = `Reports are ${formatDistance(distanceKm)} apart, beyond the ${params.radiusKm} km radius.`;
    return base;
  }
  if (deltaMinutes > windowMinutes) {
    base.rejectionReason = `Reports are ${formatDelta(deltaMinutes)} apart, beyond the ${params.windowHours} h window.`;
    return base;
  }
  if (category === 0 && semantic < 0.25 && imageMatches.length === 0) {
    base.rejectionReason = `Unrelated categories (${categoryLabel(a.category)} vs ${categoryLabel(b.category)}) with little descriptive overlap.`;
    return base;
  }

  const weights: Record<string, number> = { ...WEIGHTS };
  const values: Record<string, number> = { geo, temporal, category, semantic, evidence: evidence ?? 0 };
  if (evidence === null) delete weights.evidence; // no imagery to compare: redistribute weight
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  const score = Object.entries(weights).reduce((s, [k, w]) => s + w * values[k], 0) / totalWeight;
  base.score = round3(score);

  const sameSubmitter = Boolean(a.submitterKey && b.submitterKey && a.submitterKey === b.submitterKey);
  const exactImage = imageMatches.some((m) => m.kind === "exact");
  const nearIdenticalText = semantic >= 0.85;
  base.independent = !sameSubmitter;

  if (score < params.threshold) {
    base.rejectionReason = `Combined score ${score.toFixed(2)} is below the ${params.threshold} threshold.`;
    return base;
  }

  base.eligible = true;
  if (sameSubmitter || exactImage || nearIdenticalText) base.type = "possible_duplicate";
  else if (category === 1) base.type = "corroborating";
  else base.type = "related";

  const reasons: string[] = [];
  reasons.push(`locations are ${formatDistance(distanceKm)} apart (within the ${params.radiusKm} km radius)`);
  reasons.push(`incident times are ${formatDelta(deltaMinutes)} apart (within the ${params.windowHours} h window)`);
  reasons.push(
    category === 1
      ? `both are categorised as ${categoryLabel(a.category)}`
      : `categories are related (${categoryLabel(a.category)} / ${categoryLabel(b.category)})`,
  );
  if (base.sharedTerms.length) {
    reasons.push(`descriptions share terms such as "${base.sharedTerms.slice(0, 4).join('", "')}" (text similarity ${semantic.toFixed(2)})`);
  } else {
    reasons.push(`descriptions have low textual overlap (similarity ${semantic.toFixed(2)})`);
  }
  if (imageMatches.length) {
    reasons.push(
      `${imageMatches.length} image pair(s) match (${imageMatches.map((m) => (m.kind === "exact" ? "identical file" : `perceptual distance ${m.distance}`)).join(", ")})`,
    );
  }
  let explanation = `Linked with score ${score.toFixed(2)} (threshold ${params.threshold}) because ${reasons.join("; ")}.`;
  if (base.type === "possible_duplicate") {
    const why = [
      sameSubmitter ? "both submissions appear to come from the same source" : null,
      exactImage ? "an identical image file was submitted with both" : null,
      nearIdenticalText ? "the descriptions are nearly identical" : null,
    ].filter(Boolean);
    explanation += ` Flagged as a possible duplicate (${why.join("; ")}), so it does not count as independent corroboration.`;
  }
  base.explanation = explanation;
  return base;
}

/** Score every pair between `target` and `candidates`. */
export function correlate(
  target: CorrelationReport,
  candidates: CorrelationReport[],
  params: CorrelationParams = DEFAULT_PARAMS,
): PairScore[] {
  const tfidf = new TfIdf();
  const all = [target, ...candidates.filter((c) => c.id !== target.id)];
  for (const r of all) tfidf.add(r.id, `${r.title} ${r.description} ${r.locationText}`);
  return all.slice(1).map((c) => scorePair(target, c, params, tfidf));
}

// ---------------------------------------------------------------------------
// Clustering (connected components over accepted edges)
// ---------------------------------------------------------------------------

export interface Edge {
  a: string;
  b: string;
}

export function connectedComponents(nodes: string[], edges: Edge[]): string[][] {
  const parent = new Map<string, string>(nodes.map((n) => [n, n]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const { a, b } of edges) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n);
    groups.set(r, [...(groups.get(r) ?? []), n]);
  }
  return [...groups.values()].map((g) => g.sort());
}

/**
 * Keep cluster identities stable across recomputation: each new component is
 * matched to the existing cluster with which it shares the most members.
 */
export function assignClusterIds(
  components: string[][],
  existing: Map<string, string>, // reportId -> clusterId
): { members: string[]; clusterId: string | null }[] {
  const taken = new Set<string>();
  const ranked = components
    .map((members) => {
      const counts = new Map<string, number>();
      for (const m of members) {
        const c = existing.get(m);
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
      return { members, best };
    })
    .sort((x, y) => y.members.length - x.members.length);

  return ranked.map(({ members, best }) => {
    const choice = best.find(([id]) => !taken.has(id));
    if (choice) {
      taken.add(choice[0]);
      return { members, clusterId: choice[0] };
    }
    return { members, clusterId: null };
  });
}

export function independentSourceCount(reports: Pick<CorrelationReport, "id" | "submitterKey">[]): number {
  const keys = new Set<string>();
  for (const r of reports) keys.add(r.submitterKey ?? `unknown:${r.id}`);
  return keys.size;
}

export function centroid(points: { latitude: number; longitude: number }[]) {
  const lat = points.reduce((s, p) => s + p.latitude, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.longitude, 0) / points.length;
  const radiusKm = Math.max(0, ...points.map((p) => haversineKm(lat, lon, p.latitude, p.longitude)));
  return { latitude: lat, longitude: lon, radiusKm };
}
