import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadPayees, payeeMatchKey, savePayees } from './payeeData.js'

export default function PayeeAutocomplete({ value, onChange, onSelect, style }) {
  const [payees, setPayees] = useState(loadPayees)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [error, setError] = useState('')
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)
  const menuRef = useRef(null)
  const key = payeeMatchKey(value)
  const matches = payees.filter(name => payeeMatchKey(name).includes(key))
  const canSave = Boolean(value.trim()) && !payees.some(name => payeeMatchKey(name) === key)
  const showMenu = isOpen && (matches.length > 0 || canSave)

  useLayoutEffect(() => {
    if (!showMenu) return
    const updateHeight = () => {
      const input = inputRef.current
      const menu = menuRef.current
      if (!input || !menu) return
      const dialogBottom = input.closest('[role="dialog"]')?.getBoundingClientRect().bottom ?? window.innerHeight
      const viewport = window.visualViewport
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
      const available = Math.max(0, Math.min(dialogBottom, viewportBottom) - input.getBoundingClientRect().bottom - 6)
      menu.style.setProperty('--payee-menu-max-height', `${available}px`)
    }
    updateHeight()
    window.addEventListener('resize', updateHeight)
    window.visualViewport?.addEventListener('resize', updateHeight)
    window.visualViewport?.addEventListener('scroll', updateHeight)
    document.addEventListener('scroll', updateHeight, true)
    return () => {
      window.removeEventListener('resize', updateHeight)
      window.visualViewport?.removeEventListener('resize', updateHeight)
      window.visualViewport?.removeEventListener('scroll', updateHeight)
      document.removeEventListener('scroll', updateHeight, true)
    }
  }, [showMenu])

  useEffect(() => {
    if (showMenu && activeIndex >= 0) {
      wrapperRef.current?.querySelector(`#transaction-payee-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [activeIndex, showMenu])

  function choose(name) {
    inputRef.current?.focus()
    onSelect(name)
    setActiveIndex(-1)
    setIsOpen(false)
    setError('')
  }

  function save() {
    try {
      const current = loadPayees()
      if (current.some(name => payeeMatchKey(name) === key)) {
        setPayees(current)
        setError('This payee is already saved.')
        return
      }
      const name = value.trim()
      setPayees(savePayees([...current, name]))
      choose(name)
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  return (
    <div
      className="payee-autocomplete"
      ref={wrapperRef}
      onBlur={event => {
        if (!wrapperRef.current?.contains(event.relatedTarget)) {
          setIsOpen(false)
          setActiveIndex(-1)
        }
      }}
    >
      <input
        ref={inputRef}
        placeholder="Payee or description"
        aria-label="Payee or description"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showMenu}
        aria-controls={showMenu && matches.length ? 'transaction-payee-options' : undefined}
        aria-activedescendant={showMenu && activeIndex >= 0 ? `transaction-payee-option-${activeIndex}` : undefined}
        autoComplete="off"
        value={value}
        onFocus={() => { setPayees(loadPayees()); setIsOpen(true) }}
        onChange={event => {
          onChange(event)
          setIsOpen(true)
          setActiveIndex(-1)
          setError('')
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && showMenu) {
            event.preventDefault()
            event.stopPropagation()
            setIsOpen(false)
            setActiveIndex(-1)
          } else if (event.key === 'ArrowDown' && matches.length) {
            event.preventDefault()
            setIsOpen(true)
            setActiveIndex(index => Math.min(index + 1, matches.length - 1))
          } else if (event.key === 'ArrowUp' && matches.length) {
            event.preventDefault()
            setIsOpen(true)
            setActiveIndex(index => Math.max(index - 1, 0))
          } else if (event.key === 'Enter' && showMenu && activeIndex >= 0) {
            event.preventDefault()
            choose(matches[activeIndex])
          }
        }}
        style={{ ...style, width: '100%' }}
      />
      {showMenu && (
        <div ref={menuRef} className="payee-autocomplete-menu">
          {matches.length > 0 && (
            <div id="transaction-payee-options" role="listbox" aria-label="Saved payee suggestions" className="payee-autocomplete-options">
              {matches.map((name, index) => (
                <button
                  type="button"
                  role="option"
                  id={`transaction-payee-option-${index}`}
                  aria-selected={index === activeIndex}
                  key={name}
                  onPointerDown={event => event.preventDefault()}
                  onClick={() => choose(name)}
                >{name}</button>
              ))}
            </div>
          )}
          {canSave && (
            <button type="button" className="payee-autocomplete-save" onPointerDown={event => event.preventDefault()} onClick={save}>
              Save as New Payee
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="payee-autocomplete-error">{error}</p>}
    </div>
  )
}
