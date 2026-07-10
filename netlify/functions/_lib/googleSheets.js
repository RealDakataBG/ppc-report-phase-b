/* Reads the (private) to-do Google Sheet as a service account. */
const { google } = require('googleapis');

function getCredentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is not set.');
  }
  const json = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8');
  return JSON.parse(json);
}

async function getSheetsClient() {
  const credentials = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

/**
 * @returns {Promise<Array<Array<string>>>} raw sheet rows as an array-of-arrays
 *   (row 0 = header: ["", "January", ..., "December"])
 */
async function fetchTodoSheetRows() {
  const spreadsheetId = process.env.TODO_SHEET_ID;
  const gid = Number(process.env.TODO_SHEET_GID || '0');
  if (!spreadsheetId) throw new Error('TODO_SHEET_ID environment variable is not set.');

  const sheets = await getSheetsClient();

  // The Sheets v4 API addresses ranges by tab *title*, not gid - resolve it
  // dynamically rather than guessing/hardcoding a title.
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const tab = (meta.data.sheets || []).find((s) => s.properties.sheetId === gid);
  if (!tab) throw new Error('Tabellenblatt mit gid=' + gid + ' wurde nicht gefunden.');
  const title = tab.properties.title;

  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'" + title.replace(/'/g, "''") + "'!A1:M200"
  });
  return valuesRes.data.values || [];
}

module.exports = { fetchTodoSheetRows };
