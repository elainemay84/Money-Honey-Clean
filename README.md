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

## Home financial calculations

Available Funds is the signed sum of opening balances plus cleared **and uncleared**
register transactions dated through today, respecting each account's opening date.
All active Checking, Savings, Cash and Other accounts (including negative balances)
are included. Investment accounts, credit limits, credit-card balances, archived accounts, and future
register entries are not available cash. Registers themselves still show their
full dated running balances, including future entries.

The forecast runs from today **through payday, inclusive**. Payday settings take
precedence; otherwise the next active cash-account income occurrence supplies the
cutoff. Settings supply dates, never an invented paycheck amount.

`Projected Remaining Funds = Available Funds + Upcoming Income - Upcoming Expenses`

Upcoming Income includes positive register entries after today through the cutoff,
plus scheduled income not represented by a linked transaction or recorded receipt.
A linked receipt uses its actual transaction date, not its original scheduled date.
Upcoming Expenses includes negative register entries after today through the cutoff
plus scheduled obligations not already reflected in those entries or Available
Funds. Explicit transaction links/history IDs, not matching names, reconcile
payments. A partial linked payment reserves only the unpaid difference. Future
register entries beyond payday are excluded. Obligations already due, including
overdue obligations before today, stay reserved until paid. Unassigned schedules
are included conservatively in the aggregate forecast; schedules assigned to
excluded accounts are not cash flows. Savings does not automatically transfer
money to cover an individual checking-account shortfall.

Debt schedules reuse their linked bill, or a read-only projection of the existing
debt schedule when no bill has been saved yet. They are never added as both a debt
expense and a bill expense. No dashboard calculation writes financial records.

Bills Before Payday includes all non-skipped obligations due today through payday,
plus older obligations not fully cleared, across all scheduled accounts.
`Total Due = Cleared + Remaining`, and `Remaining = Paid but Uncleared + Unpaid`.
Cleared uses fully matching, cleared linked payments; only fully
cleared occurrences advance the count/progress bar. Mismatched amounts, accounts,
or payees retain the existing review-required status, but the forecast still
counts their actual cash movement only once. Pending payments remain in
Remaining but are not deducted from forecast cash twice. Legacy paid flags without
a linked account entry do not prove a cash deduction or clearance, so the amount
remains reserved; no replacement transaction is invented. All summaries use cents.

Account, bill/income, debt, and payday-setting save events update Home immediately.
Storage events update other tabs; foregrounding and the local date rollover update
the forecast day. Stored records and JSON backup formats are unchanged.

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

Edit Transaction's Duplicate action opens an unsaved copy in the Add Transaction
form. Review or change its payee, amount, type, category, account, notes, and date
(today by default), then choose Add Transaction or Cancel. Saving creates a new,
uncleared transaction in the destination account's register; the original stays
unchanged. Payment history, bill/debt links, attachments, and recurring references
are not copied.

## Bills list urgency

Money Out's List groups occurrences into Past Due, Due Within 30 Days (today
through day 30 inclusive), and Due Beyond 30 Days. Each compact section totals its
visible rows in cents and sorts by due date. Show Completed restores paid/skipped
rows in their date sections and includes them in those totals. Grouping refreshes
at local midnight and when returning to the app.

The existing schedule horizon remains the current month plus 11 months, together
with older scheduled history. Recurring and moved occurrences are generated by the
existing occurrence engine, not regenerated by grouping. Inset row spacing,
Pay/Paid actions, Calendar, and Money In's month-based list remain unchanged.

## Debt identification and credit cards

Debts optionally store a separate four-digit account suffix (as text, preserving
leading zeros) and a managed assignee. Cards and details show these discreetly;
debt names are never parsed or rewritten.

The Assigned To dropdown defaults to Unassigned. A small Manage Assignees control
directly beneath the dropdown in add/edit forms adds, renames, and deletes options, including
the initial E, R, and Joint names. Names are trimmed and duplicates are rejected
case-insensitively. Renaming updates assigned debts, including archived debts.
Deletion requires confirmation showing the affected debt count and clears only
those assignments. No debts, balances, or payment histories are removed.

Assignee management saves immediately, independently of an unsaved debt form,
and returns to that form with its draft intact and dropdown options refreshed.
The Debt overview has no assignee management control.
The list and assignments persist together in the existing debt storage record,
so a rename or deletion is a single write. Deleted defaults stay deleted, even
when the list is empty. Existing Other/custom assignments are presented as regular
named options without rewriting legacy records on load; there is no separate
Other/Custom Assignee entry workflow.

Credit cards have an optional Credit Limit instead of the form's Starting Balance.
Available credit is limit minus outstanding current balance, including a negative
result when over limit; an unknown limit is not treated as zero. Existing historical
starting balances and payoff calculations are preserved. For a newly entered card,
the current outstanding balance initializes the separate payoff starting balance,
never the credit limit. Loans retain their Starting Balance field.

These are additive optional fields, including the assignee list, in the existing
version-1 debt JSON. No data
migration rewrites old records or guesses limits, account suffixes, or assignees.
Backups round-trip the assignee list, assignments, new fields, and payment histories;
older backups without a list recover the initial options plus existing custom names.
Invalid metadata, duplicate options, and dangling assignments in a managed list
are rejected before restore.

## Private statement autofill for debts

### Payment plans and purchase categories

Choose **Add Payment Plan** from the Debt **+** menu, then enter it manually or
scan a statement. Enter a merchant or plan name, an optional purchase category,
remaining balance, number of remaining payments, first upcoming date, and frequency. The
editable installment list is calculated automatically: amounts differ by at
most one cent and sum to the balance, and monthly dates keep their original day
where possible. Frequencies include weekly, every two weeks, twice monthly,
monthly, quarterly, every six months, and yearly.

The private scanner also reads clearly labeled provider, merchant, original
purchase amount, remaining balance, explicit categories, and visible dated
installments, including separate date/amount/status lines and dated table rows.
For payment-plan screenshots with separate date and amount columns, OCR coordinates
pair confident amounts on the same horizontal row, even when OCR reads each column
separately. Original purchase and remaining scheduled balance stay distinct;
ambiguous or unreadable installment amounts stay blank rather than being divided
from either total.
Recognized rows automatically populate the editable list, including partially
read rows. Review every suggestion; ambiguous installment dates and unreadable
amounts are left blank, never guessed. A yearless date such as "Dec 15" in a
chronological timeline takes its year only from the explicitly dated rows beside
it (for example, the next row "Jan 15, 2027"); otherwise it stays blank. Matches
with neither a usable date nor an amount are not added as rows. Correct these
fields or add missing rows.

Installments automatically stay in due-date order, including after adding a
missing payment or editing a date. Display numbers follow that order; payment
identities and linked Bills/history stay attached to their original installments.
Rows with missing or invalid dates stay at the bottom until corrected.

Debt details show statement-paid installments alongside Money Honey payments in
oldest-first Payment History. Statement entries say **Paid on statement** and show
the scheduled date, not an assumed actual payment date. Linked payments appear
only once. This history is display-only: statement-paid rows do not create bank
transactions or reduce the outstanding balance again. Installment counts and
financial payoff progress are shown separately.

Debt Details includes a collapsed **Future Payments** list below Payoff Progress
for saved installment schedules. It shows today's and future unpaid installments
in due-date order, excluding paid and pending entries, and updates when the saved
schedule or recorded payments change.

All visible Activity rows are imported, including **Paid**, **Pending**, and
**Due** installments. Pending rows appear separately from completed Payment History
and never count as completed or create payable Bills. Once the provider confirms a
pending payment, change its status to **Paid on statement** in **Edit Debt**.
This only updates tracking; it does not create another transaction or deduct the
payment again. The imported remaining balance stays exactly as shown by the provider
unless you edit it, even when it differs from the sum of scheduled payments.

Dark-mode screenshots are inverted and small screenshots are enlarged on your
device before reading, so light-on-dark timeline text is read reliably.
Timeline circles and connector lines beside rows are ignored.

**Scan Payment Plan** also reads activity timelines without provider or installment
labels. It prefers the item or merchant name over generic headings such as
"In progress" and fills the next payment from the earliest visible unpaid row.
Consistent visible dates prefill the number of payments, first payment date, and
frequency. Exact amounts are retained, including a final payment with adjusted
cents; only clearly paid/completed rows are marked paid. Uncertain purchase
categories remain blank. The form shows "Schedule found from statement. Review
before saving." rather than parser details.

Scanned installments take precedence over generated schedules. Complete or correct
missing dates and amounts in the list before saving; changing the plan inputs
does not silently replace scanned rows. A partial timeline contains only its
visible rows, even if the statement mentions a larger total; missing future
payments are not invented. Activity-timeline inference is specific to Add Payment
Plan and does not add installment controls to ordinary Add Debt or Add Bill.

Saving creates one debt and one linked finite bill schedule containing only
due installments, not an indefinite recurrence. Rows recorded as paid on the
statement count toward progress but never create historical bank transactions.
Recorded payments retain their links and cannot be removed through the row editor;
correct or undo those payments in Accounts/Bills.

**Accounting rule (unchanged):** spending, budgets, and reports count recorded
purchase transactions, not debt records or scheduled bills. Purchase Category is
descriptive metadata; selecting it or scanning a plan does not create an expense.
Record the original purchase once in Accounts under its expense category if it
is not already recorded. Linked installment repayments are debt payments,
excluded from purchase spending and shown separately in debt-payment reporting,
regardless of their transaction category. This avoids counting both the original
purchase and its repayments. No past transactions or reporting calculations are
rewritten.

Add/Edit ordinary Bill offers the same private Scan / Upload Statement mechanism
for bill name, amount due, due date, and an explicitly identifiable category.
Scanning only changes the draft and leaves the existing schedule/account controls
unchanged.

The Debt **+** button expands labeled floating actions for adding a debt manually,
scanning a debt statement, or adding a payment plan. Tap the main **X** again, tap outside, or
press Escape to dismiss; choosing an action or leaving Debt also closes the menu.
The Add button stays above the bottom navigation and iPhone safe area.
Primary Add buttons and form Add/Save actions use the selected theme's solid accent
with contrasting black or white text, larger touch targets, and a subtle shadow.
Expanded Add options, including the payment-plan submenu, use matching rounded
buttons with the same theme-accent fill and contrasting text/icons as primary
buttons, plus borders and soft shadows. The menu scrolls on short screens and
stays above the navigation.
Manual entry opens the compact form without a scanner. The compact **Scan Statement**
sheet has full-width **Take Photo**, **Choose Image** (Photos or a file), and
**Choose PDF** rows, plus **Enter Manually** and **Cancel**. It stays above the
bottom navigation, follows theme styling, and supports Tab and Escape.
Scanning then opens the same normal,
unsaved Add Debt form with suggested values filled in. Review the extracted
creditor, explicit debt type, account suffix, credit limit, current balance, APR,
minimum payment, and next due date. Every suggestion is editable and can be
corrected. Partial results are welcome: even one reliable field fills its matching
control, with a short "We filled in N fields. Review and complete the rest."
message instead of a list of missing fields. Missing or conflicting values stay
blank (including an unknown debt type on a new scan), not guessed.
Edit Debt retains an optional scanner with editable, individually selectable
suggestions; **Apply Suggestions to Form** asks before replacing existing values.
Both paths only update the draft: saving still requires the normal save button.
Failed scans keep entered values intact. Manual entry remains available while
reading, and errors distinguish unreadable text from text with no matching fields.
Historical starting balances, assignments, payment histories, and transactions
are not changed by scanning. Original loan starting balances must be entered manually.

[Tesseract.js](https://github.com/naptha/tesseract.js) reads images on the device;
[PDF.js](https://mozilla.github.io/pdf.js/) extracts PDF text and renders scanned
pages for local OCR when no financial fields are found in the text layer.
There are no document uploads, third-party AI calls, paid APIs, subscriptions,
or secret keys. Documents and raw OCR text stay in memory, are not saved to
localStorage or backups, and are released after reading. Only reviewed field
values can be saved, with account numbers reduced to their last four digits.
Original purchase, total financed/repayment, total interest, already-paid totals,
and next payment amount are separate statement references, never credit
limits or payment-history entries. Saved reference values are retained in storage
and backups without adding fields to the debt form. A labeled remaining balance
alone populates Current Balance. Scanning does not select or replace a payment
schedule from installment counts; choose Monthly or Pay in 4 explicitly.
Screenshot-style labels and values on separate lines are supported, including
"Current remaining balance", "Next payment date", and installment progress.
Purchase dates and next-payment amounts never substitute for due dates or balances,
and scheduled installment amounts do not become credit-card minimum payments.
Inconsistent totals are flagged rather than recomputed. For example, the supplied
Home Depot purchase plus interest does not equal its stated total repayment;
the stated $296.74 balance remains $296.74 and no five historical payments are created.

Use sharp, well-lit English statement summary pages with clear labels. The reader
is deliberately conservative: low-confidence OCR, multiple different candidates,
ambiguous dates such as `02/03/2026`, dates without a year, credit/negative balances,
and unfamiliar layouts may require manual entry. Multi-column layouts and mixed
image/text PDFs may leave fields undetermined. This is not a general-purpose AI
document reader; review every proposed value.

Loading shows engine, language-download, initialization, and recognition progress.
Startup is bounded to 35 seconds; the complete reading is bounded to two minutes.
Errors offer **Retry Reading**, another file, or **Enter Manually**. Cancellation
terminates owned workers and releases image resources. A failed file is retained
in memory only for retry, until canceled, replaced, or the scanner is closed.
PDF cleanup is also bounded so it cannot leave the loading screen stuck.

Limits are 15 MB and five PDF pages. Image processing
and PDF rendering are bounded to roughly four million pixels per page, but large
original photos can still require substantial decoding memory. Password-protected
PDFs must first be unlocked outside Money Honey. JPEG and PNG are recommended;
HEIC and other image formats depend on browser decoding support.

The worker scripts, WASM engines, English model, PDF resources, and library licenses
are self-hosted by Vite. Deploy the **entire** generated `dist` directory, including
`statement-assets` and lazy-loaded chunks; no backend configuration is required.
OCR downloads its worker, one core variant (about 4 MB), and English model (about
3 MB) when needed. PDF support is also lazy-loaded. Serve these static files without
redirecting missing assets to HTML. There is no service worker/offline guarantee;
a connection may be needed to load these same-origin assets.

The camera and file controls use native browser pickers, including the iPhone Home
Screen app. Verify camera permission, Photos, PDF selection, HEIC behavior, memory,
and cancellation on a physical iPhone in Safari and Home Screen mode before release.
Desktop tests verify actual image OCR, text PDFs, and scanned PDFs, but cannot
certify iOS picker behavior or keyboard focus zoom. Bill scanning is not included.

## Debt payment schedules

The compact Add/Edit Debt form offers **Monthly** (default) and **Pay in 4**.
For a new Pay in 4 plan, enter only the current balance and first payment due date
in addition to the core debt details. Four payments are calculated automatically,
14 days apart, with any cent remainder assigned to the last payment. For example,
$100.03 becomes $25.00, $25.00, $25.00, and $25.03. The form and debt card show the
next scheduled payment; no installment counts, frequency controls, statement totals,
or advanced date editors are shown. A separate starting balance is not required for
Pay in 4; new payoff tracking starts with the current balance.

Editing a saved plan does not divide its remaining balance into four new payments.
Its original allocation, completed installments, adjustments, and payment identities
remain intact. Before any payments or skips, changing the balance of an automatic
Pay in 4 plan recalculates its four amounts. Earlier custom and biweekly schedules continue working without
migration; the form identifies a saved nonstandard schedule rather than displaying
it as Monthly. Hidden historical/reference values remain in storage and backups.
Saved installment schedules with payment or skip history cannot be replaced from
the selector; debt details and the next unpaid due date can still be edited.
Monthly dates continue to clamp in short months without drifting the following month.

Schedules reuse the existing debt-linked Bills and Accounts/Transactions flow.
Finite plans generate only their remaining installments, not unlimited recurring
bills. Actual payments advance the displayed next unpaid occurrence; recording the
same reference again does not count twice. Existing principal/manual-allocation
rules remain unchanged, including balance review when interest allocation is unknown.
Money Honey records payments only; it never sends money to a provider.

As selected for this workflow, **Skip Payment leaves an installment skipped**:
it does not reduce balance, increase completed installments, or extend the plan.
Use Show Completed in Bills to undo the skip and manually edit that occurrence's
due date. Skips and historical payments retain their identities across schedule edits.

Schedules, installment identities, reference amounts, and assignments round-trip
in the existing version-1 JSON backups. Legacy debts without schedule metadata keep
their existing monthly behavior and are not rewritten on load.

## Categories & Payees

Expense categories, income categories, and saved payees are alphabetized
case-insensitively in management and entry choices. Adds and renames reject blank
or duplicate names with visible errors. Category names are unique within each
type; Income and Expense may share a name without confusing new income with refunds.
There is no application-imposed record-count limit; device storage failures are
reported and entry drafts remain available to retry.

Preset and custom categories can both be deleted after confirmation. Deletion
removes future choices, not transactions, bills, budgets, or historical assignments.
Deleted categories remain available to historical reporting, including refunds
and existing budget lines. Preset deletion markers, historical category names,
and same-name category classification metadata are included in version-1 JSON
backups. Older backups remain supported; loading saved data never restores
intentionally deleted presets.

## iPhone form behavior

Mobile form controls use at least 16px text, including compensation for Small
appearance, to prevent Safari focus zoom. Compact spacing, theme styling, and
user-controlled pinch-to-zoom remain available; the viewport does not restrict zoom.
Financial amounts and percentages use text inputs with decimal keypads and no
browser increment/decrement spinners. Shared validation preserves cents and large
amounts, accepts properly grouped commas, and rejects invalid text or extra decimal
places instead of silently rounding. Account management preserves a balance draft
while typing, saves valid values as before, and validates/finalizes on blur.
Account suffixes request numeric keypads and use text inputs rather
than number inputs. Signed opening balances have a compact +/- control because
iPhone decimal keypads may omit the minus key. Transactions retain their existing
Expense/Income selector, decimal precision, and support for pasted negative values.

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
Accounts likewise places its controls above a full-width centered title.
Bills places both segmented controls side by side below its full-width centered
title, with fitted labels and compact touch targets. Only the Home
dashboard title includes the honey pot emoji.

On the Funky Pop Accounts overview, the compact app wrapper is transparent so
the root's full-height gradient remains continuous behind the bottom navigation.
Other page and theme backgrounds are unchanged.

Account summaries use three columns when the card has room and two rows on
narrow screens. Currency values fit their cells without truncation or changes to
balance calculations. Check large balances and long account names in every
appearance size, including wide decorative fonts.
