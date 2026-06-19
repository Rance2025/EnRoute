# Time Calendar Animation Design

## Goal

Make the shared time picker move naturally between the one-row week view and the full month view while keeping every date button at the same height during and after the transition.

## Context

The current unified time picker has top-level `日 / 周 / 月 / 年` modes. The old secondary `周历 / 月历` switch is gone, so the animation must happen between the top-level `周` and `日` modes. If week mode renders separate week cards, the date numbers jump when switching back to the month calendar.

## Approach

Use one calendar layout contract for both modes. Week and day modes render the same month date cells. Week mode clips the calendar frame to one visible row and translates the grid so the active week row sits in that frame; day mode expands the frame and translates the grid back to the full month position. The animation belongs to the calendar body container and grid transform, not to individual buttons, so date cells keep a stable height while the row moves into its month position.

## Interaction

- `周` shows one weekday row plus one active date row.
- `日` shows the same weekday row plus the full visible month grid.
- Switching modes animates both calendar frame height and grid vertical offset, so the same week row moves into the month grid instead of remounting.
- Date buttons use one fixed height in both modes.
- The active day, outside-month styling, hover lift, and click behavior remain unchanged.

## Implementation Boundaries

- Modify `src/time/timeRange.ts` only enough to expose visible row count and active week row index for day/week pages.
- Modify `src/components/TimeContextPanel.tsx` only enough to render day/week through the same calendar frame and date grid.
- Modify `src/App.css` for the frame height animation, grid transform animation, and shared button height.
- Add focused tests in the existing model, layout, and render test files.
- Do not add a motion library for this small transition.

## Verification

- Unit/source tests must assert day/week share the date grid model, preserve mounted date cells, and use shared button height.
- Full project verification remains `npm test -- --run`, `npm run lint`, and `npm run build`.
- Browser verification should switch `周` to `日` and back, confirm the active week row moves smoothly into the month grid, buttons stay equal height, and the console has no runtime errors.
