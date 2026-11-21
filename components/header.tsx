"use client";

import { useState } from "react";
import { IconMenu } from "./icons";

const links = [
  { href: "#about", label: "About" },
  { href: "#products", label: "Products" },
  { href: "#trust", label: "Trust" },
  { href: "#contact", label: "Contact" },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="wrap">
        <div className="header-row">
          <a href="#top" className="brand" onClick={() => setOpen(false)}>
            <img src="/crest.png" alt="" width={56} height={56} />
            <span className="brand-name text-gold">18nover</span>
          </a>
          <nav className="desktop-nav" aria-label="Primary">
            {links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="header-end">
            <span className="badge-18" title="Adults only, 18 and over">
              18+
            </span>
            <button
              className="menu-toggle"
              type="button"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              <IconMenu open={open} />
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className={`mobile-nav${open ? " open" : ""}`} aria-label="Primary">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
