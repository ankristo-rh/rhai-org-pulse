import { computed, reactive, watch } from 'vue'
import { extractProduct, extractVersion, normalizeVersionKey } from './release-utils'

/**
 * Shared dual-filter composable for Product + Version multi-select.
 * Accepts a computed/ref array of release objects (each must have `.releaseNumber`).
 *
 * "All" semantics: empty selectedProducts / selectedVersions means "all selected"
 * (filteredReleases returns everything when both sets are empty).
 */
export function useReleaseFilter(allReleases) {
  const selectedProducts = reactive(new Set())
  const selectedVersions = reactive(new Set())

  const allProducts = computed(() =>
    [...new Set(allReleases.value.map(r => extractProduct(r.releaseNumber)).filter(Boolean))].sort()
  )

  const allVersions = computed(() => {
    const seen = new Map()
    for (const r of allReleases.value) {
      const raw = extractVersion(r.releaseNumber)
      if (!raw) continue
      const key = normalizeVersionKey(raw)
      if (!seen.has(key)) seen.set(key, raw)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  })

  const visibleProducts = computed(() => {
    if (!selectedVersions.size) return allProducts.value
    const selKeys = new Set([...selectedVersions].map(normalizeVersionKey))
    return [...new Set(
      allReleases.value
        .filter(r => selKeys.has(normalizeVersionKey(extractVersion(r.releaseNumber))))
        .map(r => extractProduct(r.releaseNumber))
        .filter(Boolean)
    )].sort()
  })

  const visibleVersions = computed(() => {
    if (!selectedProducts.size) return allVersions.value
    const seen = new Map()
    for (const r of allReleases.value) {
      if (!selectedProducts.has(extractProduct(r.releaseNumber))) continue
      const raw = extractVersion(r.releaseNumber)
      if (!raw) continue
      const key = normalizeVersionKey(raw)
      if (!seen.has(key)) seen.set(key, raw)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  })

  // Auto-cleanup watchers: prune orphaned selections when cross-dimension narrowing
  // removes items from the visible list
  watch(visibleProducts, (available) => {
    for (const p of [...selectedProducts]) {
      if (!available.includes(p)) selectedProducts.delete(p)
    }
  })

  watch(visibleVersions, (available) => {
    const availableKeys = new Set(available.map(normalizeVersionKey))
    for (const v of [...selectedVersions]) {
      if (!availableKeys.has(normalizeVersionKey(v))) selectedVersions.delete(v)
    }
  })

  function toggleProduct(product) {
    if (selectedProducts.has(product)) selectedProducts.delete(product)
    else selectedProducts.add(product)
  }

  function toggleVersion(version) {
    if (selectedVersions.has(version)) selectedVersions.delete(version)
    else selectedVersions.add(version)
  }

  const filteredReleases = computed(() => {
    const selVerKeys = selectedVersions.size
      ? new Set([...selectedVersions].map(normalizeVersionKey))
      : null
    return allReleases.value.filter(r => {
      if (selectedProducts.size && !selectedProducts.has(extractProduct(r.releaseNumber))) return false
      if (selVerKeys && !selVerKeys.has(normalizeVersionKey(extractVersion(r.releaseNumber)))) return false
      return true
    })
  })

  function clearProducts() {
    selectedProducts.clear()
  }

  function clearVersions() {
    selectedVersions.clear()
  }

  function resetFilters() {
    selectedProducts.clear()
    selectedVersions.clear()
  }

  return {
    selectedProducts,
    selectedVersions,
    allProducts,
    allVersions,
    visibleProducts,
    visibleVersions,
    filteredReleases,
    toggleProduct,
    toggleVersion,
    clearProducts,
    clearVersions,
    resetFilters
  }
}
