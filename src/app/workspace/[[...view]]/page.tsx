import { redirect } from "next/navigation";
import { actor, HttpError } from "@/lib/auth";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ view?: string[] }>;
}) {
  let user;
  try {
    user = await actor();
  } catch (e) {
    if (e instanceof HttpError) redirect("/login");
    throw e;
  }
  return <Workspace user={user} view={(await params).view ?? []} />;
}
