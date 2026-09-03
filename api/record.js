const { google } = require('googleapis');

async function parseRequestBody(req) {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  }
  if (contentType.includes('multipart/form-data') || contentType.includes('urlencoded')) {
    const { formidable } = require('formidable');
    const form = formidable({ multiples: false, maxFileSize: 10 * 1024 * 1024 });
    const [fields] = await form.parse(req);
    const res = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = Array.isArray(v) ? v[0] : v;
    }
    return res;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseRequestBody(req);
    let amount = body.amount;
    const type = body.type;
    const category = body.category;
    const date = body.date;
    const description = body.description || '';

    if (amount !== undefined && amount !== null) {
      amount = Number(String(amount).replace(/[, ]/g, ''));
    }

    if (!amount || isNaN(amount) || amount <= 0 || !type || !category || !date) {
      return res.status(400).json({ error: 'Valid amount (> 0), type, category, and date are required' });
    }

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      return res.status(500).json({
        error: 'GOOGLE_APPLICATION_CREDENTIALS_JSON is missing in Vercel environment variables.'
      });
    }

    if (!process.env.GOOGLE_SHEET_ID) {
      return res.status(500).json({
        error: 'GOOGLE_SHEET_ID is missing in Vercel environment variables.'
      });
    }

    let credentials;
    try {
      credentials = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
        ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    } catch (err) {
      return res.status(500).json({
        error: `Invalid JSON in GOOGLE_APPLICATION_CREDENTIALS_JSON: ${err.message}`
      });
    }

    if (credentials.installed || credentials.web) {
      return res.status(500).json({
        error: 'You provided an OAuth Client ID key. A Google Service Account JSON key is required.'
      });
    }

    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Step 1: Detect Tab Name Dynamically (or use configured GOOGLE_SHEET_TAB)
    let tabName = process.env.GOOGLE_SHEET_TAB;
    if (!tabName) {
      try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
        tabName = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
      } catch (metaErr) {
        if (metaErr.message?.includes('caller does not have permission')) {
          return res.status(403).json({
            error: `Permission denied on Google Sheet. Please open your Google Sheet, click Share, and add your Service Account email as Editor: ${credentials.client_email}`
          });
        }
        if (metaErr.message?.includes('not found')) {
          return res.status(404).json({
            error: `Google Sheet ID "${process.env.GOOGLE_SHEET_ID}" was not found. Please verify GOOGLE_SHEET_ID in Vercel.`
          });
        }
        tabName = 'Sheet1';
      }
    }

    // Step 2: Check if Sheet needs Header Row or Summary Formulas
    try {
      const checkRange = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${tabName}!A1:I1`,
      });
      const existingHeaders = checkRange.data.values?.[0] || [];
      if (existingHeaders.length === 0) {
        // Automatically insert clean headers AND KPI summary block
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `${tabName}!A1:I5`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [
              ['Timestamp', 'Date', 'Type', 'Category', 'Amount (THB)', 'Description', '', '📊 SUMMARY', '฿ (THB)'],
              ['', '', '', '', '', '', '', '🟢 Total Income', '=SUMIF(C:C, "Income", E:E)'],
              ['', '', '', '', '', '', '', '🔴 Total Expense', '=SUMIF(C:C, "Expense", E:E)'],
              ['', '', '', '', '', '', '', '🔵 Combined Net', '=I2 - I3'],
              ['', '', '', '', '', '', '', '⭐ Savings Rate', '=IF(I2>0, (I2-I3)/I2, 0)']
            ]
          }
        });
      }
    } catch (headerErr) {
      console.warn('Header auto-check skipped:', headerErr.message);
    }

    // Step 3: Append Transaction Row (Clean & Direct)
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    const formattedAmount = Number(amount);
    const formattedType = type.toLowerCase() === 'income' ? 'Income' : 'Expense';

    const values = [[
      timestamp,
      date,
      formattedType,
      category,
      formattedAmount,
      description,
    ]];

    const out = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${tabName}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    const rowNumber = out.data.updates?.updatedRange?.match(/![A-Z]+(\d+)/)?.[1] || null;

    return res.status(200).json({
      ok: true,
      rowNumber,
      tabName,
      type: formattedType,
      category,
      amount: formattedAmount
    });

  } catch (e) {
    console.error('Record error:', e);
    return res.status(500).json({
      error: `Save failed: ${e.message || 'Check server logs'}`
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
