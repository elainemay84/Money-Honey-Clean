// Synthetic Home Depot-style plan screenshot as returned by Tesseract (words, confidence, x-range).
// Captured from on-device OCR of a generated image; contains no real account data.
const ocrLines = [
  [['3:03', 96, 97, 191], ['5G', 96, 991, 1043]],
  [['Payment', 96, 426, 634], ['plan', 96, 652, 751]],
  [['[1]', 11, 92, 202], ['The', 96, 235, 339], ['Home', 96, 361, 523], ['Depot', 94, 545, 710]],
  [["You've", 95, 511, 623], ['paid', 95, 637, 706], ['Remaining', 96, 843, 1024]],
  [['50f6', 87, 201, 339], ['$1,483.90', 91, 511, 749], ['$296.74', 91, 841, 1034]],
  [['Paid', 96, 234, 306]],
  [['$296.74', 96, 97, 258], ['scheduled', 96, 273, 474], ['for', 96, 489, 541], ['Nov', 96, 557, 633], ['16', 96, 650, 695]],
  [['Purchase', 96, 100, 284], ['date', 96, 300, 385], ['May', 95, 813, 895], ['15,', 95, 912, 967], ['2026', 95, 984, 1082]],
  [['Purchase', 96, 100, 284], ['amount', 96, 300, 448], ['$1,568.00', 95, 884, 1081]],
  [['Total', 96, 97, 188], ['interest', 96, 206, 350], ['$121.90', 95, 621, 781], ['(APR', 95, 798, 902], ['24.99%)', 96, 917, 1080]],
  [['Total', 95, 97, 188], ['amount', 96, 205, 353], ['$1,780.64', 96, 884, 1082]]
]

export const homeDepotOcrData = {
  blocks: [{
    paragraphs: [{
      lines: ocrLines.map(words => ({
        text: `${words.map(([text]) => text).join(' ')}\n`,
        words: words.map(([text, confidence, x0, x1]) => ({ text, confidence, bbox: { x0, x1 } }))
      }))
    }]
  }]
}
