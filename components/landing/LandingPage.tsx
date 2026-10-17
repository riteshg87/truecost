"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/mobile";
import styles from "@/app/landing.module.css";

export interface LandingPageProps {
  onCompare: () => void;
}

const rows = [
  ["Headline rate", "The number on the offer sheet", "The starting point, not the whole cost"],
  ["Fees and GST", "Scattered across pages and footnotes", "Counted alongside the loan terms"],
  ["Total borrowing cost", "Hard to compare across offers", "One view for a clearer decision"],
] as const;

export function LandingPage({ onCompare }: LandingPageProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Wordmark size="lg" />
        <nav className={styles.nav} aria-label="Primary navigation">
          <Link href="/signin?next=%2Fhome" className={styles.signIn}>Sign in</Link>
          <ThemeToggle className={styles.themeToggle} />
        </nav>
      </header>

      <main>
        <section className={styles.intro} aria-labelledby="landing-title">
          <p className={styles.kicker}>Home-loan comparison</p>
          <h1 id="landing-title"><span>Compare the loan</span><span>behind the rate.</span></h1>
          <p className={styles.lede}>
            Put the offer sheet into one clear view. TrueCost estimates APR, EMI,
            fees and total borrowing cost from the terms you enter.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={onCompare}
            >
              Compare two loans
            </button>
            <a href="#after-loan" className={styles.textAction}>Already have a loan?</a>
          </div>
          <p className={styles.helper}>
            Compare two offers as a guest. Sign in to save, download a report or compare up to three offers.
          </p>
        </section>

        <section className={styles.ledger} aria-labelledby="ledger-title">
          <div className={styles.ledgerHeading}>
            <h2 id="ledger-title">A lower rate is one line of the decision.</h2>
          </div>
          <div className={styles.rows}>
            <p className={styles.sectionLabel}>Before you borrow</p>
            <dl className={styles.rowList}>
              {rows.map(([term, before, after]) => (
                <div className={styles.row} key={term}>
                  <dt>{term}</dt>
                  <dd><span className={styles.cellLabel}>Offer sheet</span>{before}</dd>
                  <dd><span className={styles.cellLabel}>TrueCost view</span>{after}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="after-loan" className={styles.after} aria-labelledby="after-title">
          <div>
            <h2 id="after-title">After you borrow, keep the context.</h2>
            <p>One saved comparison can lead to the next useful decision.</p>
          </div>
          <div className={styles.afterLinks}>
            <Link href="/signin?next=%2Floan">Loan health <span aria-hidden>→</span></Link>
            <Link href="/signin?next=%2Fprepay">Prepay or invest <span aria-hidden>→</span></Link>
            <Link href="/signin?next=%2Floan%2Ftransfer">Transfer / refinance <span aria-hidden>→</span></Link>
          </div>
        </section>

        <section className={styles.path} aria-labelledby="path-title">
          <div>
            <h2 id="path-title">Bring the terms. Keep the decision clear.</h2>
          </div>
          <div className={styles.pathItems}>
            <div><strong>Compare</strong><p>Enter two offers side by side.</p></div>
            <div><strong>Understand</strong><p>Read APR, EMI and total cost together.</p></div>
            <div><strong>Keep</strong><p>Sign in to save the figures and return to them.</p></div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Estimates from your entered terms.</span>
        <Link href="/signin?next=%2Fhome">Sign in to your account</Link>
      </footer>
    </div>
  );
}
