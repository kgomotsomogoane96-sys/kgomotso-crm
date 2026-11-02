import { getDataset } from "@/lib/desk";
import type { Json } from "@/lib/types";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const dataset = await getDataset();
    const format = new URL(request.url).searchParams.get("format") ?? "json";
    const filenameDate = String(dataset.exported_at).slice(0, 19).replace(/[:T]/g, "-");
    if (format === "csv") {
      const rows: { type: string; id: string; data: Json }[] = [];
      const records = (dataset.records ?? []) as { id: string; type: string; data: Json }[];
      for (const row of records) rows.push({ type: row.type, id: row.id, data: row.data });
      for (const key of ["audit", "history", "operations"] as const) {
        for (const item of (dataset[key] ?? []) as Json[]) rows.push({ type: key, id: String(item.id ?? ""), data: item });
      }
      const header = "schema_version,exported_at,object_type,record_id,data_json";
      const lines = [header, ...rows.map((row) => [
        csvCell(dataset.schema),
        csvCell(dataset.exported_at),
        csvCell(row.type),
        csvCell(row.id),
        csvCell(JSON.stringify(row.data)),
      ].join(","))];
      return new Response(lines.join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="kgomotsoconversions-export-${filenameDate}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(JSON.stringify(dataset, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="kgomotsoconversions-export-${filenameDate}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Export failed" }, { status: 500 });
  }
}
