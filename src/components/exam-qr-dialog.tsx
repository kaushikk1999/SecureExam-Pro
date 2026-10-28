"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import QRCode from "qrcode";
import { Copy, Maximize2, QrCode, X } from "lucide-react";
import { api } from "./ui";

export default function ExamQrDialog({
  examId,
  title,
  courseCode,
  courseName,
  section,
}: {
  examId: string;
  title: string;
  courseCode: string;
  courseName: string;
  section: string;
}) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState("");
  const [examUrl, setExamUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [now, setNow] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [message, setMessage] = useState("");
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    let active = true;
    setExamUrl("");
    setImage("");
    setExpiresAt("");
    setMessage("");
    void (async () => {
      try {
        const {
          token,
          issuedAt,
          expiresAt: inviteExpiresAt,
        } = await api(`exams/${examId}/enrollment-invite`);
        if (!active) return;
        const url = new URL(`/exam/${examId}`, window.location.origin);
        url.searchParams.set("invite", token);
        url.searchParams.set("issuedAt", String(issuedAt));
        const link = url.toString();
        setExamUrl(link);
        setExpiresAt(inviteExpiresAt);
        const dataUrl = await QRCode.toDataURL(link, {
          errorCorrectionLevel: "H",
          margin: 2,
          width: 360,
          color: { dark: "#142c45", light: "#ffffff" },
        });
        if (active) setImage(dataUrl);
      } catch (error) {
        if (active)
          setMessage(
            (error as Error).message ||
              "Could not create the QR code. Please try again.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [examId, open, generation]);

  useEffect(() => {
    if (!open || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, expiresAt]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function copyLink() {
    if (expired) {
      setMessage("This exam QR has expired. Generate a fresh QR code.");
      return;
    }
    try {
      await navigator.clipboard.writeText(examUrl);
      setMessage("Exam link copied.");
    } catch {
      setMessage(
        "Copy is unavailable here. You can copy the link shown above.",
      );
    }
  }

  async function present() {
    if (expired) {
      setMessage("This exam QR has expired. Generate a fresh QR code.");
      return;
    }
    try {
      await panel.current?.requestFullscreen();
    } catch {
      setMessage(
        "Full screen is unavailable. The QR code is ready to display here.",
      );
    }
  }

  const expired = !!expiresAt && Date.parse(expiresAt) <= now;
  const remainingMinutes = expiresAt
    ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000))
    : 0;

  return (
    <>
      <button onClick={() => setOpen(true)}>
        <QrCode size={15} /> Show exam QR
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          className="exam-qr-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            aria-labelledby="exam-qr-title"
            aria-modal="true"
            className="exam-qr-panel"
            ref={panel}
            role="dialog"
          >
            <div className="exam-qr-heading">
              <div>
                <span className="eyebrow">STUDENT EXAM ACCESS</span>
                <h2 id="exam-qr-title">Scan to join this exam</h2>
              </div>
              <button aria-label="Close exam QR" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="exam-qr-course">
              <strong>{courseCode}</strong> · {courseName} · Section{" "}
              {section || "—"}
              <br />
              {title}
            </p>
            <div className="exam-qr-image">
              {image && !expired ? (
                <Image
                  src={image}
                  alt={`QR code for ${title}`}
                  width={360}
                  height={360}
                  unoptimized
                />
              ) : (
                <span>
                  {expired
                    ? "This QR code has expired. Generate a fresh one."
                    : message || "Preparing your QR code…"}
                </span>
              )}
            </div>
            <p className="exam-qr-help">
              Approved student accounts can scan this code, sign in, and be
              enrolled in this course automatically before returning to the
              exam. The QR code and its link expire 10 minutes after generation.
              Enrollment is available while the exam is open; students must
              still meet the exam entry requirements.
            </p>
            {expiresAt && (
              <p className={expired ? "error" : "small muted"} role="status">
                {expired
                  ? "This QR code has expired."
                  : `Valid for ${remainingMinutes} more minute${remainingMinutes === 1 ? "" : "s"} · expires ${new Date(expiresAt).toLocaleTimeString()}.`}
              </p>
            )}
            {examUrl && !expired && (
              <code className="exam-qr-link">{examUrl}</code>
            )}
            <div className="actions exam-qr-actions">
              <button
                onClick={() => void copyLink()}
                disabled={!examUrl || expired}
              >
                <Copy size={15} /> Copy exam link
              </button>
              <button onClick={() => setGeneration((value) => value + 1)}>
                Generate fresh QR
              </button>
              <button
                className="primary"
                onClick={() => void present()}
                disabled={!examUrl || expired}
              >
                <Maximize2 size={15} /> Present QR full screen
              </button>
            </div>
            {message && (
              <p className="small muted" role="status">
                {message}
              </p>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
