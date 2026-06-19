# Time Calendar Animation Design

## Goal

Make the day calendar's week-to-month switch feel natural while keeping every date button at the week-calendar height during and after the transition.

## Context

The current `TimeContextPanel` switches between `WeekCalendar` and `MonthCalendar` with conditional rendering. The content height changes immediately when the user switches from `周历` to `月历`, and the date buttons also change height because month mode overrides the shared calendar button size.

## Approach

Use one calendar layout contract for both modes. The week view remains a single row of date buttons, and the month view expands the same grid area to show all visible month rows. The animation belongs to the calendar body container, not to individual buttons, so date cells keep a stable height while the lower rows reveal smoothly.

## Interaction

- `周历` shows one weekday row plus one date row.
- `月历` shows the same weekday row plus the full visible month grid.
- Switching modes animates the calendar body height and row reveal.
- Date buttons use the existing week-calendar height in both modes.
- The active day, outside-month styling, hover lift, and click behavior remain unchanged.

## Implementation Boundaries

- Modify `src/components/TimeContextPanel.tsx` only enough to add stable wrapper/class hooks around the calendar body.
- Modify `src/App.css` for the animation, shared button height, and mode-specific visible height.
- Add focused tests in the existing layout/render test files.
- Do not add a motion library for this small transition.

## Verification

- Unit/source tests must assert the calendar body has mode-specific structure and shared button height.
- Full project verification remains `npm test -- --run`, `npm run lint`, and `npm run build`.
- Browser verification should switch `周历` to `月历` and confirm the expansion is animated, buttons stay equal height, and the console has no runtime errors.
