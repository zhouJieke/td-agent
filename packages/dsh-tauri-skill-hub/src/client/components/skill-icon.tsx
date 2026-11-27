import type { ReactElement } from 'react'
import { Card, GraduationCap, Icon } from 'dsh-tauri-ui/client'

const ICON_COLORS = ['#537da8', '#ad764c', '#7462c4', '#43867f', '#b76686', '#63854d'] as const

export function SkillIcon({ name }: { name: string }): ReactElement {
  const color = ICON_COLORS[Array.from(name).reduce((sum, character) => sum + character.codePointAt(0)!, 0) % ICON_COLORS.length]

  return (
    <Card.Icon
      className="h-[48px] w-[48px] shrink-0 rounded-[14px] border-none text-white"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      <Icon as={GraduationCap} size={26} />
    </Card.Icon>
  )
}
