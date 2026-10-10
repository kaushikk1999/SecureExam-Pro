import { redirect } from "next/navigation";
import { actor, HttpError } from "@/lib/auth";
import ExamRoom from "@/components/exam-room";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let user;
  try {
    user = await actor(["STUDENT"]);
  } catch (e) {
    if (e instanceof HttpError) redirect("/login");
    throw e;
  }
  return <ExamRoom examId={(await params).id} user={user} />;
}
