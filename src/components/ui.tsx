"use client";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
export async function api(
  path: string,
  data?: unknown,
  method = "POST",
  headers?: Record<string, string>,
) {
  const r = await fetch("/api/platform/" + path, {
    method: data === undefined ? "GET" : method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
export function useData(path: string, interval = 0) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setData(await api(path));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    if (interval) {
      const id = setInterval(refresh, interval);
      return () => clearInterval(id);
    }
  }, [refresh, interval]);
  return { data, error, refresh };
}
export function Status({ value }: { value: string }) {
  const good = [
      "LIVE",
      "PUBLISHED",
      "SUBMITTED",
      "ACTIVE",
      "LOCATION_CHECK_OK",
      "NORMAL",
    ].includes(value),
    bad = /SECURITY|TERMINATED|OUTSIDE|CRITICAL/.test(value);
  return (
    <span className={"status " + (good ? "good" : bad ? "bad" : "neutral")}>
      <span />
      {value.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
export function RichEditor({
  value,
  onChange,
  label = "Question content",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="rich-editor">
      <div className="toolbar">
        {[
          ["Bold", "**text**"],
          ["Code", '\n```python\nprint("Hello")\n```\n'],
          ["Math", " $x^2 + y^2$ "],
          ["Table", "\n| A | B |\n|---|---|\n| 1 | 2 |\n"],
        ].map(([title, insert]) => (
          <button
            type="button"
            key={title}
            onClick={() => onChange(value + insert)}
          >
            {title}
          </button>
        ))}
        <button type="button" onClick={() => setPreview(!preview)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <Markdown text={value} />
      ) : (
        <label className="sr-only-wrap">
          <span className="sr-only">{label}</span>
          <textarea
            rows={7}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Write with Markdown, code blocks, tables and LaTeX…"
          />
        </label>
      )}
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="error">
      {message}
    </div>
  ) : null;
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
let displayTimezone = "Asia/Bangkok";
export function setDisplayTimezone(value: string) {
  displayTimezone = value;
}
export function time(value: string | Date | undefined) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: displayTimezone,
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export function Loading() {
  return (
    <div className="skeleton" aria-label="Loading content">
      <div />
      <div />
      <div />
    </div>
  );
}
