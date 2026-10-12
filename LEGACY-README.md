# Plasgain Job Follow Up

A simple, low-friction internal web application for **Plasgain** to follow up open Job Orders from Ostendo and allow customers to confirm or amend their Required Dates in under one minute.

---

## Key Features & UX Design

- **One-Click Confirmation:** Customers review their open jobs and can confirm all required dates with a single click (**"CONFIRM ALL CURRENT DATES"**).
- **Frictionless Date Changes:** Editable date fields are not exposed by default. Customers click small **"Change Date"** buttons only on affected jobs, keeping the interface clean and effortless.
- **Optional Contact Request:** Individual jobs can be marked *"Please contact me about this order"* with an optional comment (e.g. site access delayed).
- **Secure Tokenized Review URLs:** Customers access their specific job list via random, unguessable URLs (`/review/:token`). **No accounts, passwords, or logins required.**
- **Snapshot & Audit History:** Re-uploading Ostendo exports updates active jobs without overwriting historical customer responses or audit timestamps.
- **Visual Diff Dashboard:** If a customer requests date changes, the internal admin dashboard clearly highlights original vs. requested dates side-by-side.
- **Australian Date Formatting:** All dates are handled and displayed in `DD/MM/YYYY`.

---

## Quick Start

### 1. Install & Start

```bash
# Start the web server (defaults to port 3000)
npm start
```

Open your browser to:
[http://localhost:3000](http://localhost:3000)

### 2. Run Tests

An automated end-to-end integration test suite is included:

```bash
node test/e2e-test.js
```

---

## Typical Workflow

1. **Upload Ostendo Export:**
   - Go to [http://localhost:3000/admin/upload](http://localhost:3000/admin/upload).
   - Upload your `Job Orders.xls` or `.xlsx` file.
   - The parser automatically filters records where `Status = 'Open'` (ignoring closed, completed, or lost jobs).
2. **Import Preview:**
   - Review open jobs count, customer count, snapshot date, and any skipped rows.
   - Click **"Confirm & Commit Import"**.
3. **Dispatch Customer Links:**
   - In the dashboard, click **"Copy Link"** next to any customer, or click **"View Jobs &rarr;"**.
   - Paste the link into your customer follow-up email.
   - Click **"Mark as Sent"** to track which customers have been notified.
4. **Customer Response:**
   - The customer opens their unique link on mobile, tablet, or desktop.
   - **Scenario A (Dates correct):** They click **"CONFIRM ALL CURRENT DATES"**. Done!
   - **Scenario B (Dates changed):** They click **"Change Date"** on affected jobs, pick new dates, and click **"SUBMIT CHANGES"**.
5. **Review Dashboard:**
   - Admin view displays status badges: `Not Sent`, `Awaiting Response`, `Confirmed`, `Changes Submitted`.
   - Clicking on a customer who submitted changes displays the side-by-side date comparison to update Ostendo manually.
