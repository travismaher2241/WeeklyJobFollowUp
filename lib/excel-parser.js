// lib/excel-parser.js
const xlsx = require('xlsx');
const { parseExcelDate, formatDateAU } = require('./export-dates');

function normalizeHeader(header) {
  if (!header) return '';
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumnKey(rowKeys, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    for (const key of rowKeys) {
      if (normalizeHeader(key) === normalizedAlias) {
        return key;
      }
    }
  }
  return null;
}

function parseJobOrdersFile(filePath, originalFilename = 'Job Orders.xls') {
  const wb = filePath instanceof Uint8Array ? xlsx.read(filePath, { type: 'array', cellDates: false }) : xlsx.readFile(filePath, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: '', blankrows: true });
  if (rawRows.length > 10000) throw new Error('Please export fewer than 10,000 rows at a time.');

  if (!rawRows || rawRows.length === 0) {
    return {
      filename: originalFilename,
      totalRows: 0,
      openJobsCount: 0,
      customersCount: 0,
      openJobs: [],
      skippedRows: [],
      uniqueCustomers: [],
      error: 'The uploaded file contains no rows.'
    };
  }

  const sampleRow = rawRows[0];
  const rowKeys = Object.keys(sampleRow);

  const statusKey = findColumnKey(rowKeys, ['status', 'jobstatus', 'orderstatus']) || 'Status';
  const customerKey = findColumnKey(rowKeys, ['customer', 'customername', 'client', 'account']) || 'Customer';
  const descKey = findColumnKey(rowKeys, ['description', 'jobdescription', 'details', 'desc']) || 'Description';
  const poKey = findColumnKey(rowKeys, ['purchaseorder', 'purchaseordernumber', 'po', 'ponumber', 'orderpo', 'customerpo']) || 'Purchase Order';
  const reqDateKey = findColumnKey(rowKeys, ['requireddate', 'reqdate', 'reqdate.', 'deliverydate', 'duedate', 'daterequired']) || 'Required Date';
  const jobOrderKey = findColumnKey(rowKeys, ['jobordernumber', 'joborder', 'job#', 'jobno', 'jobno.', 'ordernumber', 'orderno', 'orderno.']);
  const missing = [statusKey, customerKey, descKey, poKey, reqDateKey].filter(key => !rowKeys.includes(key));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}. Use the first worksheet with headings in row 1.`);

  const openJobs = [];
  const skippedRows = [];
  const customerSet = new Set();
  const seenNumbers = new Set();

  rawRows.forEach((row, index) => {
    if (Object.values(row).every(v => v === '' || v === null)) return;
    const rowNum = index + 2; // Accounting for 1-based index and header row
    const rawStatus = String(row[statusKey] || '').trim();
    const rawCustomer = String(row[customerKey] || '').trim();
    const rawDesc = String(row[descKey] || '').trim();
    const rawPO = String(row[poKey] || '').trim();
    const rawDate = row[reqDateKey];
    const rawJobOrder = jobOrderKey ? String(row[jobOrderKey] || '').trim() : '';

    // Filter rule: Only include records where Status = Open
    if (rawStatus.toLowerCase() !== 'open') {
      skippedRows.push({
        rowNumber: rowNum,
        reason: `Status is '${rawStatus || 'Empty'}' (Only 'Open' jobs are imported)`,
        data: row
      });
      return;
    }

    if (!rawCustomer) {
      skippedRows.push({
        rowNumber: rowNum,
        reason: 'Missing Customer Name',
        data: row
      });
      return;
    }

    const isoDate = parseExcelDate(rawDate, Boolean(wb.Workbook?.WBProps?.date1904));
    if (!isoDate) {
      skippedRows.push({
        rowNumber: rowNum,
        reason: `Could not parse Required Date: '${rawDate}'`,
        data: row
      });
      return;
    }

    // Determine Job Order display identifier
    const jobOrderNumber = rawJobOrder;
    if (rawJobOrder && seenNumbers.has(rawJobOrder)) throw new Error(`Duplicate Job Order Number '${rawJobOrder}' at row ${rowNum}. Resolve duplicate numbers before generating files.`);
    if (rawJobOrder) seenNumbers.add(rawJobOrder);

    customerSet.add(rawCustomer);

    openJobs.push({
      rowNumber: rowNum,
      customerName: rawCustomer,
      jobOrderNumber: jobOrderNumber,
      hasExplicitJobOrder: Boolean(rawJobOrder),
      description: rawDesc || 'No description provided',
      purchaseOrder: rawPO,
      requiredDate: isoDate,
      requiredDateFormatted: formatDateAU(isoDate),
      status: 'Open'
    });
  });

  return {
    filename: originalFilename,
    totalRows: rawRows.length,
    openJobsCount: openJobs.length,
    customersCount: customerSet.size,
    openJobs,
    skippedRows,
    uniqueCustomers: Array.from(customerSet).sort()
  };
}

module.exports = {
  parseJobOrdersFile
};
