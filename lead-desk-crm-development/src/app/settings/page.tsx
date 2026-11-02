import CrmApp from "@/components/CrmApp";
import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · KgomotsoConversions" };

export default async function SettingsPage() {
  const workspace = await loadWorkspace();
  return <CrmApp initialWorkspace={workspace} view="settings" />;
}
