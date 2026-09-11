import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-12 pt-14">
      <header className="mb-10">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">
          TrueCost
        </p>
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-tight text-ink">
          Know what a financial product actually costs you.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Headline rates hide fees, GST and bundled premiums. This works out the
          real number, on your phone, without sending your details anywhere.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <FlowCard
          href="/compare"
          eyebrow="Flow 1"
          title="True cost comparison"
          body="Put two or three loan offers side by side and rank them on effective APR and cost per lakh — the only measures that survive different amounts and tenures."
          points={[
            "Converts flat rates to their reducing equivalent",
            "Counts processing fees, GST, insurance and legal charges",
            "Full EMI schedule and cost-per-lakh breakdown",
          ]}
        />

        <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-3">
              Flow 2
            </p>
            <span className="rounded-full bg-surface-inset px-2.5 py-1 text-[11px] font-medium text-ink-3">
              Next up
            </span>
          </div>
          <h2 className="mt-2 text-[19px] font-semibold tracking-tight text-ink-2">
            Understand your insurance
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">
            A plain-language read of the term cover you already hold, with an
            adequacy check against your income and liabilities. Information
            only — no recommendations, no selling.
          </p>
        </div>
      </div>

      <footer className="mt-auto pt-10">
        <p className="text-[12px] leading-relaxed text-ink-3">
          Everything is calculated and stored on this device. TrueCost does not
          sell products, earn commissions, or send your figures to a server. It
          is a calculation tool, not financial advice.
        </p>
      </footer>
    </main>
  );
}

function FlowCard({
  href,
  eyebrow,
  title,
  body,
  points,
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-line bg-surface px-5 py-5 shadow-[var(--shadow-card)] transition hover:border-accent-line hover:shadow-[var(--shadow-lift)]"
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        {eyebrow}
      </p>
      <h2 className="mt-2 flex items-center gap-2 text-[19px] font-semibold tracking-tight text-ink">
        {title}
        <span className="text-accent transition group-hover:translate-x-0.5">→</span>
      </h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{body}</p>
      <ul className="mt-3.5 flex flex-col gap-1.5">
        {points.map((point) => (
          <li key={point} className="flex gap-2 text-[13px] leading-snug text-ink-2">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            {point}
          </li>
        ))}
      </ul>
    </Link>
  );
}
