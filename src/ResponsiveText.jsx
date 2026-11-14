import { useLayoutEffect, useRef } from 'react'

function fitText(element) {
  element.style.removeProperty('--responsive-font-size')
  const availableWidth = element.clientWidth - 2
  if (availableWidth <= 0) return

  const words = window.getComputedStyle(element).whiteSpace === 'nowrap'
    ? [element.textContent]
    : element.textContent.match(/[^ \t\r\n]+/g) ?? []
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  Object.assign(probe.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    width: 'max-content'
  })
  element.append(probe)
  const measure = () => Math.max(0, ...words.map(word => {
    probe.textContent = word
    return probe.offsetWidth
  }))

  if (measure() > availableWidth) {
    let lower = 0
    let upper = parseFloat(window.getComputedStyle(element).fontSize)
    for (let step = 0; step < 12; step += 1) {
      const size = (lower + upper) / 2
      element.style.setProperty('--responsive-font-size', `${size}px`)
      if (measure() <= availableWidth) lower = size
      else upper = size
    }
    element.style.setProperty('--responsive-font-size', `${lower}px`)
  }
  probe.remove()
}

export default function ResponsiveText({ as: Element = 'h1', children, className = '', ...props }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    fitText(ref.current)
  })

  useLayoutEffect(() => {
    const element = ref.current
    let frame
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => fitText(element))
    }
    const observer = new window.ResizeObserver(schedule)
    observer.observe(element)
    document.fonts?.addEventListener('loadingdone', schedule)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      document.fonts?.removeEventListener('loadingdone', schedule)
    }
  }, [Element])

  return (
    <Element {...props} ref={ref} className={`responsive-text ${Element === 'h1' ? 'responsive-page-title' : ''} ${className}`.trim()}>
      {children}
    </Element>
  )
}
