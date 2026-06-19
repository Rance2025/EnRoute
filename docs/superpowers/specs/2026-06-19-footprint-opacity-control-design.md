# Footprint Opacity Control Design

## Goal

Allow footprint point opacity to be adjusted from the existing map style popover with a slider-only control.

## Behavior

- Default opacity remains the current point value: `0.82`.
- Supported opacity range is `0.3` to `1`.
- Slider step is `0.01`.
- The UI does not expose a manual number input for opacity.
- Opacity is stored with the existing footprint style settings and applied to the native AMap `MassMarks` SVG icon through `fill-opacity`.

## Testing

- Layer tests cover default opacity, custom opacity, precision rounding, invalid values, and range clamping.
- Canvas tests cover persisted opacity being passed into the native layer.
- Toolbar tests cover the slider-only opacity control and local storage persistence.
