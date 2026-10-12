const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { parseJobOrdersFile } = require('./lib/excel-parser');
const { formatDateTimeAU } = require('./lib/export-dates');
const { createCustomerWorkbook, createAllWorkbooks, filename } = require('./lib/customer-spreadsheets');

const app = express();
const batches = new Map();
const TTL = 8 * 60 * 60 * 1000;
const tmpDir = os.tmpdir();

function getBatch(id) {
  if (batches.has(id)) return batches.get(id);
  try {
    const p = path.join(tmpDir, `plasgain-batch-${id}.json`);
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      data.createdAt = new Date(data.createdAt);
      batches.set(id, data);
      return data;
    }
  } catch {}
  return null;
}

function saveBatch(id, batch) {
  batches.set(id, batch);
  try {
    const p = path.join(tmpDir, `plasgain-batch-${id}.json`);
    fs.writeFileSync(p, JSON.stringify(batch));
  } catch {}
}

function deleteBatch(id) {
  batches.delete(id);
  try {
    const p = path.join(tmpDir, `plasgain-batch-${id}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(/\.xlsx?$/i.test(file.originalname) ? null : new Error('Choose an .xls or .xlsx Excel file.'), true);
  }
});

app.disable('x-powered-by');
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views/export'));

// Normalization middleware for serverless / Vercel rewrites
app.use((req, res, next) => {
  const matched = req.headers['x-matched-path'];
  if (matched && !req.url.startsWith('/css') && !req.url.startsWith('/js')) {
    req.url = matched;
  }
  if (req.url.startsWith('/server.js')) {
    req.url = req.url.slice('/server.js'.length) || '/';
  }
  if (req.url.startsWith('/api')) {
    req.url = req.url.slice('/api'.length) || '/';
  }
  next();
});

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  
  const password = process.env.ADMIN_PASSWORD;
  if (password) {
    const encoded = (req.headers.authorization || '').match(/^Basic (.+)$/)?.[1];
    const given = Buffer.from(encoded || '', 'base64').toString();
    const expected = `admin:${password}`;
    if (!crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), crypto.createHash('sha256').update(expected).digest())) {
      return res.status(401).set('WWW-Authenticate', 'Basic realm="Plasgain spreadsheets"').send('Sign in to generate customer files.');
    }
  } else if (process.env.LOCAL_ONLY === 'true' && !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) {
    return res.status(403).send('Local access only.');
  }

  if (req.method === 'POST' && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.get('host')) return res.status(403).send('Request origin not allowed.');
    } catch {
      return res.status(403).send('Invalid request origin.');
    }
  }

  for (const [id, b] of batches) {
    if (Date.now() - b.createdAt.getTime() > TTL) deleteBatch(id);
  }
  next();
});

app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function home(res, error = null, status = 200) {
  res.status(status).render('upload', { title: 'Customer spreadsheets', error });
}

app.get('/', (req, res) => home(res));
app.get(['/admin', '/admin/upload'], (req, res) => res.redirect('/'));

app.post('/upload', upload.single('excelFile'), (req, res, next) => {
  try {
    if (!req.file) return home(res, 'Choose your Ostendo export first.', 400);
    const parsed = parseJobOrdersFile(req.file.buffer, req.file.originalname);
    if (parsed.error) return home(res, parsed.error, 400);
    if (!parsed.openJobsCount) return home(res, 'No valid open jobs found. No customer files were created. Check the Status and Required Date columns.', 400);
    if (batches.size >= 20) return home(res, 'There are already 20 uploads open. Cancel an old upload or restart the app before uploading again.', 429);
    
    const grouped = new Map();
    for (const job of parsed.openJobs) {
      if (!grouped.has(job.customerName)) grouped.set(job.customerName, []);
      grouped.get(job.customerName).push(job);
    }
    const createdAt = new Date();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(createdAt);
    const id = crypto.randomBytes(24).toString('hex');
    
    const batchData = {
      ...parsed,
      id,
      createdAt,
      date,
      ready: false,
      customers: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([name, jobs]) => ({ name, jobs }))
    };
    saveBatch(id, batchData);
    res.redirect(`/batches/${id}/preview`);
  } catch (e) {
    next(e);
  }
});

app.use('/batches/:id', (req, res, next) => {
  req.batch = getBatch(req.params.id);
  if (!req.batch) return home(res, 'This upload has expired or the app was restarted. Please upload the export again.', 404);
  next();
});

app.get('/batches/:id/preview', (req, res) => res.render('preview', { title: 'Check your export', batch: req.batch, formatDateTimeAU }));
app.post('/batches/:id/cancel', (req, res) => {
  deleteBatch(req.params.id);
  res.redirect('/');
});
app.post('/batches/:id/confirm', (req, res) => {
  req.batch.ready = true;
  saveBatch(req.params.id, req.batch);
  res.redirect(`/batches/${req.params.id}`);
});

app.use('/batches/:id', (req, res, next) => {
  if (!req.batch.ready) return res.status(409).send('Review and confirm this upload before downloading files.');
  next();
});

app.get('/batches/:id', (req, res) => res.render('customers', { title: 'Download customer files', batch: req.batch, formatDateTimeAU }));

app.get('/batches/:id/all.zip', (req, res) => {
  res.attachment(`Plasgain - ${req.batch.date} - Customer Follow Ups.zip`).send(createAllWorkbooks(req.batch));
});

app.get('/batches/:id/customers/:index.xlsx', (req, res) => {
  if (!/^\d+$/.test(req.params.index)) return res.sendStatus(404);
  const i = Number(req.params.index);
  const c = req.batch.customers[i];
  if (!c) return res.sendStatus(404);
  res.attachment(filename(c.name, i, req.batch.date)).send(createCustomerWorkbook(c.name, c.jobs, req.batch.createdAt));
});

app.use('/review', (req, res) => res.status(404).send('Customer review links are no longer used.'));
app.use((req, res) => res.status(404).send('Page not found (404).'));

app.use((err, req, res, next) => {
  console.error('Spreadsheet export:', err.message);
  home(res, err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large. Maximum size is 25 MB.' : err.message, 400);
});

if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_PASSWORD before allowing network access.');
  }
  app.listen(Number(process.env.PORT) || 3000, host, () => console.log(`Plasgain spreadsheets: http://${host}:${process.env.PORT || 3000}`));
}

module.exports = app;
