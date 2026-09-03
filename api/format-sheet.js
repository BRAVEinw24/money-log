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

    // Get metadata to get target sheetId, title, and existing conditional formatting rules
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [process.env.GOOGLE_SHEET_TAB || 'Transactions'],
      fields: 'sheets(properties,conditionalFormats)'
    });
    const sheetObj = meta.data.sheets?.[0];
    const sheetId = sheetObj?.properties?.sheetId || 0;
    const tabName = sheetObj?.properties?.title || 'Sheet1';
    const existingRuleCount = sheetObj?.conditionalFormats?.length || 0;

    // 1. Write Header (A1:F1) and Summary (H1:I5) separately so data rows are never overwritten
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `${tabName}!A1:F1`,
            values: [['Timestamp', 'Date', 'Type', 'Category', 'Amount (THB)', 'Description']]
          },
          {
            range: `${tabName}!H1:I5`,
            values: [
              ['📊 SUMMARY', '฿ (THB)'],
              ['🟢 Total Income', '=SUMIF(C:C, "Income", E:E)'],
              ['🔴 Total Expense', '=SUMIF(C:C, "Expense", E:E)'],
              ['🔵 Combined Net', '=I2 - I3'],
              ['⭐ Savings Rate', '=IF(I2>0, (I2-I3)/I2, 0)']
            ]
          }
        ]
      }
    });

    // 2. Build Category Colors & Conditional Formatting Rules (Yellow for Food, Green for Transport)
    const categories = [
      { name: 'Food', bg: { red: 1.0, green: 0.96, blue: 0.65 }, fg: { red: 0.55, green: 0.35, blue: 0.0 } }, // 🟡 Yellow (as requested)
      { name: 'Transport', bg: { red: 0.82, green: 0.96, blue: 0.85 }, fg: { red: 0.08, green: 0.50, blue: 0.20 } }, // 🟢 Green (as requested)
      { name: 'Shopping', bg: { red: 0.99, green: 0.88, blue: 0.93 }, fg: { red: 0.75, green: 0.10, blue: 0.35 } }, // 🌸 Pink / Rose
      { name: 'Bills', bg: { red: 1.0, green: 0.90, blue: 0.78 }, fg: { red: 0.80, green: 0.35, blue: 0.0 } }, // ⚡ Orange / Amber
      { name: 'Health', bg: { red: 1.0, green: 0.88, blue: 0.88 }, fg: { red: 0.75, green: 0.15, blue: 0.15 } }, // 🔴 Soft Coral / Red
      { name: 'Home', bg: { red: 0.95, green: 0.90, blue: 0.85 }, fg: { red: 0.50, green: 0.32, blue: 0.18 } }, // 🏠 Warm Tan / Sand
      { name: 'Education', bg: { red: 0.93, green: 0.88, blue: 0.99 }, fg: { red: 0.45, green: 0.12, blue: 0.70 } }, // 📚 Purple
      { name: 'Entertainment', bg: { red: 0.88, green: 0.90, blue: 0.99 }, fg: { red: 0.22, green: 0.20, blue: 0.65 } }, // 🎬 Indigo
      { name: 'Investments', bg: { red: 0.85, green: 0.96, blue: 0.99 }, fg: { red: 0.0, green: 0.45, blue: 0.60 } }, // 📈 Cyan
      { name: 'Salary', bg: { red: 0.85, green: 0.98, blue: 0.90 }, fg: { red: 0.05, green: 0.55, blue: 0.25 } }, // 💼 Mint
      { name: 'Other', bg: { red: 0.94, green: 0.95, blue: 0.96 }, fg: { red: 0.35, green: 0.38, blue: 0.42 } } // ✨ Charcoal Gray
    ];

    const requests = [];

    // Clear any previous conditional format rules to eliminate duplicates
    for (let i = existingRuleCount - 1; i >= 0; i--) {
      requests.push({
        deleteConditionalFormatRule: {
          sheetId,
          index: i
        }
      });
    }

    // Reset Sheet Background to Clean White & Dark Readable Text (Purge any dark/black background)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 12 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
            textFormat: { foregroundColor: { red: 0.08, green: 0.09, blue: 0.13 }, fontSize: 10, fontFamily: 'Arial' }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat(foregroundColor,fontSize,fontFamily))'
      }
    });

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

    // Style Header Row A1:F1 (Light TradingView Stone, Crisp Dark Navy Text)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.94, green: 0.95, blue: 0.98 },
            textFormat: { foregroundColor: { red: 0.08, green: 0.09, blue: 0.13 }, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
      }
    });

    // Style Summary Header (H1:I1) - Light TradingView Blue
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.88, green: 0.93, blue: 0.98 },
            textFormat: { foregroundColor: { red: 0.16, green: 0.38, blue: 1.0 }, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
      }
    });

    // Style Summary Card Body (H2:I5) - Soft Card White Background
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.97, green: 0.98, blue: 0.99 },
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold)'
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
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Income' }] },
            format: {
              backgroundColor: { red: 0.86, green: 0.98, blue: 0.90 },
              textFormat: { foregroundColor: { red: 0.03, green: 0.58, blue: 0.20 }, bold: true }
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
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Expense' }] },
            format: {
              backgroundColor: { red: 1.0, green: 0.90, blue: 0.90 },
              textFormat: { foregroundColor: { red: 0.85, green: 0.15, blue: 0.15 }, bold: true }
            }
          }
        },
        index: 1
      }
    });

    // Add Category Colors in Column D (Using TEXT_CONTAINS for bulletproof matching)
    categories.forEach((cat, idx) => {
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
            booleanRule: {
              condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: cat.name }] },
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
      message: 'Google Sheet formatted successfully! TradingView Light Theme, formulas, and 11 vibrant category colors applied.',
      tabName,
      categoriesCount: categories.length
    });

  } catch (err) {
    console.error('Format sheet error:', err);
    return res.status(500).json({ error: `Formatting failed: ${err.message}` });
  }
};
