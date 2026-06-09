import { describe, it, expect, vi } from 'vitest'

const {
  buildJql,
  normalizeIssue,
  getTargetVersionFieldId,
  getTeamFieldId,
  queryFeaturesFromJira,
  CLOSED_STATUSES
} = require('../feature-query')

function makeReadFromStorage(overrides) {
  return function(key) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      return overrides[key]
    }
    return null
  }
}

describe('buildJql', function() {
  it('builds JQL excluding Closed and Resolved statuses', function() {
    var jql = buildJql()
    expect(jql).toBe('project = RHAISTRAT AND status NOT IN ("Closed", "Resolved")')
  })

  it('CLOSED_STATUSES contains Closed and Resolved', function() {
    expect(CLOSED_STATUSES).toEqual(['Closed', 'Resolved'])
  })
})

describe('getTargetVersionFieldId', function() {
  it('returns configured field id', function() {
    var read = makeReadFromStorage({
      'releases/planning/config.json': { customFieldIds: { targetVersion: 'customfield_99999' } }
    })
    expect(getTargetVersionFieldId(read)).toBe('customfield_99999')
  })

  it('returns default when not configured', function() {
    var read = makeReadFromStorage({ 'releases/planning/config.json': {} })
    expect(getTargetVersionFieldId(read)).toBe('customfield_10855')
  })
})

describe('getTeamFieldId', function() {
  it('returns configured field id', function() {
    var read = makeReadFromStorage({
      'releases/planning/config.json': { fieldMapping: { team: 'customfield_88888' } }
    })
    expect(getTeamFieldId(read)).toBe('customfield_88888')
  })

  it('returns default when not configured', function() {
    var read = makeReadFromStorage({ 'releases/planning/config.json': {} })
    expect(getTeamFieldId(read)).toBe('customfield_10001')
  })
})

describe('normalizeIssue', function() {
  var tvField = 'customfield_10855'
  var teamField = 'customfield_10001'

  it('normalizes a complete issue', function() {
    var issue = {
      key: 'RHAISTRAT-100',
      fields: {
        summary: 'My Feature',
        status: { name: 'In Progress' },
        priority: { name: 'Major' },
        assignee: { displayName: 'Jane Doe' },
        components: [{ name: 'UI' }, { name: 'API' }],
        labels: ['strat-creator-human-sign-off', 'some-label'],
        fixVersions: [{ name: 'rhoai-3.6' }],
        customfield_10855: [{ name: 'rhoai-3.6' }],
        customfield_10001: { name: 'Platform Team' }
      }
    }

    var result = normalizeIssue(issue, tvField, teamField)
    expect(result.key).toBe('RHAISTRAT-100')
    expect(result.summary).toBe('My Feature')
    expect(result.status).toBe('In Progress')
    expect(result.priority).toBe('Major')
    expect(result.assignee).toBe('Jane Doe')
    expect(result.components).toEqual(['UI', 'API'])
    expect(result.labels).toEqual(['strat-creator-human-sign-off', 'some-label'])
    expect(result.fixVersions).toEqual(['rhoai-3.6'])
    expect(result.targetVersions).toEqual(['rhoai-3.6'])
    expect(result.team).toBe('Platform Team')
  })

  it('handles missing fields gracefully', function() {
    var issue = { key: 'RHAISTRAT-200', fields: {} }
    var result = normalizeIssue(issue, tvField, teamField)
    expect(result.key).toBe('RHAISTRAT-200')
    expect(result.summary).toBe('RHAISTRAT-200')
    expect(result.status).toBeNull()
    expect(result.priority).toBeNull()
    expect(result.assignee).toBeNull()
    expect(result.components).toEqual([])
    expect(result.labels).toEqual([])
    expect(result.fixVersions).toEqual([])
    expect(result.targetVersions).toEqual([])
    expect(result.team).toBeNull()
  })

  it('handles string target version', function() {
    var issue = {
      key: 'RHAISTRAT-300',
      fields: { customfield_10855: 'rhoai-3.7' }
    }
    var result = normalizeIssue(issue, tvField, teamField)
    expect(result.targetVersions).toEqual(['rhoai-3.7'])
  })

  it('handles target version with value property', function() {
    var issue = {
      key: 'RHAISTRAT-400',
      fields: { customfield_10855: { value: 'rhoai-3.8' } }
    }
    var result = normalizeIssue(issue, tvField, teamField)
    expect(result.targetVersions).toEqual(['rhoai-3.8'])
  })

  it('handles array of string target versions', function() {
    var issue = {
      key: 'RHAISTRAT-500',
      fields: { customfield_10855: ['rhoai-3.6', 'rhoai-3.7'] }
    }
    var result = normalizeIssue(issue, tvField, teamField)
    expect(result.targetVersions).toEqual(['rhoai-3.6', 'rhoai-3.7'])
  })

  it('handles team as string', function() {
    var issue = {
      key: 'RHAISTRAT-600',
      fields: { customfield_10001: 'ML Ops' }
    }
    var result = normalizeIssue(issue, tvField, teamField)
    expect(result.team).toBe('ML Ops')
  })

  it('handles team with value property', function() {
    var issue = {
      key: 'RHAISTRAT-700',
      fields: { customfield_10001: { value: 'Data Science' } }
    }
    var result = normalizeIssue(issue, tvField, teamField)
    expect(result.team).toBe('Data Science')
  })
})

describe('queryFeaturesFromJira', function() {
  it('calls fetchAllJqlResults with correct params and returns normalized map', async function() {
    var mockIssues = [
      {
        key: 'RHAISTRAT-1',
        fields: {
          summary: 'Feature One',
          status: { name: 'New' },
          priority: { name: 'Major' },
          assignee: null,
          components: [],
          labels: [],
          fixVersions: [],
          customfield_10855: null,
          customfield_10001: null
        }
      },
      {
        key: 'RHAISTRAT-2',
        fields: {
          summary: 'Feature Two',
          status: { name: 'In Progress' },
          priority: { name: 'Critical' },
          assignee: { displayName: 'Bob' },
          components: [{ name: 'API' }],
          labels: ['strat-creator-human-sign-off'],
          fixVersions: [{ name: 'rhoai-3.6' }],
          customfield_10855: [{ name: 'rhoai-3.6' }],
          customfield_10001: { name: 'Platform' }
        }
      }
    ]

    var mockJiraRequest = vi.fn()
    var mockFetchAll = vi.fn().mockResolvedValue(mockIssues)
    var read = makeReadFromStorage({ 'releases/planning/config.json': {} })

    var result = await queryFeaturesFromJira(mockJiraRequest, mockFetchAll, read)

    expect(mockFetchAll).toHaveBeenCalledOnce()
    var callArgs = mockFetchAll.mock.calls[0]
    expect(callArgs[0]).toBe(mockJiraRequest)
    expect(callArgs[1]).toBe('project = RHAISTRAT AND status NOT IN ("Closed", "Resolved")')
    expect(callArgs[2]).toContain('summary')
    expect(callArgs[2]).toContain('customfield_10855')
    expect(callArgs[2]).toContain('customfield_10001')

    expect(result.size).toBe(2)
    expect(result.get('RHAISTRAT-1').summary).toBe('Feature One')
    expect(result.get('RHAISTRAT-2').assignee).toBe('Bob')
    expect(result.get('RHAISTRAT-2').team).toBe('Platform')
  })
})
