"use client";

import { FormEvent } from "react";
import { CONTACT_EMAIL } from "@/lib/config";

export function ContactForm() {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const message = String(data.get("message") || "").trim();
    const subject = encodeURIComponent(name ? `Message from ${name}` : "Message from 18nover.gay");
    const body = encodeURIComponent(
      `${message}\n\n— ${name || "Someone"}${email ? ` (${email})` : ""}`,
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  return (
    <form className="contact-form" onSubmit={onSubmit}>
      <label>
        Name
        <input type="text" name="name" autoComplete="name" required />
      </label>
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        Message
        <textarea name="message" required rows={5} />
      </label>
      <button type="submit" className="btn-gold">
        Send message
      </button>
    </form>
  );
}
