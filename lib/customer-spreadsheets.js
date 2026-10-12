const xlsx = require('xlsx');
const AdmZip = require('adm-zip');
const { buildWorkbook, filename } = require('./workbook-layout');

function createCustomerWorkbook(customer, jobs, createdAt) {
  const wb = buildWorkbook(xlsx, customer, jobs, createdAt);
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function createAllWorkbooks(batch) {
  const zip = new AdmZip();
  const usedNames = new Set();
  batch.customers.forEach((c, i) => {
    const name = filename(c.name, i, batch.date);
    if (usedNames.has(name.toLowerCase())) {
      throw new Error(`Two customers produce the filename "${name}". Download those customers individually to avoid overwriting a file.`);
    }
    usedNames.add(name.toLowerCase());
    zip.addFile(name, createCustomerWorkbook(c.name, c.jobs, batch.createdAt));
  });
  return zip.toBuffer();
}

module.exports = { createCustomerWorkbook, createAllWorkbooks, filename };
