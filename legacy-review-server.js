// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const dbMgr = require('./db');
const { parseJobOrdersFile } = require('./lib/excel-parser');
const { formatDateTimeAU } = require('./lib/date-utils');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xls' || ext === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('Only .xls and .xlsx Excel files are supported.'));
    }
  }
});

// Staging cache for import previews
const stagingPreviews = new Map();

// View engine setup
app.set('views', [
  path.join(__dirname, 'views'),
  path.join(__dirname, 'views', 'admin'),
  path.join(__dirname, 'views', 'customer')
]);
app.set('view engine', 'ejs');

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('trust proxy', true);

// Helper for building host URL (supports configured domain, tunnel, or env var)
function getHostUrl(req) {
  if (process.env.APP_BASE_URL && process.env.APP_BASE_URL.trim()) {
    return process.env.APP_BASE_URL.trim().replace(/\/+$/, '');
  }
  const configured = dbMgr.getSetting('base_url');
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

// --- ADMIN ROUTES ---

// Update Public Base URL setting
app.post('/admin/settings/base-url', (req, res) => {
  const { baseUrl } = req.body;
  dbMgr.setSetting('base_url', baseUrl ? baseUrl.trim() : '');
  const returnTo = req.headers.referer || '/admin';
  res.redirect(returnTo);
});

// Redirect root to /admin
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Admin Dashboard
app.get('/admin', (req, res) => {
  const currentStatus = req.query.status || 'All';
  const searchQuery = req.query.q || '';
  const successMessage = req.query.msg || null;

  const stats = dbMgr.getDashboardStats();
  const customers = dbMgr.getCustomersList(currentStatus, searchQuery);

  res.render('admin/dashboard', {
    title: 'Customer Dashboard',
    stats,
    customers,
    currentStatus,
    searchQuery,
    successMessage,
    host: getHostUrl(req),
    configuredBaseUrl: dbMgr.getSetting('base_url') || ''
  });
});

// Upload View
app.get('/admin/upload', (req, res) => {
  res.render('admin/upload', {
    title: 'Upload Job Orders',
    error: req.query.error || null
  });
});

// Handle Upload & Stage Preview
app.post('/admin/upload', upload.single('excelFile'), (req, res) => {
  if (!req.file) {
    return res.redirect('/admin/upload?error=Please+select+an+Excel+file+to+upload.');
  }

  const tempFilePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    const parsedResult = parseJobOrdersFile(tempFilePath, originalName);

    // Remove temp file from disk once parsed into memory
    fs.unlink(tempFilePath, () => {});

    if (parsedResult.openJobsCount === 0) {
      return res.render('admin/upload', {
        title: 'Upload Job Orders',
        error: `No open jobs found in "${originalName}". Please ensure the spreadsheet contains rows with Status = "Open".`
      });
    }

    const previewId = crypto.randomUUID();
    stagingPreviews.set(previewId, {
      ...parsedResult,
      createdAt: new Date()
    });

    res.redirect(`/admin/preview/${previewId}`);
  } catch (err) {
    // Clean up temp file
    fs.unlink(tempFilePath, () => {});
    console.error('File parsing error:', err);
    res.render('admin/upload', {
      title: 'Upload Job Orders',
      error: `Could not parse the spreadsheet: ${err.message}`
    });
  }
});

// Import Preview View
app.get('/admin/preview/:previewId', (req, res) => {
  const previewData = stagingPreviews.get(req.params.previewId);
  if (!previewData) {
    return res.redirect('/admin/upload?error=Preview+session+expired.+Please+upload+your+file+again.');
  }

  res.render('admin/preview', {
    title: 'Import Preview',
    previewId: req.params.previewId,
    previewData,
    importDateFormatted: formatDateTimeAU(previewData.createdAt)
  });
});

// Commit Import to Database
app.post('/admin/preview/:previewId/commit', (req, res) => {
  const previewData = stagingPreviews.get(req.params.previewId);
  if (!previewData) {
    return res.redirect('/admin/upload?error=Preview+session+expired.+Please+upload+your+file+again.');
  }

  try {
    dbMgr.commitImport(previewData);
    stagingPreviews.delete(req.params.previewId);

    const msg = encodeURIComponent(
      `Successfully imported ${previewData.openJobsCount} open jobs across ${previewData.customersCount} customers from ${previewData.filename}.`
    );
    res.redirect(`/admin?msg=${msg}`);
  } catch (err) {
    console.error('Import commit error:', err);
    res.status(500).send(`Failed to commit import: ${err.message}`);
  }
});

// Customer Detail & Links View
app.get('/admin/customers/:id', (req, res) => {
  const customer = dbMgr.getCustomerById(parseInt(req.params.id));
  if (!customer) {
    return res.status(404).send('Customer not found');
  }

  const reviewUrl = `${getHostUrl(req)}/review/${customer.reviewRequest ? customer.reviewRequest.token : ''}`;

  res.render('admin/customer-detail', {
    title: `${customer.name} - Job Orders`,
    customer,
    reviewUrl
  });
});

// Mark Review Link as Sent
app.post('/admin/customers/:id/mark-sent', (req, res) => {
  dbMgr.markRequestAsSent(parseInt(req.params.id));
  res.redirect(`/admin/customers/${req.params.id}`);
});

// --- CUSTOMER FACING ROUTES ---

// Public Customer Review Page (No login, token-based)
app.get('/review/:token', (req, res) => {
  const token = req.params.token;
  const reviewData = dbMgr.getReviewDataByToken(token);

  if (!reviewData) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><title>Review Link Not Found</title><script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-slate-50 flex items-center justify-center min-h-screen p-4 text-center">
        <div class="max-w-md bg-white p-8 rounded-2xl border border-slate-200 shadow-md">
          <h1 class="text-xl font-bold text-slate-800">Invalid or Expired Link</h1>
          <p class="text-sm text-slate-500 mt-2">This review link is not valid. Please contact Plasgain to request a current review link.</p>
        </div>
      </body>
      </html>
    `);
  }

  res.render('customer/review', {
    title: 'Confirm Required Dates',
    reviewData
  });
});

// Customer Submit Response (JSON API)
app.post('/review/:token/submit', (req, res) => {
  const token = req.params.token;
  const { responseType, items, notes } = req.body;

  try {
    const result = dbMgr.submitCustomerResponse(token, responseType, items, notes);
    res.json(result);
  } catch (err) {
    console.error('Customer response submit error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Customer Thank You Screen
app.get('/review/:token/thank-you', (req, res) => {
  const token = req.params.token;
  const reviewData = dbMgr.getReviewDataByToken(token);

  if (!reviewData) {
    return res.redirect('/');
  }

  res.render('customer/thank-you', {
    customerName: reviewData.reviewRequest.customer_name,
    respondedAtFormatted: reviewData.reviewRequest.responded_at_formatted || formatDateTimeAU(new Date()),
    type: req.query.type || 'confirmed'
  });
});

// Multer error handling
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.render('admin/upload', {
      title: 'Upload Job Orders',
      error: err.message || 'File upload error occurred.'
    });
  }
  next();
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Plasgain Job Follow Up running at http://localhost:${PORT}`);
  });
}

module.exports = app;
