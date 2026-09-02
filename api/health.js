const { ImageAnnotatorClient } = require('@google-cloud/vision');

module.exports = async (req, res) => {
  const diagnostics = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID ? 'Configured (' + process.env.GOOGLE_SHEET_ID.slice(0, 6) + '...)' : 'MISSING',
      GOOGLE_SHEET_TAB: process.env.GOOGLE_SHEET_TAB || 'Default (Transactions)',
      GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID ? 'Configured (' + process.env.GOOGLE_DRIVE_FOLDER_ID.slice(0, 6) + '...)' : 'MISSING',
      GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? 'Present' : 'MISSING'
    },
    credentialsValidation: {
      validJson: false,
      credentialType: 'unknown',
      clientEmail: null,
      projectId: null,
      privateKeyFormatted: false
    },
    visionApiCheck: 'not_run'
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
    diagnostics.message = 'You uploaded an OAuth Client ID key. Vercel backend requires a Google Cloud Service Account JSON key.';
    return res.status(200).json(diagnostics);
  }

  diagnostics.credentialsValidation.credentialType = credentials.type || 'service_account';
  diagnostics.credentialsValidation.clientEmail = credentials.client_email || 'missing';
  diagnostics.credentialsValidation.projectId = credentials.project_id || 'missing';
  diagnostics.credentialsValidation.privateKeyFormatted = typeof credentials.private_key === 'string' && credentials.private_key.includes('BEGIN PRIVATE KEY');

  if (typeof credentials.private_key === 'string') {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  try {
    const client = new ImageAnnotatorClient({ credentials });
    // Quick probe with empty/dummy payload to test authentication handshake
    await client.getProjectId();
    diagnostics.visionApiCheck = 'authenticated_successfully';
  } catch (e) {
    diagnostics.status = 'error';
    diagnostics.visionApiCheck = `failed: ${e.message}`;
    diagnostics.message = `Google Cloud Vision authentication check failed: ${e.message}`;
  }

  return res.status(200).json(diagnostics);
};
