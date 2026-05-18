export function extractProduct(releaseNumber) {
  const s = (releaseNumber || '').toLowerCase()
  const dash = s.indexOf('-')
  return dash > 0 ? s.slice(0, dash) : s
}

export function extractVersion(releaseNumber) {
  const s = releaseNumber || ''
  const dash = s.indexOf('-')
  return dash > 0 ? s.slice(dash + 1) : s
}

export function normalizeVersionKey(version) {
  return (version || '').replace(/[\s.]+/g, '.').toLowerCase()
}
