---
description: Bring people, credentials and the roster across from Humanz (or any roster spreadsheet): dry run first, then import.
---

1. Order matters: workers first, then credentials, then shifts. Sites and jobs must exist (`/jobs`); add them by asking.
2. Dry run: `npm run roster -- import workers <file.csv> --dry-run` (then `credentials`, then `shifts`). Show the counts and anything it could not read.
3. On a yes, run it without `--dry-run`. Running it twice is harmless: rows already here are skipped.
4. Check one person end to end with `/worker` and one job with `/job`.
5. Column names and what maps: `docs/replace-humanz.md`. If the export has other columns, map them in `scripts/roster.mjs` (`importCmd`) and add the case to the smoke test.
