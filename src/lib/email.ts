type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type EmailResult = { sent: number; failed: number; reason?: string };

export async function sendEmailBatch(
  messages: EmailMessage[],
): Promise<EmailResult> {
  if (messages.length === 0) return { sent: 0, failed: 0 };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return {
      sent: 0,
      failed: messages.length,
      reason: "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
    };
  }

  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < messages.length; offset += 100) {
    const batch = messages.slice(offset, offset + 100).map((message) => ({
      from,
      ...(process.env.EMAIL_REPLY_TO
        ? { reply_to: process.env.EMAIL_REPLY_TO }
        : {}),
      ...message,
    }));
    try {
      const response = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        failed += batch.length;
        continue;
      }
      const result = (await response.json()) as { data?: unknown[] };
      const deliveredToProvider = Math.min(
        batch.length,
        Array.isArray(result.data) ? result.data.length : batch.length,
      );
      sent += deliveredToProvider;
      failed += batch.length - deliveredToProvider;
    } catch {
      failed += batch.length;
    }
  }
  return {
    sent,
    failed,
    ...(failed > 0 ? { reason: "Some messages could not be sent." } : {}),
  };
}

export function escapeEmailHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

export function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://secureexam-pro-jet.vercel.app";
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}
