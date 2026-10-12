// Shared, pure worksheet layout used by both the offline and server applications.
const { formatDateTimeAU } = require('./export-dates');
function xml(value) { return String(value??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function filename(customer,index,date) {
  const safe=customer.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').replace(/[. ]+$/g,'').trim().slice(0,100)||'Customer';
  const formattedDate=date.split('-').reverse().join('-');
  return `${safe} - ${formattedDate}.xlsx`;
}
function renderWorksheet(sheet, customer, jobs, createdAt) {
  if(!jobs.length || jobs.some(j=>j.customerName!==customer)) throw new Error('Customer workbook must contain only that customer’s jobs.');
  const styles=Object.fromEntries(['A','B','C','D','E','F'].map(col=>[col,sheet.match(new RegExp(`<x:c r="${col}10" s="(\\d+)"`))[1]]));
  const rows=[...jobs].sort((a,b)=>a.requiredDate.localeCompare(b.requiredDate)||a.rowNumber-b.rowNumber).map((j,i)=>{
    const n=i+10;
    const desc=j.jobOrderNumber ? `${j.description}\nJob Order: ${j.jobOrderNumber}` : j.description;
    const text=(col,value)=>`<x:c r="${col}${n}" s="${styles[col]}" t="inlineStr"><x:is><x:t xml:space="preserve">${xml(value)}</x:t></x:is></x:c>`;
    const serial=(Date.parse(j.requiredDate+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
    if(!Number.isFinite(serial)) throw new Error('Invalid delivery date');
    const height=Math.max(42,Math.ceil(desc.length/48)*16+(j.jobOrderNumber?16:0),Math.ceil(j.purchaseOrder.length/21)*16);
    return `<x:row r="${n}" ht="${Math.min(height,409)}" customHeight="1">${text('A',desc)}${text('B',j.purchaseOrder)}<x:c r="C${n}" s="${styles.C}" t="n"><x:v>${serial}</x:v></x:c><x:c r="D${n}" s="${styles.D}"/><x:c r="E${n}" s="${styles.E}"/><x:c r="F${n}" s="${styles.F}"/></x:row>`;
  }).join('');
  sheet=sheet.replace('{{CUSTOMER}}',()=>xml(customer)).replace('{{SNAPSHOT}}',()=>xml(`Prepared ${formatDateTimeAU(createdAt)} · ${jobs.length} open order${jobs.length===1?'':'s'}`));
  sheet=sheet.replace(/<x:row r="10"[\s\S]*?<\/x:row>/,()=>rows);
  sheet=sheet.replace('</x:sheetData>',`</x:sheetData><x:autoFilter ref="A9:F${jobs.length+9}"/>`);
  sheet=sheet.replace('<x:pageMargins',`<x:dataValidations count="1"><x:dataValidation type="date" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Enter a date" error="Enter a valid confirmed or estimated date, or leave blank." sqref="D10:E${jobs.length+9}"><x:formula1>1</x:formula1><x:formula2>2958465</x:formula2></x:dataValidation></x:dataValidations><x:pageMargins`);
  sheet=sheet.replace(/(<x:pageMargins\b[^>]*\/>)/,'$1<x:pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>');
  return sheet;
}
module.exports={renderWorksheet,filename};
