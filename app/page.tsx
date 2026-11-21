import { ContactForm } from "@/components/contact-form";
import { Header } from "@/components/header";
import { IconCheck, IconLock, IconShield, IconStar } from "@/components/icons";
import { CONTACT_EMAIL, onlymen, site } from "@/lib/config";

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div id="top">
        <Header />
        <main id="main">
          <section className="hero" aria-labelledby="hero-title">
            <img className="flourish flourish-left" src="/flourish.svg" alt="" />
            <img className="flourish flourish-right" src="/flourish.svg" alt="" />
            <div className="wrap">
              <div className="hero-inner">
                <h1 id="hero-title">
                  Built for Men.
                  <br />
                  Made for Grown-Ups.
                </h1>
                <p className="lede">
                  The parent company behind OnlyMen, a creator-first platform for adult men.
                </p>
                <div className="cta">
                  <a className="btn-gold" href={onlymen.url}>
                    Visit OnlyMen
                  </a>
                  <a className="btn-outline" href={onlymen.joinCreator}>
                    Become a Creator
                  </a>
                </div>
              </div>
            </div>
          </section>

          <section id="about" className="section" aria-labelledby="about-title">
            <div className="wrap">
              <h2 id="about-title" className="section-title text-gold">
                About 18nover
              </h2>
              <p className="about-intro">
                18nover is an adults-only company, built by and for gay men. Our name means what
                it says: eighteen and over. We build platforms that treat creators as partners,
                put consent and safety first, and keep the experience private, respectful, and
                grown-up.
              </p>
              <ul className="feature-list">
                <li className="feature">
                  <span className="feature-icon">
                    <IconStar />
                  </span>
                  <div>
                    <h3>Creator-First</h3>
                    <p>
                      Creators come first in everything we ship. On OnlyMen they own their
                      profiles, set their terms, and keep control of how they appear and earn —
                      not as listings to be managed, but as the reason the platform exists.
                    </p>
                  </div>
                </li>
                <li className="feature">
                  <span className="feature-icon">
                    <IconShield />
                  </span>
                  <div>
                    <h3>Verified &amp; Safe</h3>
                    <p>
                      Every creator is identity-checked, and every member must confirm they are
                      18 or older. We have zero tolerance for minors or non-consensual content,
                      and we give people clear ways to report anything that crosses the line.
                    </p>
                  </div>
                </li>
                <li className="feature">
                  <span className="feature-icon">
                    <IconLock />
                  </span>
                  <div>
                    <h3>Privacy by Design</h3>
                    <p>
                      You decide what you share, and with whom. We collect only what we need to
                      run the service, keep personal details under tight control, and never treat
                      private photos or messages as marketing material.
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </section>

          <section id="products" className="section" aria-labelledby="products-title">
            <div className="wrap">
              <h2 id="products-title" className="section-title text-gold">
                Our Products
              </h2>
              <a className="product-card" href={onlymen.url}>
                <img src="/crest.png" alt="" width={96} height={96} />
                <div>
                  <h3 className="text-gold">
                    Only<em>Men</em>
                  </h3>
                  <p className="product-domain">{onlymen.brandDomain}</p>
                  <p className="product-blurb">
                    A creator-first platform for adult men — profiles, companionship, and live
                    connection, with ID verification for creators and a strict 18+ gate.
                  </p>
                </div>
              </a>
            </div>
          </section>

          <section id="trust" className="trust" aria-label="Trust and safety">
            <div className="trust-row">
              <a className="trust-item" href={onlymen.legal.statement2257}>
                <IconCheck />
                18+ Verification
              </a>
              <a className="trust-item" href={onlymen.legal.statement2257}>
                <IconCheck />
                2257 Compliance
              </a>
            </div>
          </section>

          <section id="contact" className="section" aria-labelledby="contact-title">
            <div className="wrap">
              <div className="contact-inner">
                <h2 id="contact-title" className="section-title text-gold">
                  Contact
                </h2>
                <p>
                  For press, partnerships, creator support, or anything else about {site.name}{" "}
                  and {onlymen.name}, send a note. There is no phone line and no office drop-in
                  — email is the way to reach us.
                </p>
                <div className="contact-actions">
                  <a className="btn-gold" href={`mailto:${CONTACT_EMAIL}`}>
                    Email us
                  </a>
                  <a className="contact-email" href={`mailto:${CONTACT_EMAIL}`}>
                    {CONTACT_EMAIL}
                  </a>
                </div>
                <ContactForm />
              </div>
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <div className="wrap">
            <nav aria-label="Legal">
              <ul className="footer-links">
                <li>
                  <a href={onlymen.legal.terms}>Terms</a>
                </li>
                <li>
                  <a href={onlymen.legal.privacy}>Privacy</a>
                </li>
                <li>
                  <a href={onlymen.legal.statement2257}>2257</a>
                </li>
                <li>
                  <a href={onlymen.legal.guidelines}>Guidelines</a>
                </li>
              </ul>
            </nav>
            <p className="notice">
              18nover products are for adults only. You must be 18 or older to use OnlyMen.
            </p>
            <p className="copy">© 2026 {site.name}</p>
          </div>
        </footer>
      </div>
    </>
  );
}
