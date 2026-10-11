"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Copy, Maximize2, QrCode, X } from "lucide-react";

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
  const [message, setMessage] = useState("");
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const url = new URL(`/exam/${examId}`, window.location.origin).toString();
    setExamUrl(url);
    setImage("");
    setMessage("");
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 360,
      color: { dark: "#142c45", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (active) setImage(dataUrl);
      })
      .catch(() => {
        if (active)
          setMessage(
            "Could not create the QR code. Copy the exam link instead.",
          );
      });
    return () => {
      active = false;
    };
  }, [examId, open]);

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
      await navigator.clipboard.writeText(examUrl);
      setMessage("Exam link copied.");
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
        "Full screen is unavailable. The QR code is ready to display here.",
      );
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}>
        <QrCode size={15} /> Show exam QR
      </button>
      {open && (
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
                <h2 id="exam-qr-title">Scan to open this exam</h2>
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
              {image ? (
                <Image
                  src={image}
                  alt={`QR code for ${title}`}
                  width={360}
                  height={360}
                  unoptimized
                />
              ) : (
                <span>{message || "Preparing your QR code…"}</span>
              )}
            </div>
            <p className="exam-qr-help">
              Students scan with their phone camera, sign in, and return
              directly to this exam. They still need to be enrolled in this
              course and meet the exam entry requirements.
            </p>
            {examUrl && <code className="exam-qr-link">{examUrl}</code>}
            <div className="actions exam-qr-actions">
              <button onClick={() => void copyLink()} disabled={!examUrl}>
                <Copy size={15} /> Copy exam link
              </button>
              <button className="primary" onClick={() => void present()}>
                <Maximize2 size={15} /> Present QR full screen
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
