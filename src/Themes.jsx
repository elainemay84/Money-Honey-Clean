import { useState } from 'react'
import {
  FONT_STYLES,
  LINE_SPACING_LABELS,
  getThemeStyle,
  loadCustomThemes,
  previewTextColor,
  saveCustomThemes,
  THEME_PRESETS
} from './themeData.js'

const field = {
  padding: 9,
  borderRadius: 9,
  border: '1px solid #E9D6B7',
  minWidth: 0,
  background: '#FFFFFF'
}

const colorNames = [
  ['background', 'Background'],
  ['glow', 'Glow'],
  ['accent', 'Accent'],
  ['tabs', 'Tabs'],
  ['card', 'Cards'],
  ['text', 'Text']
]

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

export default function Themes({ settings, onPreview, onSave, onBack }) {
  const [customThemes, setCustomThemes] = useState(() => loadCustomThemes())
  const [customName, setCustomName] = useState('')
  const [editingCustomId, setEditingCustomId] = useState(null)
  const editorColors = colorsFor(settings)

  function chooseTheme(theme) {
    onPreview({
      ...settings,
      themeId: theme.id,
      headingFont: theme.headingFont,
      bodyFont: theme.bodyFont,
      appFont: theme.bodyFont,
      lineSpacing: theme.lineSpacing ?? 'normal',
      colors: colorsFor({ colors: theme.colors })
    })
    setEditingCustomId(theme.id.startsWith('custom-') ? theme.id : null)
    setCustomName(theme.id.startsWith('custom-') ? theme.name : '')
  }

  function updateColor(key, value) {
    onPreview({ ...settings, colors: { ...editorColors, [key]: value } })
  }

  function saveAsNew() {
    const name = customName.trim()
    if (!name) return
    const customTheme = {
      id: `custom-${Date.now()}`,
      name,
      description: 'Custom theme',
      headingFont: settings.appFont ?? settings.bodyFont,
      bodyFont: settings.appFont ?? settings.bodyFont,
      appFont: settings.appFont ?? settings.bodyFont,
      lineSpacing: settings.lineSpacing ?? 'normal',
      colors: editorColors
    }
    const nextThemes = [...customThemes, customTheme]
    setCustomThemes(saveCustomThemes(nextThemes))
    onSave(customTheme)
  }

  function updateSelected() {
    if (!editingCustomId) return
    const existing = customThemes.find(theme => theme.id === editingCustomId)
    if (!existing) return
    const updated = {
      ...existing,
      name: customName.trim() || existing.name,
      headingFont: settings.appFont ?? settings.bodyFont,
      bodyFont: settings.appFont ?? settings.bodyFont,
      appFont: settings.appFont ?? settings.bodyFont,
      lineSpacing: settings.lineSpacing ?? 'normal',
      colors: editorColors
    }
    const nextThemes = customThemes.map(theme => theme.id === editingCustomId ? updated : theme)
    setCustomThemes(saveCustomThemes(nextThemes))
    onSave(updated)
  }

  function editCustomTheme(theme) {
    setEditingCustomId(theme.id)
    setCustomName(theme.name)
    onPreview({
      ...settings,
      ...theme,
      colors: colorsFor(theme)
    })
  }

  function deleteCustomTheme(theme) {
    if (!window.confirm(`Delete ${theme.name}?`)) return
    const nextThemes = customThemes.filter(item => item.id !== theme.id)
    setCustomThemes(saveCustomThemes(nextThemes))
    if (settings.themeId === theme.id) {
      onPreview({
        ...THEME_PRESETS[0],
        appFont: THEME_PRESETS[0].bodyFont,
        lineSpacing: 'normal',
        colors: colorsFor(THEME_PRESETS[0])
      })
    }
  }

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <button type="button" onClick={onBack} style={{ ...field, color: '#79502A', cursor: 'pointer' }}>
        ‹ Settings
      </button>
      <h1 style={{ color: '#B87522', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
        Themes &amp; Fonts
      </h1>

      <section style={{ background: '#FFFFFF', padding: 14, borderRadius: 16, marginBottom: 12 }}>
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

      <section style={{ background: '#FFFFFF', padding: 14, borderRadius: 16, marginBottom: 12 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Manual Theme</h2>
        <p style={{ margin: '0 0 10px', color: '#79502A', fontSize: 12 }}>
          Build a named theme with your own colors and type.
        </p>
        <input
          aria-label="Custom theme name"
          placeholder="Custom theme name"
          value={customName}
          onChange={event => setCustomName(event.target.value)}
          style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
        />
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 11 }}>
            App Font
            <select
              value={settings.appFont ?? settings.bodyFont}
              onChange={event => onPreview({
                ...settings,
                appFont: event.target.value,
                headingFont: event.target.value,
                bodyFont: event.target.value
              })}
              style={field}
            >
              {Object.entries(FONT_STYLES).map(([value, font]) => (
                <option key={value} value={value}>{font.label}</option>
              ))}
            </select>
          </label>
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
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 7, marginTop: 10 }}>
          {colorNames.map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, color: '#79502A', fontSize: 11 }}>
              {label}
              <input
                type="color"
                aria-label={label}
                value={editorColors[key]}
                onChange={event => updateColor(key, event.target.value)}
                style={{ width: 36, height: 27, padding: 2, border: '1px solid #E9D6B7', borderRadius: 7 }}
              />
            </label>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: editingCustomId ? '1fr 1fr' : '1fr', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={saveAsNew} style={{ ...field, background: '#B87522', color: '#FFFFFF', fontWeight: 'bold', cursor: 'pointer' }}>
            Save as New
          </button>
          {editingCustomId && (
            <button type="button" onClick={updateSelected} style={{ ...field, background: '#FFF8ED', color: '#79502A', fontWeight: 'bold', cursor: 'pointer' }}>
              Update Selected
            </button>
          )}
        </div>
      </section>

      {customThemes.length > 0 && (
        <section style={{ background: '#FFFFFF', padding: 14, borderRadius: 16, marginBottom: 12 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Saved Themes</h2>
          <div style={{ display: 'grid', gap: 7 }}>
            {customThemes.map(theme => (
              <div key={theme.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 3, flex: 1, minWidth: 0 }}>
                  {[theme.colors.background, theme.colors.accent, theme.colors.card, theme.colors.text].map(color => (
                    <span key={color} aria-hidden="true" style={{ width: 15, height: 15, borderRadius: '50%', background: color, border: '1px solid #E9D6B7' }} />
                  ))}
                  <strong
                    style={{
                      marginLeft: 3,
                      padding: '2px 4px',
                      borderRadius: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 12,
                      color: previewTextColor(theme.colors.background),
                      background: theme.colors.background
                    }}
                  >
                    {theme.name}
                  </strong>
                </div>
                <button type="button" onClick={() => editCustomTheme(theme)} style={{ ...field, padding: '6px 8px', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                <button type="button" onClick={() => deleteCustomTheme(theme)} style={{ ...field, padding: '6px 8px', color: '#9B463E', fontSize: 11, cursor: 'pointer' }}>Delete</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ background: '#FFFFFF', padding: 14, borderRadius: 16, marginBottom: 12 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Fonts</h2>
        <p style={{ margin: '0 0 10px', color: '#79502A', fontSize: 12 }}>
          Fine-tune headings and body text after choosing a theme.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {[
            ['headingFont', 'Heading font'],
            ['bodyFont', 'Body font']
          ].map(([key, label]) => (
            <label key={key} style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 11 }}>
              {label}
              <select value={settings[key]} onChange={event => onPreview({ ...settings, [key]: event.target.value })} style={field}>
                {Object.entries(FONT_STYLES).map(([value, font]) => (
                  <option key={value} value={value}>{font.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => onSave(settings)}
        style={{ width: '100%', minHeight: 44, border: 'none', borderRadius: 10, background: settings.colors.accent, color: settings.colors.card, fontWeight: 'bold', cursor: 'pointer' }}
      >
        Save Theme
      </button>
    </main>
  )
}
