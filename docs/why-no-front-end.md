# Why there is no front end

Humanz is a database with a subscription. The records underneath it are ordinary: people, the credentials they hold and when each expires, the sites and what each requires, the swing patterns, the dated shifts, the flights and rooms, the timesheets. What you pay for is the layer on top that lets people who do not write queries get at those records. A scheduler grid, filters, warnings, a phone app.

That layer used to be the whole product, because talking to a database was hard. It is not hard any more. Open this folder in Claude Code, describe what you want, and it runs the check, books the swing, or answers the question. Ask a question the scheduler never had a screen for ("who on the books could cover a rigger on the Bowen Range shutdown without breaking anyone's 14 day hours?") and you still get an answer.

## What you gain

- **Better answers.** A scheduler shows what the vendor decided to show. Here you ask your own question against your own roster.
- **No headcount price.** Rostering 300 people costs the same as rostering 30. Labour hire and subbies are records, not seats.
- **Your data in your database.** Plain records. Back them up, query them from anything, leave any time.
- **Rules that match yours.** A client changes its fatigue standard, you change one row. A new site wants a new ticket, you add it in a sentence.

## What you give up

- **A drag-and-drop scheduler.** The roster is a grid you print or ask about (`npm run view`, `/board`), and a swing is booked by asking.
- **A worker phone app.** Workers confirm shifts and send hours by text, photo or the supervisor's sheet, and they are entered here. Enterprise DNA builds a phone screen into your version if you need one.
- **Live push to phones and two-way payroll sync.** Itineraries are drafted and a person sends them; approved hours leave as a payroll file.
- **A vendor help desk.** This is open source. Enterprise DNA supports the installed version for businesses that want someone to call.

## Who this fits

A crew coordinator or operations manager who spends the day answering "who is cleared, who is flying, who is short, who is over hours". If your crews need a phone app on day one, either keep Humanz or have Enterprise DNA build the phone screen in. If you need the answers more than the screens, this is cheaper and yours.

Installed and run for you: https://enterprisedna.co/omni/instead-of/humanz
