import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const workspace = await loadWorkspace();
    return Response.json(workspace, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Workspace could not load" }, { status: 500 });
  }
}
