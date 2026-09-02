const { formidable } = require('formidable');
const fs = require('fs');
const { google } = require('googleapis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const form = formidable({ multiples: false, maxFileSize: 10 * 1024 * 1024 });
  try {
    const [fields, files] = await form.parse(req);
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
        error: 'GOOGLE_APPLICATION_CREDENTIALS_JSON is not set in Vercel environment variables.'
      });
    }

    let credentials;
    try {
      credentials = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
        ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    } catch (err) {
      return res.status(500).json({
        error: `Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${err.message}`
      });
    }

    if (credentials.installed || credentials.web) {
      return res.status(500).json({
        error: 'GOOGLE_APPLICATION_CREDENTIALS_JSON is an OAuth client key. Please use a Service Account JSON key.'
      });
    }

    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });

    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const parent = process.env.GOOGLE_DRIVE_FOLDER_ID;
    let receiptUrl = '';

    const receipt = Array.isArray(files.receipt) ? files.receipt[0] : files.receipt;
    if (receipt && receipt.filepath) {
      const uploaded = await drive.files.create({
        requestBody: {
          name: `${date}-${category}-${receipt.originalFilename || 'receipt'}`,
          parents: parent ? [parent] : undefined,
        },
        media: {
          mimeType: receipt.mimetype || 'application/octet-stream',
          body: fs.createReadStream(receipt.filepath),
        },
        fields: 'id,webViewLink',
      });
      receiptUrl = uploaded.data.webViewLink || `https://drive.google.com/open?id=${uploaded.data.id}`;
    }

    const values = [[
      new Date().toISOString(),
      date,
      type,
      category,
      Number(amount),
      description,
      receiptUrl,
    ]];

    const out = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${process.env.GOOGLE_SHEET_TAB || 'Transactions'}!A:G`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    const rowNumber = out.data.updates?.updatedRange?.match(/![A-Z]+(\d+)/)?.[1] || null;
    return res.status(200).json({ ok: true, rowNumber, receiptUrl });
  } catch (e) {
    console.error('Record error:', e);
    return res.status(500).json({ error: e.message || 'Could not save. Check Google credentials and environment variables.' });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

