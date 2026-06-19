# Time Calendar Animation Design

## Goal

Make the `日` mode calendar move naturally between its secondary `周历` and `月历` display modes while keeping every date button at the same height during and after the transition.

## Context

The shared time panel has top-level `日 / 周 / 月 / 年` modes. Top-level `周` is a week aggregation mode and should keep its week-card grid. The animated calendar transition belongs inside top-level `日`, where the secondary `周历 / 月历` switch changes how the same selected day is displayed.

## Approach

Use one calendar layout contract for both secondary display modes. `周历` and `月历` render the same month date cells. `周历` clips the calendar body to one visible row and translates only the date grid so the active week row sits below the weekday header; `月历` expands the body and translates the date grid back to the full month position. The animation belongs to the calendar body container and date-grid transform, not to individual buttons, so date cells keep a stable height while the row moves into its month position.

## Interaction

- Top-level `日` defaults to `周历`, showing one weekday row plus one active date row.
- `月历` shows the same weekday row plus the full visible month grid.
- Switching `周历 / 月历` animates both calendar body height and date-grid vertical offset, so the same week row moves into the month grid instead of remounting.
- Top-level `周` remains `按周聚合` and does not show the secondary calendar switch.
- Date buttons use one fixed height in both modes.
- The active day, outside-month styling, hover lift, and click behavior remain unchanged.

## Implementation Boundaries

- Modify `src/time/timeRange.ts` only enough to expose the secondary calendar display mode helpers and keep top-level week aggregation separate.
- Modify `src/components/TimeContextPanel.tsx` only enough to render top-level `日` through the secondary calendar body and keep top-level `周` on the paged aggregation grid.
- Modify `src/App.css` for the frame height animation, grid transform animation, and shared button height.
- Add focused tests in the existing model, layout, and render test files.
- Do not add a motion library for this small transition.

## Verification

- Unit/source tests must assert `周历/月历` share the date grid model, preserve mounted date cells, and use shared button height.
- Full project verification remains `npm test -- --run`, `npm run lint`, and `npm run build`.
- Browser verification should switch `周历` to `月历` and back inside top-level `日`, confirm the active week row moves smoothly into the month grid, buttons stay equal height, top-level `周` still renders week cards, and the console has no runtime errors.
