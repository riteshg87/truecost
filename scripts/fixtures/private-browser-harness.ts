import { compareOffers } from "../../lib/finance/comparison";
import { createComparisonSnapshot, type ComparisonSnapshot } from "../../lib/contracts/snapshot";
import { PrivateStorage, openPrivateDatabase, PRIVATE_STORE_NAME } from "../../lib/private-storage/storage";
import { ComparisonWorkspace, openComparisonDatabase, COMPARISON_PRIVATE_STORE } from "../../lib/comparison/private-workspace";
import type { PrivateSessionAccess } from "../../lib/auth/private-session";
import type { SavedLoanPayload } from "../../lib/contracts/saved-loan";
import { publishPrivateBrowserClearSignal, subscribeToPrivateBrowserClearSignal } from "../../lib/privacy/private-browser-clear-signal";
import { clearAllMemberPrivateBrowserData } from "../../lib/privacy/private-browser-clear";

type Account = "A" | "B";
type AnyResult = Record<string, unknown>;

const account = new URLSearchParams(location.search).get("account") === "B" ? "B" : "A";
const profileId = `synthetic-profile-${account.toLowerCase()}`;
const sessionId = `synthetic-session-${account.toLowerCase()}`;
const now = () => Date.now();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const validOrigin = location.hostname === "127.0.0.1" && location.port === "3338";
const GUEST_SENTINEL = "truecost.synthetic.guest-sentinel.v1";

const runtime = { current: true };
let signalReceiptCount = 0;
let seeded = false;
let confirmVisible = false;
let clearResult: AnyResult | null = null;
let capturedWriterResult: AnyResult | null = null;
let loan: PrivateStorage | null = null;
let workspace: ComparisonWorkspace | null = null;
let staleWorkspace: ComparisonWorkspace | null = null;
let loanGuard: ReturnType<PrivateStorage["captureGuard"]> = null;
let comparisonCleanup: { run(): Promise<unknown> } | null = null;
let snapshot: ComparisonSnapshot | null = null;

const access: PrivateSessionAccess = {
  identity: { profileId, subject: `synthetic-subject-${account.toLowerCase()}`, sessionId, authEpoch: 1, verifiedOnline: true },
  getToken: async () => null,
  isCurrent: () => runtime.current,
};
const staleAccess: PrivateSessionAccess = { ...access, isCurrent: () => true };

function syntheticLoan(): SavedLoanPayload {
  return {
    loan: { lender: `Synthetic ${account}`, original: 100000, outstanding: 95000, ratePct: 8, basis: "fixed", spreadPct: null, spreadProvenance: "unknown", cycle: "monthly", lastReset: "", lastResetProvenance: "unknown", monthsLeft: 120 },
    quote: { newRatePct: 7.5, feePct: 1, legalCharges: 250, keepTenure: true, newTenureMonths: 120 },
    surplus: 10000,
    bufferMonths: 3,
    rateResolvedAt: null,
  };
}

function syntheticOffers() {
  return [
    { id: uuid(account === "A" ? 101 : 201), lender: `Synthetic ${account} Alpha`, loanType: "home" as const, amount: 100000, ratePct: 8, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 120, tenureUnit: "months" as const, processingFee: { mode: "percent" as const, value: 1 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "upfront" as const, otherFees: [] },
    { id: uuid(account === "A" ? 102 : 202), lender: `Synthetic ${account} Beta`, loanType: "home" as const, amount: 100000, ratePct: 8.5, rateType: "reducing" as const, rateStructure: "fixed" as const, tenureValue: 120, tenureUnit: "months" as const, processingFee: { mode: "percent" as const, value: 0.5 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "upfront" as const, otherFees: [] },
  ];
}

function resultPayload(): AnyResult {
  return { account, persistedBothDbRowcounts: { loan: { total: 0, member: 0 }, comparison: { total: 0, member: 0 } }, capturedWriterResult, signalReceiptCount, guestSentinelPreserved: localStorage.getItem(GUEST_SENTINEL) === "guest-data-preserved", clearResult };
}

function show(value: AnyResult): void {
  const output = document.querySelector<HTMLPreElement>("#output");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error ?? new Error("request failed")); });
}

async function countStore(db: IDBDatabase, storeName: string, profileKey: string | ((value: unknown) => boolean)): Promise<{ total: number; member: number }> {
  const transaction = db.transaction(storeName, "readonly");
  const rows = await request(transaction.objectStore(storeName).getAll()) as unknown[];
  const member = typeof profileKey === "function" ? rows.filter(profileKey).length : rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const record = row as Record<string, unknown>;
    return record.partitionKey === profileKey || record.profileId === profileKey;
  }).length;
  return { total: rows.length, member };
}

async function inspectStorage(): Promise<AnyResult> {
  if (!validOrigin) return { ...resultPayload(), error: "Use http://127.0.0.1:3338 before inspecting synthetic storage." };
  const privateDb = await openPrivateDatabase();
  const comparisonDb = await openComparisonDatabase();
  try {
    const [loanRows, comparisonRows] = await Promise.all([
      countStore(privateDb, PRIVATE_STORE_NAME, profileId),
      countStore(comparisonDb, COMPARISON_PRIVATE_STORE, (row) => !!row && typeof row === "object" && ((row as Record<string, unknown>).profileId === profileId)),
    ]);
    const value = { ...resultPayload(), persistedBothDbRowcounts: { loan: loanRows, comparison: comparisonRows }, guestSentinelPreserved: localStorage.getItem(GUEST_SENTINEL) === "guest-data-preserved" };
    show(value);
    return value;
  } finally { privateDb.close(); comparisonDb.close(); }
}

async function seed(): Promise<void> {
  if (!validOrigin) { show({ ...resultPayload(), error: "Use http://127.0.0.1:3338 before seeding synthetic storage." }); return; }
  if (seeded) { await inspectStorage(); return; }
  localStorage.setItem(GUEST_SENTINEL, "guest-data-preserved");
  loan = new PrivateStorage({ now });
  const unlocked = await loan.unlock(access.identity);
  if (unlocked.kind !== "ok") throw new Error(`loan unlock: ${unlocked.kind}`);
  loanGuard = loan.captureGuard();
  const saved = await loan.applyServerState({ revision: 1, payload: syntheticLoan() }, loanGuard ?? undefined);
  if (saved.kind !== "ok") throw new Error(`loan cache: ${saved.kind}`);
  const queued = await loan.queueSaveLoan({ requestId: uuid(account === "A" ? 111 : 211), expectedRevision: 1, createdAt: new Date(now()).toISOString(), payload: syntheticLoan() }, loanGuard ?? undefined);
  if (queued.kind !== "ok") throw new Error(`loan queue: ${queued.kind}`);

  const offers = syntheticOffers();
  snapshot = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: new Date(now()).toISOString() });
  workspace = new ComparisonWorkspace({ access, tabId: `synthetic-${account.toLowerCase()}` });
  const opened = await workspace.open();
  if (opened.kind !== "ok") throw new Error(`comparison open: ${opened.code}`);
  const working = await workspace.setWorking({ draft: { loanType: "home", offers }, snapshot });
  if (working.kind !== "ok") throw new Error(`comparison draft: ${working.code}`);
  const savedComparison = await workspace.queueSave({ snapshot, source: "member", createdAt: new Date(now()).toISOString(), requestId: uuid(account === "A" ? 121 : 221) });
  if (savedComparison.kind !== "ok") throw new Error(`comparison queue: ${savedComparison.code}`);

  // This second runtime keeps a mocked-current access guard. After the clear,
  // its mutation must still fail at the durable browser epoch check.
  staleWorkspace = new ComparisonWorkspace({ access: staleAccess, tabId: `stale-${account.toLowerCase()}` });
  const staleOpened = await staleWorkspace.open();
  if (staleOpened.kind !== "ok") throw new Error(`stale comparison open: ${staleOpened.code}`);
  comparisonCleanup = workspace.captureFormerAccountCleanup(access, true);
  seeded = true;
  await inspectStorage();
}

async function clearSynthetic(): Promise<void> {
  if (!validOrigin) { show({ ...resultPayload(), error: "Use http://127.0.0.1:3338 before clearing synthetic storage." }); return; }
  if (!seeded) { show({ ...resultPayload(), error: "Seed this tab before clearing." }); return; }
  // The clear coordinator retains its own lifetime guard. Signal receipt
  // revokes the old store/session guard in this tab before IDB deletion.
  publishPrivateBrowserClearSignal();
  clearResult = await clearAllMemberPrivateBrowserData({ confirmed: true, isCurrent: () => true });
  await inspectStorage();
}

async function checkStaleWrites(): Promise<void> {
  if (!seeded || !loan || !workspace || !snapshot) { show({ ...resultPayload(), error: "Seed synthetic data first." }); return; }
  const payload = syntheticLoan();
  const staleLoan = await loan.queueSaveLoan({ requestId: uuid(account === "A" ? 131 : 231), expectedRevision: 1, createdAt: new Date(now()).toISOString(), payload }, loanGuard ?? undefined);
  const revokedComparison = await workspace.setWorking({ draft: { loanType: "home", offers: syntheticOffers() }, snapshot });
  const durableComparison = staleWorkspace ? await staleWorkspace.setWorking({ draft: { loanType: "home", offers: syntheticOffers() }, snapshot }) : { kind: "error", code: "not-open" };
  const captured = comparisonCleanup ? await comparisonCleanup.run() : { kind: "missing" };
  capturedWriterResult = { loan: staleLoan, comparison: revokedComparison, durableComparison, capturedCleanup: captured };
  await inspectStorage();
}

function mount(): void {
  document.title = `Private browser harness ${account}`;
  document.body.innerHTML = `<main><h1>Private browser harness - account ${account}</h1><p>Origin: <code>${location.origin}</code>. Synthetic only.</p><button id="seed">Seed synthetic account ${account}</button><button id="clear">Clear synthetic private data</button><button id="stale">Check stale writes</button><button id="inspect">Inspect storage</button><div id="confirm" hidden><button id="confirm-clear">Confirm clear synthetic private data</button></div><pre id="output"></pre></main>`;
  document.querySelector<HTMLButtonElement>("#seed")!.onclick = () => { void seed().catch((error) => show({ ...resultPayload(), error: String(error) })); };
  document.querySelector<HTMLButtonElement>("#clear")!.onclick = () => { confirmVisible = true; document.querySelector<HTMLElement>("#confirm")!.hidden = !confirmVisible; };
  document.querySelector<HTMLButtonElement>("#confirm-clear")!.onclick = () => { confirmVisible = false; document.querySelector<HTMLElement>("#confirm")!.hidden = true; void clearSynthetic().catch((error) => show({ ...resultPayload(), error: String(error) })); };
  document.querySelector<HTMLButtonElement>("#stale")!.onclick = () => { void checkStaleWrites().catch((error) => show({ ...resultPayload(), error: String(error) })); };
  document.querySelector<HTMLButtonElement>("#inspect")!.onclick = () => { void inspectStorage().catch((error) => show({ ...resultPayload(), error: String(error) })); };
  if (!validOrigin) show({ ...resultPayload(), error: "Harness actions require http://127.0.0.1:3338." });
  else show(resultPayload());
}

subscribeToPrivateBrowserClearSignal(() => { signalReceiptCount += 1; runtime.current = false; show(resultPayload()); });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
