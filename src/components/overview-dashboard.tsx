"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  GraduationCap,
  LockKeyhole,
  MonitorCheck,
  Radio,
  ShieldCheck,
  Sparkles,
  Users,
  Eye,
} from "lucide-react";
import type { Actor } from "@/lib/auth";
import { useData, ErrorBox, Empty, Loading, time } from "./ui";
import styles from "./overview-dashboard.module.css";

type Exam = {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  course_code: string;
  enrolled: number;
  attended: number;
};

type Event = {
  id: string;
  event_type: string;
  severity: string;
  created_at: string;
  name?: string | null;
};

type OverviewData = {
  exams: Exam[];
  events: Event[];
  examCount: number | null;
  students: number | null;
  warnings: number | null;
};

type ActivityFilter = "all" | "security" | "logins" | "flags";

function useBangkokClock(timezone: string) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now
    ? `${timezone} ${new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "shortOffset",
      }).format(now)}`
    : `${timezone} --:--:--`;
}

function useAmbientMesh(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    if (motionPreference.matches) return;

    const points: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      phase: number;
    }> = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let isVisible = document.visibilityState === "visible";
    const pointer = { x: -1000, y: -1000 };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(34, Math.max(16, Math.round((width * height) / 38000)));
      points.length = 0;
      for (let index = 0; index < count; index += 1) {
        points.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.23,
          vy: (Math.random() - 0.5) * 0.23,
          radius: 0.8 + Math.random() * 1.25,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const draw = () => {
      if (!isVisible) return;
      context.clearRect(0, 0, width, height);
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        point.x += point.vx;
        point.y += point.vy;
        point.phase += 0.018;
        if (point.x < -8) point.x = width + 8;
        if (point.x > width + 8) point.x = -8;
        if (point.y < -8) point.y = height + 8;
        if (point.y > height + 8) point.y = -8;

        const dx = point.x - pointer.x;
        const dy = point.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0 && distance < 105) {
          const push = (105 - distance) / 1050;
          point.x += (dx / distance) * push;
          point.y += (dy / distance) * push;
        }

        for (let otherIndex = index + 1; otherIndex < points.length; otherIndex += 1) {
          const other = points[otherIndex];
          const lineDistance = Math.hypot(point.x - other.x, point.y - other.y);
          if (lineDistance < 132) {
            context.beginPath();
            context.moveTo(point.x, point.y);
            context.lineTo(other.x, other.y);
            context.strokeStyle = `rgba(37, 99, 235, ${(1 - lineDistance / 132) * 0.16})`;
            context.lineWidth = 0.7;
            context.stroke();
          }
        }

        context.beginPath();
        context.arc(
          point.x,
          point.y,
          point.radius + Math.sin(point.phase) * 0.35,
          0,
          Math.PI * 2,
        );
        context.fillStyle = `rgba(0, 219, 233, ${0.28 + Math.sin(point.phase) * 0.12})`;
        context.fill();
      }
      frame = window.requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY - canvas.getBoundingClientRect().top;
    };
    const onVisibilityChange = () => {
      isVisible = document.visibilityState === "visible";
      if (isVisible) frame = window.requestAnimationFrame(draw);
      else window.cancelAnimationFrame(frame);
    };

    resize();
    frame = window.requestAnimationFrame(draw);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [canvasRef]);
}

function AnimatedNumber({ value }: { value: number | null | undefined }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const start = performance.now();
    const duration = 850;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{typeof value === "number" ? shown.toLocaleString() : "—"}</>;
}

function classifyEvent(event: Event): ActivityFilter {
  const name = event.event_type.toLowerCase();
  if (/warning|security|tab_hidden|auto_submit|integrity|face/.test(name))
    return "flags";
  if (/login|sign.?in|auth/.test(name)) return "logins";
  return "security";
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countdown(date: string, now: Date | null) {
  if (!now) return "Checking schedule";
  const distance = new Date(date).getTime() - now.getTime();
  if (distance <= 0) return "Starting now";
  const minutes = Math.ceil(distance / 60000);
  if (minutes < 60) return `Starts in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `Starts in ${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ""}`;
}

export default function OverviewDashboard({
  user,
  timezone = "Asia/Bangkok",
}: {
  user: Actor;
  timezone?: string;
}) {
  const { data, error } = useData("overview", 10000);
  const payload = data as OverviewData | null;
  const exams = useMemo(() => payload?.exams ?? [], [payload?.exams]);
  const events = payload?.events ?? [];
  const clock = useBangkokClock(timezone);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [now, setNow] = useState<Date | null>(null);
  useAmbientMesh(canvasRef);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const openExams = useMemo(
    () =>
      exams.filter((exam) => {
        const current = now?.getTime() ?? 0;
        return (
          ["LIVE", "PUBLISHED"].includes(exam.status) &&
          new Date(exam.starts_at).getTime() <= current &&
          new Date(exam.ends_at).getTime() > current
        );
      }),
    [exams, now],
  );
  const nextExam = useMemo(
    () =>
      exams
        .filter(
          (exam) =>
            ["LIVE", "PUBLISHED"].includes(exam.status) &&
            new Date(exam.starts_at).getTime() > (now?.getTime() ?? 0),
        )
        .sort(
          (left, right) =>
            new Date(left.starts_at).getTime() -
            new Date(right.starts_at).getTime(),
        )[0],
    [exams, now],
  );
  const activity = events.filter(
    (event) => filter === "all" || classifyEvent(event) === filter,
  );

  const metrics = [
    {
      icon: FileText,
      value: payload?.examCount,
      label: "Examinations",
      caption: "Across your courses",
      accent: "blue",
    },
    {
      icon: Users,
      value: payload?.students,
      label: "Enrolled students",
      caption: "Your teaching community",
      accent: "cyan",
    },
    {
      icon: Radio,
      value: payload ? openExams.length : null,
      label: "Open examinations",
      caption: "Currently within exam time",
      accent: "green",
    },
    {
      icon: ShieldCheck,
      value: payload?.warnings,
      label: "Warnings recorded",
      caption: "Review signals with context",
      accent: "rose",
    },
  ];

  return (
    <div className={styles.dashboard}>
      <canvas ref={canvasRef} className={styles.mesh} aria-hidden="true" />
      <div className={styles.content}>
        <div className={`${styles.contextBar} ${styles.enter}`}>
          <div className={styles.contextMessage}>
            <span className={styles.statusDot} />
            <span>A little clarity before your next examination.</span>
          </div>
          <div className={styles.contextBadge}>
            <span className={styles.statusDot} />
            <span>Bangkok University · Workspace ready</span>
          </div>
        </div>

        <section className={`${styles.hero} ${styles.enter}`} aria-labelledby="dashboard-title">
          <div className={styles.auroraOne} aria-hidden="true" />
          <div className={styles.auroraTwo} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <div className={styles.heroLabelRow}>
              <span className={styles.heroPill}>
                <Sparkles size={13} /> READY FOR WHAT’S NEXT
              </span>
              <span className={styles.versionTag}>BU · EXAM WORKSPACE</span>
            </div>
            <h1 id="dashboard-title">
              Less administration.
              <br />
              <span>More room for learning.</span>
            </h1>
            <p>
              Prepare your questions, bring your class together, and follow
              every exam securely from one workspace.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/workspace/exams?new=1">
                Manage examinations <ArrowUpRight size={16} />
              </Link>
              <Link className={styles.secondaryAction} href="/workspace/exams">
                <Eye size={16} /> View exam schedule
              </Link>
              {nextExam ? (
                <span className={styles.nextExamBeacon}>
                  <span /> {countdown(nextExam.starts_at, now)}
                </span>
              ) : (
                <span className={styles.nextExamBeaconQuiet}>
                  <CalendarClock size={14} /> No upcoming exam
                </span>
              )}
            </div>
          </div>

          <div className={styles.radarWrap} aria-label={`${openExams.length} currently open examinations`}>
            <div className={styles.radar}>
              <div className={styles.radarOuter} />
              <div className={styles.radarMid} />
              <div className={styles.radarInner} />
              <div className={styles.radarSweep} />
              <div className={styles.radarOrbit}>
                <span />
              </div>
              <span className={`${styles.satellite} ${styles.satelliteTop}`}>
                <Radio size={13} /> <span>Open now</span>
                <strong>{payload ? openExams.length : "—"}</strong>
              </span>
              <span className={`${styles.satellite} ${styles.satelliteRight}`}>
                <ShieldCheck size={13} /> <span>Warnings</span>
                <strong>{payload?.warnings ?? "—"}</strong>
              </span>
              <span className={`${styles.satellite} ${styles.satelliteBottom}`}>
                <Users size={13} /> <span>Students</span>
                <strong>{payload?.students ?? "—"}</strong>
              </span>
              <div className={styles.shieldEmblem}>
                <ShieldCheck size={50} strokeWidth={1.35} />
                <span />
              </div>
              <div className={styles.radarCaption}>
                <CheckCircle2 size={14} /> Instructor-led assessment
              </div>
            </div>
          </div>
        </section>

        <section className={styles.metricGrid} aria-label="Workspace summary">
          {metrics.map(({ icon: Icon, value, label, caption, accent }, index) => (
            <article
              className={`${styles.metricCard} ${styles.enter}`}
              style={{ "--stagger": `${100 + index * 80}ms` } as React.CSSProperties}
              key={label}
            >
              <div className={styles.metricTop}>
                <div>
                  <strong className={styles.metricValue}>
                    <AnimatedNumber value={value} />
                  </strong>
                  <h2>{label}</h2>
                </div>
                <span className={`${styles.metricIcon} ${styles[accent]}`}>
                  <Icon size={19} />
                </span>
              </div>
              <div className={styles.metricBottom}>
                <span>{caption}</span>
                <span className={`${styles.signal} ${styles[accent]}`} aria-hidden="true">
                  <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
                </span>
              </div>
            </article>
          ))}
        </section>

        <div className={styles.mainGrid}>
          <section className={styles.examPanel}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.panelEyebrow}>PLAN · PREPARE · PUBLISH</span>
                <h2>Examinations</h2>
                <p>Recently created assessments from your courses</p>
              </div>
              <Link href="/workspace/exams" className={styles.textAction}>
                View all <ArrowRight size={15} />
              </Link>
            </div>
            <ErrorBox message={error} />
            {!payload ? (
              <div className={styles.loading}><Loading /></div>
            ) : exams.length === 0 ? (
              <div className={styles.emptyState}>
                <Empty
                  title="A fresh semester starts here"
                  description="Create a course, enroll students, then prepare your first examination."
                />
              </div>
            ) : (
              <div className={styles.examList}>
                {exams.slice(0, 4).map((exam) => {
                  const isLive = openExams.some((item) => item.id === exam.id);
                  const isNext = nextExam?.id === exam.id;
                  const isSubmitted = ["CLOSED", "ARCHIVED"].includes(exam.status);
                  return (
                    <Link
                      className={styles.examRow}
                      href={`/workspace/exams/${exam.id}`}
                      key={exam.id}
                    >
                      <span className={`${styles.examIcon} ${isLive ? styles.examIconLive : ""}`}>
                        {isLive ? <MonitorCheck size={20} /> : <FileText size={20} />}
                      </span>
                      <span className={styles.examDetails}>
                        <span className={styles.examTitleLine}>
                          <strong>{exam.title}</strong>
                          {isLive && <span className={styles.liveTag}><i /> LIVE</span>}
                          {isNext && <span className={styles.scheduledTag}>NEXT</span>}
                        </span>
                        <span className={styles.examMeta}>
                          {exam.course_code} <i /> {exam.duration_minutes} min <i /> {time(exam.starts_at)}
                        </span>
                      </span>
                      <span className={`${styles.examStatus} ${isLive ? styles.statusLive : isSubmitted ? styles.statusClosed : ""}`}>
                        <i /> {isLive ? "In progress" : humanize(exam.status)}
                      </span>
                      <span className={styles.examCount}>
                        <Users size={14} /> {exam.enrolled ?? 0} enrolled
                      </span>
                      <ChevronRight size={17} className={styles.examArrow} />
                      <span className={styles.examProgress}>
                        <span>
                          <span><GraduationCap size={13} /> {exam.attended ?? 0} attempts started</span>
                          <span>{exam.enrolled ? `${Math.min(100, Math.round(((exam.attended ?? 0) / exam.enrolled) * 100))}%` : "—"}</span>
                        </span>
                        <i><b style={{ width: `${exam.enrolled ? Math.min(100, ((exam.attended ?? 0) / exam.enrolled) * 100) : 0}%` }} /></i>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link href="/workspace/exams?new=1" className={styles.quickPrompt}>
              <span><Sparkles size={16} /> Ready to prepare another assessment?</span>
              <span>Create exam <ArrowRight size={14} /></span>
            </Link>
          </section>

          <section className={styles.activityPanel}>
            <div className={styles.activityHeading}>
              <div>
                <span className={styles.panelEyebrow}>RECENT SIGNALS</span>
                <h2>Recent activity</h2>
                <p>Your examination audit trail</p>
              </div>
              <span className={styles.activityGlyph}><Activity size={20} /></span>
            </div>
            <div className={styles.filters} aria-label="Filter activity">
              {([
                ["all", "All"],
                ["security", "Security"],
                ["logins", "Logins"],
                ["flags", "Warnings"],
              ] as [ActivityFilter, string][]).map(([value, label]) => (
                <button
                  type="button"
                  aria-pressed={filter === value}
                  className={filter === value ? styles.filterActive : ""}
                  onClick={() => setFilter(value)}
                  key={value}
                >
                  {label}
                </button>
              ))}
            </div>
            {!payload ? (
              <div className={styles.activityLoading}><Loading /></div>
            ) : activity.length === 0 ? (
              <div className={styles.activityEmpty}>
                <CircleAlert size={18} />
                <span>{events.length ? "No activity matches this filter." : "Exam and account activity will appear here."}</span>
              </div>
            ) : (
              <div className={styles.timeline}>
                {activity.slice(0, 5).map((event, index) => {
                  const category = classifyEvent(event);
                  const isWarning = category === "flags" || event.severity === "HIGH";
                  return (
                    <div
                      className={`${styles.timelineItem} ${styles.enter}`}
                      style={{ "--stagger": `${index * 55}ms` } as React.CSSProperties}
                      key={event.id}
                    >
                      <span className={`${styles.timelineDot} ${isWarning ? styles.timelineWarning : ""}`}>
                        {isWarning && <i />}
                      </span>
                      <span className={styles.timelineCopy}>
                        <span className={styles.timelineTitleLine}>
                          <strong>{humanize(event.event_type)}</strong>
                          <span className={`${styles.eventTag} ${isWarning ? styles.eventTagWarning : ""}`}>
                            {isWarning ? <BellRing size={10} /> : <LockKeyhole size={10} />}
                            {isWarning ? "Review" : category === "logins" ? "Account" : "System"}
                          </span>
                        </span>
                        <span className={styles.timelineMeta}>
                          {(event.name ?? "Workspace activity").toUpperCase()} · {time(event.created_at)}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className={styles.activityFooter}>
              <span>Updates as new activity arrives</span>
              <Link href="/workspace/audit">Open audit <ArrowUpRight size={13} /></Link>
            </div>
          </section>
        </div>

        <footer className={styles.dashboardFooter}>
          <span><strong>SecureExam Pro</strong><i /> Bangkok University Workspace</span>
          <span><Clock3 size={13} /> {clock}</span>
        </footer>
        <p className={styles.screenReaderOnly}>Signed in as {user.name}</p>
      </div>
    </div>
  );
}
