"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Crosshair, EyeOff, FlaskConical, ImagePlus, Info, Link2, Radar, Trash2 } from "lucide-react";
import { ApiError, cn } from "@/lib/client/utils";
import { CATEGORIES, EMERGENCY_DISCLAIMER } from "@/lib/domain/constants";
import { PageHeader } from "@/components/app/shell";
import { MapPicker } from "@/components/app/map-picker";
import { useHealth, useSession } from "@/components/app/providers";
import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui/primitives";

interface Created {
  id: string;
  reference: string;
  evidenceCount: number;
  duplicateEvidence: number;
  relatedReports: number;
  investigationStatus: "queued" | "not_configured";
  aiConfigured: boolean;
  synthetic?: boolean;
}

function localDateTimeValue(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

const MAX_FILES = 5;
const MAX_MB = 8;

export default function ReportPage() {
  const { user } = useSession();
  const { data: health } = useHealth();
  const [synthetic, setSynthetic] = React.useState(true);
  const qc = useQueryClient();
  const [form, setForm] = React.useState({
    title: "",
    description: "",
    category: "",
    locationText: "",
    occurredAt: localDateTimeValue(),
    anonymous: false,
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  });
  const [coords, setCoords] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [locationSource, setLocationSource] = React.useState<"map" | "gps" | "manual" | "none">("none");
  const [accuracy, setAccuracy] = React.useState<number | null>(null);
  const [manualLat, setManualLat] = React.useState("");
  const [manualLng, setManualLng] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [geoStatus, setGeoStatus] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const previews = React.useMemo(() => files.map((f) => ({ f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null })), [files]);
  React.useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews]);

  function useGps() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("Geolocation is not available in this browser.");
      return;
    }
    setGeoStatus("Requesting location permission…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const v = { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) };
        setCoords(v);
        setManualLat(String(v.latitude));
        setManualLng(String(v.longitude));
        setAccuracy(pos.coords.accuracy ?? null);
        setLocationSource("gps");
        setGeoStatus(`Location captured (±${Math.round(pos.coords.accuracy)} m).`);
      },
      (err) => setGeoStatus(err.code === err.PERMISSION_DENIED ? "Permission denied. Pick the location on the map or enter it manually." : "Could not determine your location."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function applyManual() {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (manualLat === "" || manualLng === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setErrors((e) => ({ ...e, latitude: "Enter a latitude between -90 and 90 and a longitude between -180 and 180." }));
      return;
    }
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "latitude")));
    setCoords({ latitude: lat, longitude: lng });
    setLocationSource("manual");
    setAccuracy(null);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const problems: string[] = [];
    const ok = incoming.filter((f) => {
      if (!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm))$/.test(f.type)) {
        problems.push(`${f.name}: unsupported type`);
        return false;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        problems.push(`${f.name}: larger than ${MAX_MB} MB`);
        return false;
      }
      return true;
    });
    const next = [...files, ...ok].slice(0, MAX_FILES);
    if (files.length + ok.length > MAX_FILES) problems.push(`Only ${MAX_FILES} files can be attached.`);
    setFiles(next);
    setErrors((e) => {
      const rest = Object.fromEntries(Object.entries(e).filter(([k]) => k !== "files"));
      return problems.length ? { ...rest, files: problems.join(" · ") } : rest;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const clientErrors: Record<string, string> = {};
    if (form.title.trim().length < 5) clientErrors.title = "Title must be at least 5 characters";
    if (form.description.trim().length < 20) clientErrors.description = "Please describe what you observed (at least 20 characters)";
    if (!form.category) clientErrors.category = "Choose an incident category";
    if (form.locationText.trim().length < 2) clientErrors.locationText = "Describe the location (area, landmark, street)";
    if (!form.occurredAt) clientErrors.occurredAt = "Incident date and time is required";
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, k === "occurredAt" ? new Date(String(v)).toISOString() : String(v));
    if (coords) {
      fd.set("latitude", String(coords.latitude));
      fd.set("longitude", String(coords.longitude));
      fd.set("locationSource", locationSource);
      if (accuracy !== null) fd.set("locationAccuracyM", String(Math.round(accuracy)));
    }
    for (const f of files) fd.append("files", f);
    if (health?.demoMode && synthetic) fd.set("synthetic", "true");
    setSubmitting(true);
    try {
      const res = await fetch("/api/reports", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new ApiError(body.error ?? "Submission failed", res.status, body);
      setCreated(body);
      qc.invalidateQueries();
      window.scrollTo({ top: 0 });
    } catch (err) {
      const body = (err as ApiError).body as { issues?: { path: string; message: string }[]; field?: string } | undefined;
      if (body?.issues) setErrors(Object.fromEntries(body.issues.map((i) => [i.path || "form", i.message])));
      if (body?.field) setErrors((x) => ({ ...x, [body.field!]: (err as Error).message }));
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto max-w-2xl p-4 py-10 lg:p-6">
        <Panel>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="size-10 text-accent" />
            <h1 className="text-xl font-semibold">Report received</h1>
            <p className="text-sm text-muted">Your reference ID</p>
            <p className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 font-mono text-xl tracking-wider text-accent" data-testid="report-reference">
              {created.reference}
            </p>
            {created.synthetic && <p className="flex items-center gap-1 text-xs text-warn"><FlaskConical className="size-3.5" /> Recorded as synthetic demonstration data.</p>}
            <p className="max-w-md text-xs text-muted">Keep this reference. It identifies your report in the platform and in exported intelligence reports.</p>
          </div>
          <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
            <li className="flex items-start gap-2">
              <Radar className="mt-0.5 size-4 text-accent" />
              {created.aiConfigured ? (
                <span>The AI investigation engine has started. Six specialised agents are analysing your report; results appear on the report page as each agent completes.</span>
              ) : (
                <span className="text-warn">AI investigation is not configured on this deployment, so no AI analysis will run. Your report is queued for human review.</span>
              )}
            </li>
            <li className="flex items-start gap-2">
              <Link2 className="mt-0.5 size-4 text-info" />
              <span>
                {created.relatedReports > 0
                  ? `${created.relatedReports} potentially related report(s) were found nearby. GOS-IP will assess whether they describe the same event.`
                  : "No related reports were found nearby yet. If others report the same event, they will be linked automatically."}
              </span>
            </li>
            {created.evidenceCount > 0 && (
              <li className="flex items-start gap-2">
                <ImagePlus className="mt-0.5 size-4 text-muted" />
                <span>
                  {created.evidenceCount} evidence file(s) stored securely.
                  {created.duplicateEvidence > 0 && ` ${created.duplicateEvidence} matched previously submitted imagery and will be reviewed.`}
                </span>
              </li>
            )}
          </ul>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href={`/reports/${created.id}`}>
              <Button variant="primary">Follow the investigation</Button>
            </Link>
            <Button variant="outline" onClick={() => { setCreated(null); setFiles([]); setForm((f) => ({ ...f, title: "", description: "" })); }}>
              Submit another report
            </Button>
          </div>
          <p className="mt-6 text-center text-[11px] text-dim">{EMERGENCY_DISCLAIMER} If lives are at risk, contact local emergency services now.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Report an incident"
        description="Share what you observed. Reports are claims until corroborated or reviewed — GOS-IP investigates them, links related reports and keeps your identity protected."
      />
      <form onSubmit={submit} noValidate className="grid gap-4 p-4 lg:grid-cols-5 lg:p-6">
        <div className="space-y-4 lg:col-span-3">
          <div className="flex gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-xs text-fg/90">
            <Info className="mt-0.5 size-3.5 shrink-0 text-danger" />
            <span>{EMERGENCY_DISCLAIMER} If anyone is in immediate danger, contact local emergency services first.</span>
          </div>
          <Panel title="What happened">
            <div className="space-y-4">
              <Field label="Incident title" required error={errors.title}>
                <Input value={form.title} onChange={set("title")} maxLength={200} placeholder="e.g. Flood water blocking road near Bodija market" />
              </Field>
              <Field label="Incident category" required error={errors.category}>
                <Select value={form.category} onChange={set("category")}>
                  <option value="">Select a category…</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Detailed description" required error={errors.description} hint="Describe only what you saw or heard. Say if something was reported to you by someone else.">
                <Textarea value={form.description} onChange={set("description")} maxLength={5000} rows={6} placeholder="What did you observe? When did it start? Is anyone at risk? Are roads or services affected?" />
              </Field>
              <Field label="Incident date and time" required error={errors.occurredAt}>
                <Input type="datetime-local" value={form.occurredAt} onChange={set("occurredAt")} max={localDateTimeValue()} />
              </Field>
            </div>
          </Panel>

          <Panel title="Supporting evidence" subtitle={`Up to ${MAX_FILES} photos or short videos · ${MAX_MB} MB each · JPEG, PNG, WebP, MP4, MOV, WebM`}>
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-2 bg-bg-2 px-4 py-6 text-center hover:border-accent/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <ImagePlus className="size-5 text-muted" />
              <span className="text-sm">Add photos or videos</span>
              <span className="text-[11px] text-dim">Images are hashed and checked against previously submitted imagery. Metadata is never shown publicly.</span>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} data-testid="file-input" />
            </label>
            {errors.files && <p className="mt-2 text-xs text-danger">{errors.files}</p>}
            {files.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {previews.map(({ f, url }, i) => (
                  <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded-md border border-line bg-bg-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                    {url ? <img src={url} alt={f.name} className="h-24 w-full object-cover" /> : <div className="grid h-24 place-items-center text-xs text-muted">Video</div>}
                    <div className="flex items-center justify-between gap-1 px-2 py-1">
                      <span className="truncate text-[11px] text-muted">{f.name}</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-dim hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Panel title="Location">
            <div className="space-y-3">
              <Field label="Location description" required error={errors.locationText} hint="Neighbourhood, landmark, street or town.">
                <Input value={form.locationText} onChange={set("locationText")} maxLength={300} placeholder="e.g. Bodija Market, Ibadan" />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={useGps}>
                  <Crosshair className="size-3.5" /> Use my location
                </Button>
                <span className="text-[11px] text-dim">or click the map</span>
              </div>
              {geoStatus && <p className="text-[11px] text-muted">{geoStatus}</p>}
              <MapPicker
                value={coords}
                onChange={(v) => {
                  setCoords(v);
                  setManualLat(String(v.latitude));
                  setManualLng(String(v.longitude));
                  setLocationSource("map");
                  setAccuracy(null);
                }}
                className="h-64 overflow-hidden rounded-md border border-line"
              />
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Latitude">
                  <Input inputMode="decimal" value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="7.4352" />
                </Field>
                <Field label="Longitude">
                  <Input inputMode="decimal" value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="3.9133" />
                </Field>
                <Button type="button" size="md" variant="outline" onClick={applyManual}>
                  Set
                </Button>
              </div>
              {errors.latitude && <p className="text-xs text-danger">{errors.latitude}</p>}
              <p className="text-[11px] text-dim">
                {coords ? `Selected: ${coords.latitude}, ${coords.longitude} (${locationSource})` : "Coordinates are optional but greatly improve correlation with nearby reports."}
                {coords && (
                  <button type="button" className="ml-2 text-accent hover:underline" onClick={() => { setCoords(null); setManualLat(""); setManualLng(""); setLocationSource("none"); }}>
                    clear
                  </button>
                )}
              </p>
            </div>
          </Panel>

          <Panel title="Identity & contact">
            <div className="space-y-3">
              <label className={cn("flex cursor-pointer gap-3 rounded-md border p-3", form.anonymous ? "border-accent/50 bg-accent/5" : "border-line")}>
                <input type="checkbox" checked={form.anonymous} onChange={set("anonymous")} className="mt-0.5 accent-[#9bcb8b]" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm"><EyeOff className="size-3.5" /> Report anonymously</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                    Your report will not be linked to {user ? "your account" : "you"} and no contact details are stored. Anonymous reports are still investigated, but count as weaker evidence until corroborated.
                  </span>
                </span>
              </label>
              {!form.anonymous && (
                <>
                  <p className="text-[11px] text-dim">Optional. Visible only to authorised reviewers, never published.</p>
                  <Field label="Name"><Input value={form.contactName} onChange={set("contactName")} maxLength={120} /></Field>
                  <Field label="Phone"><Input value={form.contactPhone} onChange={set("contactPhone")} maxLength={40} inputMode="tel" /></Field>
                  <Field label="Email" error={errors.contactEmail}><Input type="email" value={form.contactEmail} onChange={set("contactEmail")} maxLength={200} /></Field>
                </>
              )}
              {user && !form.anonymous && <p className="text-[11px] text-muted">Signed in as {user.displayName}. This report will be linked to your account.</p>}
            </div>
          </Panel>

          {health?.demoMode && (
            <label className={cn("flex cursor-pointer gap-3 rounded-md border p-3", synthetic ? "border-warn/50 bg-warn/5" : "border-line")}>
              <input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} className="mt-0.5 accent-[#d9a441]" />
              <span>
                <span className="flex items-center gap-1.5 text-sm text-warn"><FlaskConical className="size-3.5" /> Synthetic demonstration report</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">This deployment runs in demo mode. Synthetic reports are labelled everywhere and only correlate with other synthetic reports — never with real ones.</span>
              </span>
            </label>
          )}
          {formError && <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{formError}</p>}
          <Button type="submit" variant="primary" className="h-11 w-full text-base" loading={submitting}>
            Submit report
          </Button>
        </div>
      </form>
    </div>
  );
}
