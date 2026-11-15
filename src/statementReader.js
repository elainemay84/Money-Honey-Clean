export class StatementScanError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StatementScanError'
  }
}

export function createLocalStatementReader({
  assets, signal, onProgress,
  workerFactory = () => new Worker(new URL('./statementOcr.worker.js', import.meta.url), { type: 'module' }),
  initializationTimeoutMs = 35_000
}) {
  let worker
  let pending
  let timer
  let initialized = false
  let stopped = false
  function terminate() {
    clearTimeout(timer)
    worker?.terminate()
    worker = undefined
    stopped = true
    signal.removeEventListener('abort', abort)
  }
  function fail(error) {
    pending?.reject(error)
    pending = undefined
    terminate()
  }
  const abort = () => fail(signal.reason ?? new DOMException('Reading cancelled.', 'AbortError'))
  signal.addEventListener('abort', abort, { once: true })
  return {
    recognize(image) {
      if (signal.aborted) {
        terminate()
        return Promise.reject(signal.reason)
      }
      if (stopped) return Promise.reject(new StatementScanError('The reader stopped. Retry or enter the debt manually.'))
      return new Promise((resolve, reject) => {
        pending = { resolve, reject }
        try {
          if (!worker) {
            worker = workerFactory()
            worker.onerror = event => {
              event.preventDefault?.()
              fail(new StatementScanError('The on-device reader could not start. Its worker or engine may be blocked or unavailable in this browser. Retry with a connection, choose a text PDF, or enter manually.'))
            }
            worker.onmessageerror = () => fail(new StatementScanError('The on-device reader could not return a result. Retry or enter manually.'))
            worker.onmessage = ({ data }) => {
              if (data.error) {
                fail(new StatementScanError('The on-device text reader failed to initialize or read this image. Check your connection to load its local assets, retry, use a text PDF, or enter manually.'))
              } else if (data.ready) {
                initialized = true
                clearTimeout(timer)
              } else if (data.lines) {
                pending?.resolve(data.lines)
                pending = undefined
              } else if (data.status) {
                onProgress(data.status)
              }
            }
          }
          if (!initialized) timer = setTimeout(() => fail(new StatementScanError(
            'The on-device reader did not initialize within 35 seconds. Its engine or language files may be blocked or slow to load. Retry, choose a text-based PDF, or enter manually.'
          )), initializationTimeoutMs)
          worker.postMessage({ image, assets }, [image])
        } catch {
          fail(new StatementScanError('This browser could not start the local reader. Try an updated Safari, a text-based PDF, or manual entry.'))
        }
      })
    },
    terminate
  }
}
