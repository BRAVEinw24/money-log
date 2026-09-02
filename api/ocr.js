const { formidable } = require('formidable');
const fs = require('fs');
const { ImageAnnotatorClient } = require('@google-cloud/vision');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const form = formidable({ multiples: false, maxFileSize: 10 * 1024 * 1024 });
  try {
    const [, files] = await form.parse(req);
    const receipt = Array.isArray(files.receipt) ? files.receipt[0] : files.receipt;
    if (!receipt || !receipt.filepath) return res.status(400).json({ error: 'Receipt file is required' });

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      return res.status(500).json({
        error: 'GOOGLE_APPLICATION_CREDENTIALS_JSON is not set in Vercel environment variables. Please add it in Vercel Settings -> Environment Variables, then click Redeploy.'
      });
    }

    let credentials;
    try {
      credentials = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
        ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    } catch (parseErr) {
      return res.status(500).json({
        error: `Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON as JSON: ${parseErr.message}`
      });
    }

    if (credentials.installed || credentials.web) {
      return res.status(500).json({
        error: 'You pasted an OAuth Client ID key (starts with "installed" or "web"). Google Cloud Vision requires a Service Account JSON key (starts with {"type": "service_account", ...}).'
      });
    }

    if (!credentials.client_email || !credentials.private_key) {
      return res.status(500).json({
        error: 'Service account JSON is missing client_email or private_key. Please download a new key from Google Cloud Console -> IAM & Admin -> Service Accounts.'
      });
    }

    // Fix escaped newlines in Vercel environment variables
    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const client = new ImageAnnotatorClient({ credentials });
    const fileContent = fs.readFileSync(receipt.filepath);
    const [result] = await client.documentTextDetection({ image: { content: fileContent } });
    const text = result.fullTextAnnotation?.text || '';
    const amount = findAmount(text);
    return res.status(200).json({ amount, description: '', rawText: text.slice(0, 1000) });
  } catch (e) {
    console.error('OCR failed:', e);
    return res.status(500).json({
      error: `OCR error: ${e.message || 'Check Google Cloud Vision API status and credentials.'}`
    });
  }
};

function findAmount(text) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    const matches = line.match(/(?:฿|บาท|thb|total|ยอดรวม|รวมทั้งสิ้น|amount|ยอดชำระ)?\s*([0-9]{1,3}(?:[, ][0-9]{3})*(?:\.\d{2})?)/gi) || [];
    for (const m of matches) {
      const n = Number((m.match(/[0-9][0-9, ]*(?:\.\d{2})?/) || [''])[0].replace(/[, ]/g, ''));
      if (Number.isFinite(n) && n > 0 && n < 100000000) candidates.push({ n, priority: /total|ยอดรวม|รวมทั้งสิ้น|amount|ยอดชำระ/i.test(m) ? 2 : 1 });
    }
  }
  candidates.sort((a, b) => b.priority - a.priority || b.n - a.n);
  return candidates[0]?.n ?? null;
}

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

