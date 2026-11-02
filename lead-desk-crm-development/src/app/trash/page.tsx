import CrmApp from "@/components/CrmApp";
import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trash & undo · KgomotsoConversions" };

export default async function TrashPage() {
  const workspace = await loadWorkspace();
  return <CrmApp initialWorkspace={workspace} view="trash" />;
}
