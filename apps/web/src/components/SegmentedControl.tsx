import { useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react'

export type SegmentedOption<Value extends string | number> = {
  value: Value
  label: string
  disabled?: boolean
}

type SegmentedControlProps<Value extends string | number> = {
  ariaLabel: string
  className?: string
  options: Array<SegmentedOption<Value>>
  orientation?: 'horizontal' | 'vertical'
  value: Value
  onChange: (value: Value) => void
}

export function SegmentedControl<Value extends string | number>({
  ariaLabel,
  className,
  options,
  orientation = 'horizontal',
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

  function getPointerPosition(clientX: number, clientY: number) {
    const rect = controlRef.current?.getBoundingClientRect()
    const start = orientation === 'vertical' ? rect?.top : rect?.left
    const size = orientation === 'vertical' ? rect?.height : rect?.width
    const pointer = orientation === 'vertical' ? clientY : clientX

    if (start === undefined || !size || size <= 0) return undefined

    const boundedRatio = Math.min(Math.max((pointer - start) / size, 0), 1)
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

  function previewPointerPosition(clientX: number, clientY: number) {
    const position = getPointerPosition(clientX, clientY)

    if (!position) return

    setDragIndex(position.previewIndex)
  }

  function commitPointerPosition(clientX: number, clientY: number) {
    const position = getPointerPosition(clientX, clientY)

    if (!position) return

    commitIndex(position.index)
  }

  function handlePointerDown(event: PointerEvent<HTMLSpanElement>) {
    isDraggingRef.current = true
    setIsDragging(true)
    controlRef.current?.setPointerCapture?.(event.pointerId)
    previewPointerPosition(event.clientX, event.clientY)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    previewPointerPosition(event.clientX, event.clientY)
  }

  function endDrag(event: PointerEvent<HTMLDivElement | HTMLSpanElement>) {
    if (isDraggingRef.current) {
      commitPointerPosition(event.clientX, event.clientY)
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

  const activeLabels = options.map((option) => (
    <span className="segmented-control__active-label" key={option.value}>
      {option.label}
    </span>
  ))

  return (
    <div
      ref={controlRef}
      className={[
        'segmented-control',
        `segmented-control--${orientation}`,
        isDragging ? 'is-dragging' : null,
        className,
      ]
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
        aria-orientation={orientation}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <span className="segmented-control__active-labels" aria-hidden="true">
          {activeLabels}
        </span>
      </span>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          data-segment-label={option.label}
        >
          <span className="segmented-control__label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function getClosestEnabledOption<Value extends string | number>(
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
