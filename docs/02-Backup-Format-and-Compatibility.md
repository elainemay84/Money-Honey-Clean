# Money Honey Backup Format and Compatibility

## Current format

Money Honey exports a UTF-8 JSON file with this top-level shape:

```json
{
  "formatVersion": 1,
  "exportedAt": "2026-11-13T23:00:00.000Z",
  "storageKeys": ["..."],
  "data": {
    "money-honey-account-data": "...serialized JSON...",
    "...": "..."
  }
}
```

- `formatVersion` is the backup envelope version. The current value is `1`.
- `exportedAt` is the ISO timestamp when the export was created.
- `storageKeys` records the supported Money Honey storage-key allowlist.
- `data` contains the serialized values for every supported key. Missing values are represented as `null`.
- The file is a replacement backup, not a merge file. Import replaces every supported key and removes supported keys that are absent from the backup.
- Unrecognized keys are ignored and reported during import. Unrelated browser storage is not exported.

The implementation of the allowlist and snapshot is in `src/backupData.js`. The import validation and sanitization rules are in `src/backupSanitize.js`.

## Included records and settings

The current full backup includes:

- Accounts and transactions, including cleared status, account links, categories, ordering/link fields, and account settings.
- Bills and income schedules, including payment histories.
- Pay schedule.
- Debts, balances, and debt payment histories.
- Legacy, manual, and smart budget values.
- Dismissed smart-budget suggestions.
- Budget mode and budget settings.
- Categories, including custom categories, renamed built-in categories, and disabled built-ins.
- Saved payees.
- Active theme settings, fonts, colors, background settings, and line spacing.
- Saved custom themes.
- Appearance size and transaction sort order.

Authentication-like values, unrelated browser keys, and temporary session notices are not part of the backup.

## Compatibility policy

1. `formatVersion` changes only when the JSON envelope or its compatibility contract changes.
2. Future versions must continue to import `formatVersion: 1` backups, either directly or through an explicit migration step.
3. A future importer must never reinterpret an old backup silently. It must migrate it deterministically, validate the migrated data, and verify the restored values.
4. Newer backup versions must be rejected by older applications with a clear message; they must not be partially imported.
5. Each persistent data domain should retain an internal version when its schema changes. Domain migrations should run before normal validation and should be covered by fixtures from every supported prior version.
6. Adding a persistent storage key requires updating the backup allowlist, replacement categories, sanitization/loader checks where applicable, documentation, and the explicit persistent-key regression test.
7. Removing or renaming a key requires a migration or an intentional documented removal. A missing key in an imported backup remains destructive for that supported key because restore is replacement-based.

The current implementation is version-aware and rejects unsupported versions; it does not yet migrate older versions automatically.

## Future native iOS import

A native iOS app can import the current file as a document using the same JSON envelope. It should:

1. Parse and validate `formatVersion`.
2. Treat `data` as an interchange payload, not as native localStorage.
3. Map each supported storage key to a native model or persistence table.
4. Preserve the serialized record fields and relationships, including transaction cleared state, bill/income links, payment histories, budgets, categories, and themes.
5. Apply explicit domain migrations before writing native records.
6. Validate the complete migrated dataset before replacing existing native data.
7. Keep the existing file format supported for as long as practical and export the same format when interoperability is required.

The native app should use a transactional replacement or staging import so a failed import cannot leave a partially migrated financial dataset.
