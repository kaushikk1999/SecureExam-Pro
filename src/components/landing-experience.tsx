"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  FileCheck2,
  GraduationCap,
  Layers3,
  LockKeyhole,
  MapPin,
  MonitorCheck,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
} from "lucide-react";
import styles from "./landing-experience.module.css";

type Brand = {
  brand: string;
  institution: string;
  accent: string;
  timezone: string;
};
const chapters = [
  {
    label: "Before the exam",
    title: "Start prepared.",
    description:
      "Bring your questions, classroom and students into one place. Choose the right security policy and give every student clear instructions.",
    icon: Layers3,
    items: [
      "Eleven question types, including code",
      "Classroom check-in and room codes",
      "Individual accessibility accommodations",
    ],
  },
  {
    label: "During the exam",
    title: "Stay connected.",
    description:
      "Follow progress as students work. See device and location signals in context, while answers save in the background.",
    icon: MonitorCheck,
    items: [
      "A calm, focused student workspace",
      "Live status and instructor messages",
      "Server-controlled timing and submission",
    ],
  },
  {
    label: "After the exam",
    title: "Make informed decisions.",
    description:
      "Review the evidence, give useful feedback and release results when you are ready. Every important action leaves a record.",
    icon: FileCheck2,
    items: [
      "Incident timelines with review notes",
      "Automatic and manual grading",
      "Attendance and results exports",
    ],
  },
];
export default function LandingExperience({ brand }: { brand: Brand }) {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false),
    [reduced, setReduced] = useState(false),
    [chapter, setChapter] = useState(0),
    [role, setRole] = useState<"teacher" | "student">("teacher");
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const motionOff = paused || reduced;
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const animations: Animation[] = [];
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!motionOff) {
            const el = entry.target as HTMLElement;
            animations.push(
              el.animate(
                [
                  { opacity: 0.25, transform: "translateY(26px)" },
                  { opacity: 1, transform: "translateY(0)" },
                ],
                {
                  duration: 700,
                  delay: Number(el.dataset.delay ?? 0),
                  easing: "cubic-bezier(.2,.7,.2,1)",
                },
              ),
            );
          }
          reveal.unobserve(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    node.querySelectorAll("[data-reveal]").forEach((el) => reveal.observe(el));
    const scenes = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            setChapter(Number((entry.target as HTMLElement).dataset.chapter));
      },
      { rootMargin: "-25% 0px -40% 0px", threshold: 0 },
    );
    node.querySelectorAll("[data-chapter]").forEach((el) => scenes.observe(el));
    let frame = 0;
    const draw = () => {
      const total = document.documentElement.scrollHeight - innerHeight;
      node.style.setProperty(
        "--reading",
        String(total > 0 ? scrollY / total : 0),
      );
      node.style.setProperty(
        "--drift",
        motionOff ? "0px" : Math.min(scrollY * 0.14, 100) + "px",
      );
      frame = 0;
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    addEventListener("scroll", scroll, { passive: true });
    addEventListener("resize", scroll);
    return () => {
      reveal.disconnect();
      scenes.disconnect();
      animations.forEach((a) => a.cancel());
      removeEventListener("scroll", scroll);
      removeEventListener("resize", scroll);
      cancelAnimationFrame(frame);
    };
  }, [motionOff]);
  return (
    <div
      ref={root}
      className={styles.site}
      data-paused={motionOff}
      style={{ "--accent": brand.accent } as React.CSSProperties}
    >
      <div className={styles.reading} aria-hidden="true" />
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link className={styles.logo} href="/">
          <span>
            <ShieldCheck size={23} />
          </span>
          {brand.brand}
        </Link>
        <nav aria-label="Main navigation">
          <a href="#experience">The experience</a>
          <a href="#features">Capabilities</a>
          <a href="#principles">Our approach</a>
        </nav>
        <Link className={styles.signIn} href="/login">
          Sign in <ArrowUpRight size={16} />
        </Link>
      </header>
      <main id="main">
        <section className={styles.hero}>
          <div className={styles.heroGrid} aria-hidden="true" />
          <div className={styles.heroCopy} data-reveal>
            <div className={styles.eyebrow}>
              <span className={styles.dot} /> {brand.institution} · Digital
              assessment
            </div>
            <h1>
              Bright minds.
              <br />A <em>fairer</em> start.
            </h1>
            <p>
              A more considered way to run examinations.
              <br className={styles.desktopBreak} /> Prepare with confidence.
              Stay connected.
              <br className={styles.desktopBreak} /> Put learning at the heart
              of every assessment.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href="/login">
                Enter your workspace <ArrowUpRight size={18} />
              </Link>
              <a className={styles.textLink} href="#experience">
                Explore the experience <ArrowDown size={16} />
              </a>
            </div>
            <div className={styles.trustLine}>
              <LockKeyhole size={14} /> Privacy-conscious. Instructor-led. Built
              for your classroom.
            </div>
          </div>
          <div
            className={styles.heroGraphic}
            aria-label="Illustration of the examination workspace"
          >
            <div className={styles.orbit} aria-hidden="true">
              <span />
            </div>
            <div className={styles.floatingTag}>
              <ShieldCheck size={16} /> Integrity, with context
            </div>
            <div className={styles.preview} data-reveal data-delay="160">
              <div className={styles.previewTop}>
                <span className={styles.previewMark}>
                  <GraduationCap size={21} />
                </span>
                <div>
                  <strong>Your classroom, connected.</strong>
                  <small>Workspace illustration · sample data</small>
                </div>
                <span className={styles.miniDots}>•••</span>
              </div>
              <div className={styles.previewSummary}>
                <div>
                  <small>EXAMINATION</small>
                  <h3>Data Structures</h3>
                  <span>CS301 · Midterm assessment</span>
                </div>
                <span className={styles.previewBadge}>
                  <span /> In progress
                </span>
              </div>
              <div className={styles.previewMetrics}>
                <div>
                  <b>03</b>
                  <span>Students</span>
                </div>
                <div>
                  <b>02</b>
                  <span>Working</span>
                </div>
                <div>
                  <b>01</b>
                  <span>Submitted</span>
                </div>
              </div>
              <div className={styles.previewRows}>
                {[
                  ["A", "Student A", "Answering questions", 72],
                  ["B", "Student B", "Answering questions", 48],
                  ["C", "Student C", "Submitted", 100],
                ].map(([letter, name, status, progress]) => (
                  <div key={String(letter)}>
                    <span className={styles.avatar}>{letter}</span>
                    <div>
                      <strong>{name}</strong>
                      <small>{status}</small>
                    </div>
                    <div className={styles.miniProgress}>
                      <span style={{ width: progress + "%" }} />
                    </div>
                    {progress === 100 ? (
                      <CheckCheck size={16} />
                    ) : (
                      <Wifi size={15} />
                    )}
                  </div>
                ))}
              </div>
              <div className={styles.previewBottom}>
                <span className={styles.dot} /> A clear view of every
                examination <ArrowUpRight size={14} />
              </div>
            </div>
            <div className={styles.savedTag}>
              <span>
                <Check size={15} />
              </span>
              <div>
                <strong>Every answer matters.</strong>
                <small>Automatic saving, built in.</small>
              </div>
            </div>
          </div>
          <a href="#experience" className={styles.scrollCue}>
            <span>
              <ArrowDown size={15} />
            </span>{" "}
            SCROLL TO DISCOVER
          </a>
        </section>
        <div className={styles.strip}>
          <span>ONE CONNECTED WORKSPACE</span>
          <div>
            <Layers3 size={18} /> Prepare
          </div>
          <ChevronRight size={15} />
          <div>
            <MonitorCheck size={18} /> Supervise
          </div>
          <ChevronRight size={15} />
          <div>
            <FileCheck2 size={18} /> Review
          </div>
        </div>
        <section id="experience" className={styles.experience}>
          <div className={styles.sectionHeading} data-reveal>
            <div className={styles.eyebrow}>
              THOUGHTFUL FROM START TO FINISH
            </div>
            <h2>
              One exam.
              <br />
              Every moment, considered.
            </h2>
            <p>
              From your first question to your final feedback,
              <br />
              keep the important things in view.
            </p>
          </div>
          <div className={styles.storyLayout}>
            <div className={styles.storyVisual}>
              <div className={styles.storyVisualTop}>
                <ShieldCheck size={20} />
                <span>THE EXAMINATION JOURNEY</span>
                <b>0{chapter + 1} / 03</b>
              </div>
              <div className={styles.scene} data-scene={chapter}>
                <div className={styles.sceneRings} aria-hidden="true" />
                <div className={styles.sceneIcon}>
                  {chapter === 0 ? (
                    <Layers3 size={55} strokeWidth={1.2} />
                  ) : chapter === 1 ? (
                    <MonitorCheck size={55} strokeWidth={1.2} />
                  ) : (
                    <FileCheck2 size={55} strokeWidth={1.2} />
                  )}
                </div>
                <span className={styles.sceneCaption}>
                  {chapters[chapter].label}
                </span>
                <div className={styles.sceneCards}>
                  {chapters[chapter].items.map((item, i) => (
                    <div key={item} style={{ "--i": i } as React.CSSProperties}>
                      <CheckCircle />
                      <span>{item}</span>
                      <Check size={13} />
                    </div>
                  ))}
                </div>
              </div>
              <div
                className={styles.sceneSteps}
                aria-label="Jump to examination stage"
              >
                {chapters.map((c, i) => (
                  <a
                    key={c.label}
                    href={"#stage-" + i}
                    aria-current={chapter === i ? "step" : undefined}
                  >
                    <span />
                    {c.label}
                  </a>
                ))}
              </div>
            </div>
            <div className={styles.chapters}>
              {chapters.map((c, i) => (
                <article
                  id={"stage-" + i}
                  key={c.label}
                  data-chapter={i}
                  className={styles.chapter}
                >
                  <div data-reveal>
                    <span className={styles.chapterNumber}>0{i + 1}</span>
                    <div className={styles.eyebrow}>{c.label}</div>
                    <h3>{c.title}</h3>
                    <p>{c.description}</p>
                    <ul>
                      {c.items.map((item) => (
                        <li key={item}>
                          <Check size={15} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section id="features" className={styles.capabilities}>
          <div className={styles.sectionHeading} data-reveal>
            <div className={styles.eyebrow}>LESS FRICTION. MORE FOCUS.</div>
            <h2>Everything in its right place.</h2>
            <p>Powerful where you need it. Calm where it matters.</p>
          </div>
          <div className={styles.featureGrid}>
            <article className={styles.featureWide} data-reveal>
              <div className={styles.featureIcon}>
                <MonitorCheck size={24} />
              </div>
              <h3>A workspace that fits your role.</h3>
              <p>
                Purposeful tools for instructors. A focused place for students
                to do their best work.
              </p>
              <div
                className={styles.roleTabs}
                role="group"
                aria-label="Preview workspace role"
              >
                <button
                  aria-pressed={role === "teacher"}
                  onClick={() => setRole("teacher")}
                >
                  For instructors
                </button>
                <button
                  aria-pressed={role === "student"}
                  onClick={() => setRole("student")}
                >
                  For students
                </button>
              </div>
              <div className={styles.rolePreview} key={role}>
                <strong>
                  {role === "teacher"
                    ? "See the class. Support the individual."
                    : "Your questions. Your time. Your focus."}
                </strong>
                <p>
                  {role === "teacher"
                    ? "Monitor progress, approve entry, add extra time and review incidents from one workspace."
                    : "Read clear instructions, navigate questions, flag answers for review and see your save status."}
                </p>
                <Link href="/login">
                  Open your workspace <ArrowRight size={15} />
                </Link>
              </div>
            </article>
            <article
              className={styles.locationCard}
              data-reveal
              data-delay="80"
            >
              <div className={styles.featureIcon}>
                <MapPin size={24} />
              </div>
              <h3>A confident classroom check-in.</h3>
              <p>
                Geofencing, rotating room codes and optional instructor approval
                help verify exam entry.
              </p>
              <div className={styles.radar} aria-hidden="true">
                <span />
                <span />
                <MapPin size={27} />
                <i />
              </div>
              <small>Location accuracy is checked before entry.</small>
            </article>
            <article data-reveal>
              <div className={styles.featureIcon}>
                <Layers3 size={23} />
              </div>
              <h3>Questions with more possibility.</h3>
              <p>
                Code, equations, essays and multiple choice. Build your paper
                around what you want students to learn.
              </p>
              <div className={styles.pills}>
                <span>Code</span>
                <span>LaTeX</span>
                <span>Essays</span>
                <span>MCQ</span>
              </div>
            </article>
            <article data-reveal data-delay="70">
              <div className={styles.featureIcon}>
                <FileCheck2 size={23} />
              </div>
              <h3>Evidence you can understand.</h3>
              <p>
                Follow the incident timeline, add context and annotate false
                positives before making a decision.
              </p>
              <div className={styles.miniTimeline}>
                <span>Event recorded</span>
                <span>Instructor review</span>
                <span>Decision documented</span>
              </div>
            </article>
            <article data-reveal data-delay="140">
              <div className={styles.featureIcon}>
                <Users size={23} />
              </div>
              <h3>Room for individual needs.</h3>
              <p>
                Configure extra time and camera, microphone or warning
                exemptions for approved accommodations.
              </p>
              <span className={styles.featureNote}>
                Fairness is part of the design <ArrowUpRight size={14} />
              </span>
            </article>
          </div>
        </section>
        <section id="principles" className={styles.principles} data-reveal>
          <div>
            <div className={styles.eyebrow}>TECHNOLOGY WITH PERSPECTIVE</div>
            <h2>
              Support better judgment.
              <br />
              <em>Keep people at the center.</em>
            </h2>
          </div>
          <div>
            <ShieldCheck size={30} strokeWidth={1.3} />
            <p>
              Monitoring signals deserve context. A connection problem, an
              inaccurate location reading or an accessibility need should never
              become an automatic accusation.
            </p>
            <p className={styles.principleNote}>
              Camera and microphone recordings are not uploaded. Browser
              monitoring helps instructors review events; it cannot guarantee
              that cheating is prevented.
            </p>
          </div>
        </section>
        <section className={styles.cta} data-reveal>
          <span className={styles.ctaGlow} aria-hidden="true" />
          <Sparkles size={25} />
          <div className={styles.eyebrow}>YOUR NEXT EXAM, REIMAGINED</div>
          <h2>
            Ready for a more
            <br />
            considered exam day?
          </h2>
          <p>Your classroom. Your students. One connected workspace.</p>
          <Link className={styles.primary} href="/login">
            Let’s get started <ArrowUpRight size={18} />
          </Link>
          <small>Sign in with the account provided by your institution.</small>
        </section>
      </main>
      <footer className={styles.footer}>
        <Link className={styles.logo} href="/">
          <ShieldCheck size={20} />
          {brand.brand}
        </Link>
        <span>
          {brand.institution} · {brand.timezone}
        </span>
        <button
          onClick={() => setPaused((p) => !p)}
          disabled={reduced}
          aria-pressed={motionOff}
        >
          {motionOff ? <Play size={13} /> : <Pause size={13} />}{" "}
          {reduced
            ? "Reduced motion enabled"
            : paused
              ? "Resume motion"
              : "Pause motion"}
        </button>
      </footer>
    </div>
  );
}
function CheckCircle() {
  return (
    <span className={styles.checkCircle}>
      <Check size={12} />
    </span>
  );
}
