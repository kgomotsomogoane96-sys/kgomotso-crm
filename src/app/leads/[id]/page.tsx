import LeadPage from "@/components/LeadPage";
import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export default async function LeadRoute({ params }: RouteContext) {
  const { id } = await params;
  const workspace = await loadWorkspace();
  return <LeadPage initialWorkspace={workspace} leadId={id} />;
}
