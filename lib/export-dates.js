const xlsx = require('xlsx');
function validDate(y,m,d) {
  if (y < 1900 || y > 9999) return null;
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d
    ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null;
}
function parseExcelDate(value, date1904=false) {
  if (typeof value==='number' && Number.isFinite(value)) {
    const p=xlsx.SSF.parse_date_code(value,{date1904});
    return p ? validDate(p.y,p.m,p.d) : null;
  }
  if (value instanceof Date && !isNaN(value)) return validDate(value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate());
  const str=String(value??'').trim();
  let m=str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if(m) return validDate(+m[1],+m[2],+m[3]);
  m=str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return m ? validDate(+m[3],+m[2],+m[1]) : null;
}
function formatDateAU(value) { return value ? value.split('-').reverse().join('/') : ''; }
function formatDateTimeAU(value) { return new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',day:'2-digit',month:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)); }
module.exports={parseExcelDate,formatDateAU,formatDateTimeAU};
