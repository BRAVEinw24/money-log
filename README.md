# Money Log — Vercel + Google Drive

Receipt upload -> OCR amount preview -> confirmation -> Google Drive receipt upload + Google Sheet row.

## Google setup

1. Create a Google Cloud project and enable **Google Drive API**, **Google Sheets API**, and **Cloud Vision API**.
2. Create a service account and download its JSON key.
3. Create a Google Sheet with headers:
   `Created At | Date | Type | Category | Amount | Description | Receipt URL`
4. Share the Sheet and the Drive receipt folder with the service-account email as Editor.
5. Deploy this folder to Vercel.
6. Add these Vercel environment variables:
   - `GOOGLE_SHEET_ID`: the ID in the Sheet URL
   - `GOOGLE_SHEET_TAB`: usually `Sheet1`
   - `GOOGLE_DRIVE_FOLDER_ID`: `1yXW1TUCuCbk53qzf-UQ9Mb2XkqH9vK90` (Income and Expense Record folder)
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON`: the complete service-account JSON

## Important credential note

Vercel serverless functions need credentials in an environment variable. Before deployment, update `api/ocr.js` and `api/record.js` to use the JSON from `GOOGLE_APPLICATION_CREDENTIALS_JSON`, for example:

```js
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const auth = new google.auth.GoogleAuth({ credentials, scopes: [...] });
```

For Vision, pass the same `credentials` object to `new ImageAnnotatorClient({ credentials })`.

Never commit the JSON key to GitHub or upload it into the website.

## Local check

```bash
npm install
npm run dev
```

The OCR parser returns a suggested amount and the UI always shows it for confirmation before saving.
