/**
 * Scrape ring/product data from www.thediamondguy.co.za and write to assets/data/rings.json
 *
 * Notes:
 * - This script is best-effort and depends on the site's structure.
 * - It prefers structured data (JSON-LD Product/ItemList) when present.
 * - It writes a stable, minimal schema used by the in-app Rings catalog.
 *
 * Run: npm run scrape:rings
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SITE = 'https://www.thediamondguy.co.za'

function safeJsonParse(text) {
  try { return JSON.parse(text) } catch { return null }
}

function uniqBy(arr, keyFn) {
  const seen = new Set()
  const out = []
  for (const item of arr) {
    const key = keyFn(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'RingConfiguratorBot/1.0 (+noncommercial)' } })
  if (!res.ok) throw new Error(`Request failed ${res.status} for ${url}`)
  return await res.text()
}

function extractJsonLd(html) {
  const out = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    const raw = m[1].trim()
    const parsed = safeJsonParse(raw)
    if (!parsed) continue
    out.push(parsed)
  }
  return out
}

function normalizeToItems(jsonld) {
  // jsonld can be object, array, or @graph containers.
  const items = []
  const pushAny = (x) => {
    if (!x) return
    if (Array.isArray(x)) { x.forEach(pushAny); return }
    if (typeof x === 'object') {
      if (x['@graph']) pushAny(x['@graph'])
      items.push(x)
    }
  }
  pushAny(jsonld)
  return items
}

function toRingCard(product) {
  const name = product?.name || product?.title
  const url = product?.url
  if (!name) return null

  const id =
    (product?.sku && String(product.sku)) ||
    (url && String(url).split('/').filter(Boolean).slice(-1)[0]) ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  // Keep schema minimal; model mapping is manual for now.
  return {
    id,
    name: String(name).trim(),
    tagline: '',
    href: url ? String(url) : '',
    badge: 'Imported',
    model: 1
  }
}

async function main() {
  // Start from homepage; follow any ItemList/Product JSON-LD we can find.
  const homeHtml = await fetchText(SITE)
  const jsonlds = extractJsonLd(homeHtml).flatMap(normalizeToItems)

  // Collect obvious product URLs from JSON-LD ItemList (if present)
  const itemList = jsonlds.find((x) => x?.['@type'] === 'ItemList')
  const listItems = itemList?.itemListElement || []
  const urls = []
  for (const li of Array.isArray(listItems) ? listItems : []) {
    const u = li?.url || li?.item?.url || li?.item
    if (typeof u === 'string' && u.startsWith('http')) urls.push(u)
    else if (typeof u === 'string' && u.startsWith('/')) urls.push(`${SITE}${u}`)
  }

  // If we didn't find anything, fall back to just writing a placeholder dataset.
  const productPages = uniqBy(urls, (u) => u)
  const products = []

  for (const u of productPages.slice(0, 60)) {
    try {
      const html = await fetchText(u)
      const pageJson = extractJsonLd(html).flatMap(normalizeToItems)
      const product = pageJson.find((x) => x?.['@type'] === 'Product')
      if (!product) continue
      const ring = toRingCard(product)
      if (ring) products.push(ring)
    } catch {
      // ignore individual page failures
    }
  }

  const rings = products.length
    ? uniqBy(products, (p) => p.id)
    : [
        { id: 'classic-solitaire', name: 'Classic Solitaire', tagline: 'Clean lines, timeless profile', model: 1, badge: 'Configurable' },
        { id: 'halo-ensemble', name: 'Halo Ensemble', tagline: 'Soft sparkle, elevated presence', model: 2, badge: 'Configurable' }
      ]

  const outPath = path.resolve(__dirname, '..', 'assets', 'data', 'rings.json')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(rings, null, 2) + '\n', 'utf8')
  console.log(`Wrote ${rings.length} rings to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

