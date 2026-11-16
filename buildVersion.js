import { createHash } from 'node:crypto'

// Stamps each production build with a content-based ID (in index.html and version.json)
// so an already-open app can tell when a newer deployment is available.
export default function buildVersion() {
  return {
    name: 'money-honey-build-version',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html']
      if (!html) return
      const hash = createHash('sha256')
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name]
        hash.update(name)
        hash.update(item.type === 'chunk' ? item.code : item.source)
      }
      const build = hash.digest('hex').slice(0, 16)
      html.source = String(html.source).replace('</head>', `  <meta name="money-honey-build" content="${build}" />\n  </head>`)
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build })}\n` })
    }
  }
}
