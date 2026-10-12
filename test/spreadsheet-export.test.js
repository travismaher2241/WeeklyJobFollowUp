const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const xlsx=require('xlsx');
const AdmZip=require('adm-zip');
const app=require('../server');
const {parseJobOrdersFile}=require('../lib/excel-parser');
const {parseExcelDate}=require('../lib/export-dates');
const {createCustomerWorkbook,createAllWorkbooks,filename}=require('../lib/customer-spreadsheets');
function row(customer='Alpha',description='Aurora Stage 75',date='15/10/2026',status='Open') {return {Status:status,Customer:customer,Description:description,'Purchase Order':'00123','Required Date':date};}
function source(rows,bookType='xlsx',props){const wb=xlsx.utils.book_new();xlsx.utils.book_append_sheet(wb,xlsx.utils.json_to_sheet(rows),'Jobs');if(props)wb.Workbook={WBProps:props};return xlsx.write(wb,{type:'buffer',bookType});}
function parsed(rows){return parseJobOrdersFile(source(rows),'jobs.xlsx');}
function read(buffer){const w=xlsx.read(buffer,{type:'buffer',cellDates:true});assert.deepEqual(w.SheetNames,['Upcoming Jobs']);return w.Sheets['Upcoming Jobs'];}
test('xls and xlsx: grouping, open-only filter, row errors',()=>{
  for(const type of ['xls','xlsx']){const p=parseJobOrdersFile(source([row(),row('Beta'),row('Closed','Closed job','15/10/2026','Closed'),row('Invalid','Bad date','31/02/2026')],type));assert.equal(p.openJobsCount,2);assert.equal(p.customersCount,2);assert.equal(p.skippedRows.length,2);}
});
test('dates validated, leap years and 1904 date system preserved',()=>{
  assert.equal(parseExcelDate('31/02/2026'),null);assert.equal(parseExcelDate('29/02/2024'),'2024-02-29');assert.equal(parseExcelDate('29/02/2025'),null);
  assert.equal(parseJobOrdersFile(source([row('Alpha','Date',44848)],'xlsx',{date1904:true})).openJobs[0].requiredDate,'2026-10-15');
});
test('missing columns rejected; blank rows preserve error row numbers',()=>{
  assert.throws(()=>parsed([{Customer:'Alpha'}]),/Missing columns/);
  const p=parsed([row(),{},row('Bad','Invalid','invalid')]);assert.equal(p.skippedRows[0].rowNumber,4);
});
test('missing job IDs are not invented; duplicate explicit IDs rejected',()=>{
  assert.equal(parsed([row()]).openJobs[0].jobOrderNumber,'');
  assert.throws(()=>parsed([{...row(),'Job Order Number':'J1'},{...row(),'Job Order Number':'J1'}]),/Duplicate Job Order/);
});
test('export preserves typed dates, text PO, blank inputs, customer and all rows',()=>{
  const p=parsed([row(),row('Alpha','Merrifield Stage 57','23/10/2026')]);const b=createCustomerWorkbook('Alpha',p.openJobs,new Date('2026-10-02T00:00:00Z'));const s=read(b);
  assert.equal(s.A3.v,'Alpha');assert.match(s.A4.v,/02\/10\/2026/);assert.equal(s.A10.v,'Aurora Stage 75');assert.equal(s.B10.v,'00123');assert.equal(s.B10.t,'s');assert.equal(xlsx.read(b,{type:'buffer'}).Sheets['Upcoming Jobs'].C10.v,46310);assert.equal(s.A11.v,'Merrifield Stage 57');assert.ok(!s.D10?.v&&!s.E10?.v);assert.ok(!Object.values(s).some(c=>c?.f));
  assert.equal(s.D9.v,'Confirmed Date');assert.equal(s.E9.v,'Estimated Date');assert.equal(s.F9.v,'Comments (optional)');assert.ok(!s.F10?.v);
  const xml=new AdmZip(b).readAsText('xl/worksheets/sheet1.xml');assert.match(xml,/D10:E11/);assert.match(xml,/A9:F11/);assert.match(xml,/ySplit="9"/);
});
test('customer isolation enforced and ZIP contains one correct file per customer',()=>{
  const p=parsed([row('Alpha'),row('Beta','Beta only'),row('constructor','Special name')]);
  assert.throws(()=>createCustomerWorkbook('Alpha',p.openJobs,new Date()),/only that customer/);
  const batch={date:'2026-10-02',createdAt:new Date(),customers:p.uniqueCustomers.map(name=>({name,jobs:p.openJobs.filter(j=>j.customerName===name)}))};
  const zip=new AdmZip(createAllWorkbooks(batch));assert.equal(zip.getEntries().length,3);
  for(const [i,c] of batch.customers.entries()){const sheet=read(zip.readFile(filename(c.name,i,batch.date)));assert.equal(sheet.A3.v,c.name);assert.equal(sheet.A10.v,c.jobs[0].description);assert.equal(sheet.A11,undefined);}
});
test('spreadsheet markup and formula-like text stay literal; filenames use company and Australian date',()=>{
  const text='=HYPERLINK("https://example.invalid", "A&B <tag>")';const p=parsed([row('A/B',text)]);const s=read(createCustomerWorkbook('A/B',p.openJobs,new Date()));assert.equal(s.A10.v,text);assert.equal(s.A10.t,'s');assert.equal(s.A10.f,undefined);
  assert.ok(!filename('../A/B',0,'2026-10-02').includes('/'));
  assert.equal(filename('Over Head Maintenance Services',13,'2026-10-02'),'Over Head Maintenance Services - 02-10-2026.xlsx');
  const p2=parsed([row('A/B'),row('A:B')]);
  assert.throws(()=>createAllWorkbooks({date:'2026-10-02',createdAt:new Date(),customers:p2.uniqueCustomers.map(name=>({name,jobs:p2.openJobs.filter(j=>j.customerName===name)}))}),/Two customers produce/);
});
test('optional actual Job Order Number included without replacing description or PO',()=>{
  const p=parsed([{...row(),'Job Order Number':'JO-123'}]);const s=read(createCustomerWorkbook('Alpha',p.openJobs,new Date()));assert.equal(s.A10.v,'Aurora Stage 75\nJob Order: JO-123');assert.equal(s.B10.v,'00123');
});
test('HTTP upload, preview, confirm, individual/ZIP download, isolated new upload, cancel, old public routes disabled',async()=>{
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const req=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
  const upload=async(rows)=>{const f=new FormData();f.set('excelFile',new Blob([source(rows)]),'jobs.xlsx');const r=await req('/upload',{method:'POST',body:f});assert.equal(r.status,302);return r.headers.get('location').replace('/preview','');};
  try{
    const url=await upload([row(),row('Beta')]);assert.match(await(await req(url+'/preview')).text(),/Check your export/);
    assert.equal((await req(url+'/all.zip')).status,409);
    assert.equal((await req(url+'/confirm',{method:'POST'})).status,302);
    let r=await req(url+'/customers/0.xlsx');assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment/);assert.equal(read(Buffer.from(await r.arrayBuffer())).A3.v,'Alpha');
    r=await req(url+'/all.zip');assert.equal(new AdmZip(Buffer.from(await r.arrayBuffer())).getEntries().length,2);
    const second=await upload([row('Only new customer')]);await req(second+'/confirm',{method:'POST'});assert.equal(new AdmZip(Buffer.from(await(await req(second+'/all.zip')).arrayBuffer())).getEntries().length,1);
    assert.equal((await req(url+'/customers/99.xlsx')).status,404);assert.equal((await req('/review/old-token')).status,404);assert.equal((await req('/review/old-token/submit',{method:'POST'})).status,404);
    assert.equal((await req(url+'/cancel',{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);
    await req(url+'/cancel',{method:'POST'});assert.equal((await req(url+'/all.zip')).status,404);
    const f=new FormData();f.set('excelFile',new Blob(['bad']),'bad.txt');assert.equal((await req('/upload',{method:'POST',body:f})).status,400);
    process.env.ADMIN_PASSWORD='test-only';assert.equal((await req('/')).status,401);assert.equal((await req('/',{headers:{Authorization:'Basic '+Buffer.from('admin:test-only').toString('base64')}})).status,200);delete process.env.ADMIN_PASSWORD;
  }finally{delete process.env.ADMIN_PASSWORD;server.close();}
});
