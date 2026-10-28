---
description: Draft the swing itinerary message to a worker: dates, flights, room, start time, and anything that will stop them at the gate.
---

1. Run `npm run roster -- swings --worker=<who> --json` and `npm run docs -- itinerary` so the itinerary page is ready to attach.
2. Write the message to `drafts/itinerary-<worker>-<date>.md`: first day and start time, flights with booking references, camp and room, the last day and the flight home. If a credential lapses before the last day, say so plainly and what to bring.
3. Short enough to read on a phone. Never send it. Say where the draft is.
