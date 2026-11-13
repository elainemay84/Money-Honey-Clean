export const THEME_STORAGE_KEY = 'money-honey-theme-settings'
export const CUSTOM_THEME_STORAGE_KEY = 'money-honey-custom-themes'
const THEME_PRESET_VERSION = 2

export const FONT_STYLES = {
  classicSerif: {
    label: 'Classic Serif',
    family: "'Libre Baskerville', Georgia, 'Times New Roman', serif"
  },
  libreBaskerville: {
    label: 'Libre Baskerville',
    family: "'Libre Baskerville', Georgia, 'Times New Roman', serif"
  },
  modernSans: {
    label: 'Modern Sans',
    family: "Arial, 'Helvetica Neue', sans-serif"
  },
  elegant: {
    label: 'Elegant',
    family: "'Playfair Display', 'Palatino Linotype', Palatino, Georgia, serif"
  },
  playfairDisplay: {
    label: 'Playfair Display',
    family: "'Playfair Display', 'Palatino Linotype', Palatino, Georgia, serif"
  },
  greatVibes: {
    label: 'Great Vibes',
    family: "'Great Vibes', cursive"
  },
  berkshireSwash: {
    label: 'Berkshire Swash',
    family: "'Berkshire Swash', Georgia, serif"
  },
  imFellEnglish: {
    label: 'IM Fell English',
    family: "'IM Fell English', Georgia, serif"
  },
  rye: {
    label: 'Rye',
    family: "'Rye', Georgia, serif"
  },
  poiretOne: {
    label: 'Poiret One',
    family: "'Poiret One', Arial, sans-serif"
  },
  marcellus: {
    label: 'Marcellus',
    family: "'Marcellus', Georgia, serif"
  },
  shrikhand: {
    label: 'Shrikhand',
    family: "'Shrikhand', Arial, sans-serif"
  },
  amaticSc: {
    label: 'Amatic SC',
    family: "'Amatic SC', 'Trebuchet MS', sans-serif"
  },
  parisienne: {
    label: 'Parisienne',
    family: "'Parisienne', cursive"
  },
  retro: {
    label: 'Retro',
    family: "'Trebuchet MS', Arial, sans-serif"
  },
  breeSerif: { label: 'Bree Serif', family: "'Bree Serif', Georgia, serif" },
  poppins: { label: 'Poppins', family: "'Poppins', Arial, sans-serif" },
  outfit: { label: 'Outfit', family: "'Outfit', Arial, sans-serif" },
  fraunces: { label: 'Fraunces', family: "'Fraunces', Georgia, serif" },
  pacifico: { label: 'Pacifico', family: "'Pacifico', cursive" },
  montserrat: { label: 'Montserrat', family: "'Montserrat', Arial, sans-serif" },
  sora: { label: 'Sora', family: "'Sora', Arial, sans-serif" },
  dmSans: { label: 'DM Sans', family: "'DM Sans', Arial, sans-serif" },
  workSans: { label: 'Work Sans', family: "'Work Sans', Arial, sans-serif" },
  quicksand: { label: 'Quicksand', family: "'Quicksand', Arial, sans-serif" },
  josefinSans: { label: 'Josefin Sans', family: "'Josefin Sans', Arial, sans-serif" },
  nunito: { label: 'Nunito', family: "'Nunito', Arial, sans-serif" },
  crimsonText: { label: 'Crimson Text', family: "'Crimson Text', Georgia, serif" },
  cormorantGaramond: { label: 'Cormorant Garamond', family: "'Cormorant Garamond', Georgia, serif" },
  caveat: { label: 'Caveat', family: "'Caveat', cursive" },
  abrilFatface: { label: 'Abril Fatface', family: "'Abril Fatface', Georgia, serif" },
  dancingScript: { label: 'Dancing Script', family: "'Dancing Script', cursive" }
}

export const LINE_SPACING = {
  compact: 1.3,
  normal: 1.45,
  relaxed: 1.65
}

export const LINE_SPACING_LABELS = {
  compact: 'Compact',
  normal: 'Normal',
  relaxed: 'Relaxed'
}

export const THEME_STYLES = {
  'honey-classic': {
    radius: '16px',
    shadow: '0 8px 20px rgba(139, 91, 28, 0.12)',
    pattern: 'radial-gradient(circle at 12px 12px, rgba(184, 117, 34, 0.08) 0 2px, transparent 2.5px)',
    patternSize: '24px 24px',
    nav: '#FFF3DF',
    buttonText: '#FFFFFF'
  },
  'funky-pop': {
    radius: '18px',
    shadow: '5px 5px 0 rgba(62, 33, 64, 0.16)',
    pattern: 'radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.42) 0 7px, transparent 8px), radial-gradient(circle at 82% 72%, rgba(151, 53, 190, 0.22) 0 12px, transparent 13px), linear-gradient(135deg, #F33C9A 0%, #FF8F68 48%, #FFF09A 100%)',
    patternSize: 'auto, auto, 100% 100%',
    nav: 'linear-gradient(135deg, #FF55B5 0%, #9C40B9 100%)',
    navActive: '#FFF08A',
    navInactive: '#FFFFFF',
    buttonText: '#FFFFFF'
  },
  'pink-sugar': {
    radius: '18px',
    shadow: '5px 5px 0 rgba(62, 33, 64, 0.16)',
    pattern: 'linear-gradient(135deg, rgba(216, 79, 139, 0.08) 25%, transparent 25% 50%, rgba(255, 190, 45, 0.08) 50% 75%, transparent 75%)',
    patternSize: '28px 28px',
    nav: '#F6BEDC',
    navActive: '#662649',
    navInactive: '#774760',
    buttonText: '#FFFFFF'
  },
  'moody-plum': {
    radius: '17px',
    shadow: '0 8px 22px rgba(91, 54, 91, 0.16)',
    pattern: 'radial-gradient(ellipse at 18px 12px, rgba(142, 90, 131, 0.16) 0 2px, transparent 2.5px), radial-gradient(ellipse at 30px 28px, rgba(112, 74, 112, 0.1) 0 3px, transparent 3.5px), conic-gradient(from 25deg at 78% 24%, transparent 0 18%, rgba(181, 126, 158, 0.08) 19% 23%, transparent 24% 100%)',
    patternSize: '44px 38px, 58px 52px, 76px 76px',
    nav: '#5A3D58',
    buttonText: '#FFF8FF'
  },
  midnight: {
    radius: '12px',
    shadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
    pattern: 'linear-gradient(45deg, transparent 42%, rgba(135, 152, 181, 0.12) 43% 46%, transparent 47% 100%), linear-gradient(135deg, transparent 42%, rgba(135, 152, 181, 0.08) 43% 46%, transparent 47% 100%), linear-gradient(90deg, transparent 48%, rgba(212, 220, 232, 0.06) 49% 51%, transparent 52%)',
    patternSize: '38px 38px, 38px 38px, 76px 76px',
    nav: '#252D38',
    buttonText: '#EEF2F4'
  },
  'forest-cabin': {
    radius: '14px',
    shadow: '0 7px 18px rgba(36, 53, 42, 0.16)',
    pattern: 'radial-gradient(ellipse at 10px 8px, rgba(82, 116, 91, 0.14) 0 2px, transparent 2.5px), radial-gradient(ellipse at 28px 22px, rgba(36, 53, 42, 0.1) 0 3px, transparent 3.5px), linear-gradient(68deg, transparent 42%, rgba(82, 116, 91, 0.08) 43% 46%, transparent 47% 100%)',
    patternSize: '46px 38px, 62px 52px, 54px 58px',
    nav: '#2F4938',
    navActive: '#F0DCB4',
    navInactive: '#E8E9DC',
    buttonText: '#F7F1E5'
  },
  bookstore: {
    radius: '8px',
    shadow: '0 5px 14px rgba(56, 39, 29, 0.16)',
    pattern: 'repeating-linear-gradient(0deg, rgba(141, 93, 59, 0.07) 0 1px, transparent 1px 7px), repeating-linear-gradient(90deg, rgba(93, 58, 38, 0.035) 0 1px, transparent 1px 11px), radial-gradient(circle at 22px 18px, rgba(141, 93, 59, 0.08) 0 1px, transparent 1.5px)',
    patternSize: '100% 7px, 11px 100%, 44px 36px',
    nav: '#38271D',
    buttonText: '#FFF9EC'
  },
  'desert-cactus': {
    radius: '15px',
    shadow: '0 7px 18px rgba(117, 68, 46, 0.15)',
    pattern: 'conic-gradient(from 225deg at 50% 115%, rgba(185, 104, 77, 0.14) 0 8%, transparent 8% 16%, rgba(185, 104, 77, 0.14) 16% 24%, transparent 24% 32%, rgba(185, 104, 77, 0.14) 32% 40%, transparent 40% 100%), linear-gradient(45deg, transparent 0 44%, rgba(73, 51, 38, 0.08) 45% 48%, transparent 49% 100%)',
    patternSize: '92px 74px, 34px 26px',
    nav: '#6E4839',
    buttonText: '#FFF9F1'
  },
  'sage-stone': {
    radius: '12px',
    shadow: '0 5px 16px rgba(53, 64, 51, 0.12)',
    pattern: 'radial-gradient(ellipse at 15px 10px, rgba(125, 146, 112, 0.13) 0 3px, transparent 3.5px), radial-gradient(ellipse at 30px 24px, rgba(53, 64, 51, 0.07) 0 4px, transparent 4.5px), linear-gradient(112deg, transparent 0 46%, rgba(125, 146, 112, 0.07) 47% 49%, transparent 50% 100%)',
    patternSize: '48px 38px, 66px 54px, 72px 64px',
    nav: '#53664E',
    buttonText: '#FFFDF5'
  },
  pink: {
    radius: '18px',
    shadow: '0 7px 18px rgba(216, 79, 139, 0.16)',
    pattern: 'radial-gradient(circle at 50% 100%, rgba(216, 79, 139, 0.1) 0 18px, transparent 19px), radial-gradient(circle at 0 0, rgba(248, 174, 202, 0.14) 0 14px, transparent 15px)',
    patternSize: '54px 34px, 58px 44px',
    nav: '#8E315E',
    buttonText: '#FFFFFF'
  },
  sage: {
    radius: '14px',
    shadow: '0 6px 16px rgba(48, 64, 53, 0.12)',
    pattern: 'linear-gradient(72deg, transparent 0 44%, rgba(113, 139, 107, 0.09) 45% 48%, transparent 49% 100%), radial-gradient(ellipse at 80% 20%, rgba(176, 196, 163, 0.12) 0 14px, transparent 15px)',
    patternSize: '42px 48px, 72px 58px',
    nav: '#4E634B',
    buttonText: '#FFFFFF'
  },
  glam: {
    radius: '18px',
    shadow: '0 7px 20px rgba(154, 78, 120, 0.18)',
    pattern: 'radial-gradient(circle at 20px 20px, rgba(212, 170, 114, 0.18) 0 2px, transparent 2.5px), conic-gradient(from 45deg at 72% 28%, transparent 0 22%, rgba(154, 78, 120, 0.08) 23% 27%, transparent 28% 100%)',
    patternSize: '36px 36px, 74px 74px',
    nav: '#5D2F4B',
    buttonText: '#FFF8FC'
  },
  monstera: {
    radius: '16px',
    shadow: '0 7px 18px rgba(35, 67, 49, 0.14)',
    pattern: 'radial-gradient(ellipse at 9px 12px, rgba(62, 120, 87, 0.14) 0 3px, transparent 3.5px), linear-gradient(64deg, transparent 45%, rgba(35, 67, 49, 0.08) 46% 49%, transparent 50% 100%)',
    patternSize: '24px 28px, 42px 50px',
    nav: '#234331',
    buttonText: '#F5FFF6'
  },
  'retro-groovy': {
    radius: '16px',
    shadow: '4px 4px 0 rgba(74, 46, 61, 0.15)',
    pattern: 'radial-gradient(ellipse at 50% 110%, transparent 0 18px, rgba(213, 107, 61, 0.12) 19px 22px, transparent 23px 34px, rgba(202, 154, 55, 0.1) 35px 38px, transparent 39px)',
    patternSize: '72px 52px',
    nav: '#4A2E3D',
    buttonText: '#FFF9EC'
  },
  'modern-minimal': {
    radius: '10px',
    shadow: '0 4px 12px rgba(36, 39, 43, 0.09)',
    pattern: 'linear-gradient(90deg, rgba(93, 102, 112, 0.06) 0 1px, transparent 1px 32px), linear-gradient(0deg, rgba(93, 102, 112, 0.04) 0 1px, transparent 1px 32px)',
    patternSize: '32px 32px',
    nav: '#24272B',
    buttonText: '#FFFFFF'
  },
  'preppy-navy': {
    radius: '14px',
    shadow: '0 6px 16px rgba(41, 76, 115, 0.14)',
    pattern: 'linear-gradient(90deg, rgba(41, 76, 115, 0.08) 0 2px, transparent 2px 12px), linear-gradient(0deg, rgba(214, 91, 82, 0.07) 0 2px, transparent 2px 12px)',
    patternSize: '12px 12px',
    nav: '#294C73',
    buttonText: '#FFFFFF'
  },
  'coastal-clean': {
    radius: '16px',
    shadow: '0 6px 16px rgba(36, 67, 70, 0.12)',
    pattern: 'radial-gradient(ellipse at 50% 100%, transparent 0 18px, rgba(76, 154, 153, 0.1) 19px 20px, transparent 21px 30px)',
    patternSize: '64px 32px',
    nav: '#D6F0F0',
    navActive: '#144F5D',
    navInactive: '#436F79',
    buttonText: '#FFFFFF'
  },
  'sunflower-farmhouse': {
    radius: '12px',
    shadow: '0 6px 16px rgba(75, 64, 40, 0.14)',
    pattern: 'radial-gradient(circle at 50% 50%, rgba(199, 149, 36, 0.16) 0 4px, transparent 4.5px), conic-gradient(from 0deg at 50% 50%, rgba(199, 149, 36, 0.08) 0 8%, transparent 8% 25%, rgba(199, 149, 36, 0.08) 25% 33%, transparent 33% 50%, rgba(199, 149, 36, 0.08) 50% 58%, transparent 58% 75%, rgba(199, 149, 36, 0.08) 75% 83%, transparent 83% 100%)',
    patternSize: '42px 42px',
    nav: '#5D4C1D',
    buttonText: '#FFFDF5'
  },
  'lavender-garden': {
    radius: '16px',
    shadow: '0 7px 18px rgba(59, 49, 80, 0.13)',
    pattern: 'radial-gradient(ellipse at 10px 10px, rgba(139, 118, 174, 0.13) 0 3px, transparent 3.5px), radial-gradient(ellipse at 22px 22px, rgba(114, 143, 111, 0.1) 0 3px, transparent 3.5px)',
    patternSize: '34px 36px',
    nav: '#4B3E68',
    buttonText: '#FFFFFF'
  },
  'cherry-cola': {
    radius: '10px',
    shadow: '0 6px 16px rgba(64, 38, 40, 0.16)',
    pattern: 'radial-gradient(ellipse at 50% 120%, transparent 0 18px, rgba(165, 61, 69, 0.1) 19px 21px, transparent 22px 32px)',
    patternSize: '64px 40px',
    nav: '#402628',
    buttonText: '#FFF9F7'
  }
}

export function getThemeStyle(themeId) {
  return THEME_STYLES[themeId] ?? THEME_STYLES['honey-classic']
}

const BACKGROUND_DIRECTIONS = {
  'left-to-right': 'to right',
  'top-to-bottom': 'to bottom',
  diagonal: '135deg'
}

export function getThemeBackground(theme) {
  const backgroundStyle = theme?.backgroundStyle
  if (
    backgroundStyle?.type === 'gradient'
    && backgroundStyle.color1
    && backgroundStyle.color2
  ) {
    const direction = BACKGROUND_DIRECTIONS[backgroundStyle.direction] ?? BACKGROUND_DIRECTIONS.diagonal
    return `linear-gradient(${direction}, ${backgroundStyle.color1}, ${backgroundStyle.color2})`
  }
  return theme?.colors?.background
}

const PREVIEW_DARK_TEXT = '#241b14'
const PREVIEW_LIGHT_TEXT = '#fffaf2'

function colorChannels(color) {
  if (typeof color !== 'string') return null
  const value = color.replace('#', '')
  if (!/^[\da-f]{6}$/i.test(value)) return null
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  ]
}

function relativeLuminance(color) {
  const channels = colorChannels(color)
  if (!channels) return null
  return channels.reduce((total, channel, index) => {
    const linear = channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
    return total + linear * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  if (foregroundLuminance === null || backgroundLuminance === null) return 1
  const brightest = Math.max(foregroundLuminance, backgroundLuminance)
  const darkest = Math.min(foregroundLuminance, backgroundLuminance)
  return (brightest + 0.05) / (darkest + 0.05)
}

export function previewTextColor(background) {
  return contrastRatio(PREVIEW_DARK_TEXT, background) >= contrastRatio(PREVIEW_LIGHT_TEXT, background)
    ? PREVIEW_DARK_TEXT
    : PREVIEW_LIGHT_TEXT
}

export function getNavigationColors(background, accent) {
  const inactive = previewTextColor(background)
  const active = contrastRatio(accent, background) >= 4.5
    ? accent
    : inactive
  return { active, inactive }
}

const extraPresets = [
  ['pink', 'Pink', 'Soft pink and berry', '#FFF0F4', '#FFFFFF', '#D84F8B', '#4A2338', 'poppins', 'nunito'],
  ['sage', 'Sage', 'Calm sage and ivory', '#E8EEE7', '#FFFFFF', '#718B6B', '#304035', 'cormorantGaramond', 'workSans'],
  ['glam', 'Glam', 'Plum, rose, and champagne', '#F6EDF3', '#FFFFFF', '#9A4E78', '#402638', 'parisienne', 'poppins'],
  ['monstera', 'Monstera', 'Leafy green and cream', '#E7F0E7', '#FFFFFF', '#3E7857', '#234331', 'fraunces', 'outfit'],
  ['retro-groovy', 'Retro Groovy', 'Warm orange and violet', '#FFF0D7', '#FFF9EC', '#D56B3D', '#4A2E3D', 'shrikhand', 'poppins'],
  ['modern-minimal', 'Modern Minimal', 'Stone, white, and ink', '#F3F3F0', '#FFFFFF', '#5D6670', '#24272B', 'montserrat', 'dmSans'],
  ['preppy-navy', 'Preppy Navy', 'Navy, coral, and cream', '#EEF2F7', '#FFFFFF', '#294C73', '#1E2C3B', 'montserrat', 'sora'],
  ['coastal-clean', 'Coastal Clean', 'Sea glass and sand', '#EAF4F3', '#FFFFFF', '#4C9A99', '#244346', 'josefinSans', 'workSans'],
  ['sunflower-farmhouse', 'Sunflower Farmhouse', 'Sunflower, cream, and denim', '#FFF5D9', '#FFFDF5', '#C79524', '#4B4028', 'amaticSc', 'nunito'],
  ['lavender-garden', 'Lavender Garden', 'Lavender, sage, and ivory', '#F1ECF8', '#FFFFFF', '#8B76AE', '#3B3150', 'cormorantGaramond', 'quicksand'],
  ['cherry-cola', 'Cherry Cola', 'Cherry red and cola brown', '#F4E9E7', '#FFF9F7', '#A53D45', '#402628', 'crimsonText', 'dmSans']
].map(([id, name, description, background, card, accent, text, headingFont, bodyFont]) => ({
  id,
  name,
  description,
  colors: { background, card, accent, text },
  headingFont,
  bodyFont
}))

export const THEME_PRESETS = [
  {
    id: 'honey-classic',
    name: 'Honey Classic',
    description: 'Cream, honey-gold, and brown',
    colors: { background: '#FFF8ED', card: '#FFFFFF', accent: '#B87522', text: '#493320' },
    headingFont: 'breeSerif',
    bodyFont: 'nunito'
  },
  {
    id: 'moody-plum',
    name: 'Moody Plum',
    description: 'Soft lavender, dusty mauve, and plum',
    colors: { background: '#E9DDF0', card: '#D8C5DC', accent: '#8E5A83', text: '#3D2140' },
    headingFont: 'greatVibes',
    bodyFont: 'quicksand'
  },
  {
    id: 'funky-pop',
    name: 'Funky Pop',
    description: 'Hot pink, citrus, and retro geometry',
    colors: { background: '#FFF09A', card: '#FFF9ED', accent: '#F33C9A', text: '#3E2140' },
    headingFont: 'abrilFatface',
    bodyFont: 'poppins'
  },
  {
    id: 'pink-sugar',
    name: 'Pink Sugar',
    description: 'Retro pink, purple, and orange',
    colors: { background: '#FFF0F4', card: '#FFFFFF', accent: '#D84F8B', text: '#3E2140' },
    headingFont: 'pacifico',
    bodyFont: 'poppins'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep charcoal, slate, and cool violet',
    colors: { background: '#171C24', card: '#2B333F', accent: '#8798B5', text: '#EEF2F4' },
    headingFont: 'poiretOne',
    bodyFont: 'dmSans'
  },
  {
    id: 'forest-cabin',
    name: 'Forest Cabin',
    description: 'Evergreen, sage, and warm wood',
    colors: { background: '#E8EEE7', card: '#FCFDFC', accent: '#52745B', text: '#24352A' },
    headingFont: 'berkshireSwash',
    bodyFont: 'outfit'
  },
  {
    id: 'bookstore',
    name: 'Bookstore',
    description: 'Espresso, parchment, and vintage neutrals',
    colors: { background: '#F2E8D5', card: '#FFF9EC', accent: '#8D5D3B', text: '#38271D' },
    headingFont: 'imFellEnglish',
    bodyFont: 'libreBaskerville'
  },
  {
    id: 'desert-cactus',
    name: 'Desert Cactus',
    description: 'Terracotta, sand, and cactus green',
    colors: { background: '#F4E3CF', card: '#FFF9F1', accent: '#B9684D', text: '#493326' },
    headingFont: 'rye',
    bodyFont: 'nunito'
  },
  {
    id: 'sage-stone',
    name: 'Sage & Stone',
    description: 'Muted sage, stone, and warm ivory',
    colors: { background: '#E7E8DE', card: '#FFFDF5', accent: '#7D9270', text: '#354033' },
    headingFont: 'marcellus',
    bodyFont: 'workSans'
  },
  ...extraPresets
]

const defaultTheme = THEME_PRESETS[0]

export function getDefaultThemeSettings() {
  return {
    themeId: defaultTheme.id,
    headingFont: defaultTheme.headingFont,
    bodyFont: defaultTheme.bodyFont,
    appFont: defaultTheme.bodyFont,
    lineSpacing: 'normal',
    colors: { ...defaultTheme.colors }
  }
}

export function loadCustomThemes() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_THEME_STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter(theme =>
      theme?.id
      && theme.name
      && theme.colors?.background
      && theme.colors?.card
      && theme.colors?.accent
      && theme.colors?.text
    ) : []
  } catch {
    return []
  }
}

export function saveCustomThemes(themes) {
  localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(themes))
  return themes
}

export function loadThemeSettings() {
  const fallback = getDefaultThemeSettings()
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? 'null')
    const savedThemeId = saved?.presetVersion === THEME_PRESET_VERSION
      ? saved?.themeId
      : (saved?.themeId === 'funky-pop' ? 'pink-sugar' : saved?.themeId)
    const preset = THEME_PRESETS.find(theme => theme.id === savedThemeId)
      ?? loadCustomThemes().find(theme => theme.id === savedThemeId)
      ?? defaultTheme
    return {
      ...fallback,
      ...saved,
      themeId: preset.id,
      headingFont: FONT_STYLES[saved?.headingFont] ? saved.headingFont : preset.headingFont,
      bodyFont: FONT_STYLES[saved?.bodyFont]
        ? saved.bodyFont
        : (FONT_STYLES[saved?.appFont] ? saved.appFont : preset.bodyFont),
      appFont: FONT_STYLES[saved?.appFont] ? saved.appFont : (preset.bodyFont ?? defaultTheme.bodyFont),
      lineSpacing: LINE_SPACING[saved?.lineSpacing] ? saved.lineSpacing : 'normal',
      backgroundStyle: saved?.backgroundStyle?.type === 'gradient'
        ? { ...saved.backgroundStyle }
        : saved?.backgroundStyle?.type === 'solid'
        ? { ...saved.backgroundStyle }
        : undefined,
      colors: { ...preset.colors, ...(saved?.colors ?? {}) }
    }
  } catch {
    return fallback
  }
}

export function saveThemeSettings(settings) {
  const preset = THEME_PRESETS.find(theme => theme.id === settings.themeId)
    ?? loadCustomThemes().find(theme => theme.id === settings.themeId)
    ?? defaultTheme
  const value = {
    presetVersion: THEME_PRESET_VERSION,
    themeId: preset.id,
    headingFont: FONT_STYLES[settings.headingFont] ? settings.headingFont : preset.headingFont,
    bodyFont: FONT_STYLES[settings.bodyFont] ? settings.bodyFont : preset.bodyFont,
    appFont: FONT_STYLES[settings.appFont] ? settings.appFont : (settings.bodyFont ?? preset.bodyFont),
    lineSpacing: LINE_SPACING[settings.lineSpacing] ? settings.lineSpacing : 'normal',
    backgroundStyle: settings.backgroundStyle?.type === 'gradient' || settings.backgroundStyle?.type === 'solid'
      ? { ...settings.backgroundStyle }
      : undefined,
    colors: { ...preset.colors, ...(settings.colors ?? {}) }
  }
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(value))
  return value
}
