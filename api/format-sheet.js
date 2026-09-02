const { google } = require('googleapis');

module.exports = async (req, res) => {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || !process.env.GOOGLE_SHEET_ID) {
    return res.status(400).json({ error: 'GOOGLE_APPLICATION_CREDENTIALS_JSON and GOOGLE_SHEET_ID must be set in Vercel.' });
  }

  try {
    let credentials = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
      ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
      : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Get metadata to get target sheetId and title
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetObj = meta.data.sheets?.[0];
    const sheetId = sheetObj?.properties?.sheetId || 0;
    const tabName = sheetObj?.properties?.title || 'Sheet1';

    // 1. Write Header and Live Formula KPI Summary Block
    await sheets.spreadsheets.values.update({
      spreadsheetId,
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

    // 2. Build Category Colors & Conditional Formatting Rules
    const categories = [
      { name: 'Food', bg: { red: 1.0, green: 0.88, blue: 0.70 }, fg: { red: 0.8, green: 0.35, blue: 0.0 } }, // Orange
      { name: 'Transport', bg: { red: 0.78, green: 0.88, blue: 1.0 }, fg: { red: 0.0, green: 0.35, blue: 0.85 } }, // Blue
      { name: 'Shopping', bg: { red: 1.0, green: 0.78, blue: 0.86 }, fg: { red: 0.85, green: 0.1, blue: 0.3 } }, // Pink
      { name: 'Bills', bg: { red: 1.0, green: 0.96, blue: 0.72 }, fg: { red: 0.7, green: 0.5, blue: 0.0 } }, // Yellow
      { name: 'Health', bg: { red: 0.78, green: 0.95, blue: 0.82 }, fg: { red: 0.1, green: 0.6, blue: 0.2 } }, // Green
      { name: 'Home', bg: { red: 0.93, green: 0.87, blue: 0.80 }, fg: { red: 0.5, green: 0.35, blue: 0.2 } }, // Tan
      { name: 'Education', bg: { red: 0.91, green: 0.82, blue: 0.98 }, fg: { red: 0.5, green: 0.1, blue: 0.7 } }, // Purple
      { name: 'Entertainment', bg: { red: 0.85, green: 0.85, blue: 0.98 }, fg: { red: 0.3, green: 0.2, blue: 0.7 } }, // Indigo
      { name: 'Investments', bg: { red: 0.80, green: 0.95, blue: 1.0 }, fg: { red: 0.0, green: 0.5, blue: 0.7 } }, // Cyan
      { name: 'Salary', bg: { red: 0.78, green: 0.98, blue: 0.85 }, fg: { red: 0.0, green: 0.6, blue: 0.2 } }, // Mint
      { name: 'Other', bg: { red: 0.90, green: 0.90, blue: 0.92 }, fg: { red: 0.35, green: 0.35, blue: 0.35 } } // Gray
    ];

    const requests = [];

    // Freeze Row 1
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 }
        },
        fields: 'gridProperties.frozenRowCount'
      }
    });

    // Style Header Row (Dark Gray Background, Bold White Text)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.15, green: 0.15, blue: 0.17 },
            textFormat: { foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 }, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
      }
    });

    // Style Summary Header (H1:I1)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.1, green: 0.4, blue: 0.8 },
            textFormat: { foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 }, bold: true },
            horizontalAlignment: 'CENTER'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
      }
    });

    // Format Currency Columns (Column E and Column I)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '฿#,##0.00' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '฿#,##0.00' },
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(numberFormat,textFormat)'
      }
    });
    // Format Savings Rate as Percentage (I5)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(numberFormat,textFormat)'
      }
    });

    // Add Type Conditional Formatting: Income (Green) vs Expense (Red) in Column C
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Income' }] },
            format: {
              backgroundColor: { red: 0.85, green: 0.98, blue: 0.88 },
              textFormat: { foregroundColor: { red: 0.05, green: 0.6, blue: 0.2 }, bold: true }
            }
          }
        },
        index: 0
      }
    });
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Expense' }] },
            format: {
              backgroundColor: { red: 1.0, green: 0.90, blue: 0.90 },
              textFormat: { foregroundColor: { red: 0.8, green: 0.15, blue: 0.15 }, bold: true }
            }
          }
        },
        index: 1
      }
    });

    // Add Category Colors in Column D
    categories.forEach((cat, idx) => {
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: cat.name }] },
              format: {
                backgroundColor: cat.bg,
                textFormat: { foregroundColor: cat.fg, bold: true }
              }
            }
          },
          index: idx + 2
        }
      });
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });

    return res.status(200).json({
      ok: true,
      message: 'Google Sheet formatted successfully! Formulas and 10 category colors applied.',
      tabName,
      categoriesCount: categories.length
    });

  } catch (err) {
    console.error('Format sheet error:', err);
    return res.status(500).json({ error: `Formatting failed: ${err.message}` });
  }
};
