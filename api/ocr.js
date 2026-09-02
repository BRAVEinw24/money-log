const { formidable } = require('formidable');
const fs = require('fs');
const { ImageAnnotatorClient } = require('@google-cloud/vision');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const form = formidable({ multiples: false, maxFileSize: 10 * 1024 * 1024 });
  try {
    const [, files] = await form.parse(req);
    const receipt = files.receipt?.[0];
    if (!receipt) return res.status(400).json({ error: 'Receipt file is required' });
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) : undefined;
    const client = new ImageAnnotatorClient(credentials ? { credentials } : {});
    const [result] = await client.documentTextDetection({ image: { content: fs.readFileSync(receipt.filepath) } });
    const text = result.fullTextAnnotation?.text || '';
    const amount = findAmount(text);
    return res.status(200).json({ amount, description: '', rawText: text.slice(0, 1000) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'OCR failed. Check Google Cloud Vision credentials.' });
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
