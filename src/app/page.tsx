import Link from "next/link";
import { ArrowRight, Bot, FileImage, Map as MapIcon, Network, ShieldCheck, Users } from "lucide-react";
import { Wordmark } from "@/components/app/brand";
import { AGENTS, EMERGENCY_DISCLAIMER } from "@/lib/domain/constants";

const PIPELINE = [
  { title: "Individual reports", body: "Anyone can report — signed in or anonymously — with photos, a map pin or GPS.", icon: Users },
  { title: "AI investigation", body: "Six specialised agents classify, analyse evidence, check geography, corroborate and assess threat.", icon: Bot },
  { title: "Evidence correlation", body: "Perceptual hashing, metadata signals and explainable scoring link related reports.", icon: FileImage },
  { title: "Incident intelligence", body: "Clusters become one structured assessment with severity, confidence and open questions.", icon: Network },
  { title: "Human decision", body: "Only accountable human reviewers verify, escalate or resolve. Every action is audited.", icon: ShieldCheck },
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Wordmark />
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" className="hidden rounded-md px-3 py-1.5 text-muted hover:text-fg sm:block">Command centre</Link>
            <Link href="/map" className="hidden rounded-md px-3 py-1.5 text-muted hover:text-fg sm:block">Live map</Link>
            <Link href="/login" className="rounded-md px-3 py-1.5 text-muted hover:text-fg">Sign in</Link>
            <Link href="/report" className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink hover:bg-accent-strong">Report an incident</Link>
          </nav>
        </div>
      </header>

      <section className="grid-backdrop border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Global Open-Source Situational Intelligence Platform</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">
            Every report matters.<br />
            <span className="text-muted">Every incident deserves investigation.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fg/80">
            When an emergency unfolds, the people nearby know first — but their observations are scattered across messages, photos and posts. GOS-IP investigates community reports with specialised AI agents, discovers which ones describe the same developing event, and turns them into evidence-backed, explainable situational intelligence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-ink hover:bg-accent-strong">
              Open the command centre <ArrowRight className="size-4" />
            </Link>
            <Link href="/report" className="inline-flex h-11 items-center gap-2 rounded-md border border-line-2 px-5 text-fg hover:bg-panel">
              Report an incident
            </Link>
            <Link href="/intelligence-graph" className="inline-flex h-11 items-center gap-2 rounded-md px-4 text-muted hover:text-fg">
              <Network className="size-4" /> Explore the intelligence graph
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">From fragments to intelligence</h2>
        <ol className="mt-6 grid gap-3 md:grid-cols-5">
          {PIPELINE.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex items-center justify-between">
                  <Icon className="size-5 text-accent" />
                  <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                </div>
                <p className="mt-3 text-sm font-medium">{step.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="border-y border-line bg-bg-2">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Not a chatbot. An investigation pipeline.</h2>
            <p className="mt-3 leading-relaxed text-muted">
              Each agent has one responsibility and a validated output schema. Findings are stored separately, failures are recorded instead of hidden, and the lead investigator may only state what the other agents found — with every conclusion traceable to its source.
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {AGENTS.map((a) => (
                <li key={a.id} className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded border border-line font-mono text-[11px] text-accent">{a.code}</span>
                  {a.name}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-panel p-5">
              <p className="flex items-center gap-2 text-sm font-medium"><Network className="size-4 text-accent" /> The cross-report intelligence graph</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Five people report flooding in different neighbourhoods. GOS-IP scores every pair on distance, time, category, language and imagery — and links them only above a configurable threshold, with a written explanation for every link. Same-source and duplicate-image submissions never count as independent corroboration.
              </p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-5">
              <p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-accent" /> Responsible by construction</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Severity and confidence are separate. Claims, AI assessments, corroboration and human decisions are labelled differently everywhere. The database itself refuses to let AI verify or resolve an incident. Anonymous reporters and sensitive locations are protected by row-level security.
              </p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-5">
              <p className="flex items-center gap-2 text-sm font-medium"><MapIcon className="size-4 text-accent" /> Live geographic picture</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">An interactive map with marker clustering, incident-cluster footprints, hotspots and filters by category, severity and status.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-xs text-dim">
        <p className="max-w-3xl leading-relaxed">{EMERGENCY_DISCLAIMER}</p>
        <p className="mt-3">Open source under the MIT License · Built for Kiroween 2026 (Frankenstein category).</p>
      </footer>
    </div>
  );
}
