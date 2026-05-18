import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, reactive } from 'vue'
import ReleaseChipBar from '../../../client/deliver/components/ReleaseChipBar.vue'

function createMockFilter() {
  return {
    selectedProducts: reactive(new Set()),
    selectedVersions: reactive(new Set()),
    visibleProducts: computed(() => ['rhoai', 'rhaii']),
    visibleVersions: computed(() => ['2.15', '2.16', '3.0']),
    toggleProduct: vi.fn(),
    toggleVersion: vi.fn(),
    clearProducts: vi.fn(),
    clearVersions: vi.fn()
  }
}

function mountChipBar(filter = createMockFilter()) {
  return mount(ReleaseChipBar, {
    global: {
      provide: { releaseFilter: filter }
    }
  })
}

describe('ReleaseChipBar', () => {
  it('renders product chips from visible products', () => {
    const wrapper = mountChipBar()
    const buttons = wrapper.findAll('button')
    // Product row: All + 2 products = 3, Version row: All + 3 versions = 4 => 7 total
    expect(buttons).toHaveLength(7)
    expect(wrapper.text()).toContain('RHOAI')
    expect(wrapper.text()).toContain('RHAII')
  })

  it('renders version chips from visible versions', () => {
    const wrapper = mountChipBar()
    expect(wrapper.text()).toContain('2.15')
    expect(wrapper.text()).toContain('2.16')
    expect(wrapper.text()).toContain('3.0')
  })

  it('calls toggleProduct when a product chip is clicked', async () => {
    const filter = createMockFilter()
    const wrapper = mountChipBar(filter)
    // Find the RHOAI button (first product after "All")
    const productButtons = wrapper.findAll('button')
    // Product row: All(0), RHOAI(1), RHAII(2)
    await productButtons[1].trigger('click')
    expect(filter.toggleProduct).toHaveBeenCalledWith('rhoai')
  })

  it('calls clearProducts when "All" product chip is clicked', async () => {
    const filter = createMockFilter()
    const wrapper = mountChipBar(filter)
    const buttons = wrapper.findAll('button')
    // First button is product All
    await buttons[0].trigger('click')
    expect(filter.clearProducts).toHaveBeenCalled()
  })

  it('calls clearVersions when "All" version chip is clicked', async () => {
    const filter = createMockFilter()
    const wrapper = mountChipBar(filter)
    const buttons = wrapper.findAll('button')
    // Version row All is button index 3 (after product All, RHOAI, RHAII)
    await buttons[3].trigger('click')
    expect(filter.clearVersions).toHaveBeenCalled()
  })

  it('applies active class when product is selected', () => {
    const filter = createMockFilter()
    filter.selectedProducts.add('rhoai')
    const wrapper = mountChipBar(filter)
    const buttons = wrapper.findAll('button')
    // Product All (index 0) should be inactive (size > 0)
    expect(buttons[0].classes()).toContain('bg-gray-100')
    // RHOAI (index 1) should be active
    expect(buttons[1].classes()).toContain('bg-primary-100')
  })
})
