const { formidable } = require('formidable');
const fs = require('fs');
const { google } = require('googleapis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const form = formidable({ multiples: false, maxFileSize: 10 * 1024 * 1024 });
  try {
    const [fields, files] = await form.parse(req);
    const required = ['amount', 'type', 'category', 'date'];
    for (const key of required) if (!fields[key]?.[0]) return res.status(400).json({ error: `${key} is required` });
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) : undefined;
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'] });
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const parent = process.env.GOOGLE_DRIVE_FOLDER_ID;
    let receiptUrl = '';
    const receipt = files.receipt?.[0];
    if (receipt) {
      const uploaded = await drive.files.create({ requestBody: { name: `${fields.date[0]}-${fields.category[0]}-${receipt.originalFilename}`, parents: parent ? [parent] : undefined }, media: { mimeType: receipt.mimetype || 'application/octet-stream', body: fs.createReadStream(receipt.filepath) }, fields: 'id,webViewLink' });
      receiptUrl = uploaded.data.webViewLink || `https://drive.google.com/open?id=${uploaded.data.id}`;
    }
    const values = [[new Date().toISOString(), fields.date[0], fields.type[0], fields.category[0], Number(fields.amount[0]), fields.description?.[0] || '', receiptUrl]];
    const out = await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${process.env.GOOGLE_SHEET_TAB || 'Sheet1'}!A:G`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values } });
    const rowNumber = out.data.updates?.updatedRange?.match(/![A-Z]+(\d+)/)?.[1] || null;
    return res.status(200).json({ ok: true, rowNumber, receiptUrl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Could not save. Check Google credentials and environment variables.' });
  }
};
module.exports.config = { api: { bodyParser: false } };
