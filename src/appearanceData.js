export const APPEARANCE_SIZE_STORAGE_KEY = 'money-honey-appearance-size'
export const APPEARANCE_SIZES = ['small', 'medium', 'large']

export function loadAppearanceSize() {
  const saved = localStorage.getItem(APPEARANCE_SIZE_STORAGE_KEY)
  return APPEARANCE_SIZES.includes(saved) ? saved : 'medium'
}

export function saveAppearanceSize(size) {
  const value = APPEARANCE_SIZES.includes(size) ? size : 'medium'
  localStorage.setItem(APPEARANCE_SIZE_STORAGE_KEY, value)
  return value
}
