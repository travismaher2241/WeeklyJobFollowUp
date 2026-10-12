const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/travi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const app=require('../server');
(async()=>{
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const out=path.join(__dirname,'export-results');fs.mkdirSync(out,{recursive:true});
try{
await page.goto(base);await page.locator('input[type=file]').setInputFiles('C:/Users/travi/Downloads/drive-download-20261001T220651Z-1-001/Job Orders.xls');await page.getByRole('button',{name:'Upload & preview'}).click();await page.waitForURL('**/preview',{timeout:10000}).catch(async e=>{console.log('Upload page:',page.url(),await page.locator('body').innerText(),errors);throw e;});assert.match(await page.locator('.metrics').innerText(),/127/);assert.match(await page.locator('.metrics').innerText(),/25/);
await page.getByRole('button',{name:'Prepare customer files'}).click();await page.waitForURL(/\/batches\/[a-f0-9]+$/);const batchUrl=page.url();assert.equal(await page.locator('[data-customer]').count(),25);
await page.locator('#customerSearch').fill('zz-no-match');assert.equal(await page.locator('[data-customer]:visible').count(),0);assert.equal(await page.locator('#noResults').isVisible(),true);await page.locator('#customerSearch').fill('');
const name=await page.locator('[data-customer] strong').first().textContent();await page.locator('#customerSearch').fill(name);assert.ok(await page.locator('[data-customer]:visible').count()>0);await page.locator('#customerSearch').fill('');
const dl=page.waitForEvent('download');await page.getByRole('link',{name:/Download Excel/}).first().click();await(await dl).saveAs(path.join(out,'sample-customer.xlsx'));
const all=page.waitForEvent('download');await page.getByRole('link',{name:/Download all customer/}).click();await(await all).saveAs(path.join(out,'all-customers.zip'));
await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.goto(base);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'mobile-upload.png'),fullPage:true});
await page.goto(batchUrl);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.getByRole('link',{name:/Download all customer/}).isVisible(),true);assert.deepEqual(errors,[]);
console.log('PASS browser: real 127-job/25-customer import, preview, generation, search, individual and ZIP downloads, desktop/mobile, no page errors.');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
