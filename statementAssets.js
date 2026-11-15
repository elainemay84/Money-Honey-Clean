import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export default function statementAssets() {
  const assets = new Map()
  const add = (name, path) => assets.set(`statement-assets/${name}`, path)
  add('worker.min.js', require.resolve('tesseract.js/dist/worker.min.js'))
  for (const variant of ['', '-simd', '-relaxedsimd']) {
    const name = `tesseract-core${variant}-lstm.wasm.js`
    add(name, require.resolve(`tesseract.js-core/${name}`))
  }
  add('eng.traineddata.gz', require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'))
  const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))
  for (const folder of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
    for (const file of readdirSync(join(pdfRoot, folder))) {
      add(`pdf/${folder}/${file}`, join(pdfRoot, folder, file))
    }
  }
  for (const [name, path] of [
    ['tesseract-LICENSE', 'tesseract.js/LICENSE.md'],
    ['tesseract-core-LICENSE', 'tesseract.js-core/LICENSE'],
    ['pdfjs-LICENSE', 'pdfjs-dist/LICENSE'],
    ['libheif-LICENSE', 'libheif-js/LICENSE']
  ]) add(name, require.resolve(path))
  let base = '/'
  return {
    name: 'local-statement-assets',
    configResolved(config) { base = config.base },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url, 'http://localhost').pathname
        const source = assets.get(path.slice(base.length))
        if (!path.startsWith(base) || !source) return next()
        response.setHeader('Content-Type', source.endsWith('.js') ? 'text/javascript'
          : source.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        createReadStream(source).on('error', next).pipe(response)
      })
    },
    generateBundle() {
      for (const [fileName, source] of assets) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) })
      }
    }
  }
}
