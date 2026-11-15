import { createWorker } from 'tesseract.js'
import { getReliableOcrLines } from './statementData.js'

let reader
self.onmessage = async ({ data: { image, assets } }) => {
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
    self.postMessage({ ready: true })
    const { data } = await reader.recognize(new Uint8Array(image), {}, { text: false, blocks: true })
    self.postMessage({ lines: getReliableOcrLines(data) })
  } catch {
    self.postMessage({ error: true })
  }
}
