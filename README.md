# Plasgain customer follow-up spreadsheets

A small internal utility that turns an Ostendo export into one Excel attachment per customer.

## Work laptop: no installation

Copy **`portable/Plasgain Job Follow Up.html`** to the work laptop using your normal approved file-transfer method. Open it with the laptop's existing Edge or Chrome browser. Only that one HTML file is needed: it includes the code, Excel reader, ZIP library and workbook template. It does not use a server, need internet access, upload customer data, or depend on the home computer.

Choose the Ostendo export, check the preview, select **Prepare customer files**, then download an individual Excel attachment or all files as a ZIP. Outputs go to the browser's normal Downloads location. The HTML file itself contains no customer data. Closing or refreshing it clears the loaded export; already-downloaded files remain on the laptop.

The portable edition was tested from a `file:` URL with the browser set offline, using the actual 127-job/25-customer export, and made zero network requests. Corporate policies governing local HTML files and downloads still apply; no work-laptop policy has been changed or bypassed.

For development only: `npm run build:portable` rebuilds the single HTML file and `npm run test:portable` runs its offline browser tests. These commands are **not needed on the work laptop**. The portable and server versions share parsing, date validation and worksheet layout logic.

## Optional server version

```sh
npm install
npm start
```

Open http://127.0.0.1:3000. By default the server listens on this computer only.

## Weekly workflow

1. Upload the Ostendo `.xls` or `.xlsx` export.
2. Review the customer/job totals and any excluded rows.
3. Select **Prepare customer files**.
4. Download one customer's Excel file, or **Download all customer files (.zip)**.
5. Attach each customer's file to your own email. Customers reply “All dates confirmed” or enter confirmed or estimated dates and comments and email the file back.

Each workbook has one **Upcoming Jobs** worksheet: order description, PO number, delivery date, blank confirmed date, blank estimated date, and optional comments. Original delivery dates remain separate. Editable cells are yellow. Dates are numeric Excel dates displayed as `DD/MM/YYYY`; PO references remain text. There are no macros, per-row confirmation requirements, or formulas in the editable cells. If an actual Job Order Number is supplied, it is included below the description.

The first worksheet must have headings in row 1: Status, Customer, Description, Purchase Order, Required Date. Common heading aliases are supported. Only Open rows are included. Missing customers and invalid calendar dates are listed in the preview. Duplicate explicit Job Order Numbers stop the import. Missing job numbers are not invented; the supplied export works using description and PO for this manual email workflow. Files up to 25 MB and 10,000 source rows are accepted.

Each upload is an independent batch; earlier customer records cannot leak into the next export. Upload data is held in memory for eight hours and disappears on restart. Download files before closing the app. No emails are sent and returned spreadsheets are not automatically imported.

## Network hosting

Local use needs no account. To listen on a network interface, set `HOST=0.0.0.0` and `ADMIN_PASSWORD` before starting. Sign in as **admin** with that password. The app refuses to start on a network interface without a password. Use HTTPS when hosted remotely. `render.yaml` requires the password to be supplied during setup. No persistent disk is needed for this in-memory workflow.

## Verification

```sh
npm test
npm run test:browser
```

`npm test` covers parsing, customer isolation, calendar dates, workbook contents, special characters, ZIPs, and HTTP download/preview/authentication behavior. The browser test uses the local bundled Playwright path (override with `PLAYWRIGHT_PATH`) and the original Ostendo sample's Downloads path. It verifies the real 127-job/25-customer upload, search, downloads and mobile layout. Generated test files are under `test/export-results`.

The export template at `templates/customer-follow-up.xlsx` was authored with Artifact Tool. `tools/spreadsheet/build-template.mjs` rebuilds it in the Codex bundled runtime; the deployed application needs only the checked-in template. Runtime exports populate its styled worksheet rows using `adm-zip`, without requiring Excel or the authoring runtime. Export tests check native XLSX date types and literal text handling.

The Excel parser uses the publisher's documented [SheetJS distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), rather than the older npm registry release.

## Previous version

The original database and review implementation are retained as historical files. `legacy-review-server.js`, `db.js`, the old views and `LEGACY-README.md` are not used by `npm start`. The original public review URLs and submission endpoints are disabled in the new app. `TEST-REPORT.md` describes the previous build, not this replacement workflow. The historical integration/audit suites target that previous workflow; use `npm test` for the active app.

## Progress

**Completed:** upload/preview, individual customer workbooks, all-customer ZIP, customer search/job preview, simplified local interface, input validation, optional hosting password, automated and browser verification.

**Next:** use the next weekly export, download the files and email each customer their attachment.

**Later:** no additional features agreed.
