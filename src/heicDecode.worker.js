import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs'

// The bundle embeds libheif's WebAssembly, so production needs no separate .wasm URL.
let libheif
self.onmessage = async ({ data: { bytes, maxPixels } }) => {
  let images = []
  try {
    libheif ??= await createLibheif()
    images = new libheif.HeifDecoder().decode(new Uint8Array(bytes))
    const image = images.find(item => item.is_primary?.()) ?? images[0]
    if (!image) throw new Error('No image')
    const width = image.get_width()
    const height = image.get_height()
    if (!width || !height) throw new Error('Empty image')
    if (width * height > maxPixels) {
      self.postMessage({ error: 'too-large' })
      return
    }
    const pixels = await new Promise((resolve, reject) => image.display(
      { data: new Uint8ClampedArray(width * height * 4), width, height },
      result => result ? resolve(result) : reject(new Error('Decode failed'))
    ))
    self.postMessage({ width, height, data: pixels.data.buffer }, [pixels.data.buffer])
  } catch {
    self.postMessage({ error: 'decode' })
  } finally {
    for (const image of images) image.free?.()
  }
}
