import { parseFinancialAmount } from './financialAmounts.js'

export default function FinancialInput({ signed = false, min, max, step: _step, onChange, ...props }) {
  function validate(event) {
    const input = event.currentTarget
    try {
      const value = parseFinancialAmount(input.value, 'Amount', { signed, optional: !input.required })
      if (value != null && ((min != null && value < Number(min)) || (max != null && value > Number(max)))) {
        throw new Error(`Enter an amount${min != null ? ` of at least ${min}` : ''}${max != null ? ` and no more than ${max}` : ''}.`)
      }
      input.setCustomValidity('')
    } catch (error) {
      input.setCustomValidity(error.message)
    }
    onChange?.(event)
  }
  return <input {...props} type="text" inputMode="decimal" onChange={validate} />
}
