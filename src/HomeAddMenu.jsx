import { useEffect, useRef, useState } from 'react'

export default function HomeAddMenu({ onQuickAdd, onMainAccount }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    const closeOutside = event => {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false)
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        menuRef.current?.querySelector('[aria-expanded]')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  return (
    <div ref={menuRef} className="debt-fab home-fab">
      <button
        type="button"
        className="debt-fab-toggle theme-primary-action theme-add-button theme-floating-add"
        aria-label={isOpen ? 'Close quick add menu' : 'Open quick add menu'}
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'home-add-actions' : undefined}
        onClick={() => setIsOpen(value => !value)}
      >
        <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {isOpen && (
        <div id="home-add-actions" role="group" aria-label="Home quick actions" className="debt-fab-actions">
          <button type="button" className="debt-fab-action" onClick={() => { setIsOpen(false); onQuickAdd() }}>
            <span className="debt-fab-label">Quick Add Transaction</span>
            <span className="debt-fab-circle">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m16 3 5 5L8 21H3v-5L16 3ZM13 6l5 5" />
              </svg>
            </span>
          </button>
          <button type="button" className="debt-fab-action" onClick={() => { setIsOpen(false); onMainAccount() }}>
            <span className="debt-fab-label">Main Account</span>
            <span className="debt-fab-circle">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M7 10h10M7 14h10M7 18h6" />
              </svg>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
