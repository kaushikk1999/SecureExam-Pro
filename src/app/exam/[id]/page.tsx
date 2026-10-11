import { redirect } from "next/navigation";
import { actor, HttpError } from "@/lib/auth";
import { safeStudentReturnPath } from "@/lib/auth-role";
import ExamRoom from "@/components/exam-room";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const candidate =
    typeof search.invite === "string"
      ? safeStudentReturnPath(`/exam/${id}?invite=${search.invite}`)
      : null;
  const inviteToken = candidate?.split("?invite=")[1] ?? null;
  const returnPath =
    candidate ?? safeStudentReturnPath(`/exam/${id}`) ?? `/exam/${id}`;
  let user;
  try {
    user = await actor(["STUDENT"]);
  } catch (e) {
    if (e instanceof HttpError)
      redirect(`/login?role=student&next=${encodeURIComponent(returnPath)}`);
    throw e;
  }
  return <ExamRoom examId={id} enrollmentToken={inviteToken} user={user} />;
}
