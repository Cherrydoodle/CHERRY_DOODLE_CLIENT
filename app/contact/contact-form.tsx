"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "sent" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setStatus("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/v1/contact", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          name: values.get("name"),
          email: values.get("email"),
          subject: values.get("subject"),
          message: values.get("message"),
          company: values.get("company") || undefined,
        }),
      });
      if (!response.ok) throw new Error("Contact submission failed");
      form.reset();
      setStatus("sent");
      setMessage("Thanks for reaching out! We'll reply to your email within 1–2 business days.");
    } catch {
      setStatus("error");
      setMessage("Sorry, we couldn't send your message right now. Please email us directly or try again.");
    }
  };

  const fieldClass =
    "w-full rounded-2xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary";

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="contact-name" className="text-sm font-medium">Name</label>
          <input id="contact-name" name="name" type="text" required maxLength={120} autoComplete="name" className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="contact-email" className="text-sm font-medium">Email</label>
          <input id="contact-email" name="email" type="email" required maxLength={254} autoComplete="email" className={fieldClass} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="contact-subject" className="text-sm font-medium">Subject</label>
        <input id="contact-subject" name="subject" type="text" required maxLength={160} className={fieldClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="contact-message" className="text-sm font-medium">Message</label>
        <textarea id="contact-message" name="message" required minLength={10} maxLength={5000} rows={6} className={fieldClass} />
      </div>
      {/* Honeypot: hidden from real users; bots that fill it are silently ignored. */}
      <input name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <button type="submit" disabled={status === "submitting"} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-60">
        {status === "submitting" ? "Sending…" : "Send message"}
      </button>
      <p className="text-sm" aria-live="polite" role="status">
        {status === "sent" ? <span className="text-primary">{message}</span> : null}
        {status === "error" ? <span className="text-destructive">{message}</span> : null}
      </p>
    </form>
  );
}
