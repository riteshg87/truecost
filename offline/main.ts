import { comparisonFromSnapshot, calculateOffline, type OfflineOfferForm } from "./calculator";
import { commitGuestSnapshot, loadGuestSnapshot } from "../lib/guest/storage";
import type { ComparisonSnapshot } from "../lib/contracts/snapshot";
import { queueCalculatorSubmit } from "./submit";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
let memorySnapshot: Readonly<ComparisonSnapshot> | null = null;
let persistedSnapshot: Readonly<ComparisonSnapshot> | null = null;

function value(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "");
}

function formFor(form: HTMLFormElement, index: 1 | 2): OfflineOfferForm {
  return {
    lender: value(form, `lender-${index}`),
    amount: value(form, `amount-${index}`),
    ratePct: value(form, `rate-${index}`),
    tenureValue: value(form, `tenure-${index}`),
    tenureUnit: "years",
    feeMode: value(form, `fee-mode-${index}`) === "flat" ? "flat" : "percent",
    feeValue: value(form, `fee-${index}`),
    gstPct: value(form, `gst-${index}`),
    insurancePremium: value(form, `insurance-${index}`),
    insuranceFunding: value(form, `insurance-funding-${index}`) === "upfront" ? "upfront" : "financed",
    otherFeesTotal: value(form, `other-${index}`),
  };
}

function setStatus(message: string, tone: "normal" | "error" | "warning" = "normal") {
  const status = document.querySelector<HTMLElement>("#status")!;
  status.hidden = false;
  status.className = `notice${tone === "normal" ? "" : ` ${tone}`}`;
  status.textContent = message;
}

function renderSnapshot(snapshot: ComparisonSnapshot) {
  const comparison = comparisonFromSnapshot(snapshot);
  const result = document.querySelector<HTMLElement>("#result")!;
  const body = document.querySelector<HTMLElement>("#result-body")!;
  const caveats = document.querySelector<HTMLElement>("#caveats")!;
  const offerNotes = document.querySelector<HTMLElement>("#offer-notes")!;
  const date = document.querySelector<HTMLElement>("#result-date")!;
  const labels = new Map(snapshot.offers.map((offer) => [offer.id, offer.lender.trim() || `Offer ${snapshot.offers.indexOf(offer) + 1}`]));
  body.innerHTML = "";
  const rows: Array<[string, (row: (typeof comparison.rows)[number]) => string]> = [
    ["Loan amount", (row) => money.format(row.offer.amount)],
    ["Quoted rate", (row) => `${percent.format(row.offer.ratePct)}% reducing`],
    ["Tenure", (row) => `${row.derived.tenureMonths} months`],
    ["Insurance", (row) => `${money.format(row.offer.insurancePremium)} (${row.offer.insuranceFunding})`],
    ["Other fees", (row) => money.format(row.derived.otherFeesTotal)],
    ["Total repayment", (row) => money.format(row.derived.totalRepayment)],
    ["Total interest", (row) => money.format(row.derived.totalInterest)],
    ["Effective APR", (row) => row.derived.effectiveAprPct === null ? "Could not solve" : `${percent.format(row.derived.effectiveAprPct)}%`],
    ["Monthly EMI", (row) => money.format(row.derived.emi)],
    ["Processing fee + GST", (row) => money.format(row.derived.processingFeeAmount + row.derived.gstAmount)],
    ["Cash received", (row) => money.format(row.derived.cashInHand)],
    ["Total borrowing cost", (row) => money.format(row.derived.totalCostOfBorrowing)],
  ];
  for (const [label, format] of rows) {
    const tr = document.createElement("tr");
    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.textContent = label;
    tr.append(labelCell);
    for (const row of comparison.rows) {
      const cell = document.createElement("td");
      const bestLabel = label === "Effective APR" && row.isBest ? "Lowest APR" : "";
      cell.innerHTML = `<strong>${format(row)}</strong>${bestLabel}`;
      tr.append(cell);
    }
    body.append(tr);
  }
  comparison.rows.forEach((row, index) => {
    const column = document.querySelector<HTMLElement>(`[data-column="${index + 1}"]`);
    if (column) column.textContent = labels.get(row.offer.id) ?? `Offer ${index + 1}`;
  });
  const notices = comparison.notices.map((notice) => notice.message);
  offerNotes.innerHTML = "";
  for (const row of comparison.rows) {
    const item = document.createElement("p");
    const warnings = row.derived.warnings.map((warning) => warning.message).join(" ");
    item.textContent = `${labels.get(row.offer.id) ?? "Offer"}: processing fee ${row.offer.processingFee.mode} ${row.offer.processingFee.value}; ${warnings || "No offer-specific warnings."}`;
    offerNotes.append(item);
  }
  caveats.textContent = notices.length ? notices.join(" ") : "APR includes stated fees, insurance and GST. Confirm every figure against the lender's sanction letter.";
  date.textContent = `Calculated ${new Date(snapshot.createdAt).toLocaleDateString("en-IN")}`;
  result.hidden = false;
}

function notifyOnline(action: string) {
  setStatus(`${action} is available after you sign in online. This device-only result remains visible here.`, "warning");
}

async function boot() {
  const state = await loadGuestSnapshot();
  if (state.kind === "saved" && state.snapshot) {
    persistedSnapshot = state.snapshot;
    renderSnapshot(state.snapshot);
    setStatus("Your first result is stored only on this device. A new calculation needs an online sign-in.");
  } else if (state.kind === "invalid") {
    setStatus("The stored device result is unreadable and remains unchanged. Sign in online to start another comparison.", "warning");
  } else if (!state.persisted) {
    setStatus("Private device storage is unavailable. You can calculate in memory for this visit; closing this tab will remove the result.", "warning");
  }
}

const form = document.querySelector<HTMLFormElement>("#calculator")!;
async function handleSubmit(forms: [OfflineOfferForm, OfflineOfferForm]) {
  const result = calculateOffline(forms);
  if (result.kind === "invalid") {
    setStatus(result.issues.join(" "), "error");
    return;
  }
  if (persistedSnapshot || memorySnapshot) {
    renderSnapshot(persistedSnapshot ?? memorySnapshot!);
    setStatus("Your first result is preserved. Sign in online to calculate and save another comparison.", "warning");
    return;
  }
  const saved = await commitGuestSnapshot(result.snapshot);
  if (saved.kind === "saved") {
    persistedSnapshot = saved.snapshot;
    renderSnapshot(saved.snapshot);
    setStatus("Result stored only on this device. Sign in online to save it to your account.");
  } else if (saved.kind === "requires-auth") {
    persistedSnapshot = saved.snapshot;
    if (saved.snapshot) renderSnapshot(saved.snapshot);
    setStatus(saved.snapshot ? "Your first result is preserved. Sign in online to calculate and save another comparison." : "The stored device result is unreadable and remains unchanged. Sign in online to start another comparison.", "warning");
  } else {
    memorySnapshot = result.snapshot;
    renderSnapshot(result.snapshot);
    setStatus("Storage is unavailable, so this result exists in memory for this visit only. Sign in online to save it.", "warning");
  }
}

queueCalculatorSubmit(form, () => [formFor(form, 1), formFor(form, 2)] as [OfflineOfferForm, OfflineOfferForm], handleSubmit);

document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.action === "new") {
      form.reset();
      setStatus("The first result stays above. Sign in online before starting another saved comparison.", "warning");
    } else if (button.dataset.action === "save") notifyOnline("Saving");
    else if (button.dataset.action === "download") notifyOnline("Downloading");
  });
});

void boot();
