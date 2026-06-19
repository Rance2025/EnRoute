import { useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react'

export type SegmentedOption<Value extends string> = {
  value: Value
  label: string
  disabled?: boolean
}

type SegmentedControlProps<Value extends string> = {
  ariaLabel: string
  className?: string
  options: Array<SegmentedOption<Value>>
  value: Value
  onChange: (value: Value) => void
}

export function SegmentedControl<Value extends string>({
  ariaLabel,
  className,
  options,
  value,
  onChange,
}: SegmentedControlProps<Value>) {
  const controlRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const selectedIndex = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  )
  const selectedOption = options[selectedIndex] ?? options[0]
  const enabledOptions = options.filter((option) => !option.disabled)

  function commitIndex(index: number) {
    const option = getClosestEnabledOption(options, index)

    if (option && option.value !== value) {
      onChange(option.value)
    }
  }

  function commitPointerPosition(clientX: number) {
    const rect = controlRef.current?.getBoundingClientRect()

    if (!rect || rect.width <= 0) return

    const boundedRatio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 0.999)
    const index = Math.floor(boundedRatio * options.length)

    commitIndex(index)
  }

  function handlePointerDown(event: PointerEvent<HTMLSpanElement>) {
    isDraggingRef.current = true
    setIsDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    commitPointerPosition(event.clientX)
  }

  function handlePointerMove(event: PointerEvent<HTMLSpanElement>) {
    if (!isDraggingRef.current) return
    commitPointerPosition(event.clientX)
  }

  function endDrag(event: PointerEvent<HTMLSpanElement>) {
    isDraggingRef.current = false
    setIsDragging(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    const enabledIndex = enabledOptions.findIndex((option) => option.value === value)
    let nextValue: Value | undefined

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextValue = enabledOptions[Math.min(enabledIndex + 1, enabledOptions.length - 1)]?.value
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextValue = enabledOptions[Math.max(enabledIndex - 1, 0)]?.value
    }

    if (event.key === 'Home') {
      nextValue = enabledOptions[0]?.value
    }

    if (event.key === 'End') {
      nextValue = enabledOptions.at(-1)?.value
    }

    if (nextValue) {
      event.preventDefault()
      onChange(nextValue)
    }
  }

  return (
    <div
      ref={controlRef}
      className={['segmented-control', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={ariaLabel}
      style={
        {
          '--segment-count': options.length,
          '--segment-index': selectedIndex,
        } as CSSProperties
      }
    >
      <span
        className={`segmented-control__thumb${isDragging ? ' is-dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={`${ariaLabel}滑块`}
        aria-valuemin={0}
        aria-valuemax={Math.max(options.length - 1, 0)}
        aria-valuenow={selectedIndex}
        aria-valuetext={selectedOption?.label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      />
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function getClosestEnabledOption<Value extends string>(
  options: Array<SegmentedOption<Value>>,
  targetIndex: number,
) {
  if (!options[targetIndex]?.disabled) {
    return options[targetIndex]
  }

  for (let distance = 1; distance < options.length; distance += 1) {
    const next = options[targetIndex + distance]
    const previous = options[targetIndex - distance]

    if (next && !next.disabled) return next
    if (previous && !previous.disabled) return previous
  }

  return undefined
}
