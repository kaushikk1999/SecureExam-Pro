"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Copy, QrCode, X } from "lucide-react";
import { api } from "./ui";

export default function CourseEnrollmentQrDialog({
  courseId,
  courseCode,
  courseName,
  section,
}: {
  courseId: string;
  courseCode: string;
  courseName: string;
  section: string;
}) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [message, setMessage] = useState("");
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setImage("");
    setInviteUrl("");
    setMessage("");
    void (async () => {
      try {
        const { token } = await api(`courses/${courseId}/enrollment-invite`);
        if (!active) return;
        const url = new URL(
          `/enroll/course/${courseId}`,
          window.location.origin,
        );
        url.searchParams.set("invite", token);
        const value = url.toString();
        setInviteUrl(value);
        const dataUrl = await QRCode.toDataURL(value, {
          errorCorrectionLevel: "H",
          margin: 2,
          width: 360,
          color: { dark: "#142c45", light: "#ffffff" },
        });
        if (active) setImage(dataUrl);
      } catch (error) {
        if (active)
          setMessage(
            (error as Error).message || "Could not create this course QR code.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [courseId, open]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Course enrollment link copied.");
    } catch {
      setMessage(
        "Copy is unavailable here. You can copy the link shown above.",
      );
    }
  }

  async function present() {
    try {
      await panel.current?.requestFullscreen();
    } catch {
      setMessage(
        "Full screen is unavailable. The course QR is ready to display here.",
      );
    }
  }

  return (
    <>
      <button
        className="course-enrollment-qr-button"
        type="button"
        aria-label={`Show enrollment QR for ${courseCode} section ${section}`}
        onClick={() => setOpen(true)}
      >
        <QrCode size={15} /> Enroll by QR
      </button>
      {open && (
        <div
          className="exam-qr-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            aria-labelledby={`course-qr-title-${courseId}`}
            aria-modal="true"
            className="exam-qr-panel"
            ref={panel}
            role="dialog"
          >
            <div className="exam-qr-heading">
              <div>
                <span className="eyebrow">COURSE ENROLLMENT</span>
                <h2 id={`course-qr-title-${courseId}`}>
                  Scan to join this course
                </h2>
              </div>
              <button
                aria-label="Close course QR"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="exam-qr-course">
              <strong>{courseCode}</strong> · {courseName} · Section {section}
            </p>
            <div className="exam-qr-image">
              {image ? (
                <Image
                  src={image}
                  alt={`Course enrollment QR for ${courseCode} section ${section}`}
                  width={360}
                  height={360}
                  unoptimized
                />
              ) : (
                <span>{message || "Preparing course enrollment QR…"}</span>
              )}
            </div>
            <p className="exam-qr-help">
              Students scan this code, sign in with the approved Student
              account, and are added to this course automatically. Each course
              section has its own QR code.
            </p>
            {inviteUrl && <code className="exam-qr-link">{inviteUrl}</code>}
            <div className="actions exam-qr-actions">
              <button onClick={() => void copyLink()} disabled={!inviteUrl}>
                <Copy size={15} /> Copy enrollment link
              </button>
              <button className="primary" onClick={() => void present()}>
                <QrCode size={15} /> Present QR full screen
              </button>
            </div>
            {message && (
              <p className="small muted" role="status">
                {message}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
