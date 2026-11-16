import { parseBillStatement, parseDebtStatement } from './statementData.js'
import { createLocalStatementReader, StatementScanError } from './statementReader.js'
import { decodeHeicFile, sniffStatementFile } from './statementImageFormat.js'
export { StatementScanError } from './statementReader.js'

export const MAX_STATEMENT_BYTES = 15 * 1024 * 1024
export const MAX_STATEMENT_PAGES = 5
const MAX_PIXELS = 4_000_000
const MAX_SCAN_MS = 120_000

export function getStatementFileKind(file) {
  if (!file || file.size === 0) throw new StatementScanError('Choose a non-empty image or PDF statement.')
  if (file.size > MAX_STATEMENT_BYTES) throw new StatementScanError('This statement is too large. Choose a file under 15 MB.')
  const extension = file.name?.split('.').at(-1)?.toLowerCase()
  const genericType = !file.type || file.type === 'application/octet-stream'
  if (file.type === 'application/pdf' || (genericType && extension === 'pdf')) return 'pdf'
  if (/^image\/(?:jpeg|png|webp|heic|heif|avif|bmp|tiff)$/.test(file.type)
    || (genericType && ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff'].includes(extension))) return 'image'
  throw new StatementScanError('Unsupported file. Choose a JPEG, PNG, another supported photo, or a PDF.')
}

// Browsers sometimes report HEIC or PDF files with a blank, generic or wrong MIME type.
export async function resolveStatementFileKind(file, signature) {
  if (!file || file.size === 0 || file.size > MAX_STATEMENT_BYTES) return getStatementFileKind(file)
  const detected = signature === undefined ? await sniffStatementFile(file) : signature
  if (detected === 'pdf') return 'pdf'
  if (detected) return 'image'
  return getStatementFileKind(file)
}

function abortError() {
  return new DOMException('Statement reading cancelled.', 'AbortError')
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? abortError())
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(value => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) {
        reject(signal.reason ?? abortError())
      } else resolve(value)
    }, error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}

export function getPdfTextLines(items) {
  const rows = []
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue
    const y = item.transform[5]
    let row = rows.find(candidate => Math.abs(candidate.y - y) < 3)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push(item)
  }
  const sorted = rows.sort((a, b) => b.y - a.y)
  for (const row of sorted) row.items.sort((a, b) => a.transform[4] - b.transform[4])
  return sorted.flatMap((row, index) => {
    const text = row.items.map(item => item.str).join(' ')
    const next = sorted[index + 1]
    // Do not pair a label with the next row's value from a different column.
    return next && Math.abs(next.items[0].transform[4] - row.items[0].transform[4]) > 36
      ? [text, ''] : [text]
  })
}

function boundedCanvas(width, height) {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  return { canvas, context }
}

async function nativeImageCanvas(file, signal) {
  const url = URL.createObjectURL(file)
  const image = new Image()
  let canvas
  try {
    image.src = url
    await abortable(image.decode(), signal)
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image')
    const target = boundedCanvas(image.naturalWidth, image.naturalHeight)
    canvas = target.canvas
    target.context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } catch (error) {
    if (canvas) canvas.width = canvas.height = 0
    throw error
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
  }
}

async function heicCanvas(file, signal) {
  const { width, height, data } = await decodeHeicFile(file, { signal })
  const source = document.createElement('canvas')
  try {
    source.width = width
    source.height = height
    const context = source.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.putImageData(new ImageData(data, width, height), 0, 0)
    const target = boundedCanvas(width, height)
    target.context.drawImage(source, 0, 0, target.canvas.width, target.canvas.height)
    return target.canvas
  } catch {
    if (signal.aborted) throw signal.reason
    throw new StatementScanError('This HEIC photo could not be prepared on this device. Choose a JPEG or PNG copy, or take a screenshot, and try again.')
  } finally {
    source.width = source.height = 0
  }
}

// Photos of screens or paper have shaded, uneven backgrounds that make Tesseract skip whole text blocks.
// Dividing each pixel by its local background brightness turns the background white and keeps text dark.
export function flattenStatementBackground(pixels, width, height, tile = 32) {
  const luminance = new Float32Array(width * height)
  let total = 0
  for (let i = 0, j = 0; j < luminance.length; i += 4, j++) {
    luminance[j] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
    total += luminance[j]
  }
  // Light text on a dark background (dark mode) is left untouched.
  if (total / luminance.length < 128) return pixels
  const columns = Math.ceil(width / tile)
  const rows = Math.ceil(height / tile)
  const background = new Float32Array(columns * rows)
  const histogram = new Uint32Array(256)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      histogram.fill(0)
      let count = 0
      for (let y = row * tile; y < Math.min(height, row * tile + tile); y++) {
        for (let x = column * tile; x < Math.min(width, column * tile + tile); x++) {
          histogram[luminance[y * width + x] | 0]++
          count++
        }
      }
      let level = 255
      for (let brighter = histogram[255]; level > 0 && brighter < count * 0.1; brighter += histogram[--level]);
      // A floor keeps dark-mode or text-free dark tiles from being stretched to white.
      background[row * columns + column] = Math.max(level, 128)
    }
  }
  for (let y = 0; y < height; y++) {
    const fy = Math.min(rows - 1, Math.max(0, y / tile - 0.5))
    const y0 = fy | 0
    const y1 = Math.min(rows - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(columns - 1, Math.max(0, x / tile - 0.5))
      const x0 = fx | 0
      const x1 = Math.min(columns - 1, x0 + 1)
      const wx = fx - x0
      const level = (background[y0 * columns + x0] * (1 - wx) + background[y0 * columns + x1] * wx) * (1 - wy)
        + (background[y1 * columns + x0] * (1 - wx) + background[y1 * columns + x1] * wx) * wy
      const value = Math.min(255, luminance[y * width + x] / level * 255)
      const i = (y * width + x) * 4
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value
    }
  }
  return pixels
}

function flattenCanvas(canvas) {
  const context = canvas.getContext('2d')
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  flattenStatementBackground(image.data, canvas.width, canvas.height)
  context.putImageData(image, 0, 0)
}

// Safari decodes HEIC natively; other browsers use the bundled on-device converter.
async function imageCanvas(file, signal, signature, onProgress) {
  try {
    return await nativeImageCanvas(file, signal)
  } catch {
    if (signal.aborted) throw signal.reason
  }
  if (signature === 'heif') {
    onProgress('Converting HEIC photo on your device...')
    return heicCanvas(file, signal)
  }
  throw new StatementScanError('This photo cannot be decoded. Try a clear JPEG or PNG, or take a screenshot.')
}

export function extractBillStatement(file, options = {}) {
  return extractDebtStatement(file, { ...options, parse: parseBillStatement })
}

export async function extractDebtStatement(file, { signal: externalSignal, onProgress = () => {}, parse = parseDebtStatement } = {}) {
  const signature = file?.size > 0 && file.size <= MAX_STATEMENT_BYTES ? await sniffStatementFile(file) : null
  const kind = await resolveStatementFileKind(file, signature)
  const controller = new AbortController()
  const { signal } = controller
  const cancel = () => controller.abort(externalSignal.reason ?? abortError())
  externalSignal?.addEventListener('abort', cancel, { once: true })
  if (externalSignal?.aborted) cancel()
  const timeout = setTimeout(() => controller.abort(new StatementScanError(
    'Reading took too long. Try one clear page or a smaller file.'
  )), MAX_SCAN_MS)
  let ocrReader
  let loadingTask
  let pdfPort
  let pdfWorker
  let pdfInitializationTimer
  const stopPdf = () => {
    pdfPort?.terminate()
    pdfWorker?.destroy()
  }
  const assets = new URL(`${import.meta.env.BASE_URL}statement-assets/`, location.href).href
  async function recognize(canvas) {
    onProgress('Preparing image for the on-device reader...')
    const blob = await abortable(new Promise((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new StatementScanError('This image could not be prepared for reading. Try a smaller JPEG or PNG.')),
      'image/png'
    )), signal)
    const image = await abortable(blob.arrayBuffer(), signal)
    ocrReader ??= createLocalStatementReader({ assets, signal, onProgress })
    onProgress('Starting the on-device reader (up to 35 seconds)...')
    return ocrReader.recognize(image)
  }
  try {
    let lines = []
    if (kind === 'image') {
      const canvas = await imageCanvas(file, signal, signature, onProgress)
      try {
        flattenCanvas(canvas)
        lines = await recognize(canvas)
      } finally {
        canvas.width = canvas.height = 0
      }
    } else {
      onProgress('Reading PDF on your device...')
      const pdf = await abortable(import('pdfjs-dist/build/pdf.mjs'), signal)
      const { default: workerUrl } = await abortable(import('pdfjs-dist/build/pdf.worker.min.mjs?url'), signal)
      pdfPort = new Worker(workerUrl, { type: 'module' })
      pdfPort.onerror = event => {
        event.preventDefault()
        controller.abort(new StatementScanError('The local PDF reader could not start. Retry with a connection, use an updated browser, or enter manually.'))
      }
      pdfWorker = new pdf.PDFWorker({ port: pdfPort })
      signal.addEventListener('abort', stopPdf, { once: true })
      if (signal.aborted) stopPdf()
      pdfInitializationTimer = setTimeout(() => controller.abort(new StatementScanError(
        'The local PDF reader did not open this document within 35 seconds. Try a smaller, unlocked text PDF or enter manually.'
      )), 35_000)
      loadingTask = pdf.getDocument({
        worker: pdfWorker,
        data: new Uint8Array(await abortable(file.arrayBuffer(), signal)),
        cMapUrl: `${assets}pdf/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}pdf/standard_fonts/`,
        wasmUrl: `${assets}pdf/wasm/`,
        iccUrl: `${assets}pdf/iccs/`,
        isEvalSupported: false,
        enableXfa: false,
        useSystemFonts: true
      })
      const document = await abortable(loadingTask.promise, signal)
      clearTimeout(pdfInitializationTimer)
      if (document.numPages > MAX_STATEMENT_PAGES) {
        throw new StatementScanError('This PDF has more than 5 pages. Export just the statement summary pages and try again.')
      }
      for (let index = 1; index <= document.numPages; index += 1) {
        onProgress(`Reading PDF page ${index} of ${document.numPages}...`)
        const page = await abortable(document.getPage(index), signal)
        try {
          const text = await abortable(page.getTextContent(), signal)
          let pageLines = getPdfTextLines(text.items)
          if (!Object.keys(parse(pageLines).values).some(key => key !== 'name' && key !== 'type')) {
            const viewport = page.getViewport({ scale: 2 })
            const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)))
            const bounded = page.getViewport({ scale: 2 * scale })
            const canvas = window.document.createElement('canvas')
            canvas.width = Math.ceil(bounded.width)
            canvas.height = Math.ceil(bounded.height)
            const render = page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport: bounded })
            const cancelRender = () => render.cancel()
            signal.addEventListener('abort', cancelRender, { once: true })
            try {
              await abortable(render.promise, signal)
              pageLines = await recognize(canvas)
            } finally {
              signal.removeEventListener('abort', cancelRender)
              canvas.width = canvas.height = 0
            }
          }
          lines.push(...pageLines, '')
        } finally {
          page.cleanup()
        }
      }
    }
    onProgress('Matching statement fields on your device...')
    const result = parse(lines)
    const hasText = lines.some(line => line.trim())
    lines = []
    if (!Object.keys(result.values).length) {
      throw new StatementScanError(hasText
        ? 'We read text, but could not identify debt fields. Try the summary page or enter them manually.'
        : 'We could not read clear text. Try a sharper image or enter the debt manually.')
    }
    return result
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof StatementScanError) throw error
    if (error?.name === 'PasswordException') throw new StatementScanError('This PDF is password-protected. Choose an unlocked copy; Money Honey does not ask for statement passwords.')
    if (error?.name === 'InvalidPDFException') throw new StatementScanError('This PDF is damaged or unreadable. Export a fresh copy or use a clear photo.')
    throw new StatementScanError('The statement could not be read. Check your connection to load the on-device reader, or try a clear JPEG, PNG, or PDF. No document was uploaded.')
  } finally {
    clearTimeout(timeout)
    clearTimeout(pdfInitializationTimer)
    externalSignal?.removeEventListener('abort', cancel)
    ocrReader?.terminate()
    let cleanupTimer
    try {
      if (loadingTask) await Promise.race([
        loadingTask.destroy(),
        new Promise(resolve => {
          cleanupTimer = setTimeout(() => {
            console.warn('Statement PDF cleanup timed out; terminating its worker.')
            resolve()
          }, 1000)
        })
      ])
    } catch {
      console.warn('Statement PDF cleanup failed; terminating its worker.')
    } finally {
      clearTimeout(cleanupTimer)
      signal.removeEventListener('abort', stopPdf)
      stopPdf()
    }
  }
}
