// Isolated acceptance/security audit. Does not open or modify plasgain.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
process.env.DB_PATH = ':memory:';
const dbm = require('../db');
const app = require('../server');
const xlsx = require('xlsx');
const { parseJobOrdersFile } = require('../lib/excel-parser');
const dates = require('../lib/date-utils');
const out = path.join(__dirname, 'audit-results');
fs.mkdirSync(out, { recursive: true });
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'plasgain-audit-'));
const results = [];
let base;
function check(name, fn) {
  return Promise.resolve().then(fn).then(evidence => {
    results.push({ name, status: 'PASS', evidence: evidence || '' });
    console.log('PASS ' + name);
  }).catch(e => {
    results.push({ name, status: 'FAIL', evidence: e.message });
    console.log('FAIL ' + name + ': ' + e.message);
  });
}
function reset() {
  for (const t of ['job_response_items','job_responses','review_requests','jobs','customers','imports','settings']) dbm.db.prepare(`DELETE FROM ${t}`).run();
}
function row(customer = 'Audit Alpha', job = 'JO-001', date = '15/10/2026', status = 'Open') {
  return { Customer: customer, 'Job Order Number': job, Description: `Stage ${job}`, 'Purchase Order': `PO-${job}`, 'Required Date': date, Status: status };
}
function workbook(rows, name = 'fixture.xlsx', props) {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), 'Jobs');
  if (props) wb.Workbook = { WBProps: props };
  const p = path.join(fixtures, name);
  xlsx.writeFile(wb, p);
  return p;
}
function seed(rows = [row(), row('Audit Beta', 'JO-002')]) {
  reset();
  dbm.commitImport(parseJobOrdersFile(workbook(rows)));
  return dbm.getCustomersList();
}
function payload(customer, overrides = {}) {
  const jobs = dbm.getReviewDataByToken(customer.token).jobs;
  return { responseType: 'CONFIRMED_ALL', items: jobs.map(j => ({jobId:j.id,originalRequiredDate:j.required_date,isChanged:false,contactRequested:false})), ...overrides };
}
async function request(url, body, headers = {}) {
  return fetch(base + url, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: body === undefined ? headers : {'Content-Type':'application/json',...headers}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
}
async function submit(c, data) { return request(`/review/${c.token}/submit`, data); }
async function upload(p) {
  const form = new FormData();
  form.set('excelFile', new Blob([fs.readFileSync(p)]), path.basename(p));
  return fetch(base+'/admin/upload', { method:'POST',body:form,redirect:'manual' });
}
async function apiTests() {
  for (const ext of ['xlsx','xls']) await check(`Import ${ext}: open-only filter, dates, grouping, skipped rows`, () => {
    const rows = [row(),row('Audit Alpha','JO-003',46200),row('Audit Beta','JO-002'),row('Closed','J4','15/10/2026','Closed'),row('Done','J5','15/10/2026','Completed'),row('Lost','J6','15/10/2026','Lost'),row('','J7'),row('Invalid','J8','not a date')];
    const p = parseJobOrdersFile(workbook(rows,`mixed.${ext}`));
    assert.equal(p.openJobsCount,3); assert.equal(p.customersCount,2); assert.equal(p.skippedRows.length,5);
    assert.equal(p.openJobs[0].requiredDate,'2026-10-15');
  });
  await check('Actual Ostendo sample: 127 jobs, 25 customers', () => {
    const p = parseJobOrdersFile('C:/Users/travi/Downloads/drive-download-20261001T220651Z-1-001/Job Orders.xls');
    assert.equal(p.openJobsCount,127); assert.equal(p.customersCount,25);
    return `Explicit job numbers: ${p.openJobs.filter(j=>j.hasExplicitJobOrder).length}/127`;
  });
  await check('Missing Job Order Number is flagged rather than invented', () => {
    const r = row(); delete r['Job Order Number'];
    const p = parseJobOrdersFile(workbook([r]));
    assert.ok(p.error || p.skippedRows.length,`Accepted as ${p.openJobs[0]?.jobOrderNumber} with no warning`);
  });
  await check('Impossible dates are rejected', () => assert.equal(dates.parseExcelDate('31/02/2026'),null));
  await check('1904 Excel date system is respected', () => {
    const p = parseJobOrdersFile(workbook([row('Audit Alpha','J1',44848)],'1904.xlsx',{date1904:true}));
    const expected = xlsx.SSF.parse_date_code(44848,{date1904:true});
    assert.equal(p.openJobs[0].requiredDate,`${expected.y}-${String(expected.m).padStart(2,'0')}-${String(expected.d).padStart(2,'0')}`);
  });
  await check('Duplicate job number cannot create duplicate active jobs', () => {
    seed([row(),row()]); assert.equal(dbm.getDashboardStats().openJobs,1);
  });
  await check('Repeat import has no duplicate active jobs and preserves prior response', () => {
    const [a] = seed(); dbm.submitCustomerResponse(a.token,'CONFIRMED_ALL',payload(a).items);
    dbm.commitImport(parseJobOrdersFile(workbook([row(),row('Audit Beta','JO-002')])));
    assert.equal(dbm.getDashboardStats().openJobs,2);
    assert.equal(dbm.getCustomerById(a.id).latestResponse.items[0].original_required_date,'2026-10-15');
  });
  await check('New snapshot removes jobs for customers absent from file', () => {
    seed(); dbm.commitImport(parseJobOrdersFile(workbook([row()])));
    assert.equal(dbm.getDashboardStats().openJobs,1);
  });
  await check('Zero-open snapshot can clear previously active jobs', async () => {
    seed(); const r = await upload(workbook([row('Audit Alpha','JO-001','15/10/2026','Closed')]));
    assert.equal(r.status,302,`Upload returned ${r.status}: zero-open snapshot refused`);
  });
  await check('New dates do not inherit an old Confirmed status', () => {
    const [a] = seed(); dbm.submitCustomerResponse(a.token,'CONFIRMED_ALL',payload(a).items);
    dbm.commitImport(parseJobOrdersFile(workbook([row('Audit Alpha','JO-001','20/11/2026')])));
    assert.notEqual(dbm.getCustomerById(a.id).reviewRequest.status,'Confirmed');
  });
  await check('Sent review link preserves the dates originally sent', () => {
    const [a] = seed(); dbm.markRequestAsSent(a.id);
    dbm.commitImport(parseJobOrdersFile(workbook([row('Audit Alpha','JO-001','20/11/2026')])));
    assert.equal(dbm.getReviewDataByToken(a.token).jobs[0].required_date,'2026-10-15');
  });
  await check('Customer named constructor imports safely', () => seed([row('constructor')]));
  await check('Unauthenticated admin dashboard is protected', async () => {
    seed(); const r = await request('/admin'); assert.ok([401,403,302,303].includes(r.status),`Anonymous GET /admin returned ${r.status} and all customer links`);
  });
  await check('Unauthenticated admin mutations are protected', async () => {
    seed(); const r = await request('/admin/settings/base-url',{baseUrl:'https://audit.invalid'});
    assert.equal(dbm.getSetting('base_url'),null,`Anonymous POST persisted base URL; HTTP ${r.status}`);
  });
  await check('Random tokens are distinct, 160-bit, and altered token returns 404', async () => {
    const [a,b] = seed(); assert.match(a.token,/^[a-f0-9]{40}$/);assert.notEqual(a.token,b.token);
    assert.equal((await request('/review/'+a.token+'a')).status,404);
  });
  await check('Public review GET displays only the token customer', async () => {
    const [a] = seed(); const html = await (await request('/review/'+a.token)).text();
    assert.ok(html.includes('Audit Alpha')); assert.ok(!html.includes('Audit Beta')); assert.ok(!html.includes('Stage JO-002'));
  });
  await check('Cross-customer job IDs are rejected in submissions', async () => {
    const [a,b] = seed(); const r = await submit(a,payload(b,{responseType:'CHANGES_SUBMITTED'}));
    assert.equal(r.status,400,`HTTP ${r.status}; Beta job accepted into Alpha response`);
  });
  await check('Cross-customer descriptions cannot leak via contaminated response', async () => {
    const [a,b] = seed(); await submit(a,payload(b,{responseType:'CHANGES_SUBMITTED'}));
    const html = await (await request('/admin/customers/'+a.id)).text();
    assert.ok(!html.includes('Stage JO-002'),'Alpha response view shows Beta description and PO');
  });
  await check('Confirmation records all jobs and timestamp without modifying imports', async () => {
    const [a] = seed([row(),row('Audit Alpha','JO-003')]);
    const r = await submit(a,payload(a)); assert.equal(r.status,200);
    const c = dbm.getCustomerById(a.id); assert.equal(c.reviewRequest.status,'Confirmed'); assert.ok(c.reviewRequest.responded_at);assert.equal(c.latestResponse.items.length,2);
    assert.ok(c.jobs.every(j=>j.required_date==='2026-10-15'));
  });
  await check('Date change and optional contact are retained; imported date unchanged', async () => {
    const [a] = seed(); const data=payload(a,{responseType:'CHANGES_SUBMITTED'});
    Object.assign(data.items[0],{newRequiredDate:'2026-11-06',isChanged:true,contactRequested:true,customerComment:''});
    assert.equal((await submit(a,data)).status,200);
    const c=dbm.getCustomerById(a.id);assert.equal(c.latestResponse.items[0].new_required_date,'2026-11-06');assert.equal(c.latestResponse.items[0].contact_requested,1);assert.equal(c.jobs[0].required_date,'2026-10-15');
  });
  for (const [label,mutate] of [
    ['Empty confirmation',d=>d.items=[]],
    ['Unknown response type',d=>d.responseType='BOGUS'],
    ['Forged original date',d=>d.items[0].originalRequiredDate='1900-01-01'],
    ['Invalid requested date',d=>{d.responseType='CHANGES_SUBMITTED';d.items[0].isChanged=true;d.items[0].newRequiredDate='2026-99-99';}],
    ['Duplicate response items',d=>d.items.push({...d.items[0]})]
  ]) await check(`${label} rejected by server`,async()=>{
    const [a]=seed();const d=payload(a);mutate(d);const r=await submit(a,d);assert.equal(r.status,400,`Accepted with HTTP ${r.status}`);
  });
  await check('Stale pre-import browser submission is rejected',async()=>{
    const [a]=seed();const old=payload(a);dbm.commitImport(parseJobOrdersFile(workbook([row('Audit Alpha','JO-001','20/11/2026')])));
    assert.equal((await submit(a,old)).status,400,'Old snapshot accepted while current jobs marked Confirmed');
  });
  await check('Missing referenced job rolls back the whole response',async()=>{
    const [a]=seed();const d=payload(a);d.items[0].jobId=-999;assert.equal((await submit(a,d)).status,400);assert.equal(dbm.getCustomerById(a.id).reviewRequest.status,'Not Sent');
  });
  await check('Search and response filters return correct customers',()=>{
    const [a]=seed();dbm.markRequestAsSent(a.id);assert.equal(dbm.getCustomersList('Awaiting Response').length,1);assert.equal(dbm.getCustomersList(null,'beta')[0].name,'Audit Beta');assert.equal(dbm.getCustomersList(null,"' OR 1=1 --").length,0);
  });
  await check('Changed-date count reflects latest response, not cumulative history',()=>{
    const [a]=seed();const d=payload(a);Object.assign(d.items[0],{isChanged:true,newRequiredDate:'2026-11-06'});
    dbm.submitCustomerResponse(a.token,'CHANGES_SUBMITTED',d.items);dbm.submitCustomerResponse(a.token,'CHANGES_SUBMITTED',d.items);
    assert.equal(dbm.getCustomersList()[0].changed_dates_count,1);
  });
  await check('Latest response selection is deterministic for same-second submissions',()=>{
    const [a]=seed();const d=payload(a);const first=dbm.submitCustomerResponse(a.token,'CONFIRMED_ALL',d.items);const second=dbm.submitCustomerResponse(a.token,'CHANGES_SUBMITTED',d.items);
    dbm.db.prepare("UPDATE job_responses SET responded_at = '2026-10-02 01:00:00'").run();
    assert.equal(dbm.getCustomerById(a.id).latestResponse.id,second.responseId,`Selected first response ${first.responseId} rather than latest ${second.responseId}`);
  });
  await check('UTC database timestamp displays Australia/Sydney time',()=>assert.equal(dates.formatDateTimeAU('2026-10-02 00:00:00'),'02/10/2026 10:00 AM'));
  await check('Non-Excel extension and missing upload handled without commit',async()=>{
    reset();const f=path.join(fixtures,'invalid.txt');fs.writeFileSync(f,'test');const r=await upload(f);assert.match(await r.text(),/Only .xls and .xlsx/);assert.equal(dbm.getDashboardStats().openJobs,0);
    assert.equal((await request('/admin/upload',{})).status,302);
  });
  await check('Upload preview is uncommitted until explicit commit; duplicate commit harmless',async()=>{
    reset();const r=await upload(workbook([row()]));assert.equal(r.status,302);assert.equal(dbm.getDashboardStats().openJobs,0);
    const url=r.headers.get('location');assert.match(await(await request(url)).text(),/Review Import Snapshot/);
    await request(url+'/commit',{});await request(url+'/commit',{});assert.equal(dbm.getDashboardStats().openJobs,1);assert.equal(dbm.db.prepare('SELECT COUNT(*) n FROM imports').get().n,1);
  });
  await check('Render deployment stores SQLite on configured persistent disk',()=>{
    const config=fs.readFileSync(path.join(__dirname,'../render.yaml'),'utf8');
    assert.match(config,/DB_PATH[\s\S]*\/data\//,'Persistent /data disk exists but DB_PATH is not set; default DB is in application directory');
  });
}

async function browserTests() {
  // agent-browser CLI unavailable in this workspace; use bundled Playwright.
  const {chromium} = require(process.env.AUDIT_PLAYWRIGHT || 'C:/Users/travi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  let a;
  async function open(rows=[row(),row('Audit Alpha','JO-003'),row('Audit Beta','JO-002')]) { [a]=seed(rows);await page.goto(base+'/review/'+a.token);await page.waitForFunction(()=>getComputedStyle(document.querySelector('#changeModal')).display==='none'); }
  await check('Browser: upload, preview, cancel, commit, copy link, mark sent',async()=>{
    reset();await page.goto(base+'/admin/upload');
    await page.locator('input[type=file]').setInputFiles(workbook([row(),row('Audit Alpha','JO-003'),row('Audit Beta','JO-002')]));
    await page.getByRole('button',{name:'Upload & Preview Import'}).click();await page.waitForURL('**/admin/preview/*');assert.equal(dbm.getDashboardStats().openJobs,0);
    await page.getByRole('link',{name:'Cancel & Re-upload'}).click();assert.equal(dbm.getDashboardStats().openJobs,0);
    await page.locator('input[type=file]').setInputFiles(workbook([row(),row('Audit Alpha','JO-003'),row('Audit Beta','JO-002')]));await page.getByRole('button',{name:'Upload & Preview Import'}).click();
    await page.getByRole('button',{name:/Confirm & Commit Import/}).click();await page.waitForURL('**/admin?*');
    await page.getByRole('link',{name:'Audit Alpha',exact:true}).click();
    await page.locator('#copyBtn').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/\/review\/[a-f0-9]{40}$/);
    await page.getByRole('button',{name:/Mark as Sent/}).click();
    a=dbm.getCustomersList().find(c=>c.name==='Audit Alpha');assert.equal(a.review_status,'Awaiting Response');
    await page.screenshot({path:path.join(out,'admin-customer-desktop.png'),fullPage:true});
  });
  await check('Browser: default fields hidden and one click confirms every job',async()=>{
    await open();assert.equal(await page.locator('input[type=date]:visible').count(),0);
    const started=Date.now();await page.getByRole('button',{name:'CONFIRM ALL CURRENT DATES'}).click();await page.waitForURL('**/thank-you?type=confirmed');
    assert.equal(dbm.getCustomerById(a.id).latestResponse.items.length,2);
    return `Single click to persisted response/success screen: ${Date.now()-started}ms (automation, not a human usability study)`;
  });
  await check('Browser: change one date, review diff, submit; admin sees original/new',async()=>{
    await open();await page.getByRole('button',{name:'Change Date',exact:true}).first().click();await page.locator('input[type=date]:visible').fill('2026-11-06');
    await page.locator('#primaryActionBtn').click();assert.match(await page.locator('#changeSummaryList').innerText(),/15\/10\/2026[\s\S]*06\/11\/2026/);
    await page.screenshot({path:path.join(out,'change-summary-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Confirm & Submit Changes'}).click();await page.waitForURL('**/thank-you?type=changes');
    const c=dbm.getCustomerById(a.id);assert.equal(c.latestResponse.items.filter(i=>i.is_changed).length,1);assert.equal(c.jobs[0].required_date,'2026-10-15');
    await page.goto(base+'/admin/customers/'+a.id);assert.match(await page.locator('body').innerText(),/06\/11\/2026/);
  });
  await check('Browser: cancel date change restores one-click confirmation',async()=>{
    await open();await page.getByRole('button',{name:'Change Date',exact:true}).first().click();await page.locator('input[type=date]:visible').fill('2026-11-06');await page.getByRole('button',{name:/Cancel \/ Keep Original/}).first().click();
    assert.equal(await page.locator('input[type=date]:visible').count(),0);assert.match(await page.locator('#primaryActionBtn').innerText(),/CONFIRM ALL/);
  });
  await check('Browser: contact-only response requires no comment',async()=>{
    await open();await page.getByRole('button',{name:'Please contact me about this order',exact:true}).first().click();await page.locator('#primaryActionBtn').click();await page.getByRole('button',{name:'Confirm & Submit Changes'}).click();await page.waitForURL('**/thank-you?type=changes');
    assert.equal(dbm.getCustomerById(a.id).latestResponse.items[0].contact_requested,1);
  });
  await check('Browser: clearing an optional comment actually removes it',async()=>{
    await open();await page.getByRole('button',{name:'Please contact me about this order',exact:true}).first().click();const input=page.locator('input[placeholder^="Optional comment"]:visible');await input.fill('Remove this private note');await input.fill('');await page.locator('#primaryActionBtn').click();
    assert.ok(!(await page.locator('#changeSummaryList').innerText()).includes('Remove this private note'),'Cleared comment remains in submission summary');
  });
  await check('Browser: clearing date does not retain a hidden previous selection',async()=>{
    await open();await page.getByRole('button',{name:'Change Date',exact:true}).first().click();const input=page.locator('input[type=date]:visible');await input.fill('2026-11-06');await input.fill('');await page.locator('#primaryActionBtn').click();
    assert.ok(!(await page.locator('#changeSummaryList').innerText()).includes('06/11/2026'),'Blank date input still submits 06/11/2026');
  });
  await check('Browser: toggling contact off clears pending contact request',async()=>{
    await open();const b=page.getByRole('button',{name:'Please contact me about this order',exact:true}).first();await b.click();await b.click();assert.match(await page.locator('#primaryActionBtn').innerText(),/CONFIRM ALL/);
  });
  await check('Browser: imported description remains text inside change summary (XSS)',async()=>{
    const r=row();r.Description='<img src="/audit-missing-image" onerror="window.auditXss=true">';await open([r]);await page.getByRole('button',{name:'Change Date',exact:true}).click();await page.locator('input[type=date]:visible').fill('2026-11-06');await page.locator('#primaryActionBtn').click();
    await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.auditXss||false),false,'Imported description executes JavaScript in customer page');
  });
  for(const [name,width,height] of [['desktop',1440,1000],['tablet',768,1024],['mobile',390,844],['small-mobile',320,740]]) await check(`Browser: ${name} layout, hidden inputs, visible primary action`,async()=>{
    await page.setViewportSize({width,height});await open();
    await page.screenshot({path:path.join(out,`review-${name}.png`),fullPage:true});
    const m=await page.evaluate(()=>{const r=document.querySelector('#primaryActionBtn').getBoundingClientRect();return {scroll:document.documentElement.scrollWidth,width:innerWidth,button:{x:r.x,right:r.right,y:r.y,bottom:r.bottom},height:innerHeight};});
    assert.ok(m.scroll<=m.width,JSON.stringify(m));assert.ok(m.button.x>=0&&m.button.right<=m.width&&m.button.y>=0&&m.button.bottom<=m.height,JSON.stringify(m));assert.equal(await page.locator('input[type=date]:visible').count(),0);
  });
  await check('Browser: mobile date-change and contact submission completes',async()=>{
    await page.setViewportSize({width:390,height:844});await open();await page.getByRole('button',{name:'Please contact me about this order',exact:true}).first().click();await page.getByRole('button',{name:'Change Date',exact:true}).first().click();await page.locator('input[type=date]:visible').fill('2026-11-06');await page.locator('#primaryActionBtn').click();await page.screenshot({path:path.join(out,'change-summary-mobile.png'),fullPage:true});await page.getByRole('button',{name:'Confirm & Submit Changes'}).click();await page.waitForURL('**/thank-you?type=changes');
  });
  await check('Browser: customer details expose actual Job Order Number',async()=>{
    await page.goto(base+'/admin/customers/'+a.id);assert.ok(await page.getByRole('columnheader',{name:'Job Order',exact:true}).count(),'Admin table omits Job Order Number column');
  });
  fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(errors,null,2));
  await browser.close();
}
async function main(){
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  try{
    if(process.env.AUDIT_BROWSER_ONLY){
      const previous=JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8'));
      results.push(...previous.results.filter(r=>!r.name.startsWith('Browser')));
    }else{
    await apiTests();
    await check('Existing supplied integration test passes on isolated database',()=>{
      const r=spawnSync(process.execPath,[path.join(__dirname,'e2e-test.js')],{env:{...process.env,DB_PATH:':memory:'},encoding:'utf8'});
      const log=(r.stdout+r.stderr).replace(/[a-f0-9]{40}/g,'[test token redacted]');fs.writeFileSync(path.join(out,'original-suite.log'),log);assert.equal(r.status,0,log.slice(-1800));
    });
    }
    try{await browserTests();}catch(e){results.push({name:'Browser test infrastructure',status:'BLOCKED',evidence:e.stack});console.error(e.stack);}
  }finally{
    server.close();dbm.db.close();
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({generatedAt:new Date().toISOString(),results,summary:results.reduce((s,r)=>(s[r.status]=(s[r.status]||0)+1,s),{})},null,2));
    console.log(JSON.stringify(results.reduce((s,r)=>(s[r.status]=(s[r.status]||0)+1,s),{})));
    if(results.some(r=>r.status!=='PASS')) process.exitCode=1;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
