const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const xlsx=require('xlsx');const AdmZip=require('adm-zip');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/travi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {parseJobOrdersFile}=require('../lib/excel-parser');
(async()=>{
const browser=await chromium.launch();const context=await browser.newContext({offline:true,acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(12000);
const errors=[];const network=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
const out=path.resolve('test/portable-results');fs.mkdirSync(out,{recursive:true});
const real='C:/Users/travi/Downloads/drive-download-20261001T220651Z-1-001/Job Orders.xls';
const workbook=rows=>{const w=xlsx.utils.book_new();xlsx.utils.book_append_sheet(w,xlsx.utils.json_to_sheet(rows),'Jobs');return xlsx.write(w,{type:'buffer',bookType:'xlsx'});};
const row=(customer='Synthetic Alpha')=>({Status:'Open',Customer:customer,Description:'=Literal text & <b>not markup</b>','Purchase Order':'000123','Required Date':'15/10/2026'});
const upload=async(buffer,name)=>{await page.locator('#excelFile').setInputFiles({name,mimeType:'application/octet-stream',buffer});await page.getByRole('button',{name:'Preview customer files'}).click();};
try{
await page.goto(pathToFileURL(path.resolve('portable/Plasgain Job Follow Up.html')).href);
await page.getByRole('button',{name:'Preview customer files'}).click();assert.match(await page.locator('#error').innerText(),/Choose/);
await upload(workbook([row(),{...row('Closed'),Status:'Closed'},{...row('Invalid'),'Required Date':'31/02/2026'}]),'synthetic.xlsx');await page.locator('#previewSection').waitFor({state:'visible'});assert.equal(await page.locator('#jobCount').innerText(),'1');assert.equal(await page.locator('#excludedCount').innerText(),'2');
await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#uploadSection').isVisible(),true);
await upload(fs.readFileSync(real),'Job Orders.xls');await page.locator('#previewSection').waitFor({state:'visible'});assert.equal(await page.locator('#jobCount').innerText(),'127');assert.equal(await page.locator('#customerCount').innerText(),'25');await page.getByRole('button',{name:'Prepare customer files'}).click();
assert.equal(await page.locator('[data-customer]').count(),25);await page.locator('#customerSearch').fill('no-such-customer-zzz');assert.equal(await page.locator('[data-customer]:visible').count(),0);await page.locator('#customerSearch').fill('');
let download=page.waitForEvent('download');await page.getByRole('button',{name:/Download Excel for/}).first().click();await(await download).saveAs(path.join(out,'customer.xlsx'));
download=page.waitForEvent('download');await page.getByRole('button',{name:/Download all/}).click();await(await download).saveAs(path.join(out,'customers.zip'));
const zip=new AdmZip(path.join(out,'customers.zip'));assert.equal(zip.getEntries().length,25);let total=0;
const expected=parseJobOrdersFile(real).openJobs;
for(const file of zip.getEntries()){
 const fileBytes=zip.readFile(file);const w=xlsx.read(fileBytes,{type:'buffer'});assert.deepEqual(w.SheetNames,['Upcoming Jobs']);const s=w.Sheets['Upcoming Jobs'];const customer=s.A3.v;
 assert.equal(s.A2.v,'Upcoming Delivery Dates');assert.ok(!s.A4.v.includes('Dates:'));
 const inner=new AdmZip(fileBytes);const media=inner.getEntries().filter(e=>e.entryName.startsWith('xl/media/'));assert.equal(media.length,1);assert.deepEqual(inner.readFile(media[0]),fs.readFileSync('templates/plasgain-logo.png'));
 const jobs=expected.filter(j=>j.customerName===customer).sort((a,b)=>a.requiredDate.localeCompare(b.requiredDate)||a.rowNumber-b.rowNumber);assert.ok(jobs.length);
 jobs.forEach((j,i)=>{const n=i+10;assert.equal(s['A'+n].v,j.description);assert.equal(s['B'+n]?.v||'',j.purchaseOrder);assert.equal(s['C'+n].v,(Date.parse(j.requiredDate+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000);assert.ok(!s['D'+n]?.v&&!s['E'+n]?.v);total++;});assert.equal(s['A'+(jobs.length+10)],undefined);
}assert.equal(total,127);
await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
await page.getByRole('button',{name:'Choose another export'}).click();await upload(workbook([row('<img src=x onerror=alert(1)>')]),'literal.xlsx');await page.locator('#previewSection').waitFor({state:'visible'});await page.getByRole('button',{name:'Prepare customer files'}).click();assert.equal(await page.locator('[data-customer]').count(),1);assert.equal(await page.locator('img').count(),0);
download=page.waitForEvent('download');await page.getByRole('button',{name:/Download Excel for/}).click();await(await download).saveAs(path.join(out,'literal.xlsx'));const s=xlsx.readFile(path.join(out,'literal.xlsx')).Sheets['Upcoming Jobs'];assert.equal(s.A10.v,row().Description);assert.equal(s.A10.f,undefined);assert.equal(s.B10.v,'000123');
await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Choose another export'}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
console.log('PASS portable OFFLINE: .xls/.xlsx, preview/cancel, invalid rows, 127 jobs in 25 verified customer workbooks, ZIP + individual downloads, search, new-file isolation, literal text, mobile layout, zero network requests, zero browser errors.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
