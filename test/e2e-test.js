// test/e2e-test.js
const assert = require('assert');
const path = require('path');
const { parseJobOrdersFile } = require('../lib/excel-parser');
const dbMgr = require('../db');

async function runTests() {
  console.log('--- STARTING E2E INTEGRATION TESTS ---');

  const sampleFilePath = 'C:\\Users\\travi\\Downloads\\drive-download-20261001T220651Z-1-001\\Job Orders.xls';

  // 1. Test Excel Parsing
  console.log('\n1. Testing Excel Parsing...');
  const parsed = parseJobOrdersFile(sampleFilePath, 'Job Orders.xls');
  assert.strictEqual(parsed.openJobsCount, 127, 'Should parse exactly 127 open jobs');
  assert.strictEqual(parsed.customersCount, 25, 'Should identify 25 unique customers');
  assert.strictEqual(parsed.skippedRows.length, 0, 'Should have 0 skipped rows for this sample file');
  console.log('✓ Excel parser parsed 127 open jobs across 25 customers successfully.');

  // 2. Test Import Commit
  console.log('\n2. Testing Database Import Commit...');
  const importId = dbMgr.commitImport(parsed);
  assert(importId > 0, 'Import ID should be a positive integer');
  console.log(`✓ Import committed with ID: ${importId}`);

  // 3. Test Initial Dashboard Stats
  console.log('\n3. Testing Dashboard Stats...');
  const stats = dbMgr.getDashboardStats();
  assert.strictEqual(stats.openJobs, 127);
  assert.strictEqual(stats.customersCount, 25);
  assert.strictEqual(stats.notSentCount, 25);
  assert.strictEqual(stats.awaitingCount, 0);
  assert.strictEqual(stats.confirmedCount, 0);
  assert.strictEqual(stats.changesCount, 0);
  console.log('✓ Initial dashboard stats verified (127 open jobs, 25 not sent).');

  // 4. Test Customer Listing & Tokens
  console.log('\n4. Testing Customers List & Tokens...');
  const customers = dbMgr.getCustomersList();
  assert.strictEqual(customers.length, 25);
  const cust1 = customers[0];
  assert(cust1.token && cust1.token.length >= 32, 'Customer should have secure random token');
  console.log(`✓ Customer token verified for "${cust1.name}": ${cust1.token}`);

  // 5. Test Mark as Sent
  console.log('\n5. Testing Mark Request As Sent...');
  dbMgr.markRequestAsSent(cust1.id);
  const cust1Updated = dbMgr.getCustomerById(cust1.id);
  assert.strictEqual(cust1Updated.reviewRequest.status, 'Awaiting Response');
  assert(cust1Updated.reviewRequest.sent_at_formatted, 'Sent at timestamp should be populated');
  console.log('✓ Status transitioned to "Awaiting Response".');

  // 6. Test Customer 1: CONFIRM ALL CURRENT DATES
  console.log('\n6. Testing Customer 1 "CONFIRM ALL CURRENT DATES"...');
  const reviewData1 = dbMgr.getReviewDataByToken(cust1.token);
  assert(reviewData1.jobs.length > 0, 'Customer 1 should have jobs');
  const confirmPayload = reviewData1.jobs.map(j => ({
    jobId: j.id,
    originalRequiredDate: j.required_date,
    newRequiredDate: null,
    isChanged: false,
    contactRequested: false
  }));
  const confirmRes = dbMgr.submitCustomerResponse(cust1.token, 'CONFIRMED_ALL', confirmPayload);
  assert.strictEqual(confirmRes.success, true);
  assert.strictEqual(confirmRes.status, 'Confirmed');

  const cust1AfterConfirm = dbMgr.getCustomerById(cust1.id);
  assert.strictEqual(cust1AfterConfirm.reviewRequest.status, 'Confirmed');
  assert.strictEqual(cust1AfterConfirm.latestResponse.response_type, 'CONFIRMED_ALL');
  console.log('✓ Customer 1 confirmed all dates successfully with 1 click.');

  // 7. Test Customer 2: SUBMIT DATE CHANGES
  console.log('\n7. Testing Customer 2 "SUBMIT CHANGES"...');
  const cust2 = customers[1];
  const reviewData2 = dbMgr.getReviewDataByToken(cust2.token);
  const jobToChange = reviewData2.jobs[0];
  const originalDate = jobToChange.required_date;
  const newDate = '2026-11-20';

  const changePayload = reviewData2.jobs.map((j, idx) => {
    if (idx === 0) {
      return {
        jobId: j.id,
        originalRequiredDate: j.required_date,
        newRequiredDate: newDate,
        isChanged: true,
        contactRequested: true,
        customerComment: 'Civil contractor postponed handover'
      };
    }
    return {
      jobId: j.id,
      originalRequiredDate: j.required_date,
      newRequiredDate: null,
      isChanged: false,
      contactRequested: false
    };
  });

  const changeRes = dbMgr.submitCustomerResponse(cust2.token, 'CHANGES_SUBMITTED', changePayload);
  assert.strictEqual(changeRes.success, true);
  assert.strictEqual(changeRes.status, 'Changes Submitted');

  const cust2AfterChange = dbMgr.getCustomerById(cust2.id);
  assert.strictEqual(cust2AfterChange.reviewRequest.status, 'Changes Submitted');
  assert.strictEqual(cust2AfterChange.latestResponse.response_type, 'CHANGES_SUBMITTED');
  const changedItem = cust2AfterChange.latestResponse.items.find(i => i.is_changed === 1);
  assert(changedItem, 'Should have recorded changed item');
  assert.strictEqual(changedItem.original_required_date, originalDate);
  assert.strictEqual(changedItem.new_required_date, newDate);
  assert.strictEqual(changedItem.contact_requested, 1);
  assert.strictEqual(changedItem.customer_comment, 'Civil contractor postponed handover');
  console.log('✓ Customer 2 changes, original vs new dates, and contact note recorded accurately.');

  // 8. Test Updated Dashboard Metrics
  console.log('\n8. Testing Updated Dashboard Metrics...');
  const finalStats = dbMgr.getDashboardStats();
  assert.strictEqual(finalStats.confirmedCount, 1, 'Should have 1 confirmed customer');
  assert.strictEqual(finalStats.changesCount, 1, 'Should have 1 changes submitted customer');
  console.log('✓ Dashboard reflects 1 Confirmed and 1 Changes Submitted.');

  // 9. Test Re-importing Snapshot (Historical Data Preservation)
  console.log('\n9. Testing Re-import Snapshot (Preserving Historical Responses)...');
  const secondImportId = dbMgr.commitImport(parsed);
  assert(secondImportId > importId);
  const cust2AfterReimport = dbMgr.getCustomerById(cust2.id);
  assert.strictEqual(cust2AfterReimport.reviewRequest.status, 'Changes Submitted', 'Historical response status preserved');
  assert.strictEqual(cust2AfterReimport.latestResponse.items.length, 1, 'Historical response items preserved');
  console.log('✓ Snapshot re-imported safely without overwriting customer audit responses.');

  console.log('\n========================================');
  console.log('ALL E2E INTEGRATION TESTS PASSED (9/9)!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
