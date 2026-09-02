const { google } = require('googleapis');

module.exports = async (req, res) => {
  const diagnostics = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID ? 'Configured (' + process.env.GOOGLE_SHEET_ID.slice(0, 6) + '...)' : 'MISSING',
      GOOGLE_SHEET_TAB: process.env.GOOGLE_SHEET_TAB || 'Auto-detecting first tab',
      GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? 'Present' : 'MISSING'
    },
    credentialsValidation: {
      validJson: false,
      credentialType: 'unknown',
      clientEmail: null,
      projectId: null,
      privateKeyFormatted: false
    },
    googleSheetCheck: 'not_run'
  };

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    diagnostics.status = 'error';
    diagnostics.message = 'GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable is missing in Vercel settings.';
    return res.status(200).json(diagnostics);
  }

  let credentials;
  try {
    credentials = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
      ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
      : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    diagnostics.credentialsValidation.validJson = true;
  } catch (e) {
    diagnostics.status = 'error';
    diagnostics.message = `GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON: ${e.message}`;
    return res.status(200).json(diagnostics);
  }

  if (credentials.installed || credentials.web) {
    diagnostics.status = 'error';
    diagnostics.credentialsValidation.credentialType = 'OAuth Client ID (Installed/Web)';
    diagnostics.message = 'You uploaded an OAuth Client ID key. A Google Cloud Service Account JSON key is required.';
    return res.status(200).json(diagnostics);
  }

  diagnostics.credentialsValidation.credentialType = credentials.type || 'service_account';
  diagnostics.credentialsValidation.clientEmail = credentials.client_email || 'missing';
  diagnostics.credentialsValidation.projectId = credentials.project_id || 'missing';
  diagnostics.credentialsValidation.privateKeyFormatted = typeof credentials.private_key === 'string' && credentials.private_key.includes('BEGIN PRIVATE KEY');

  if (typeof credentials.private_key === 'string') {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Test Google Sheet Access & Tab Discovery
  if (process.env.GOOGLE_SHEET_ID) {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
      const tabNames = meta.data.sheets?.map(s => s.properties?.title) || [];
      diagnostics.googleSheetCheck = {
        accessible: true,
        title: meta.data.properties?.title || 'Untitled Sheet',
        availableTabs: tabNames
      };
    } catch (sheetErr) {
      diagnostics.status = 'error';
      diagnostics.googleSheetCheck = {
        accessible: false,
        error: sheetErr.message,
        actionRequired: `Share your Google Sheet with: ${credentials.client_email} as Editor.`
      };
    }
  }

  return res.status(200).json(diagnostics);
};
