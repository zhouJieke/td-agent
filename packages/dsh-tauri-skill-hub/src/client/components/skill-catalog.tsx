import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillSummary } from '../types'
import { Icon, Input, Magnifier, Text } from 'dsh-tauri-ui/client'
import { isEmpty, useStore } from 'dsh-tauri/client'
import { openSkillDetail } from '../service/skill'
import { store } from '../store'
import { filterSummaries } from '../store/modules/skill.utils'
import { SkillDownloadAction } from './skill-download'
import { SkillList } from './skill-list'

interface SkillCatalogProps {
  t: Translate
  hint: string
  skills: readonly SkillSummary[]
  emptyText: string
}

/** 只读目录页：检索词是视图状态，落在 store 里以便切页签时复位；同步订阅避免中文组字被回写打断。 */
export function SkillCatalog({ t, hint, skills, emptyText }: SkillCatalogProps): ReactElement {
  const keyword = useStore(store.skill, { sync: true }).keyword
  const matched = filterSummaries(skills, keyword)

  return (
    <div className="flex flex-col gap-[12px]">
      <p className="m-0 text-secondary text-[13px] leading-[20px]">{hint}</p>
      <div className="flex items-center justify-between gap-[16px]">
        <Input
          className="flex-[0_1_320px] min-w-0 max-w-[320px] max-[680px]:max-w-[200px]"
          type="search"
          icon={<Icon as={Magnifier} />}
          aria-label={t('search.aria')}
          placeholder={t('search.placeholder')}
          value={keyword}
          onChange={event => store.skill.setKeyword(event.target.value)}
        />
        <Text tone="tertiary" size="xs">{t('list.count', { count: matched.length })}</Text>
      </div>
      <SkillList
        t={t}
        skills={matched}
        emptyText={isEmpty(keyword) ? emptyText : t('list.emptyMatch')}
        actions={skill => <SkillDownloadAction t={t} name={skill.name} latestVersion={skill.labels.latest} />}
        onSelect={openSkillDetail}
      />
    </div>
  )
}
