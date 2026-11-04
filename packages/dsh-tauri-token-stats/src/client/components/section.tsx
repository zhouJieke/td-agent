import type { ReactElement, ReactNode } from 'react'

export interface SectionProps {
  title: string
  subtitle?: string
  control?: ReactNode
  children: ReactNode
}

export function Section({ title, subtitle, control, children }: SectionProps): ReactElement {
  return (
    <section className="box-border rounded-xl border border-border-l2 bg-layer-3">
      <header className="flex items-start justify-between gap-[16px] px-[16px] pt-[14px] pb-[12px]">
        <div className="min-w-0">
          <h2 className="m-0 text-[14px] leading-[20px] font-medium">{title}</h2>
          {subtitle
            ? <p className="mt-[2px] mx-0 mb-0 text-tertiary text-[12px] leading-[18px]">{subtitle}</p>
            : null}
        </div>
        {control
          ? <div className="flex flex-none items-center gap-[8px]">{control}</div>
          : null}
      </header>
      <div className="px-[16px] pb-[16px]">{children}</div>
    </section>
  )
}
