"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, X } from "lucide-react";
import { Switch } from "./motion";
import type { Json } from "@/lib/types";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "date" | "datetime-local" | "number" | "url" | "email" | "checkbox" | "file";
  options?: { value: string; label: string }[];
  placeholder?: string;
  defaultValue?: string | number | boolean;
  required?: boolean;
  help?: string;
  rows?: number;
  accept?: string;
  span?: boolean;
};

export type DialogSpec = {
  title: string;
  description?: string;
  fields: Field[];
  submitLabel?: string;
  destructive?: boolean;
  notice?: (values: Json) => string | null;
  onSubmit: (values: Json) => Promise<void> | void;
};

export type PillTone = "blue" | "green" | "amber" | "red" | "gray" | "purple";

export function Pill({ children, tone = "gray" }: { children: ReactNode; tone?: PillTone }) {
  return <span className={`kc-pill kc-pill-${tone}`}>{children}</span>;
}

export function StatCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: ReactNode; detail?: string; tone?: PillTone }) {
  return (
    <div data-reveal className="kc-card kc-lift flex min-h-[112px] flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-medium text-[#6b6f76]">{label}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1f1f21] text-[#d8f65a]">{icon}</span>
      </div>
      <div>
        <div className="mt-3 text-[28px] font-medium leading-none tracking-[-0.04em]">{value}</div>
        {detail && <div className="mt-2 truncate text-[11px] text-[#8a8e95]">{detail}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, dark = false }: { icon: ReactNode; title: string; description: string; action?: ReactNode; dark?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-[24px] px-6 py-14 text-center ${dark ? "bg-white/[.04] text-white" : "kc-card-flat"}`}>
      <div className={`mb-4 grid h-12 w-12 place-items-center rounded-full ${dark ? "bg-[#d8f65a] text-[#111]" : "bg-[#1f1f21] text-[#d8f65a]"}`}>{icon}</div>
      <h3 className="text-[16px] font-semibold tracking-[-0.02em]">{title}</h3>
      <p className={`mt-2 max-w-md text-[13px] leading-relaxed ${dark ? "text-white/55" : "text-[#6b6f76]"}`}>{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.09em] text-[#6b6f76]">{eyebrow}</div>}
        <h1 className="text-[34px] font-normal leading-[1.05] tracking-[-0.045em]">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[#6b6f76]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Animated modal frame: springs in, fades out before unmounting. */
function ModalShell({ children, onClose, leaving, wide = false }: { children: ReactNode; onClose: () => void; leaving: boolean; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
      <button aria-label="Close dialog" className={`kc-backdrop absolute inset-0 cursor-default bg-[rgba(18,22,30,.32)] backdrop-blur-[6px] ${leaving ? "is-out" : ""}`} onClick={onClose} />
      <div data-lenis-prevent className={`kc-modal kc-scroll relative max-h-[92vh] w-full overflow-y-auto rounded-[30px] border border-white/90 bg-[rgba(246,248,251,.97)] p-5 shadow-[0_40px_120px_-30px_rgba(10,20,40,.45)] sm:p-7 ${wide ? "max-w-3xl" : "max-w-xl"} ${leaving ? "is-out" : ""}`}>
        <button onClick={onClose} aria-label="Close" className="kc-round absolute right-4 top-4 !h-9 !w-9"><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

function useAnimatedClose(onClose: () => void, open: boolean) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { if (open) setLeaving(false); }, [open]);
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => { setLeaving(false); onClose(); }, 210);
  };
  return { leaving, close };
}

export function SimpleModal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { leaving, close } = useAnimatedClose(onClose, true);
  return (
    <ModalShell onClose={close} leaving={leaving} wide={wide}>
      <h2 className="pr-10 text-[24px] font-normal tracking-[-0.035em]">{title}</h2>
      {description && <p className="mt-2 text-[13px] leading-relaxed text-[#6b6f76]">{description}</p>}
      <div className="mt-5">{children}</div>
    </ModalShell>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
}

export function ActionDialog({ spec, onClose }: { spec: DialogSpec | null; onClose: () => void }) {
  const [values, setValues] = useState<Json>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { leaving, close } = useAnimatedClose(onClose, Boolean(spec));

  useEffect(() => {
    if (!spec) return;
    const initial: Json = {};
    for (const field of spec.fields) initial[field.name] = field.defaultValue ?? (field.type === "checkbox" ? false : "");
    setValues(initial);
    setFiles({});
    setError("");
    setBusy(false);
  }, [spec]);

  if (!spec) return null;
  const notice = spec.notice ? spec.notice(values) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: Json = { ...values };
      for (const [key, file] of Object.entries(files)) if (file) payload[key] = await fileToDataUrl(file);
      await spec!.onSubmit(payload);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The operation could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={close} leaving={leaving} wide={spec.fields.length > 8}>
      <div className="pr-10">
        <h2 className="text-[24px] font-normal tracking-[-0.035em]">{spec.title}</h2>
        {spec.description && <p className="mt-2 text-[13px] leading-relaxed text-[#6b6f76]">{spec.description}</p>}
      </div>
      <form className="mt-6" onSubmit={submit}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {spec.fields.map((field, index) => {
            const value = values[field.name];
            const common = { id: `f_${field.name}`, name: field.name, className: "kc-input", required: field.required };
            return (
              <label key={field.name} htmlFor={common.id} className={`kc-fade block ${field.span || field.type === "textarea" ? "sm:col-span-2" : ""}`} style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}>
                <span className="mb-1.5 block text-[12px] font-semibold text-[#4a4e55]">{field.label}{field.required && <span className="ml-1 text-[#d23a3a]">*</span>}</span>
                {field.type === "textarea" ? (
                  <textarea {...common} rows={field.rows ?? 4} placeholder={field.placeholder} value={String(value ?? "")} onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))} />
                ) : field.type === "select" ? (
                  <select {...common} value={String(value ?? "")} onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}>
                    <option value="">Select…</option>
                    {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : field.type === "checkbox" ? (
                  <span className="flex min-h-[42px] items-center justify-between gap-3 rounded-[14px] border border-[rgba(20,24,32,.1)] bg-white/80 px-3.5">
                    <span className="text-[13px] text-[#4a4e55]">{value ? "Yes" : "No"}</span>
                    <Switch checked={Boolean(value)} label={field.label} onChange={(next) => setValues((v) => ({ ...v, [field.name]: next }))} />
                  </span>
                ) : field.type === "file" ? (
                  <input id={common.id} name={field.name} type="file" accept={field.accept} className="kc-input py-2" onChange={(e) => {
                    const file = e.target.files?.[0];
                    setFiles((f) => ({ ...f, [field.name]: file as File }));
                    setValues((v) => ({ ...v, [field.name]: file?.name ?? "" }));
                  }} />
                ) : (
                  <input {...common} type={field.type ?? "text"} placeholder={field.placeholder} value={String(value ?? "")} onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))} />
                )}
                {field.help && <span className="mt-1.5 block text-[11px] leading-relaxed text-[#8a8e95]">{field.help}</span>}
              </label>
            );
          })}
        </div>
        {notice && (
          <div className="kc-pop mt-5 flex items-start gap-2 rounded-2xl border border-[rgba(255,159,10,.25)] bg-[rgba(255,159,10,.1)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[#8a4300]">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="kc-pop mt-5 flex items-start gap-2 rounded-2xl border border-[rgba(210,58,58,.22)] bg-[rgba(210,58,58,.08)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[#a82222]">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-[rgba(20,24,32,.08)] pt-5">
          <button type="button" onClick={close} className="kc-btn kc-btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className={`kc-btn ${spec.destructive ? "kc-btn-danger" : "kc-btn-dark"}`}>{busy ? "Working…" : spec.submitLabel ?? "Save"}</button>
        </div>
      </form>
    </ModalShell>
  );
}
