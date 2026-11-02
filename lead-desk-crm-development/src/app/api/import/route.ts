import { importDataset } from "@/lib/desk";
import type { Json } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Json;
    if (!payload || typeof payload !== "object") throw new Error("Expected a JSON export object.");
    const actor = String(payload.actor || request.headers.get("x-desk-actor") || "You");
    const result = await importDataset(payload, actor);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Import failed" }, { status: 400 });
  }
}
