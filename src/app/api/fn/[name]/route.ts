import { executeFunction } from "@/lib/desk";
import type { Json } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

function parseJson(value: string): Json {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

function queryArgs(url: string): Json {
  const params = new URL(url).searchParams;
  const args: Json = {};
  for (const [key, value] of params.entries()) {
    if (key === "args") Object.assign(args, parseJson(value));
    else if (key === "filter" || key === "range" || key === "patch") args[key] = parseJson(value);
    else args[key] = value;
  }
  return args;
}

function errorResponse(error: unknown) {
  return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unexpected error" }, { status: 400 });
}

export async function GET(request: Request, context: RouteContext) {
  const { name } = await context.params;
  const actor = request.headers.get("x-desk-actor") || "You";
  try {
    const result = await executeFunction(decodeURIComponent(name), queryArgs(request.url), actor);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { name } = await context.params;
  try {
    const body = await request.json().catch(() => ({})) as Json;
    const args = (body.args && typeof body.args === "object" ? body.args : body) as Json;
    const actor = String(body.actor || request.headers.get("x-desk-actor") || "You");
    const result = await executeFunction(decodeURIComponent(name), args, actor);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
