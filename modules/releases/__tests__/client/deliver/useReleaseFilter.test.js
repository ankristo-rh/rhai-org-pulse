import { describe, it, expect } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useReleaseFilter } from '../../../client/deliver/composables/useReleaseFilter'

const testReleases = [
  { releaseNumber: 'rhoai-2.15' },
  { releaseNumber: 'rhoai-2.16' },
  { releaseNumber: 'rhoai-3.0' },
  { releaseNumber: 'rhaii-2.16' },
  { releaseNumber: 'rhaii-3.0' },
]

function setup(releases = testReleases) {
  const allReleases = ref(releases)
  let filter
  const wrapper = mount(defineComponent({
    setup() {
      filter = useReleaseFilter(allReleases)
      return { filter }
    },
    template: '<div />'
  }))
  return { allReleases, filter, wrapper }
}

describe('useReleaseFilter', () => {
  it('returns all releases when both sets are empty', () => {
    const { filter } = setup()
    expect(filter.filteredReleases.value).toHaveLength(5)
  })

  it('filters by product', () => {
    const { filter } = setup()
    filter.toggleProduct('rhoai')
    expect(filter.filteredReleases.value.every(r => r.releaseNumber.startsWith('rhoai'))).toBe(true)
    expect(filter.filteredReleases.value).toHaveLength(3)
  })

  it('filters by version', () => {
    const { filter } = setup()
    filter.toggleVersion('2.16')
    const filtered = filter.filteredReleases.value
    expect(filtered).toHaveLength(2)
    expect(filtered.map(r => r.releaseNumber).sort()).toEqual(['rhaii-2.16', 'rhoai-2.16'])
  })

  it('filters by both product and version', () => {
    const { filter } = setup()
    filter.toggleProduct('rhoai')
    filter.toggleVersion('2.16')
    const filtered = filter.filteredReleases.value
    expect(filtered).toHaveLength(1)
    expect(filtered[0].releaseNumber).toBe('rhoai-2.16')
  })

  it('narrows visible versions when a product is selected', () => {
    const { filter } = setup()
    filter.toggleProduct('rhoai')
    expect(filter.visibleVersions.value).toEqual(['2.15', '2.16', '3.0'])
  })

  it('narrows visible products when a version is selected', () => {
    const { filter } = setup()
    filter.toggleVersion('2.15')
    // Only rhoai has 2.15
    expect(filter.visibleProducts.value).toEqual(['rhoai'])
  })

  it('toggleProduct toggles selection on and off', () => {
    const { filter } = setup()
    filter.toggleProduct('rhoai')
    expect(filter.selectedProducts.has('rhoai')).toBe(true)
    filter.toggleProduct('rhoai')
    expect(filter.selectedProducts.has('rhoai')).toBe(false)
  })

  it('toggleVersion toggles selection on and off', () => {
    const { filter } = setup()
    filter.toggleVersion('2.16')
    expect(filter.selectedVersions.has('2.16')).toBe(true)
    filter.toggleVersion('2.16')
    expect(filter.selectedVersions.has('2.16')).toBe(false)
  })

  it('clearProducts empties product selection', () => {
    const { filter } = setup()
    filter.toggleProduct('rhoai')
    filter.toggleProduct('rhaii')
    filter.clearProducts()
    expect(filter.selectedProducts.size).toBe(0)
  })

  it('clearVersions empties version selection', () => {
    const { filter } = setup()
    filter.toggleVersion('2.15')
    filter.toggleVersion('2.16')
    filter.clearVersions()
    expect(filter.selectedVersions.size).toBe(0)
  })

  it('resetFilters clears both selections', () => {
    const { filter } = setup()
    filter.toggleProduct('rhoai')
    filter.toggleVersion('2.16')
    filter.resetFilters()
    expect(filter.selectedProducts.size).toBe(0)
    expect(filter.selectedVersions.size).toBe(0)
    expect(filter.filteredReleases.value).toHaveLength(5)
  })

  it('computes allProducts and allVersions correctly', () => {
    const { filter } = setup()
    expect(filter.allProducts.value).toEqual(['rhaii', 'rhoai'])
    expect(filter.allVersions.value).toEqual(['2.15', '2.16', '3.0'])
  })

  it('cross-dimension narrowing hides versions not in selected products', () => {
    const { filter } = setup()
    // Select product rhaii (which only has 2.16 and 3.0, not 2.15)
    filter.toggleProduct('rhaii')
    expect(filter.visibleVersions.value).toEqual(['2.16', '3.0'])
    expect(filter.visibleVersions.value).not.toContain('2.15')
  })

  it('cross-dimension narrowing hides products not in selected versions', () => {
    const { filter } = setup()
    // Select version 2.15 (only rhoai has it)
    filter.toggleVersion('2.15')
    expect(filter.visibleProducts.value).toEqual(['rhoai'])
    expect(filter.visibleProducts.value).not.toContain('rhaii')
  })
})
