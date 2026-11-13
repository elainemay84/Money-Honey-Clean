import { useEffect, useRef, useState } from 'react'
import {
  FONT_STYLES,
  LINE_SPACING_LABELS,
  getThemeStyle,
  loadCustomThemes,
  previewTextColor,
  saveCustomThemes,
  THEME_PRESETS
} from './themeData.js'
import PageHeader from './PageHeader'

const field = {
  padding: 9,
  borderRadius: 9,
  border: '1px solid #E9D6B7',
  minWidth: 0,
  background: '#FFFFFF'
}

const colorNames = [
  ['background', 'Background'],
  ['accent', 'Accent'],
  ['tabs', 'Tabs'],
  ['card', 'Cards'],
  ['text', 'Text']
]

const backgroundDirections = [
  ['left-to-right', 'Left to Right'],
  ['top-to-bottom', 'Top to Bottom'],
  ['diagonal', 'Diagonal']
]

function FontPicker({ label, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const pickerRef = useRef(null)
  const selectedFont = FONT_STYLES[value] ?? FONT_STYLES.modernSans
  const fonts = Object.entries(FONT_STYLES).filter(([, font]) =>
    font.label.toLowerCase().includes(query.trim().toLowerCase())
  )

  useEffect(() => {
    function closePicker(event) {
      if (!pickerRef.current?.contains(event.target)) setIsOpen(false)
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', closePicker)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closePicker)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  function chooseFont(fontValue) {
    onChange(fontValue)
    setIsOpen(false)
    setQuery('')
  }

  return (
    <label className="font-picker-field">
      {label}
      <span ref={pickerRef} className="font-picker">
        <button
          type="button"
          className="font-picker-trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(open => !open)}
          style={{ fontFamily: selectedFont.family }}
        >
          <span>{selectedFont.label}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        {isOpen && (
          <span className="font-picker-menu" role="listbox" aria-label={`${label} options`}>
            <input
              type="search"
              aria-label={`Search ${label.toLowerCase()}s`}
              placeholder="Search fonts"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="font-picker-search"
              autoFocus
            />
            <span className="font-picker-options">
              {fonts.length ? fonts.map(([fontValue, font]) => (
                <button
                  key={fontValue}
                  type="button"
                  role="option"
                  aria-selected={value === fontValue}
                  className="font-picker-option"
                  onClick={() => chooseFont(fontValue)}
                  style={{ fontFamily: font.family }}
                >
                  <span>{font.label}</span>
                  {value === fontValue && <span aria-label="Selected">✓</span>}
                </button>
              )) : (
                <span className="font-picker-empty">No fonts found</span>
              )}
            </span>
          </span>
        )}
      </span>
    </label>
  )
}

function colorsFor(settings) {
  return {
    background: settings.colors.background,
    glow: settings.colors.glow ?? settings.colors.background,
    accent: settings.colors.accent,
    tabs: settings.colors.tabs ?? settings.colors.accent,
    card: settings.colors.card,
    text: settings.colors.text
  }
}

function backgroundStyleFor(settings) {
  const saved = settings.backgroundStyle
  if (saved?.type === 'gradient') {
    return {
      type: 'gradient',
      color1: saved.color1 ?? settings.colors.background,
      color2: saved.color2 ?? settings.colors.background,
      direction: saved.direction ?? 'diagonal'
    }
  }
  return {
    type: 'solid',
    color1: settings.colors.background,
    color2: settings.colors.background,
    direction: 'diagonal'
  }
}

export default function Themes({
  settings,
  onPreview,
  onSave,
  onBack,
  onManualTheme,
  manualMode = false
}) {
  const [customThemes, setCustomThemes] = useState(() => loadCustomThemes())
  const [customName, setCustomName] = useState('')
  const [editingCustomId, setEditingCustomId] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [gradientExpanded, setGradientExpanded] = useState(false)
  const editorColors = colorsFor(settings)
  const editorBackground = backgroundStyleFor(settings)

  useEffect(() => {
    if (!statusMessage) return undefined
    const timer = window.setTimeout(() => setStatusMessage(''), 2200)
    return () => window.clearTimeout(timer)
  }, [statusMessage])

  function saveTheme(settingsToSave) {
    onSave(settingsToSave)
    setStatusMessage('Theme saved!')
  }

  function chooseTheme(theme) {
    const nextSettings = {
      ...settings,
      themeId: theme.id,
      headingFont: theme.headingFont,
      bodyFont: theme.bodyFont,
      appFont: theme.bodyFont,
      lineSpacing: theme.lineSpacing ?? 'normal',
      backgroundStyle: undefined,
      colors: colorsFor({ colors: theme.colors })
    }
    onPreview(nextSettings)
    onSave(nextSettings)
    setEditingCustomId(theme.id.startsWith('custom-') ? theme.id : null)
    setCustomName(theme.id.startsWith('custom-') ? theme.name : '')
  }

  function updateColor(key, value) {
    onPreview({ ...settings, colors: { ...editorColors, [key]: value } })
  }

  function updateBackground(nextBackground) {
    onPreview({
      ...settings,
      backgroundStyle: nextBackground,
      colors: { ...editorColors, background: nextBackground.color1 }
    })
  }

  function saveAsNew() {
    const name = customName.trim()
    if (!name) return
    const customTheme = {
      id: `custom-${Date.now()}`,
      name,
      description: 'Custom theme',
      headingFont: settings.headingFont ?? settings.appFont ?? settings.bodyFont,
      bodyFont: settings.bodyFont ?? settings.appFont,
      appFont: settings.appFont ?? settings.bodyFont,
      lineSpacing: settings.lineSpacing ?? 'normal',
      backgroundStyle: editorBackground,
      colors: editorColors
    }
    const nextThemes = [...customThemes, customTheme]
    setCustomThemes(saveCustomThemes(nextThemes))
    setEditingCustomId(customTheme.id)
    saveTheme({ ...customTheme, themeId: customTheme.id })
  }

  function updateSelected() {
    if (!editingCustomId) return
    const existing = customThemes.find(theme => theme.id === editingCustomId)
    if (!existing) return
    const updated = {
      ...existing,
      name: customName.trim() || existing.name,
      headingFont: settings.headingFont ?? settings.appFont ?? settings.bodyFont,
      bodyFont: settings.bodyFont ?? settings.appFont,
      appFont: settings.appFont ?? settings.bodyFont,
      lineSpacing: settings.lineSpacing ?? 'normal',
      backgroundStyle: editorBackground,
      colors: editorColors
    }
    const nextThemes = customThemes.map(theme => theme.id === editingCustomId ? updated : theme)
    setCustomThemes(saveCustomThemes(nextThemes))
    saveTheme({ ...updated, themeId: updated.id })
  }

  function editCustomTheme(theme) {
    setEditingCustomId(theme.id)
    setCustomName(theme.name)
    onPreview({
      ...settings,
      ...theme,
      themeId: theme.id,
      headingFont: theme.headingFont ?? settings.headingFont,
      bodyFont: theme.bodyFont ?? theme.appFont ?? settings.bodyFont,
      backgroundStyle: backgroundStyleFor(theme),
      colors: colorsFor(theme)
    })
  }

  function applyCustomTheme(theme) {
    const appliedTheme = {
      ...settings,
      ...theme,
      themeId: theme.id,
      headingFont: theme.headingFont ?? settings.headingFont,
      bodyFont: theme.bodyFont ?? theme.appFont ?? settings.bodyFont,
      appFont: theme.appFont ?? theme.bodyFont,
      backgroundStyle: backgroundStyleFor(theme),
      colors: colorsFor(theme)
    }
    onPreview(appliedTheme)
    saveTheme(appliedTheme)
  }

  function deleteCustomTheme(theme) {
    if (!window.confirm(`Delete ${theme.name}?`)) return
    const nextThemes = customThemes.filter(item => item.id !== theme.id)
    setCustomThemes(saveCustomThemes(nextThemes))
    if (settings.themeId === theme.id) {
      const fallback = {
        ...THEME_PRESETS[0],
        appFont: THEME_PRESETS[0].bodyFont,
        lineSpacing: 'normal',
        backgroundStyle: undefined,
        colors: colorsFor(THEME_PRESETS[0])
      }
      onPreview(fallback)
      saveTheme(fallback)
      setEditingCustomId(null)
      setCustomName('')
    } else if (editingCustomId === theme.id) {
      setEditingCustomId(null)
      setCustomName('')
    }
  }

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <PageHeader
        className={manualMode ? 'manual-theme-header' : 'themes-page-header'}
        backLabel={manualMode ? 'Themes & Fonts' : 'Settings'}
        onBack={onBack}
      >
        {manualMode ? 'Manual Theme' : 'Themes & Fonts'}
      </PageHeader>

      {!manualMode && (
      <section className="theme-picker-page" style={{ background: '#FFFFFF', padding: 14, borderRadius: 16, marginBottom: 12 }}>
        <button
          type="button"
          onClick={onManualTheme}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            marginBottom: 12,
            padding: 13,
            border: '1px solid #E9D6B7',
            borderRadius: 14,
            background: '#FFFFFF',
            color: '#493320',
            textAlign: 'left',
            cursor: 'pointer'
          }}
        >
          <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, background: '#8FA06C', color: '#FFFFFF', fontSize: 20 }}>☷</span>
          <span style={{ display: 'grid', gap: 2, flex: 1 }}>
            <strong style={{ fontSize: 15 }}>Manual Theme</strong>
            <span style={{ color: '#79502A', fontSize: 12 }}>Create a custom theme</span>
          </span>
          <span aria-hidden="true" style={{ fontSize: 22, color: '#9B7955' }}>›</span>
        </button>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Themes</h2>
        <p style={{ margin: '0 0 10px', color: '#79502A', fontSize: 12 }}>
          Choose a look for Money Honey.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {THEME_PRESETS.map(theme => (
            <button
              key={theme.id}
              type="button"
              aria-pressed={settings.themeId === theme.id}
              onClick={() => chooseTheme(theme)}
              className="theme-preview"
              style={{
                padding: 10,
                border: `2px solid ${settings.themeId === theme.id ? theme.colors.accent : '#E9D6B7'}`,
                borderRadius: 12,
                background: theme.colors.background,
                ...(theme.id !== 'funky-pop' && theme.id !== 'pink-sugar'
                  ? {
                      backgroundImage: getThemeStyle(theme.id).pattern,
                      backgroundSize: getThemeStyle(theme.id).patternSize
                    }
                  : {}),
                color: previewTextColor(theme.colors.background),
                '--preview-background': theme.colors.background,
                '--preview-text': previewTextColor(theme.colors.background),
                '--preview-pattern': theme.id !== 'funky-pop' && theme.id !== 'pink-sugar'
                  ? getThemeStyle(theme.id).pattern
                  : 'none',
                '--preview-pattern-size': theme.id !== 'funky-pop' && theme.id !== 'pink-sugar'
                  ? getThemeStyle(theme.id).patternSize
                  : 'auto',
                '--preview-heading-font': FONT_STYLES[theme.headingFont]?.family ?? FONT_STYLES.classicSerif.family,
                textAlign: 'left',
                cursor: 'pointer'
              }}
            >
              <span style={{ display: 'flex', gap: 4, marginBottom: 7 }}>
                {[theme.colors.accent, theme.colors.card, theme.colors.text].map(color => (
                  <span key={color} aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', background: color, border: '1px solid #FFFFFF66' }} />
                ))}
              </span>
              <strong style={{ display: 'block', fontSize: 12, fontFamily: FONT_STYLES[theme.headingFont]?.family ?? FONT_STYLES.classicSerif.family }}>
                {theme.name}
              </strong>
              <span style={{ display: 'block', marginTop: 2, fontSize: 10 }}>{theme.description}</span>
              <span style={{ display: 'block', marginTop: 3, fontSize: 9, fontFamily: FONT_STYLES[theme.bodyFont]?.family ?? FONT_STYLES.modernSans.family, opacity: 0.8 }}>
                {FONT_STYLES[theme.headingFont]?.label ?? theme.headingFont} · {FONT_STYLES[theme.bodyFont]?.label ?? theme.bodyFont}
              </span>
            </button>
          ))}
        </div>
      </section>
      )}

      {manualMode && (
      <>
      <section className="manual-theme-editor" style={{ background: '#FFFFFF', padding: 14, borderRadius: 16, marginBottom: 12 }}>
        <input
          aria-label="Custom theme name"
          placeholder="Custom theme name"
          value={customName}
          onChange={event => setCustomName(event.target.value)}
          style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
        />
        <div className="manual-theme-controls" style={{ display: 'grid', gap: 8 }}>
          <div className="manual-theme-font-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FontPicker
              label="Heading Font"
              value={settings.headingFont}
              onChange={value => onPreview({ ...settings, headingFont: value })}
            />
            <FontPicker
              label="Body Font"
              value={settings.bodyFont}
              onChange={value => onPreview({ ...settings, bodyFont: value, appFont: value })}
            />
          </div>
          <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 11 }}>
            Line Spacing
            <select
              value={settings.lineSpacing ?? 'normal'}
              onChange={event => onPreview({ ...settings, lineSpacing: event.target.value })}
              style={field}
            >
              {Object.entries(LINE_SPACING_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 11 }}>
            Background Style
            <select
              aria-label="Background Style"
              value={editorBackground.type}
              onChange={event => {
                const type = event.target.value
                updateBackground({
                  ...editorBackground,
                  type,
                  color1: editorBackground.color1,
                  color2: type === 'gradient' ? editorBackground.color2 : editorBackground.color1
                })
              }}
              style={field}
            >
              <option value="solid">Solid Color</option>
              <option value="gradient">Gradient</option>
            </select>
          </label>
          {editorBackground.type === 'gradient' && (
            <div className="gradient-options">
              <button
                type="button"
                className="gradient-options-toggle"
                aria-expanded={gradientExpanded}
                onClick={() => setGradientExpanded(expanded => !expanded)}
              >
                <span>Gradient Options</span>
                <span aria-hidden="true">{gradientExpanded ? '⌃' : '⌄'}</span>
              </button>
              {gradientExpanded && (
                <div className="gradient-options-panel">
                  {[
                    ['color1', 'Gradient Color 1'],
                    ['color2', 'Gradient Color 2']
                  ].map(([key, label]) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, color: '#79502A', fontSize: 11 }}>
                      <span>{label}</span>
                      <input
                        type="color"
                        aria-label={label}
                        value={editorBackground[key]}
                        onChange={event => updateBackground({ ...editorBackground, [key]: event.target.value })}
                        style={{ width: 36, height: 27, padding: 2, border: '1px solid #E9D6B7', borderRadius: 7 }}
                      />
                    </label>
                  ))}
                  <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 11 }}>
                    Gradient Direction
                    <select
                      aria-label="Gradient Direction"
                      value={editorBackground.direction}
                      onChange={event => updateBackground({ ...editorBackground, direction: event.target.value })}
                      style={field}
                    >
                      {backgroundDirections.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="manual-theme-swatches" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 5, marginTop: 10 }}>
          {colorNames
            .map(([key, label]) => (
            <label key={key} style={{ display: 'grid', justifyItems: 'center', gap: 3, minWidth: 0, color: '#79502A', fontSize: 10, textAlign: 'center' }}>
              <input
                type="color"
                aria-label={label}
                value={key === 'background' && editorBackground.type === 'gradient' ? editorBackground.color1 : editorColors[key]}
                onChange={event => {
                  if (key === 'background') {
                    updateBackground({ ...editorBackground, color1: event.target.value })
                  } else {
                    updateColor(key, event.target.value)
                  }
                }}
                style={{ width: 42, height: 30, padding: 2, border: '1px solid #E9D6B7', borderRadius: 7 }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="manual-theme-actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <button type="button" onClick={saveAsNew} style={{ ...field, background: '#B87522', color: '#FFFFFF', fontWeight: 'bold', cursor: 'pointer' }}>
            Save as New
          </button>
          <button
            type="button"
            onClick={updateSelected}
            disabled={!editingCustomId}
            style={{ ...field, background: '#FFF8ED', color: '#79502A', fontWeight: 'bold', cursor: editingCustomId ? 'pointer' : 'not-allowed', opacity: editingCustomId ? 1 : 0.6 }}
          >
            Update Selected
          </button>
        </div>
        {statusMessage && (
          <p role="status" style={{ margin: '9px 0 0', color: '#3E7857', fontSize: 12, fontWeight: 'bold' }}>
            {statusMessage}
          </p>
        )}
      </section>

      {customThemes.length > 0 && (
        <section className="manual-theme-saved" style={{ background: '#FFFFFF', padding: 14, borderRadius: 16, marginBottom: 12 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>My Saved Themes</h2>
          <div style={{ display: 'grid', gap: 7 }}>
            {customThemes.map(theme => (
              <div key={theme.id} className="saved-theme-card" style={{ display: 'grid', gap: 7, padding: 9, border: '1px solid #E9D6B7', borderRadius: 11, background: theme.colors.card }}>
                <div className="saved-theme-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[
                        theme.backgroundStyle?.type === 'gradient' ? theme.backgroundStyle.color1 : theme.colors.background,
                        theme.backgroundStyle?.type === 'gradient' ? theme.backgroundStyle.color2 : theme.colors.background,
                        theme.colors.accent,
                        theme.colors.card
                      ].map((color, index) => (
                        <span key={`${color}-${index}`} aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: color, border: '1px solid #E9D6B7' }} />
                      ))}
                    </div>
                    <strong style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: theme.colors.text,
                      fontFamily: FONT_STYLES[theme.headingFont]?.family ?? FONT_STYLES.classicSerif.family,
                      fontSize: 14
                    }}>
                      {theme.name}
                    </strong>
                  </div>
                  <span style={{
                    color: theme.colors.text,
                    fontFamily: FONT_STYLES[theme.bodyFont]?.family ?? FONT_STYLES.modernSans.family,
                    fontSize: 10
                  }}>
                    {FONT_STYLES[theme.headingFont]?.label ?? theme.headingFont} · {FONT_STYLES[theme.bodyFont]?.label ?? theme.bodyFont}
                  </span>
                </div>
                <div className="saved-theme-actions" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 5 }}>
                  <button type="button" onClick={() => applyCustomTheme(theme)} style={{ ...field, padding: '6px 8px', fontSize: 11, cursor: 'pointer' }}>Apply</button>
                  <button type="button" onClick={() => editCustomTheme(theme)} style={{ ...field, padding: '6px 8px', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                  <button type="button" onClick={() => deleteCustomTheme(theme)} style={{ ...field, padding: '6px 8px', color: '#9B463E', fontSize: 11, cursor: 'pointer' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      </>
      )}
    </main>
  )
}
