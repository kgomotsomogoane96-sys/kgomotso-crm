import CrmApp from "@/components/CrmApp";
import { loadWorkspace } from "@/lib/desk";

export const dynamic = "force-dynamic";

export const metadata = { title: "Calendar · KgomotsoConversions" };

export default async function CalendarPage() {
  const workspace = await loadWorkspace();
  return <CrmApp initialWorkspace={workspace} view="calendar" />;
}
