const { formidable } = require('formidable');
const { google } = require('googleapis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const form = formidable({ multiples: false, maxFileSize: 10 * 1024 * 1024 });

  try {
    const [fields] = await form.parse(req);
    const getField = (name) => Array.isArray(fields[name]) ? fields[name][0] : fields[name];

    const amount = getField('amount');
    const type = getField('type');
    const category = getField('category');
    const date = getField('date');
    const description = getField('description') || '';

    if (!amount || !type || !category || !date) {
      return res.status(400).json({ error: 'amount, type, category, and date are required' });
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

    // Step 2: Check if Sheet needs Header Row
    try {
      const checkRange = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${tabName}!A1:F1`,
      });
      if (!checkRange.data.values || checkRange.data.values.length === 0) {
        // Automatically insert clean gamified headers
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `${tabName}!A1:F1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [['Timestamp', 'Date', 'Type', 'Category', 'Amount (THB)', 'Description']]
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
