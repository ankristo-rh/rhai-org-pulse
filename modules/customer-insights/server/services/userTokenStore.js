/**
 * Simple user token storage for Google OAuth tokens
 * Stores tokens in local JSON file keyed by user email
 */

const path = require('path')
const fs = require('fs').promises

const TOKEN_FILE = path.join(process.cwd(), 'data', 'customer-insights', 'user-tokens.json')

/**
 * Get tokens for a user
 * @param {string} userEmail
 * @returns {Promise<object|null>}
 */
async function getTokens(userEmail) {
  try {
    const data = await fs.readFile(TOKEN_FILE, 'utf8')
    const tokens = JSON.parse(data)
    return tokens[userEmail] || null
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/**
 * Save tokens for a user
 * @param {string} userEmail
 * @param {object} tokens
 */
async function saveTokens(userEmail, tokens) {
  let allTokens = {}
  try {
    const data = await fs.readFile(TOKEN_FILE, 'utf8')
    allTokens = JSON.parse(data)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  allTokens[userEmail] = {
    ...tokens,
    updatedAt: new Date().toISOString()
  }

  // Ensure directory exists
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true })
  await fs.writeFile(TOKEN_FILE, JSON.stringify(allTokens, null, 2))
}

/**
 * Delete tokens for a user
 * @param {string} userEmail
 */
async function deleteTokens(userEmail) {
  try {
    const data = await fs.readFile(TOKEN_FILE, 'utf8')
    const tokens = JSON.parse(data)
    delete tokens[userEmail]
    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2))
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
}

/**
 * Get spreadsheet config for a user
 * @param {string} userEmail
 * @returns {Promise<object|null>}
 */
async function getSpreadsheetConfig(userEmail) {
  const tokens = await getTokens(userEmail)
  return tokens ? {
    spreadsheetId: tokens.spreadsheetId || null,
    spreadsheetName: tokens.spreadsheetName || null
  } : null
}

/**
 * Save spreadsheet config for a user
 * @param {string} userEmail
 * @param {string} spreadsheetId
 * @param {string} spreadsheetName
 */
async function saveSpreadsheetConfig(userEmail, spreadsheetId, spreadsheetName) {
  const tokens = await getTokens(userEmail) || {}
  tokens.spreadsheetId = spreadsheetId
  tokens.spreadsheetName = spreadsheetName
  await saveTokens(userEmail, tokens)
}

module.exports = {
  getTokens,
  saveTokens,
  deleteTokens,
  getSpreadsheetConfig,
  saveSpreadsheetConfig
}
