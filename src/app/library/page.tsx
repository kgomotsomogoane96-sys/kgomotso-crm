import CrmApp from "@/components/CrmApp";
import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

export const metadata = { title: "Library · KgomotsoConversions" };

export default async function LibraryPage() {
  const workspace = await loadWorkspace();
  return <CrmApp initialWorkspace={workspace} view="library" />;
}
