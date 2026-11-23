import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · SecureExam Pro",
  description:
    "How SecureExam Pro collects, uses, stores and deletes information during online examinations.",
};

const UPDATED = "23 November 2026";

export default function PrivacyPolicy() {
  return (
    <main className={styles.page}>
      <article className={styles.article}>
        <p className={styles.eyebrow}>SecureExam Pro</p>
        <h1>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: {UPDATED}</p>

        <p>
          SecureExam Pro is an online examination and proctoring service used by
          Bangkok University instructors and students. This policy explains what
          information the service collects, why, where it is stored, who
          receives it, and how it is deleted. Monitoring signals are evidence
          for an instructor to review; they are never an automatic finding of
          misconduct.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Account information:</strong> your name, email address, role
            (student, teacher or administrator), student ID and course
            enrolments. If you sign in with Google, we receive your Google
            account name and email address.
          </li>
          <li>
            <strong>Exam content and answers:</strong> your answers, uploaded
            files and the Word papers you submit, with save times.
          </li>
          <li>
            <strong>Exam activity signals:</strong> events such as leaving the
            exam tab or fullscreen, pasting, network changes, device type and
            warnings, each with a timestamp.
          </li>
          <li>
            <strong>Screen recording (laptops, with your consent):</strong> when
            an exam requires it, your entire shared screen is recorded in short
            video segments for the duration of the exam.
          </li>
          <li>
            <strong>Camera and microphone:</strong> the live camera and
            microphone streams stay on your device. Microphone activity is
            measured on your device as a sound level only; audio is not recorded
            or uploaded. When an exam enables AI camera review, two small,
            low-resolution camera samples are sent for automated review about
            once a minute (see below). When a warning occurs, a camera or screen
            snapshot may be saved as evidence for that warning.
          </li>
          <li>
            <strong>Location (only when an exam requires it):</strong> your
            device&apos;s location is checked against the classroom location
            during the exam.
          </li>
          <li>
            <strong>Technical data:</strong> sign-in session cookies, browser
            and device information, and security logs needed to operate and
            protect the service.
          </li>
        </ul>

        <h2>How we use information</h2>
        <ul>
          <li>To run examinations, save answers and grade them.</li>
          <li>
            To help instructors supervise exams: live monitoring, warning
            records, evidence snapshots and screen recordings that instructors
            can review.
          </li>
          <li>
            To provide AI assistance: formatting question papers, drafting
            answer suggestions for instructor review, and automated camera
            review (for example, no face visible, more than one person, or a
            phone or extra screen visible). Automated results can be mistaken
            and are reviewed by instructors.
          </li>
          <li>To secure accounts and keep audit records of exam events.</li>
        </ul>
        <p>
          We do not sell personal information, use it for advertising, or use it
          to train AI models.
        </p>

        <h2>Where information is stored and who receives it</h2>
        <ul>
          <li>
            <strong>Application hosting and database:</strong> Vercel (hosting)
            and a managed PostgreSQL database store accounts, answers and exam
            records.
          </li>
          <li>
            <strong>Private file storage:</strong> uploaded files and warning
            evidence are stored in private, access-controlled cloud storage
            (Vercel Blob) that only the application can read.
          </li>
          <li>
            <strong>Screen recordings:</strong> stored in the instructor&apos;s
            own Google Drive when the instructor has connected it, otherwise in
            the private file storage above.
          </li>
          <li>
            <strong>AI processing:</strong> camera samples and question text are
            sent to OpenRouter, which routes them to an AI model provider (for
            example NVIDIA or Google) to produce a response. Camera samples are
            processed for that request only and are not stored by SecureExam
            Pro.
          </li>
          <li>
            <strong>Google:</strong> for Google sign-in and, for instructors who
            connect it, Google Drive storage.
          </li>
          <li>
            <strong>Bangkok University staff:</strong> your instructors and
            authorized administrators can see exam results, activity records,
            evidence and recordings for the exams they run.
          </li>
        </ul>

        <h2>Google user data</h2>
        <p>
          SecureExam Pro uses Google sign-in to read your name and email
          address. Instructors may also connect Google Drive with the{" "}
          <code>drive.file</code> permission, which lets the application create
          and access only the files and folders it creates (a &quot;Secure Exam
          recordings&quot; folder); it cannot see any other files in the
          instructor&apos;s Drive. This data is used only to store and play back
          exam recordings for that instructor. Access can be removed at any time
          from SecureExam Pro Settings (Disconnect Google Drive) or from the
          Google Account&apos;s third-party access page.
        </p>
        <p>
          SecureExam Pro&apos;s use and transfer of information received from
          Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Exam answers, activity records, evidence and screen recordings are
          kept until the instructor deletes the exam. Deleting an exam removes
          its results and queues its files and recordings for deletion, with
          automatic retries if a storage service is temporarily unavailable.
          Audit records needed to resolve disputes may be kept under the
          university&apos;s retention policy.
        </p>

        <h2>Your choices and rights</h2>
        <ul>
          <li>
            Screen recording, AI camera review and other monitoring are
            explained before an exam starts and require your consent; if you do
            not consent you cannot start that exam, and you should contact your
            instructor about alternatives.
          </li>
          <li>
            You can ask your instructor or the university to access, correct or
            delete your information, subject to academic record requirements.
          </li>
        </ul>

        <h2>Security</h2>
        <p>
          Connections use HTTPS. Files and recordings are stored privately and
          served only to authorized users. Stored Google Drive access tokens are
          encrypted. No method of transmission or storage is completely secure,
          but we work to protect your information.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about this policy or your information, contact your
          course instructor or the SecureExam Pro administrator at Bangkok
          University.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this policy. The date at the top shows the latest
          version.
        </p>

        <p className={styles.back}>
          <Link href="/">← Back to SecureExam Pro</Link>
        </p>
      </article>
    </main>
  );
}
