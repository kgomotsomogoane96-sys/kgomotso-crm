"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Download } from "lucide-react";
import LeadFile from "./LeadFile";
import { Avatar, Segmented } from "./motion";
import type { Json, Lead, Workspace } from "@/lib/types";

const NAV = [
  { id: "due", label: "Due", href: "/" },
  { id: "queue", label: "Queue", href: "/queue" },
  { id: "pipeline", label: "Pipeline", href: "/pipeline" },
  { id: "calendar", label: "Calendar", href: "/calendar" },
  { id: "leads", label: "Leads", href: "/leads" },
];

export default function LeadPage({ initialWorkspace, leadId }: { initialWorkspace: Workspace; leadId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [actor, setActor] = useState("You");

  useEffect(() => {
    const saved = window.localStorage.getItem("kc_actor");
    if (saved) setActor(saved);
  }, []);

  async function run(name: string, args: Json): Promise<unknown> {
    const response = await fetch(`/api/fn/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args, actor }),
    });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || data.ok === false) throw new Error(data.error || `${name} failed`);
    const fresh = await fetch("/api/desk", { cache: "no-store" });
    if (fresh.ok) setWorkspace(await fresh.json() as Workspace);
    return data;
  }

  function download() {
    const link = document.createElement("a");
    link.href = "/api/export";
    link.download = "kgomotsoconversions-export.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const active = workspace.leads.find((l) => l.id === leadId);
  const row = workspace.records.find((r) => r.type === "lead" && r.id === leadId);
  const lead = active ?? (row ? { ...(row.data as unknown as Lead), archived_at: row.archived_at } : null);
  const index = workspace.leads.findIndex((l) => l.id === leadId);
  const prev = index > 0 ? workspace.leads[index - 1] : null;
  const next = index >= 0 && index < workspace.leads.length - 1 ? workspace.leads[index + 1] : null;

  const bar = (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <div className="kc-topbar is-scrolled mx-auto flex max-w-[1480px] flex-wrap items-center gap-2.5 rounded-[28px] px-3 py-2.5 sm:px-4">
        <button className="kc-round" title="Back to all leads" onClick={() => router.push("/leads")}><ArrowLeft size={17} /></button>
        <button onClick={() => router.push("/")} className="flex shrink-0 items-center gap-2 pr-1" title="KgomotsoConversions">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#151517" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1" /></svg>
          <span className="hidden text-[15px] font-semibold tracking-[-0.03em] md:inline">kgomotso<span className="font-normal text-[#6b6f76]">conversions</span></span>
        </button>
        <div className="order-3 flex w-full min-w-0 justify-center lg:order-none lg:w-auto lg:flex-1">
          <div className="kc-noscrollbar max-w-full overflow-x-auto rounded-full">
            <Segmented variant="nav" value="leads" onChange={(id) => router.push(NAV.find((n) => n.id === id)?.href ?? "/")} items={NAV.map((n) => ({ id: n.id, label: n.label, href: n.href }))} />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="kc-round" disabled={!prev} title={prev ? `Previous: ${prev.name}` : "No previous lead"} onClick={() => prev && router.push(`/leads/${prev.id}`)}><ChevronLeft size={17} /></button>
          <button className="kc-round" disabled={!next} title={next ? `Next: ${next.name}` : "No next lead"} onClick={() => next && router.push(`/leads/${next.id}`)}><ChevronRight size={17} /></button>
          <span className="kc-mono hidden text-[11px] text-[#8a8e95] sm:block">{index >= 0 ? `${index + 1}/${workspace.leads.length}` : "archived"}</span>
          <button className="kc-round" title="Export everything" onClick={download}><Download size={16} /></button>
          <Avatar name={actor} size={40} />
        </div>
      </div>
    </header>
  );

  if (!lead) {
    return (
      <div className="min-h-screen">
        {bar}
        <div className="mx-auto max-w-[760px] px-6 py-24 text-center">
          <h1 className="text-[44px] font-normal leading-none tracking-[-0.05em]">Lead not found</h1>
          <p className="mt-4 text-[13px] leading-relaxed text-[#6b6f76]">No record with the immutable id <span className="kc-mono text-[#151517]">{leadId}</span>. It may have been removed with the seed data — check Trash, or use Undo.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <button className="kc-btn kc-btn-dark" onClick={() => router.push("/leads")}>Back to all leads</button>
            <button className="kc-btn kc-btn-secondary" onClick={() => router.push("/trash")}>Open trash</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {bar}
      <LeadFile mode="page" lead={lead} workspace={workspace} run={run} archived={!active} onClose={() => router.push("/leads")} />
    </div>
  );
}
