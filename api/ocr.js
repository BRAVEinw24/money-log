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

    let clientConfig = {};
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try {
        const credentials = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
          ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
          : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
        clientConfig = { credentials };
      } catch (err) {
        console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', err);
      }
    }

    const client = new ImageAnnotatorClient(clientConfig);
    const fileContent = fs.readFileSync(receipt.filepath);
    const [result] = await client.documentTextDetection({ image: { content: fileContent } });
    const text = result.fullTextAnnotation?.text || '';
    const amount = findAmount(text);
    return res.status(200).json({ amount, description: '', rawText: text.slice(0, 1000) });
  } catch (e) {
    console.error('OCR failed:', e);
    return res.status(500).json({ error: e.message || 'OCR failed. Check Google Cloud Vision credentials.' });
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

