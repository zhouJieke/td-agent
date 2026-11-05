export const BRAND_NAME = 'Td-Agent'
export const BRAND_MARK_PATH = 'M10 18h24v7h-8v23h-8V25h-8ZM35 18h6c10 0 15 5.5 15 15s-5 15-15 15h-6Zm8 8v14c3.5-.8 5-3.1 5-7s-1.5-6.2-5-7Z'
export const BRAND_COLOR = '#6154e8'
export const BRAND_ACCENT = '#77eddb'

export function brandSvg(options: { nightly?: boolean, square?: boolean, template?: boolean } = {}): string {
  const background = options.nightly ? '#17233d' : BRAND_COLOR
  const radius = options.square ? 0 : 15
  const body = options.template
    ? `<path fill="#000000" fill-rule="evenodd" d="${BRAND_MARK_PATH}"/>`
    : `<rect width="64" height="64" rx="${radius}" fill="${background}"/><path fill="#ffffff" fill-rule="evenodd" d="${BRAND_MARK_PATH}"/><circle cx="51" cy="11" r="3" fill="${BRAND_ACCENT}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">${body}</svg>\n`
}
