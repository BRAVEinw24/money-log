const { google } = require('googleapis');

module.exports = async (req, res) => {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || !process.env.GOOGLE_SHEET_ID) {
    return res.status(200).json({
      ok: false,
      totalIncome: 0,
      totalExpense: 0,
      netBalance: 0,
      categoryTotals: {},
      recent: [],
      error: 'Google Sheet or credentials not configured.'
    });
  }

  try {
    let credentials;
    try {
      credentials = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
        ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Invalid credentials JSON.' });
    }

    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Step 1: Detect tab name
    let tabName = process.env.GOOGLE_SHEET_TAB;
    if (!tabName) {
      try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
        tabName = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
      } catch (err) {
        tabName = 'Sheet1';
      }
    }

    // Step 2: Fetch rows (UNFORMATTED_VALUE returns raw numbers directly)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${tabName}!A2:F`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });

    const rows = response.data.values || [];
    let totalIncome = 0;
    let totalExpense = 0;
    const categoryTotals = {};

    // Calculate totals
    for (const row of rows) {
      const type = (row[2] || '').toString().trim().toLowerCase();
      const category = (row[3] || 'Other').toString().trim();
      const rawVal = row[4];
      const amount = typeof rawVal === 'number'
        ? rawVal
        : parseFloat(String(rawVal || '').replace(/[^0-9.-]+/g, '')) || 0;

      if (type === 'income') {
        totalIncome += amount;
      } else {
        totalExpense += amount;
        categoryTotals[category] = (categoryTotals[category] || 0) + amount;
      }
    }

    const netBalance = totalIncome - totalExpense;

    // Get the last 6 recent transactions in reverse chronological order
    const recent = rows.slice(-6).reverse().map((r, idx) => {
      const rawVal = r[4];
      const amount = typeof rawVal === 'number'
        ? rawVal
        : parseFloat(String(rawVal || '').replace(/[^0-9.-]+/g, '')) || 0;
      return {
        id: idx,
        timestamp: r[0] || '',
        date: r[1] || '',
        type: (r[2] || '').toString().toLowerCase() === 'income' ? 'Income' : 'Expense',
        category: r[3] || 'Other',
        amount,
        description: r[5] || ''
      };
    });

    return res.status(200).json({
      ok: true,
      tabName,
      totalIncome,
      totalExpense,
      netBalance,
      categoryTotals,
      totalTransactions: rows.length,
      recent
    });

  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({
      ok: false,
      totalIncome: 0,
      totalExpense: 0,
      netBalance: 0,
      categoryTotals: {},
      recent: [],
      error: err.message
    });
  }
};
