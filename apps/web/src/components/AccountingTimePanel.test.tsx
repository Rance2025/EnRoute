import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TimeContextPanel } from './TimeContextPanel'

afterEach(cleanup)

describe('accounting time panel supplement', () => {
  it('uses the area below the time selector for period-specific insights', () => {
    render(
      <TimeContextPanel
        view="accounting"
        selection={{ mode: 'month', start: '2026-06-01', end: '2026-06-30', anchorDate: '2026-06-18' }}
        secondaryContextLabel="流水"
        accountingRangeBrief={{
          title: '时间窗口洞察',
          items: [
            { label: '活跃天数', value: '18 天' },
            { label: '日均支出', value: '¥156.69' },
            { label: '最高单笔', value: '¥1,299.00' },
          ],
        }}
        onSelectionChange={() => undefined}
      />,
    )

    expect(screen.getByLabelText('记账时间窗口洞察')).toHaveTextContent('活跃天数18 天')
    expect(screen.getByLabelText('记账时间窗口洞察')).toHaveTextContent('日均支出¥156.69')
    expect(screen.getByLabelText('记账时间窗口洞察')).toHaveTextContent('最高单笔¥1,299.00')
  })
})
