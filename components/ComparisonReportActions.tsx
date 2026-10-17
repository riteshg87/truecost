"use client";

import { useAuth } from "@/lib/auth/provider";
import type { PrivateSessionAccess } from "@/lib/auth/private-session";
import { buildComparisonReportModel } from "@/lib/reports/model";
import { useComparisonReport, type ComparisonReportSource } from "@/lib/reports/use-comparison-report";
import type { ComparisonSnapshot } from "@/lib/contracts/snapshot";

export function ComparisonReportActions({
  snapshot,
  source,
  access: suppliedAccess,
}: {
  snapshot: Readonly<ComparisonSnapshot>;
  source: ComparisonReportSource;
  access?: PrivateSessionAccess | null;
}) {
  const auth = useAuth();
  const access = suppliedAccess === undefined ? auth.privateSession : suppliedAccess;
  const report = useComparisonReport(snapshot, source, access);
  const model = buildComparisonReportModel(snapshot);
  const button = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  const fallback = report.canPrint;

  return (
    <section id="comparison-report" aria-labelledby="comparison-report-title" className="rounded-2xl border border-line bg-surface px-4 py-4">
      <h2 id="comparison-report-title" className="text-[15px] font-semibold text-ink">Report</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Generate a selectable PDF from the {source === "saved" ? "saved" : "current"} figures when you need a copy.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {report.status === "ready" && report.url ? (
          <a className={`${button} bg-accent text-accent-ink`} href={report.url} download={`truecost-${model.resultId}.pdf`} onClick={(event) => { if (!report.allowDownload()) event.preventDefault(); }}>Download PDF</a>
        ) : (
          <button type="button" className={`${button} bg-accent text-accent-ink`} onClick={() => void report.generate()} disabled={report.status === "generating" || report.status === "locked"}>
            {report.status === "generating" ? "Preparing PDF…" : "Generate PDF"}
          </button>
        )}
        {fallback ? <button type="button" className={`${button} bg-surface-2 text-ink`} onClick={() => { if (report.allowPrint()) window.print(); }}>Print this result</button> : null}
      </div>
      <p role="status" className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
        {report.status === "locked" ? "Verify your account online before generating a private report." : report.status === "error" ? "The PDF could not be prepared. Your figures remain available below; use Print this result." : report.status === "ready" ? "Your report is ready." : "The report is generated in this browser from the validated snapshot."}
      </p>
      {report.error && report.status === "error" ? <p role="alert" className="mt-2 text-[12.5px] leading-relaxed text-danger">{report.error}</p> : null}
      {fallback ? <ReportTextFallback model={model} /> : null}
    </section>
  );
}

function ReportTextFallback({ model }: { model: ReturnType<typeof buildComparisonReportModel> }) {
  return (
    <div className="mt-4 border-t border-line pt-3 print:text-black">
      <p className="text-[13px] font-semibold text-ink">TrueCost comparison</p>
      <p className="mt-1 text-[12px] text-ink-3">Snapshot schema {model.snapshotVersion}, created {model.createdAt}. Calculation {model.calculationVersion}; report {model.reportVersion}.</p>
      <div className="mt-3 space-y-3">
        {model.offers.map((offer) => <div key={offer.offerId} className="text-[12.5px] text-ink-2"><p className="font-semibold text-ink">{offer.rank}) {offer.lender}</p><p>Amount {offer.amount}; tenure {offer.tenure}; quoted rate {offer.quotedRate} ({offer.rateType}, {offer.rateStructure}).</p><p>Processing fee {offer.processingFee}; GST {offer.gst}; insurance {offer.insurance}; other fees {offer.otherFees}; upfront fees {offer.upfrontFees}.</p><p>EMI {offer.emi}; total repayment {offer.totalRepayment}; total interest {offer.totalInterest}; total borrowing cost {offer.totalCostOfBorrowing}; cost per lakh {offer.costPerLakh}; APR {offer.apr}.</p>{offer.aprUnavailableReason ? <p>{offer.aprUnavailableReason}</p> : null}{offer.warnings.map((warning) => <p key={`${offer.offerId}-${warning.code}`}>{warning.level}: {warning.message}</p>)}</div>)}
      </div>
      <div className="mt-3 space-y-1 text-[12px] text-ink-3">{model.assumptions.map((warning) => <p key={warning.code}>{warning.level}: {warning.message}</p>)}</div>
      <p className="mt-3 text-[12px] text-ink-3">{model.disclaimer}</p>
    </div>
  );
}
