import { cssr } from '../utils/cssr'

export default cssr.c(
  ':has(> [data-slot="sidebar"]), :has(> [data-slot="main"]), :has(> [data-slot="rightbar"]), [data-dsh-better-sidebar], [data-dsh-panel]',
  'visibility: hidden !important; pointer-events: none !important;',
)
