import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CUSTOM_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEME_PRESETS,
  getDefaultThemeSettings,
  getNavigationColors,
  getThemeBackground,
  getThemeStyle,
  loadCustomThemes,
  loadThemeSettings,
  previewTextColor,
  saveCustomThemes,
  saveThemeSettings
} from './themeData.js'

test('focused themes use their coordinated navigation colors', () => {
  const coastal = getThemeStyle('coastal-clean')
  assert.equal(coastal.nav, '#D6F0F0')
  assert.equal(coastal.navActive, '#144F5D')
  assert.equal(coastal.navInactive, '#436F79')
  assert.equal(getThemeStyle('forest-cabin').nav, '#2F4938')
  assert.equal(getThemeStyle('forest-cabin').navActive, '#F0DCB4')
  assert.equal(getThemeStyle('forest-cabin').navInactive, '#E8E9DC')
  assert.equal(getThemeStyle('pink-sugar').nav, '#F6BEDC')
  assert.equal(getThemeStyle('pink-sugar').navActive, '#662649')
  assert.equal(getThemeStyle('pink-sugar').navInactive, '#774760')
  assert.equal(getThemeStyle('funky-pop').nav, 'linear-gradient(135deg, #FF55B5 0%, #9C40B9 100%)')
  assert.equal(getThemeStyle('funky-pop').navActive, '#FFF08A')
  assert.equal(getThemeStyle('funky-pop').navInactive, '#FFFFFF')
})

test('Funky Pop keeps its gradient without decorative dot artifacts', () => {
  const funkyPop = getThemeStyle('funky-pop')
  assert.match(funkyPop.pattern, /^linear-gradient/)
  assert.doesNotMatch(funkyPop.pattern, /radial-gradient/)
  assert.equal(funkyPop.patternSize, '100% 100%')
})

test('navigation colors maintain contrast against light and dark theme nav backgrounds', () => {
  const light = getNavigationColors('#FFF3DF', '#B87522')
  const dark = getNavigationColors('#3E2140', '#D84F8B')
  assert.equal(light.inactive, '#241b14')
  assert.equal(dark.inactive, '#fffaf2')
  assert.equal(light.active, '#241b14')
  assert.equal(dark.active, '#fffaf2')
})

function withStorage(values = {}) {
  const original = globalThis.localStorage
  const data = new Map(Object.entries(values))
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value))
  }
  return () => { globalThis.localStorage = original }
}

test('theme settings default to Honey Classic and persist custom selections', () => {
  const restore = withStorage()
  const defaults = getDefaultThemeSettings()
  assert.equal(loadThemeSettings().themeId, 'honey-classic')
  const saved = saveThemeSettings({
    ...defaults,
    themeId: 'midnight',
    headingFont: 'retro',
    bodyFont: 'elegant',
    colors: { ...defaults.colors, accent: '#123456' }
  })
  assert.equal(saved.themeId, 'midnight')
  assert.equal(loadThemeSettings().headingFont, 'retro')
  assert.equal(loadThemeSettings().colors.accent, '#123456')
  assert.equal(JSON.parse(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).bodyFont, 'elegant')
  restore()
})

test('invalid saved themes and fonts fall back safely', () => {
  const restore = withStorage({
    [THEME_STORAGE_KEY]: JSON.stringify({ themeId: 'unknown', headingFont: 'unknown', bodyFont: 'unknown' })
  })
  const settings = loadThemeSettings()
  assert.equal(settings.themeId, 'honey-classic')
  assert.equal(settings.headingFont, 'breeSerif')
  assert.equal(settings.bodyFont, 'nunito')
  restore()
})

test('legacy app font migrates to body font without replacing an explicit body font', () => {
  const restore = withStorage({
    [THEME_STORAGE_KEY]: JSON.stringify({
      themeId: 'honey-classic',
      headingFont: 'greatVibes',
      appFont: 'pacifico'
    })
  })
  assert.equal(loadThemeSettings().bodyFont, 'pacifico')
  restore()

  const restoreExplicit = withStorage({
    [THEME_STORAGE_KEY]: JSON.stringify({
      themeId: 'honey-classic',
      headingFont: 'greatVibes',
      appFont: 'pacifico',
      bodyFont: 'nunito'
    })
  })
  assert.equal(loadThemeSettings().bodyFont, 'nunito')
  restoreExplicit()
})

test('theme preview text chooses readable colors for light, dark, and invalid backgrounds', () => {
  assert.equal(previewTextColor('#FFF8ED'), '#241b14')
  assert.equal(previewTextColor('#211B2B'), '#fffaf2')
  assert.equal(previewTextColor('not-a-color'), '#241b14')
})

test('Moody Plum is light and Midnight remains dark with distinct font pairings', () => {
  const moodyPlum = THEME_PRESETS.find(theme => theme.id === 'moody-plum')
  const midnight = THEME_PRESETS.find(theme => theme.id === 'midnight')
  assert.equal(moodyPlum.headingFont, 'greatVibes')
  assert.equal(moodyPlum.colors.background, '#E9DDF0')
  assert.equal(midnight.headingFont, 'poiretOne')
  assert.equal(midnight.colors.background, '#171C24')
  assert.notEqual(moodyPlum.colors.background, midnight.colors.background)
})

test('named presets use their requested heading and body font pairings', () => {
  const pairings = {
    'forest-cabin': ['berkshireSwash', 'outfit'],
    bookstore: ['imFellEnglish', 'libreBaskerville'],
    'moody-plum': ['greatVibes', 'quicksand'],
    'desert-cactus': ['rye', 'nunito'],
    midnight: ['poiretOne', 'dmSans'],
    'sage-stone': ['marcellus', 'workSans'],
    'retro-groovy': ['shrikhand', 'poppins'],
    'sunflower-farmhouse': ['amaticSc', 'nunito'],
    glam: ['parisienne', 'poppins'],
    'coastal-clean': ['josefinSans', 'workSans']
  }
  for (const [themeId, [headingFont, bodyFont]] of Object.entries(pairings)) {
    const theme = THEME_PRESETS.find(item => item.id === themeId)
    assert.equal(theme.headingFont, headingFont)
    assert.equal(theme.bodyFont, bodyFont)
  }
})

test('preset visual styles provide distinct coordinated treatments', () => {
  assert.notEqual(getThemeStyle('funky-pop').radius, getThemeStyle('bookstore').radius)
  assert.notEqual(getThemeStyle('midnight').nav, getThemeStyle('moody-plum').nav)
  assert.match(getThemeStyle('forest-cabin').pattern, /radial-gradient/)
  assert.equal(getThemeStyle('unknown').radius, getThemeStyle('honey-classic').radius)
})

test('protected presets retain their established visual treatments while named themes stay distinctive', () => {
  assert.equal(getThemeStyle('funky-pop').patternSize, '100% 100%')
  assert.equal(getThemeStyle('pink-sugar').patternSize, '28px 28px')
  assert.match(getThemeStyle('bookstore').pattern, /repeating-linear-gradient/)
  assert.match(getThemeStyle('desert-cactus').pattern, /conic-gradient/)
  assert.match(getThemeStyle('midnight').pattern, /linear-gradient\(45deg/)
  assert.notEqual(getThemeStyle('sage-stone').pattern, getThemeStyle('forest-cabin').pattern)
})

test('legacy Funky Pop selections migrate to Pink Sugar without blocking the new preset', () => {
  const restore = withStorage({
    [THEME_STORAGE_KEY]: JSON.stringify({ themeId: 'funky-pop' })
  })
  assert.equal(loadThemeSettings().themeId, 'pink-sugar')
  const saved = saveThemeSettings({
    ...getDefaultThemeSettings(),
    themeId: 'funky-pop'
  })
  assert.equal(saved.themeId, 'funky-pop')
  assert.equal(loadThemeSettings().themeId, 'funky-pop')
  restore()
})

test('named custom themes persist independently and can be edited or removed', () => {
  const restore = withStorage()
  const customTheme = {
    id: 'custom-test',
    name: 'Test Theme',
    colors: { background: '#111111', card: '#222222', accent: '#333333', text: '#FFFFFF' },
    headingFont: 'sora',
    bodyFont: 'dmSans',
    appFont: 'dmSans',
    lineSpacing: 'relaxed'
  }
  saveCustomThemes([customTheme])
  assert.equal(loadCustomThemes()[0].name, 'Test Theme')
  const renamed = { ...customTheme, name: 'Edited Theme' }
  saveCustomThemes([renamed])
  assert.equal(loadCustomThemes()[0].name, 'Edited Theme')
  saveCustomThemes([])
  assert.deepEqual(loadCustomThemes(), [])
  assert.ok(globalThis.localStorage.getItem(CUSTOM_THEME_STORAGE_KEY))
  restore()
})

test('custom theme saves persist the custom theme as active', () => {
  const restore = withStorage()
  const customTheme = {
    id: 'custom-active',
    name: 'Active Theme',
    colors: { background: '#111111', card: '#222222', accent: '#DDAA44', text: '#FFFFFF' },
    headingFont: 'sora',
    bodyFont: 'dmSans',
    appFont: 'dmSans',
    lineSpacing: 'normal'
  }
  saveCustomThemes([customTheme])
  const saved = saveThemeSettings({ ...customTheme, themeId: customTheme.id })
  assert.equal(saved.themeId, customTheme.id)
  assert.equal(loadThemeSettings().themeId, customTheme.id)
  restore()
})

test('background styles preserve legacy solids and render explicit gradients', () => {
  assert.equal(getThemeBackground({
    colors: { background: '#FDF744' }
  }), '#FDF744')
  assert.equal(getThemeBackground({
    colors: { background: '#111111' },
    backgroundStyle: {
      type: 'gradient',
      color1: '#FF55B5',
      color2: '#FFF08A',
      direction: 'left-to-right'
    }
  }), 'linear-gradient(to right, #FF55B5, #FFF08A)')
  assert.equal(getThemeBackground({
    colors: { background: '#111111' },
    backgroundStyle: {
      type: 'gradient',
      color1: '#FF55B5',
      color2: '#FFF08A',
      direction: 'top-to-bottom'
    }
  }), 'linear-gradient(to bottom, #FF55B5, #FFF08A)')
  assert.equal(getThemeBackground({
    colors: { background: '#111111' },
    backgroundStyle: {
      type: 'gradient',
      color1: '#FF55B5',
      color2: '#FFF08A',
      direction: 'diagonal'
    }
  }), 'linear-gradient(135deg, #FF55B5, #FFF08A)')
})
