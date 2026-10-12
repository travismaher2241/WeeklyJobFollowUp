// db.js
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { formatDateAU, formatDateTimeAU } = require('./lib/date-utils');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'plasgain.db');
const db = new Database(dbPath);

// Enable WAL mode and foreign keys for performance and data integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_rows INTEGER NOT NULL,
      open_jobs_count INTEGER NOT NULL,
      customers_count INTEGER NOT NULL,
      status TEXT DEFAULT 'committed'
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER REFERENCES imports(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      job_order_number TEXT NOT NULL,
      description TEXT NOT NULL,
      purchase_order TEXT,
      required_date TEXT NOT NULL, -- Stored as YYYY-MM-DD
      status TEXT DEFAULT 'Open',
      is_active INTEGER DEFAULT 1, -- 1 = currently open in latest snapshot
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS review_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      token TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'Not Sent', -- 'Not Sent', 'Awaiting Response', 'Confirmed', 'Changes Submitted'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME NULL,
      responded_at DATETIME NULL
    );

    CREATE TABLE IF NOT EXISTS job_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_request_id INTEGER NOT NULL REFERENCES review_requests(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      response_type TEXT NOT NULL, -- 'CONFIRMED_ALL', 'CHANGES_SUBMITTED'
      notes TEXT,
      responded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS job_response_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_response_id INTEGER NOT NULL REFERENCES job_responses(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      original_required_date TEXT NOT NULL,
      new_required_date TEXT,
      is_changed INTEGER DEFAULT 0,
      contact_requested INTEGER DEFAULT 0,
      customer_comment TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_customer_active ON jobs(customer_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_review_requests_token ON review_requests(token);
    CREATE INDEX IF NOT EXISTS idx_review_requests_customer ON review_requests(customer_id);
  `);
}

initSchema();

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value);
  }
}

function generateSecureToken() {
  return crypto.randomBytes(20).toString('hex');
}

// Commit parsed import data in a single atomic transaction
function commitImport(parsedResult) {
  const commitTx = db.transaction(() => {
    // 1. Insert import record
    const insertImport = db.prepare(`
      INSERT INTO imports (filename, total_rows, open_jobs_count, customers_count, status)
      VALUES (?, ?, ?, ?, 'committed')
    `);
    const importRes = insertImport.run(
      parsedResult.filename,
      parsedResult.totalRows,
      parsedResult.openJobsCount,
      parsedResult.customersCount
    );
    const importId = importRes.lastInsertRowid;

    // Prepared statements
    const findCustomer = db.prepare('SELECT id FROM customers WHERE name = ?');
    const insertCustomer = db.prepare('INSERT INTO customers (name) VALUES (?)');
    const deactivateCustomerJobs = db.prepare('UPDATE jobs SET is_active = 0 WHERE customer_id = ?');
    const insertJob = db.prepare(`
      INSERT INTO jobs (import_id, customer_id, job_order_number, description, purchase_order, required_date, status, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 'Open', 1)
    `);
    const findReviewRequest = db.prepare('SELECT id, token, status FROM review_requests WHERE customer_id = ?');
    const insertReviewRequest = db.prepare(`
      INSERT INTO review_requests (customer_id, token, status)
      VALUES (?, ?, 'Not Sent')
    `);

    // Group open jobs by customer
    const jobsByCustomer = {};
    for (const job of parsedResult.openJobs) {
      if (!jobsByCustomer[job.customerName]) {
        jobsByCustomer[job.customerName] = [];
      }
      jobsByCustomer[job.customerName].push(job);
    }

    for (const customerName of Object.keys(jobsByCustomer)) {
      // Find or create customer
      let customerRow = findCustomer.get(customerName);
      let customerId;
      if (customerRow) {
        customerId = customerRow.id;
      } else {
        const custRes = insertCustomer.run(customerName);
        customerId = custRes.lastInsertRowid;
      }

      // Mark previously active jobs as inactive for this snapshot
      deactivateCustomerJobs.run(customerId);

      // Insert new active snapshot jobs
      for (const job of jobsByCustomer[customerName]) {
        insertJob.run(
          importId,
          customerId,
          job.jobOrderNumber,
          job.description,
          job.purchaseOrder,
          job.requiredDate
        );
      }

      // Ensure review request token exists
      let reviewReq = findReviewRequest.get(customerId);
      if (!reviewReq) {
        insertReviewRequest.run(customerId, generateSecureToken());
      }
    }

    return importId;
  });

  return commitTx();
}

// Get Admin KPI statistics
function getDashboardStats() {
  const openJobs = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE is_active = 1').get().count;
  const customersCount = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) as count FROM jobs WHERE is_active = 1
  `).get().count;

  const awaitingCount = db.prepare(`
    SELECT COUNT(*) as count FROM review_requests rr
    WHERE rr.status = 'Awaiting Response'
  `).get().count;

  const confirmedCount = db.prepare(`
    SELECT COUNT(*) as count FROM review_requests rr
    WHERE rr.status = 'Confirmed'
  `).get().count;

  const changesCount = db.prepare(`
    SELECT COUNT(*) as count FROM review_requests rr
    WHERE rr.status = 'Changes Submitted'
  `).get().count;

  const notSentCount = db.prepare(`
    SELECT COUNT(*) as count FROM review_requests rr
    WHERE rr.status = 'Not Sent'
  `).get().count;

  const latestImport = db.prepare(`
    SELECT * FROM imports ORDER BY id DESC LIMIT 1
  `).get();

  return {
    openJobs,
    customersCount,
    awaitingCount,
    confirmedCount,
    changesCount,
    notSentCount,
    latestImport
  };
}

// List all customers with their active job counts and review status
function getCustomersList(filterStatus = null, searchQuery = null) {
  let sql = `
    SELECT 
      c.id,
      c.name,
      COUNT(j.id) as open_jobs_count,
      COALESCE(rr.status, 'Not Sent') as review_status,
      rr.token,
      rr.sent_at,
      rr.responded_at,
      (
        SELECT COUNT(*) 
        FROM job_response_items jri 
        JOIN job_responses jr ON jr.id = jri.job_response_id
        WHERE jr.customer_id = c.id AND jri.is_changed = 1
      ) as changed_dates_count
    FROM customers c
    JOIN jobs j ON j.customer_id = c.id AND j.is_active = 1
    LEFT JOIN review_requests rr ON rr.customer_id = c.id
    WHERE 1=1
  `;

  const params = [];

  if (filterStatus && filterStatus !== 'All') {
    sql += ` AND rr.status = ? `;
    params.push(filterStatus);
  }

  if (searchQuery && searchQuery.trim()) {
    sql += ` AND c.name LIKE ? `;
    params.push(`%${searchQuery.trim()}%`);
  }

  sql += `
    GROUP BY c.id, c.name, rr.status, rr.token, rr.sent_at, rr.responded_at
    ORDER BY c.name ASC
  `;

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({
    ...r,
    sent_at_formatted: r.sent_at ? formatDateTimeAU(r.sent_at) : 'Not Sent',
    responded_at_formatted: r.responded_at ? formatDateTimeAU(r.responded_at) : '-'
  }));
}

// Get customer by ID including active jobs and review status
function getCustomerById(customerId) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return null;

  const reviewRequest = db.prepare('SELECT * FROM review_requests WHERE customer_id = ?').get(customerId);
  
  const jobs = db.prepare(`
    SELECT * FROM jobs 
    WHERE customer_id = ? AND is_active = 1
    ORDER BY required_date ASC, id ASC
  `).all(customerId);

  const formattedJobs = jobs.map(j => ({
    ...j,
    required_date_formatted: formatDateAU(j.required_date)
  }));

  // Fetch latest response details if available
  const latestResponse = db.prepare(`
    SELECT * FROM job_responses 
    WHERE customer_id = ? 
    ORDER BY responded_at DESC LIMIT 1
  `).get(customerId);

  let responseItems = [];
  if (latestResponse) {
    responseItems = db.prepare(`
      SELECT 
        jri.*,
        j.job_order_number,
        j.description,
        j.purchase_order
      FROM job_response_items jri
      JOIN jobs j ON j.id = jri.job_id
      WHERE jri.job_response_id = ?
    `).all(latestResponse.id).map(item => ({
      ...item,
      original_date_formatted: formatDateAU(item.original_required_date),
      new_date_formatted: item.new_required_date ? formatDateAU(item.new_required_date) : null
    }));
  }

  return {
    ...customer,
    reviewRequest: reviewRequest ? {
      ...reviewRequest,
      sent_at_formatted: reviewRequest.sent_at ? formatDateTimeAU(reviewRequest.sent_at) : null,
      responded_at_formatted: reviewRequest.responded_at ? formatDateTimeAU(reviewRequest.responded_at) : null
    } : null,
    jobs: formattedJobs,
    latestResponse: latestResponse ? {
      ...latestResponse,
      responded_at_formatted: formatDateTimeAU(latestResponse.responded_at),
      items: responseItems
    } : null
  };
}

// Mark review request as sent
function markRequestAsSent(customerId) {
  const stmt = db.prepare(`
    UPDATE review_requests
    SET status = CASE WHEN status = 'Not Sent' THEN 'Awaiting Response' ELSE status END,
        sent_at = CURRENT_TIMESTAMP
    WHERE customer_id = ?
  `);
  stmt.run(customerId);
}

// Regenerate or ensure review token
function getOrCreateReviewToken(customerId) {
  let row = db.prepare('SELECT token FROM review_requests WHERE customer_id = ?').get(customerId);
  if (!row) {
    const token = generateSecureToken();
    db.prepare('INSERT INTO review_requests (customer_id, token, status) VALUES (?, ?, "Not Sent")').run(customerId, token);
    return token;
  }
  return row.token;
}

// Look up customer and jobs by public review token
function getReviewDataByToken(token) {
  const reviewRequest = db.prepare(`
    SELECT rr.*, c.name as customer_name
    FROM review_requests rr
    JOIN customers c ON c.id = rr.customer_id
    WHERE rr.token = ?
  `).get(token);

  if (!reviewRequest) return null;

  const jobs = db.prepare(`
    SELECT * FROM jobs 
    WHERE customer_id = ? AND is_active = 1
    ORDER BY required_date ASC, id ASC
  `).all(reviewRequest.customer_id);

  const formattedJobs = jobs.map(j => ({
    ...j,
    required_date_formatted: formatDateAU(j.required_date)
  }));

  const latestResponse = db.prepare(`
    SELECT * FROM job_responses 
    WHERE review_request_id = ? 
    ORDER BY responded_at DESC LIMIT 1
  `).get(reviewRequest.id);

  let responseItems = [];
  if (latestResponse) {
    responseItems = db.prepare(`
      SELECT jri.*, j.description, j.purchase_order
      FROM job_response_items jri
      JOIN jobs j ON j.id = jri.job_id
      WHERE jri.job_response_id = ?
    `).all(latestResponse.id).map(item => ({
      ...item,
      original_date_formatted: formatDateAU(item.original_required_date),
      new_date_formatted: item.new_required_date ? formatDateAU(item.new_required_date) : null
    }));
  }

  return {
    reviewRequest: {
      ...reviewRequest,
      responded_at_formatted: reviewRequest.responded_at ? formatDateTimeAU(reviewRequest.responded_at) : null
    },
    jobs: formattedJobs,
    latestResponse: latestResponse ? {
      ...latestResponse,
      responded_at_formatted: formatDateTimeAU(latestResponse.responded_at),
      items: responseItems
    } : null
  };
}

// Record Customer Response
function submitCustomerResponse(token, responseType, itemsData = [], notes = '') {
  const submitTx = db.transaction(() => {
    const reviewRequest = db.prepare('SELECT * FROM review_requests WHERE token = ?').get(token);
    if (!reviewRequest) {
      throw new Error('Invalid review link token.');
    }

    const customerId = reviewRequest.customer_id;
    const newStatus = responseType === 'CONFIRMED_ALL' ? 'Confirmed' : 'Changes Submitted';

    // 1. Update review request status
    db.prepare(`
      UPDATE review_requests
      SET status = ?, responded_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, reviewRequest.id);

    // 2. Insert job_responses record
    const insertResponse = db.prepare(`
      INSERT INTO job_responses (review_request_id, customer_id, response_type, notes)
      VALUES (?, ?, ?, ?)
    `);
    const respResult = insertResponse.run(reviewRequest.id, customerId, responseType, notes || null);
    const jobResponseId = respResult.lastInsertRowid;

    // 3. Insert response items
    const insertItem = db.prepare(`
      INSERT INTO job_response_items 
        (job_response_id, job_id, original_required_date, new_required_date, is_changed, contact_requested, customer_comment)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of itemsData) {
      insertItem.run(
        jobResponseId,
        item.jobId,
        item.originalRequiredDate,
        item.newRequiredDate || null,
        item.isChanged ? 1 : 0,
        item.contactRequested ? 1 : 0,
        item.customerComment || null
      );
    }

    return {
      success: true,
      responseId: jobResponseId,
      status: newStatus
    };
  });

  return submitTx();
}

module.exports = {
  db,
  commitImport,
  getDashboardStats,
  getCustomersList,
  getCustomerById,
  markRequestAsSent,
  getOrCreateReviewToken,
  getReviewDataByToken,
  submitCustomerResponse,
  getSetting,
  setSetting
};
