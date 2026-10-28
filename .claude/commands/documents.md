---
description: Render the paperwork in your brand: swing itineraries for each worker, the crew and compliance pack a client asks for, and the hours summary for client sign-off.
---

1. `npm run docs` renders every document. One kind: `npm run docs -- itinerary`, `npm run docs -- crew-pack`, `npm run docs -- hours-summary`. One record: add its id (`npm run docs -- crew-pack J-203`).
2. Files land in `docs-out/<kind>/`. Print to PDF from the browser, or attach as is.
3. Business name, colours and the footer come from `brand.json`. A new document type is a new entry in `documents.json`.
