import { branding } from "@/lib/branding";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await branding(), {
    headers: { "Cache-Control": "no-store" },
  });
}
