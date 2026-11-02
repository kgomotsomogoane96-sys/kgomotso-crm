import CrmApp from "@/components/CrmApp";
import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log & history · KgomotsoConversions" };

export default async function LogPage() {
  const workspace = await loadWorkspace();
  return <CrmApp initialWorkspace={workspace} view="log" />;
}
