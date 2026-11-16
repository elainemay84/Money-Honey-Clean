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

// Synthetic dark-mode 'Electric Scooter' plan timeline (1024x1536 replica of an app screenshot), as returned by
// on-device Tesseract after dark-mode inversion and 1.6x upscaling. The timeline circles are read as one column line.
const scooterLines = [
  [['12:07', 96, 181, 300], ['A', 34, 320, 360]],
  [['Electric', 96, 191, 354], ['Scooter', 96, 370, 540], ['on', 96, 555, 607], ['Nov', 96, 625, 710], ['15', 96, 725, 773]],
  [['$628.98', 95, 190, 497]],
  [['Remaining', 94, 193, 363], ['balance', 96, 378, 502]],
  [['Autopay', 91, 190, 324], ['@', 92, 335, 373]],
  [['$52.42', 96, 190, 300], ['due', 96, 314, 372], ['on', 95, 385, 423], ['Dec', 96, 437, 499], ['15', 96, 512, 550]],
  [['Activity', 95, 182, 370]],
  [['O—0—0—0—0—-—0—-0—0—0—-0—-0—0', 21, 197, 240]],
  [['Dec', 96, 302, 378], ['15', 96, 393, 438]],
  [['$52.42', 96, 300, 405], ['due', 95, 418, 474]],
  [['Jan', 96, 301, 372], ['15,', 96, 388, 444], ['2027', 96, 459, 552]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['Feb', 96, 302, 375], ['15,', 96, 391, 446], ['2027', 96, 461, 555]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['Mar', 96, 302, 376], ['15,', 96, 391, 446], ['2027', 96, 461, 555]],
  [['$52.42', 95, 300, 405], ['due', 95, 418, 474]],
  [['Apr', 96, 301, 374], ['15,', 92, 388, 444], ['2027', 95, 459, 552]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['May', 96, 302, 383], ['15,', 96, 398, 453], ['2027', 96, 469, 562]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['Jun', 96, 301, 374], ['15,', 95, 391, 446], ['2027', 96, 461, 555]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['Jul', 96, 301, 360], ['15,', 96, 376, 431], ['2027', 95, 447, 540]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['Aug', 96, 301, 381], ['15,', 96, 398, 453], ['2027', 95, 469, 562]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['Sep', 96, 301, 378], ['15,', 96, 393, 448], ['2027', 96, 464, 557]],
  [['$52.42', 96, 300, 405], ['due', 96, 418, 474]],
  [['Oct', 96, 301, 372], ['15,', 95, 386, 441], ['2027', 96, 456, 550]],
  [['$52.42', 95, 300, 405], ['due', 95, 418, 474]],
  [['Nov', 95, 302, 381], ['15,', 94, 395, 451], ['2027', 96, 466, 559]],
  [['$52.36', 96, 301, 406], ['due', 96, 418, 474]],
  [['In', 96, 679, 722], ['progress', 96, 743, 970]]
]

const ocrData = lines => ({
  blocks: [{
    paragraphs: [{
      lines: lines.map(words => ({
        text: `${words.map(([text]) => text).join(' ')}\n`,
        words: words.map(([text, confidence, x0, x1]) => ({ text, confidence, bbox: { x0, x1 } }))
      }))
    }]
  }]
})

export const electricScooterOcrData = ocrData(scooterLines)

// The same timeline when Tesseract groups each circle ('0') and connector ('1') with its row at low confidence and
// misreads the last year. Before the fix this produced only 2 incomplete rows: (no date, no amount) and (no date, $52.36).
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']
export const electricScooterMarkerOcrData = ocrData([
  ...scooterLines.slice(0, 7),
  [['O', 55, 125, 150], ['Dec', 96, 188, 240], ['15', 96, 250, 275]],
  [['1', 52, 133, 139], ['$52.42', 96, 188, 255], ['due', 95, 262, 297]],
  ...months.flatMap(month => [
    [['0', 61, 124, 151], [month, 96, 188, 240], ['15,', 95, 248, 280], ['2027', 96, 290, 345]],
    [['1', 48, 133, 139], ['$52.42', 95, 188, 255], ['due', 95, 262, 297]]
  ]),
  [['O', 58, 124, 151], ['Nov', 95, 189, 239], ['15,', 95, 248, 283], ['2027', 62, 292, 351]],
  [['$52.36', 96, 188, 254], ['due', 96, 262, 297]]
])

// Activity text with checked timeline markers, yearless dates and a provider balance
// that must not be recalculated from installment totals.
export const loveseatActivityLines = [
  'In progress', 'Christopher Knight Loveseat on Aug 14',
  '$197.38', 'Remaining balance', 'Payment processing',
  'It can take up to 2 business days.', 'Activity',
  '\u2713 Sep 16', '$64.24 paid', 'From linked bank',
  'v Oct 16', '$64.24 paid', 'From linked bank',
  'O Nov 13', '$64.24 pending', 'From linked bank',
  'O Dec 13', '$64.24 due',
  'O Jan 13, 2027', '$64.24 due',
  'O Feb 13, 2027', '$63.82 due'
]
