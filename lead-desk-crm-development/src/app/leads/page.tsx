import CrmApp from "@/components/CrmApp";
import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

export const metadata = { title: "All leads · KgomotsoConversions" };

export default async function LeadsPage() {
  const workspace = await loadWorkspace();
  return <CrmApp initialWorkspace={workspace} view="list" />;
}
