/** Disposable integration evidence for the explicitly approved development project. */
import { loadEnvFile } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { ConvexHttpClient } from 'convex/browser';

loadEnvFile('.env.local');
const target = 'https://dutiful-fly-37.convex.cloud';
const issuer = 'https://live-tarpon-2666.clerk.accounts.dev';
const report = { capturedAt: new Date().toISOString(), deployment: 'dev:dutiful-fly-37', checks: [], sourceHashes: {}, limitations: ['Synthetic development identities only; no real email delivery or private UI proof.'], cleanup: [] };
const sessions = [];
const records = [];
const check = (name, pass) => {
  report.checks.push({ name, pass: Boolean(pass) });
  if (!pass) throw new Error(name);
};
const stamp = () => new Date(Date.now() - 3000).toISOString();
const clerk = async (path, method = 'GET', body) => {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Clerk test request failed (${response.status})`);
  return response.json();
};
const client = () => new ConvexHttpClient(target, { logger: false });
async function signedClient(email) {
  const found = await clerk(`/users?email_address=${encodeURIComponent(email)}&limit=10`);
  const users = Array.isArray(found) ? found : found.data;
  const matches = users.filter(user => user.email_addresses?.some(address => address.email_address === email));
  check('Selected exactly one existing reserved synthetic user', matches.length === 1);
  const session = await clerk('/sessions', 'POST', { user_id: matches[0].id });
  sessions.push(session.id);
  const connection = client();
  const refresh = async () => {
    const { jwt } = await clerk(`/sessions/${session.id}/tokens`, 'POST', {});
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    check('Test token bound to expected Clerk issuer and Convex audience', claims.iss === issuer && (claims.aud === 'convex' || claims.aud?.includes('convex')));
    connection.setAuth(jwt);
  };
  await refresh();
  return { connection, refresh, profileArgs: { expectedSubject: matches[0].id, sessionMarker: session.id } };
}
async function denied(name, operation) {
  let rejected = false;
  try { await operation(); } catch { rejected = true; }
  check(name, rejected);
}
let failed = false;
try {
  check('Only approved development target and Clerk test keys selected',
    process.env.CONVEX_DEPLOYMENT === 'dev:dutiful-fly-37' &&
    process.env.NEXT_PUBLIC_CONVEX_URL === target &&
    process.env.CLERK_SECRET_KEY?.startsWith('sk_test_') &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_'));
  const bundle = await build({
    stdin: { contents: 'export { compareOffers } from "./lib/finance/comparison"; export { createComparisonSnapshot, serializeComparisonSnapshot } from "./lib/contracts/snapshot";', resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  });
  const { compareOffers, createComparisonSnapshot, serializeComparisonSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const offers = [8.5, 9].map((ratePct, index) => ({ id: `test-offer-${index}`, lender: `Synthetic lender ${index + 1}`, loanType: 'home', amount: 1000000, ratePct, rateType: 'reducing', rateStructure: 'floating', tenureValue: 20, tenureUnit: 'years', processingFee: { mode: 'percent', value: 0.5 }, gstPct: 18, insurancePremium: 0, insuranceFunding: 'upfront', otherFees: [] }));
  const snapshot = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: new Date(Date.now() - 30 * 86400000).toISOString() });
  const request = { requestId: randomUUID(), snapshot: serializeComparisonSnapshot(snapshot), createdAt: stamp(), title: 'Synthetic development comparison', source: 'guest' };
  const anonymous = client();
  await denied('Anonymous list denied', () => anonymous.query('comparisons:listComparisons', { paginationOpts: { numItems: 10, cursor: null } }));
  await denied('Anonymous save denied', () => anonymous.mutation('comparisons:saveComparison', request));
  await denied('Anonymous delete denied', () => anonymous.mutation('comparisons:deleteComparison', { requestId: randomUUID(), resultId: snapshot.resultId, createdAt: stamp() }));
  const a = await signedClient('truecost-isolation-a+clerk_test@example.com');
  const b = await signedClient('truecost-isolation-b+clerk_test@example.com');
  const profileA = await a.connection.query('users:currentUser', a.profileArgs);
  const profileB = await b.connection.query('users:currentUser', b.profileArgs);
  check('Two distinct active Convex profiles verified', profileA?.status === 'active' && profileB?.status === 'active' && profileA._id !== profileB._id);
  records.push({ account: a, resultId: snapshot.resultId });
  const saved = await a.connection.mutation('comparisons:saveComparison', request);
  check('Older guest result saved with fresh request timestamp', saved.status === 'saved');
  const row = await a.connection.query('comparisons:getComparison', { comparisonId: saved.comparisonId });
  check('Canonical snapshot and calculation timestamp preserved exactly', row?.snapshot === request.snapshot && JSON.parse(row.snapshot).createdAt === snapshot.createdAt);
  check('Foreign direct comparison ID returns unavailable', await b.connection.query('comparisons:getComparison', { comparisonId: saved.comparisonId }) === null);
  const listB = await b.connection.query('comparisons:listComparisons', { paginationOpts: { numItems: 50, cursor: null } });
  check('Other owner list excludes the saved comparison', listB.status === 'ok' && listB.result.page.every(item => item._id !== saved.comparisonId));
  const repeats = await Promise.all([a.connection.mutation('comparisons:saveComparison', request), a.connection.mutation('comparisons:saveComparison', request)]);
  check('Concurrent same-request retries return original acknowledgement', repeats.every(result => result.status === 'replayed' && result.comparisonId === saved.comparisonId));
  const changed = await a.connection.mutation('comparisons:saveComparison', { ...request, title: 'Changed content' });
  check('Changed request reuse rejected', changed.code === 'request_reuse');
  const duplicate = { ...request, requestId: randomUUID() };
  check('Second request for same result does not create another row', (await a.connection.mutation('comparisons:saveComparison', duplicate)).status === 'replayed');
  check('Duplicate acknowledgement also protects its request ID', (await a.connection.mutation('comparisons:saveComparison', { ...duplicate, title: 'Changed duplicate' })).code === 'request_reuse');
  await denied('Client cannot choose another owner', () => a.connection.mutation('comparisons:saveComparison', { ...request, ownerId: profileB._id }));
  check('Malformed snapshot rejected safely', (await a.connection.mutation('comparisons:saveComparison', { ...request, requestId: randomUUID(), snapshot: '{bad json' })).status === 'error');
  check('Overlarge page count rejected', (await a.connection.query('comparisons:listComparisons', { paginationOpts: { numItems: 51, cursor: null } })).code === 'invalid_number');
  const foreignDelete = await b.connection.mutation('comparisons:deleteComparison', { requestId: randomUUID(), resultId: snapshot.resultId, createdAt: stamp() });
  check('Foreign delete exposes no comparison identifier', foreignDelete.comparisonId === null);
  check('Foreign delete cannot remove owner record', (await a.connection.query('comparisons:getComparison', { comparisonId: saved.comparisonId }))?.snapshot === request.snapshot);
  const snapshot2 = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: stamp() });
  records.push({ account: a, resultId: snapshot2.resultId });
  const secondRequest = { ...request, requestId: randomUUID(), snapshot: serializeComparisonSnapshot(snapshot2), createdAt: stamp() };
  // Reuse one canonical occurrence time for this fresh calculation and save.
  secondRequest.createdAt = snapshot2.createdAt;
  check('Second result saved independently', (await a.connection.mutation('comparisons:saveComparison', secondRequest)).status === 'saved');
  const firstPage = await a.connection.query('comparisons:listComparisons', { paginationOpts: { numItems: 1, cursor: null } });
  check('Newest-first page returns bounded result and cursor', firstPage.status === 'ok' && firstPage.result.page.length === 1 && firstPage.result.page[0].resultId === snapshot2.resultId && !firstPage.result.isDone);
  const nextPage = await a.connection.query('comparisons:listComparisons', { paginationOpts: { numItems: 1, cursor: firstPage.result.continueCursor } });
  check('Cursor advances to the previous owned result', nextPage.status === 'ok' && nextPage.result.page[0]?.resultId === snapshot.resultId);
  const deletion = { requestId: randomUUID(), resultId: snapshot.resultId, createdAt: stamp() };
  check('Owner delete acknowledged', (await a.connection.mutation('comparisons:deleteComparison', deletion)).status === 'deleted');
  check('Deleted record no longer readable', await a.connection.query('comparisons:getComparison', { comparisonId: saved.comparisonId }) === null);
  check('Delete retry returns historical acknowledgement', (await a.connection.mutation('comparisons:deleteComparison', deletion)).status === 'replayed');
  check('Historical save replay acknowledges without recreating data', (await a.connection.mutation('comparisons:saveComparison', request)).status === 'replayed' && await a.connection.query('comparisons:getComparison', { comparisonId: saved.comparisonId }) === null);
  check('New delayed save cannot resurrect deleted result', (await a.connection.mutation('comparisons:saveComparison', { ...request, requestId: randomUUID() })).status === 'blocked');
  const unsaved = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: stamp() });
  check('Delete-before-save creates a guard', (await a.connection.mutation('comparisons:deleteComparison', { requestId: randomUUID(), resultId: unsaved.resultId, createdAt: stamp() })).status === 'deleted');
  check('Later first save cannot bypass prior deletion', (await a.connection.mutation('comparisons:saveComparison', { ...request, requestId: randomUUID(), snapshot: serializeComparisonSnapshot(unsaved), createdAt: stamp() })).status === 'blocked');
} catch (error) {
  failed = true;
  // No provider payload, token, URL query or private data is written to evidence.
  report.failure = report.checks.at(-1)?.pass === false ? report.checks.at(-1).name : 'Provider invocation or test setup failed before the next assertion';
} finally {
  for (const record of records) {
    try {
      await record.account.refresh();
      const out = await record.account.connection.mutation('comparisons:deleteComparison', { requestId: randomUUID(), resultId: record.resultId, createdAt: stamp() });
      report.cleanup.push({ action: 'Remove this run synthetic comparison payload', pass: ['deleted', 'replayed'].includes(out.status) });
    } catch { report.cleanup.push({ action: 'Remove this run synthetic comparison payload', pass: false }); }
  }
  for (const sessionId of sessions) {
    try { await clerk(`/sessions/${sessionId}/revoke`, 'POST', {}); report.cleanup.push({ action: 'Revoke this run temporary session', pass: true }); }
    catch { report.cleanup.push({ action: 'Revoke this run temporary session', pass: false }); }
  }
  for (const path of ['convex/comparisons.ts', 'convex/schema.ts', 'lib/contracts/snapshot.ts', 'package-lock.json']) {
    report.sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  report.finishedAt = new Date().toISOString();
  report.pass = !failed && report.cleanup.every(item => item.pass);
  await writeFile('docs/evidence/development-comparisons.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pass: report.pass, assertions: report.checks.length, passed: report.checks.filter(item => item.pass).length, cleanup: report.cleanup, evidence: 'docs/evidence/development-comparisons.json' }));
  if (!report.pass) process.exitCode = 1;
}
