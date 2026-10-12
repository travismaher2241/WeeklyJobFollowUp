# Plasgain Job Follow Up — acceptance and security test report

Tested 2 October 2026 (Australia/Sydney).

**Verdict: the basic customer experience works, but this build is not ready to send to customers.** There are confirmed security and data-integrity failures against the original brief.

**51 checks: 23 passed, 28 failed.** These are individual acceptance checks, not 28 distinct defects; several checks expose the same underlying problem. The supplied nine-step integration test also passes, but covers only a narrow happy path and direct database calls.

## Scope and evidence

- Read the server routes, SQLite schema and operations, Excel parser, date utilities, all relevant admin/customer views, existing test, and deployment configuration.
- Tested actual HTTP upload, preview, commit, public review, submission, admin reads and mutations.
- Ran Chromium browser interactions for upload/cancel/commit, copying links, marking sent, confirmation, date changes, contact requests and error-prone editing.
- Checked desktop 1440×1000, tablet 768×1024, phone 390×844, and small phone 320×740 layouts. Inspected screenshots visually.
- Read the original Ostendo sample referenced in the existing test: 127 open jobs, 25 customers. Browser screenshots use synthetic customer data.
- All application writes used an isolated in-memory database. The existing `plasgain.db` was not opened by this audit. No live deployment was modified and no messages or links were sent to customers.
- The first browser attempt could not load Tailwind because of sandbox network restrictions. Those invalid visual results were replaced by a successful network-enabled browser run. They are not counted as app failures.
- Ran `npm audit`: one high-severity vulnerable dependency, `xlsx`, with two reported advisories. No packages were changed.

Evidence: [individual results](test/audit-results/results.json), [test harness](test/full-audit.js), [original test output](test/audit-results/original-suite.log), [browser errors](test/audit-results/browser-errors.json).

## Fix before sending customer links

### 1. Admin pages and mutations are completely unprotected — critical

**Reproduction:** open `/admin` in a fresh browser without credentials. It returns HTTP 200 with every customer and their review links. An unauthenticated POST to `/admin/settings/base-url` also persists a changed URL. Upload and commit routes have the same absence of protection.

**Impact:** anyone who can reach the application can access other customers through the admin dashboard, obtain their tokens, import records and alter settings. Long public review tokens do not protect this access path.

**Location:** `server.js:66` onwards; no admin authentication middleware exists.

**Minimum correction:** protect the entire `/admin` route group, including POST routes, with simple server-side authentication suitable for this MVP. Keep customer token pages public. Protect authenticated mutations against cross-site requests.

### 2. Customer submissions do not enforce job ownership or validate their contents — high

**Reproduction:** POST to Alpha's `/review/<token>/submit` using Beta's numeric job ID. The server returns HTTP 200 and records Beta's job under Alpha's response. Alpha's admin response then displays Beta's description and PO. The imported job itself is not overwritten by this exploit, but the response record is contaminated.

The same endpoint accepts:

- A confirmation with zero jobs.
- An unknown response type.
- A forged original date of `1900-01-01`.
- A requested date of `2026-99-99`.
- Duplicate response items.
- Job IDs from an older import after the customer list has changed.

**Location:** `server.js:237`, `db.js:413` and `db.js:445`.

**Minimum correction:** resolve the review request and its allowed snapshot on the server; derive original dates from stored records; validate response type, unique job membership, completeness and real calendar dates; reject stale or mismatched submissions atomically.

### 3. Imported spreadsheet text can execute JavaScript — high

**Reproduction:** use a synthetic description containing an image element with an `onerror` handler, open its review link, change a date and open the summary. A harmless test flag (`window.auditXss`) becomes true, demonstrating script execution. No data was sent anywhere.

**Cause:** descriptions, purchase orders and optional comments are interpolated into `row.innerHTML` in the change summary. EJS escaping on the initial page does not protect data read back from HTML attributes and reinserted as markup.

**Location:** `views/customer/review.ejs:473` through `:510`.

**Minimum correction:** construct the summary using DOM nodes and `textContent` for all customer/imported strings.

### 4. Imports are not complete snapshots — high

**Reproduction:** import Alpha and Beta, then import a file containing only Alpha. The dashboard still shows two open jobs, including Beta's obsolete job. Jobs are deactivated only for customers present in the new file.

An export containing no open jobs is refused, so the app cannot clear the last remaining open jobs. Duplicate Job Order Numbers within an import also create duplicate active jobs.

**Location:** `db.js:126`, `db.js:146`, `server.js:125`.

**Minimum correction:** atomically replace the complete active set from a validated snapshot, including customers absent from the file; allow a deliberately confirmed zero-open snapshot; detect conflicting/duplicate Job Order Numbers. Keep historical snapshot rows separately or inactive as appropriate.

### 5. Old confirmations and links silently carry over to new dates — high

**Reproduction:** confirm a job with required date 15/10/2026, then import that job with 20/11/2026. The same customer remains **Confirmed**, while the public link displays the new date that was never confirmed. A link marked sent also switches to the new date after re-import. A stale browser tab can submit the old job IDs and still mark the review confirmed.

**Impact:** the dashboard can say a customer has confirmed dates they have never reviewed. There is no immutable relationship between a sent request and the jobs/dates sent. `sent_at` is overwritten each time “Mark as Sent” is used.

**Location:** `db.js:131`, `db.js:173`, `db.js:334`, `db.js:367`.

**Minimum correction:** associate each review request with an immutable import/job snapshot, preserve its sent/response history, and start a fresh pending review cycle when the current dates or job set change. Existing response items do retain their original date values; that part works.

### 6. The real export has no Job Order Number — high, requires export mapping correction

The sample contains only `Status`, `Customer`, `Description`, `Purchase Order`, and `Required Date`. **None of its 127 rows has an explicit Job Order Number.** The parser silently invents identifiers from PO or spreadsheet row position. Neither is a reliable primary job identifier.

The admin current-jobs table also omits Job Order Number, and the response table prefers PO over the actual job number.

**Location:** `lib/excel-parser.js:94`, `views/admin/customer-detail.ejs:144` and `:213`.

**Minimum correction:** include the real Job Order Number in the Ostendo export, explicitly validate/map it, warn or reject missing identifiers, and display job number separately from PO. This needs to be resolved before claiming reliable job reconciliation across uploads.

### 7. Deployment does not configure the database to use its persistent disk — high

`render.yaml` creates a disk mounted at `/data`, but does not set `DB_PATH`. `db.js:7` defaults to `plasgain.db` beside the application source, outside that mount.

**Impact:** deployments using this checked-in configuration risk losing imports and response history when the application filesystem is replaced. This is a source/configuration finding; the live hosting environment was not inspected, so an external override may already exist.

**Minimum correction:** configure `DB_PATH=/data/plasgain.db` in the deployment and verify persistence across an actual redeploy before launch.

### 8. The Excel dependency has reported high-severity vulnerabilities — high

`npm audit` reports the installed `xlsx` version as affected by [SheetJS prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [SheetJS regular expression denial of service](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9). The audit reports no automatic npm fix available.

This is advisory matching, not an exploit test. Review a maintained, patched distribution or parser alternative, then rerun both `.xls` and `.xlsx` import checks. Do not assume `npm audit fix` resolves it.

## Other reproduced defects

| Finding | Reproduction / consequence | Location |
|---|---|---|
| Cleared comments remain | Type a contact comment, erase it, open the summary: deleted text still appears and is in submission state. | `views/customer/review.ejs:379` |
| Cleared dates remain | Select 06/11/2026, clear the date field, open summary: 06/11/2026 is still pending. | `views/customer/review.ejs:313` |
| Hidden contact requests remain selected | Click “Please contact me” twice: the panel hides but “SUBMIT CHANGES (1)” remains. | `views/customer/review.ejs:336` |
| Impossible import dates accepted | `31/02/2026` becomes `2026-02-31` rather than an invalid-row warning. | `lib/date-utils.js:29` |
| 1904-system workbook dates shifted | A workbook date intended as 15/10/2026 imported as 14/10/2022. | `lib/excel-parser.js:23`, `lib/date-utils.js:9` |
| Wrong response time | Database timestamp `2026-10-02 00:00:00` displayed as 12:00 AM instead of 10:00 AM Sydney time. SQLite UTC timestamps are parsed without a timezone and output uses the host's local timezone. | `lib/date-utils.js:68` |
| Changed-date counts accumulate | Submit one changed date twice: customer list reports two changed dates. | `db.js:238` |
| Latest response ties choose earlier response | Two response rows with the same second select the first row, not the newest ID. | `db.js:297`, `db.js:381` |
| Certain customer names crash import | A valid customer named `constructor` causes `jobsByCustomer[...].push is not a function`. Use `Map` or a dictionary without a prototype. | `db.js:138` |

Additional source-review observations: preview shows only the first five excluded rows with no way to inspect the rest; the sample-count label says ten while the template can render fifteen; customer viewport disables pinch zoom; contact/date actions are relatively small on phone screens. These observations are not separate checks in the 51-check total.

## Verified working

- Both Excel formats import ordinary valid rows, group customers, and exclude non-open statuses.
- The actual sample parses to the expected 127 jobs and 25 customers.
- Upload preview does not commit data; cancel leaves data unchanged; duplicate commit does not duplicate the import.
- Unsupported extensions and missing uploads are handled.
- Repeat import of the same complete customer set avoids duplicate **active** rows; prior response values remain stored.
- Tokens are distinct 40-character hex values produced by 20 random bytes. Altered tokens return 404. Direct public review GETs show only their associated customer.
- Copy link and “Mark as Sent” work in the browser.
- Date fields are hidden initially. One click confirms every displayed job and opens the success page with a recorded timestamp.
- Changing one date shows the old/new comparison before submission. Other jobs need no individual confirmation.
- Optional contact requests can be submitted with no comment.
- Customer changes do not overwrite imported required dates, and admin displays requested dates.
- Explicit “Cancel / Keep Original” restores the normal confirmation action.
- Customer search and status filters return the expected data.
- A response containing a nonexistent foreign-key job ID rolls back atomically. This does not prevent cross-customer IDs that do exist.
- Standard desktop, tablet and phone layouts fit horizontally, keep the primary action visible, and initially hide date inputs. Phone change/contact submission completes.
- No uncaught page errors or failed browser requests were recorded in the completed browser run.

The automated one-click confirmation took approximately 98 ms from click to persisted response/success navigation in the local test. This supports the low-click design but is **not** evidence that a human can inspect every customer's complete job list in under a minute.

Screenshots: [desktop review](test/audit-results/review-desktop.png), [tablet](test/audit-results/review-tablet.png), [phone](test/audit-results/review-mobile.png), [small phone](test/audit-results/review-small-mobile.png), [phone change summary](test/audit-results/change-summary-mobile.png), [admin customer view](test/audit-results/admin-customer-desktop.png).

## Reproduce the audit

Run `node test/full-audit.js` from this project directory. It overrides `DB_PATH` to `:memory:` before loading the app, starts an ephemeral localhost server, generates temporary Excel fixtures, and writes results under `test/audit-results`. It now exits nonzero when checks fail.

Browser tests use the bundled Playwright package at the workstation path in the harness; `AUDIT_PLAYWRIGHT` can override that path. Chromium must be installed and the browser must be allowed to fetch `https://cdn.tailwindcss.com`. One sample check and the supplied test reference the original local Downloads path.

The existing `npm test` script is still a placeholder that exits with an error. The original `test/e2e-test.js` uses the main database unless `DB_PATH` is supplied; always isolate it when testing. This audit ran it with `DB_PATH=:memory:`.

## Completed / next

**Completed:** local acceptance, database/API, targeted security, dependency, and responsive-browser audit; reproducible tests, screenshots and this report. Application code and dependency versions were not changed.

**Next:** fix the launch blockers above, resolve the real Job Order Number export mapping, repair the editing/date/reporting defects, then rerun the audit and verify live authentication and database persistence in the intended hosting environment.

Limits: no production URL was provided or exercised; no physical iOS/Safari/Android testing, accessibility certification, sustained load test, destructive denial-of-service test, or exhaustive penetration test was performed. No later features have been added to scope.
