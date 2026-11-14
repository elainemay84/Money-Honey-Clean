# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Checks

Run `npm test`, `npm run lint`, and `npm run build` to validate the application.

## Accounts overview

Account cards use two compact lines: name and type on the left, balance and
available balance on the right. Names truncate visually when necessary, with the
full name available to assistive technology and on hover. Unusually large amounts
wrap instead of overlapping or hiding financial values. Cards retain account
colors and theme styling; tapping still opens the transaction register.

## Account transaction register

Rows retain bold names and right-aligned amounts, with smaller dates and running
balances underneath. Currency text fits its column without losing digits. Inline
dates show a compact date and calendar icon over a transparent, zoom-safe native
date input; tapping or focusing it still uses the native date picker. Register
line spacing stays compact independently of theme paragraph spacing.

## Bills list spacing

The list's rounded month sections include horizontal padding for both headers and
rows. Month headers use the same content edges without negative margins. Calendar
spacing and payment behavior are unchanged.

## iPhone form behavior

Mobile form controls use at least 16px text, including compensation for Small
appearance, to prevent Safari focus zoom. Compact spacing, theme styling, and
user-controlled pinch-to-zoom remain available; the viewport does not restrict zoom.

On an iPhone in Safari and the installed web app, check Accounts (add/manage),
Transactions (add/edit and inline dates), Bills (including income notes), Debts,
Budgets, and Settings (categories/payees and theme controls). In each appearance
size, focus a field, enter information, and dismiss the keyboard: the page should
keep its normal scale without horizontal overflow. Also check landscape and
confirm that pinch-to-zoom still works. Desktop browser checks cannot reproduce
the iOS keyboard's automatic focus zoom.

## Responsive headings and account summaries

Page titles retain theme fonts and wrap between words. Text fitting measures the
rendered font and adjusts on resizing, theme changes, and font loading, so an
individual word is never split or truncated. Shared headers place back/action
controls above the centered title instead of reserving fixed side gutters.
Accounts and Bills likewise place their controls above a full-width centered
title, so unequal button widths cannot shift headings off-center. Only the Home
dashboard title includes the honey pot emoji.

Account summaries use three columns when the card has room and two rows on
narrow screens. Currency values fit their cells without truncation or changes to
balance calculations. Check large balances and long account names in every
appearance size, including wide decorative fonts.
