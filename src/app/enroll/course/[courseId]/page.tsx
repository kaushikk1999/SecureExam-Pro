import { redirect, notFound } from "next/navigation";
import { actor, HttpError } from "@/lib/auth";
import { safeStudentReturnPath } from "@/lib/auth-role";
import CourseEnrollment from "@/components/course-enrollment";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const [{ courseId }, search] = await Promise.all([params, searchParams]);
  const candidate =
    typeof search.invite === "string"
      ? safeStudentReturnPath(
          `/enroll/course/${courseId}?invite=${search.invite}`,
        )
      : null;
  const token = candidate?.split("?invite=")[1];
  if (!candidate || !token) notFound();

  try {
    await actor(["STUDENT"]);
  } catch (error) {
    if (error instanceof HttpError && [401, 403].includes(error.status))
      redirect(`/login?role=student&next=${encodeURIComponent(candidate)}`);
    throw error;
  }

  return <CourseEnrollment courseId={courseId} token={token} />;
}
