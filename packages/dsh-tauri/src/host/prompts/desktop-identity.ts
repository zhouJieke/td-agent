import type { HostContext } from '../types'

type PromptAssembly = Awaited<ReturnType<HostContext['systemPrompt']['assemble']>>

const DEFAULT_PERSONA = 'You are a coding agent powered by the {{model}} model.'

export async function desktopIdentity(_assembly: PromptAssembly, _context: unknown, next: () => Promise<PromptAssembly>): Promise<PromptAssembly> {
  const assembly = await next()
  return {
    ...assembly,
    sections: [
      { name: 'harness:identity', text: '你是 问小达，运行在 问小达 Desktop 里的 AI 助手' },
      ...assembly.sections.filter(section => section.name !== 'harness:identity'
        && !(section.name === 'deployment:persona-prefix' && section.text === DEFAULT_PERSONA)),
    ],
  }
}
