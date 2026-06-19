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
  const [dragIndex, setDragIndex] = useState<number | null>(null)
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

  function getPointerPosition(clientX: number) {
    const rect = controlRef.current?.getBoundingClientRect()

    if (!rect || rect.width <= 0) return undefined

    const boundedRatio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    const previewIndex = boundedRatio * options.length - 0.5
    const index = Math.min(
      Math.max(Math.round(previewIndex), 0),
      options.length - 1,
    )

    return {
      index,
      previewIndex: Math.min(Math.max(previewIndex, 0), options.length - 1),
    }
  }

  function previewPointerPosition(clientX: number) {
    const position = getPointerPosition(clientX)

    if (!position) return

    setDragIndex(position.previewIndex)
  }

  function commitPointerPosition(clientX: number) {
    const position = getPointerPosition(clientX)

    if (!position) return

    commitIndex(position.index)
  }

  function handlePointerDown(event: PointerEvent<HTMLSpanElement>) {
    isDraggingRef.current = true
    setIsDragging(true)
    controlRef.current?.setPointerCapture?.(event.pointerId)
    previewPointerPosition(event.clientX)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    previewPointerPosition(event.clientX)
  }

  function endDrag(event: PointerEvent<HTMLDivElement | HTMLSpanElement>) {
    if (isDraggingRef.current) {
      commitPointerPosition(event.clientX)
    }

    isDraggingRef.current = false
    setIsDragging(false)
    setDragIndex(null)

    if (controlRef.current?.hasPointerCapture?.(event.pointerId)) {
      controlRef.current.releasePointerCapture(event.pointerId)
    }
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
      className={['segmented-control', isDragging ? 'is-dragging' : null, className]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={ariaLabel}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={
        {
          '--segment-count': options.length,
          '--segment-index': selectedIndex,
          ...(dragIndex === null ? {} : { '--segment-thumb-index': dragIndex }),
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
