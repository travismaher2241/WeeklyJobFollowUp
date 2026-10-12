// Shared worksheet generator producing a clean, standard Excel spreadsheet with visible gridlines.
const xlsx = require('xlsx');

function filename(customer, index, date) {
  const safe = customer.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100) || 'Customer';
  const formattedDate = date.split('-').reverse().join('-');
  return `${safe} - ${formattedDate}.xlsx`;
}

function buildWorkbook(XLSX, customer, jobs, createdAt) {
  if (!jobs.length || jobs.some(j => j.customerName !== customer)) {
    throw new Error('Customer workbook must contain only that customer’s jobs.');
  }

  const wb = XLSX.utils.book_new();

  const headers = [
    'Customer',
    'Order Description',
    'PO Number',
    'Delivery Date',
    'Confirmed Date',
    'Estimated Date',
    'Comments'
  ];

  const rows = [headers];

  const sortedJobs = [...jobs].sort((a, b) => 
    a.requiredDate.localeCompare(b.requiredDate) || a.rowNumber - b.rowNumber
  );

  for (const j of sortedJobs) {
    const desc = j.jobOrderNumber ? `${j.description}\nJob Order: ${j.jobOrderNumber}` : j.description;
    rows.push([
      customer,
      desc,
      String(j.purchaseOrder || ''),
      j.requiredDateFormatted,
      '',
      '',
      ''
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set real Excel date serial values with dd/mm/yyyy format and text for PO
  sortedJobs.forEach((j, idx) => {
    const rowIdx = idx + 2;
    const dateRef = `D${rowIdx}`;
    const poRef = `C${rowIdx}`;
    const descRef = `B${rowIdx}`;

    const serial = (Date.parse(j.requiredDate + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;
    if (Number.isFinite(serial)) {
      ws[dateRef] = { t: 'n', v: serial, z: 'dd/mm/yyyy' };
    }
    if (ws[poRef]) ws[poRef].t = 's';
    if (ws[descRef]) ws[descRef].t = 's';
  });

  // Ensure gridlines are visible on the worksheet
  ws['!views'] = [{ showGridLines: true }];

  // Clean column widths
  ws['!cols'] = [
    { wch: 30 }, // Customer
    { wch: 48 }, // Order Description
    { wch: 18 }, // PO Number
    { wch: 15 }, // Delivery Date
    { wch: 16 }, // Confirmed Date
    { wch: 16 }, // Estimated Date
    { wch: 35 }  // Comments
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Upcoming Jobs');
  return wb;
}

module.exports = { buildWorkbook, filename };
