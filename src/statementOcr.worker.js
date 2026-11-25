import { createWorker, PSM } from 'tesseract.js'
import { getReliableOcrLines } from './statementData.js'

let reader
self.onmessage = async ({ data: { image, assets, paymentPlan = false, dimensions } }) => {
  try {
    reader ??= await createWorker('eng', 1, {
      workerPath: `${assets}worker.min.js`,
      corePath: assets,
      langPath: assets.replace(/\/$/, ''),
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: message => {
        const stages = {
          'loading tesseract core': 'Loading the on-device OCR engine',
          'initializing tesseract': 'Initializing the on-device OCR engine',
          'initialized tesseract': 'OCR engine loaded',
          'loading language traineddata': 'Loading English recognition data',
          'loaded language traineddata': 'English recognition data loaded',
          'initializing api': 'Preparing text recognition',
          'initialized api': 'Text reader ready',
          'recognizing text': 'Reading text on your device'
        }
        if (stages[message.status]) self.postMessage({
          status: `${stages[message.status]}${Number.isFinite(message.progress) ? `... ${Math.round(message.progress * 100)}%` : '...'}`
        })
      },
      errorHandler: () => self.postMessage({ error: true })
    })
    // Tesseract's default single-block mode drops text placed inside graphics, such as a balance in a progress ring.
    await reader.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    self.postMessage({ ready: true })
    const bytes = new Uint8Array(image)
    const { data } = await reader.recognize(bytes, {}, { text: false, blocks: true })
    if (paymentPlan && dimensions) {
      const words = (data.blocks ?? []).flatMap(block => block.paragraphs ?? [])
        .flatMap(paragraph => paragraph.lines ?? []).flatMap(line => line.words ?? [])
      const uncertain = words.filter(word => word.confidence >= 60 && word.confidence < 80
        && (/\$\s*[\d,]+\.\d{2}/.test(word.text) || /\d+(?:\.\d+)?%/.test(word.text))
        && word.bbox && word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0).slice(0, 8)
      if (uncertain.length) {
        await reader.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
        for (const word of uncertain) {
          const padding = Math.ceil((word.bbox.y1 - word.bbox.y0) * 0.3)
          const left = Math.max(0, word.bbox.x0 - padding)
          const top = Math.max(0, word.bbox.y0 - padding)
          const right = Math.min(dimensions.width, word.bbox.x1 + padding)
          const bottom = Math.min(dimensions.height, word.bbox.y1 + padding)
          try {
            const reread = await reader.recognize(bytes, { rectangle: { left, top, width: right - left, height: bottom - top } }, { text: false, blocks: true })
            const found = (reread.data.blocks ?? []).flatMap(block => block.paragraphs ?? [])
              .flatMap(paragraph => paragraph.lines ?? []).flatMap(line => line.words ?? [])
            const numeric = value => value.replace(/[^\d.$%]/g, '')
            if (found.some(candidate => candidate.confidence >= 80 && numeric(candidate.text) === numeric(word.text))) {
              word.confidence = 80
            }
          } catch {
            data.recheckFailed = true
            break
          }
        }
      }
    }
    const lines = getReliableOcrLines(data, { paymentPlan })
    if (data.recheckFailed) lines.push('[OCR recheck failed]')
    self.postMessage({ lines })
  } catch {
    self.postMessage({ error: true })
  }
}
