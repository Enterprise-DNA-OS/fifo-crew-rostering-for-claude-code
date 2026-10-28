---
description: Record a booked flight for a worker (or cancel one). Ports default to their home airport and the site's airstrip.
---

1. Run `npm run roster -- flight <worker> --date=<date> --in|--out [--flight=QF1930] [--ref=<booking ref>] [--from=PER --to=PBO]`. Add `--cancel` to cancel.
2. Read the details off the itinerary the operator gives you. Never guess a booking reference.
3. Nothing here books with an airline. It records the booking the travel person made.
