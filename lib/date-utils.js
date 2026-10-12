// lib/date-utils.js
const xlsx = require('xlsx');

function parseExcelDate(val) {
  if (val === null || val === undefined || val === '') return null;
  
  // If it's a number (Excel date serial code)
  if (typeof val === 'number') {
    const parsed = xlsx.SSF.parse_date_code(val);
    if (!parsed) return null;
    const y = parsed.y;
    const m = String(parsed.m).padStart(2, '0');
    const d = String(parsed.d).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // If it's a Date instance
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // If it's a string, test DD/MM/YYYY or YYYY-MM-DD
  const str = String(val).trim();
  
  // Match DD/MM/YYYY or D/M/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    return `${y}-${m}-${d}`;
  }

  // Match YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const parsedDate = new Date(str);
  if (!isNaN(parsedDate.getTime())) {
    const y = parsedDate.getFullYear();
    const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const d = String(parsedDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

function formatDateAU(isoDateStr) {
  if (!isoDateStr) return '';
  const match = String(isoDateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return isoDateStr;
}

function formatDateTimeAU(dateObjOrStr) {
  if (!dateObjOrStr) return '-';
  const d = new Date(dateObjOrStr);
  if (isNaN(d.getTime())) return String(dateObjOrStr);
  
  // Format as DD/MM/YYYY hh:mm AM/PM in local time
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
}

module.exports = {
  parseExcelDate,
  formatDateAU,
  formatDateTimeAU
};
