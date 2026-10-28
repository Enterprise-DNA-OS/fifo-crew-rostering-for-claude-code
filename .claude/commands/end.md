---
description: Take someone off a job from a date: cancels their remaining shifts and closes the assignment.
---

1. Run `npm run roster -- end <worker> <job> --from=<date> --reason=".." --by=".."`.
2. Say how many shifts went, then cancel their flights (`/flight ... --cancel`) and room, and run `/coverage` for the gap it leaves.
