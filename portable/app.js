'use strict';
const {parseJobOrdersFile}=modules['./excel-parser'];
const {renderWorksheet,filename}=modules['./workbook-layout'];
const $=id=>document.getElementById(id);
let batch=null,busy=false;
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function show(section){['uploadSection','previewSection','downloadsSection'].forEach(id=>$(id).hidden=id!==section);$('error').hidden=true;$('status').textContent='';}
function reset(){if(busy)return;batch=null;$('excelFile').value='';$('customerSearch').value='';$('customerRows').replaceChildren();$('previewRows').replaceChildren();show('uploadSection');}
async function run(action){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);$('error').hidden=true;try{await action();}catch(e){$('error').textContent=e.message||'Could not process this file.';$('error').hidden=false;$('status').textContent='';}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
$('previewButton').addEventListener('click',()=>run(async()=>{
  const file=$('excelFile').files[0];if(!file)throw new Error('Choose your Ostendo export first.');
  if(!/\.xlsx?$/i.test(file.name))throw new Error('Choose an .xls or .xlsx Excel file.');
  if(file.size>25*1024*1024)throw new Error('The file is too large. Maximum size is 25 MB.');
  $('status').textContent='Reading spreadsheet…';await new Promise(r=>setTimeout(r,20));
  const parsed=parseJobOrdersFile(new Uint8Array(await file.arrayBuffer()),file.name);
  if(parsed.error)throw new Error(parsed.error);
  if(!parsed.openJobsCount)throw new Error('No valid open jobs found. Check the Status and Required Date columns.');
  const grouped=new Map();for(const j of parsed.openJobs){if(!grouped.has(j.customerName))grouped.set(j.customerName,[]);grouped.get(j.customerName).push(j);}
  const createdAt=new Date();const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(createdAt);
  batch={...parsed,createdAt,date,customers:[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([name,jobs])=>({name,jobs}))};
  $('sourceName').textContent=file.name;$('jobCount').textContent=parsed.openJobsCount;$('customerCount').textContent=parsed.customersCount;$('excludedCount').textContent=parsed.skippedRows.length;
  $('excludedRows').replaceChildren(...parsed.skippedRows.map(r=>node('li',`Row ${r.rowNumber}: ${r.reason}`)));$('excludedDetails').hidden=!parsed.skippedRows.length;
  $('previewRows').replaceChildren(...batch.customers.map(c=>{const tr=node('tr');tr.append(node('td',c.name),node('td',c.jobs.length));return tr;}));
  show('previewSection');
}));
$('cancelButton').addEventListener('click',reset);$('startAgain').addEventListener('click',reset);
$('prepareButton').addEventListener('click',()=>{
  if(!batch||busy)return;
  $('downloadSummary').textContent=`${batch.openJobsCount} open jobs across ${batch.customersCount} customers. Attach each customer’s file to your email.`;
  $('customerRows').replaceChildren(...batch.customers.map((c,i)=>{
    const tr=node('tr');tr.dataset.customer=c.name.toLowerCase();const name=node('td');name.append(node('strong',c.name));
    const details=node('details');details.append(node('summary','View jobs'));const list=node('ul');list.className='jobs';
    c.jobs.forEach(j=>list.append(node('li',`${j.description}${j.jobOrderNumber?' · Job '+j.jobOrderNumber:''} · PO: ${j.purchaseOrder||'Not provided'} · ${j.requiredDateFormatted}`)));details.append(list);name.append(details);
    const action=node('td');const button=node('button','Download Excel');button.type='button';button.className='small secondary';button.setAttribute('aria-label','Download Excel for '+c.name);button.addEventListener('click',()=>run(async()=>{const b=await workbook(c);save(b,filename(c.name,i,batch.date),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}));action.append(button);tr.append(name,node('td',c.jobs.length),action);return tr;
  }));$('noResults').hidden=true;show('downloadsSection');
});
$('customerSearch').addEventListener('input',()=>{let count=0;document.querySelectorAll('[data-customer]').forEach(row=>{row.hidden=!row.dataset.customer.includes($('customerSearch').value.trim().toLowerCase());if(!row.hidden)count++;});$('noResults').hidden=count>0;});
async function workbook(customer){
  const zip=await JSZip.loadAsync(TEMPLATE_BASE64,{base64:true});
  const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file('xl/worksheets/sheet1.xml',renderWorksheet(sheet,customer.name,customer.jobs,batch.createdAt));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
function save(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type}));const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('downloadAll').addEventListener('click',()=>run(async()=>{
  const zip=new JSZip();const usedNames=new Set();for(let i=0;i<batch.customers.length;i++){const c=batch.customers[i];const name=filename(c.name,i,batch.date);if(usedNames.has(name.toLowerCase()))throw new Error(`Two customers produce the filename "${name}". Download those customers individually to avoid overwriting a file.`);usedNames.add(name.toLowerCase());$('status').textContent=`Preparing file ${i+1} of ${batch.customers.length}…`;zip.file(name,await workbook(c));}
  save(await zip.generateAsync({type:'uint8array',compression:'STORE'}),`Plasgain - ${batch.date} - Customer Follow Ups.zip`,'application/zip');$('status').textContent='ZIP prepared. Check your browser’s Downloads.';
}));
