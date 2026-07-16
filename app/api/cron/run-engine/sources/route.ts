import { handleCronRequest } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return handleCronRequest(request, "sources");
}
