import { redirect } from "next/navigation";
import { actor, HttpError } from "@/lib/auth";
import ExamRoom from "@/components/exam-room";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let user;
  try {
    user = await actor(["STUDENT"]);
  } catch (e) {
    if (e instanceof HttpError)
      redirect(`/login?role=student&next=${encodeURIComponent(`/exam/${id}`)}`);
    throw e;
  }
  return <ExamRoom examId={id} user={user} />;
}
