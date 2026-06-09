var { getConfig } = require('./config')

var CLOSED_STATUSES = ['Closed', 'Resolved']

var FEATURE_FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'components',
  'labels',
  'fixVersions'
]

function buildJql() {
  var statusList = CLOSED_STATUSES.map(function(s) { return '"' + s + '"' }).join(', ')
  return 'project = RHAISTRAT AND status NOT IN (' + statusList + ')'
}

function getTargetVersionFieldId(readFromStorage) {
  var config = getConfig(readFromStorage)
  var ids = config.customFieldIds || {}
  return ids.targetVersion || 'customfield_10855'
}

function getTeamFieldId(readFromStorage) {
  var config = getConfig(readFromStorage)
  var mapping = config.fieldMapping || {}
  return mapping.team || 'customfield_10001'
}

function normalizeIssue(issue, targetVersionFieldId, teamFieldId) {
  var fields = issue.fields || {}

  var status = fields.status ? fields.status.name || null : null
  var priority = fields.priority ? fields.priority.name || null : null
  var assignee = fields.assignee ? fields.assignee.displayName || null : null

  var components = []
  if (Array.isArray(fields.components)) {
    for (var i = 0; i < fields.components.length; i++) {
      if (fields.components[i].name) components.push(fields.components[i].name)
    }
  }

  var labels = Array.isArray(fields.labels) ? fields.labels : []

  var fixVersions = []
  if (Array.isArray(fields.fixVersions)) {
    for (var j = 0; j < fields.fixVersions.length; j++) {
      if (fields.fixVersions[j].name) fixVersions.push(fields.fixVersions[j].name)
    }
  }

  var targetVersions = []
  var tvField = fields[targetVersionFieldId]
  if (tvField) {
    if (Array.isArray(tvField)) {
      for (var k = 0; k < tvField.length; k++) {
        var tv = tvField[k]
        if (typeof tv === 'string') targetVersions.push(tv)
        else if (tv && tv.name) targetVersions.push(tv.name)
        else if (tv && tv.value) targetVersions.push(tv.value)
      }
    } else if (typeof tvField === 'string') {
      targetVersions.push(tvField)
    } else if (tvField.name) {
      targetVersions.push(tvField.name)
    } else if (tvField.value) {
      targetVersions.push(tvField.value)
    }
  }

  var team = null
  var teamField = fields[teamFieldId]
  if (teamField) {
    if (typeof teamField === 'string') team = teamField
    else if (teamField.name) team = teamField.name
    else if (teamField.value) team = teamField.value
  }

  return {
    key: issue.key,
    summary: fields.summary || issue.key,
    status: status,
    priority: priority,
    assignee: assignee,
    components: components,
    labels: labels,
    targetVersions: targetVersions,
    fixVersions: fixVersions,
    team: team
  }
}

async function queryFeaturesFromJira(jiraRequestFn, fetchAllJqlResultsFn, readFromStorage) {
  var jql = buildJql()
  var tvFieldId = getTargetVersionFieldId(readFromStorage)
  var teamFieldId = getTeamFieldId(readFromStorage)
  var fieldsStr = FEATURE_FIELDS.concat([tvFieldId, teamFieldId]).join(',')

  var issues = await fetchAllJqlResultsFn(jiraRequestFn, jql, fieldsStr)

  var result = new Map()
  for (var i = 0; i < issues.length; i++) {
    var normalized = normalizeIssue(issues[i], tvFieldId, teamFieldId)
    result.set(normalized.key, normalized)
  }
  return result
}

module.exports = {
  queryFeaturesFromJira: queryFeaturesFromJira,
  buildJql: buildJql,
  normalizeIssue: normalizeIssue,
  getTargetVersionFieldId: getTargetVersionFieldId,
  getTeamFieldId: getTeamFieldId,
  CLOSED_STATUSES: CLOSED_STATUSES
}
