// STUB — replaced by the landing-site area.
import type { Lang } from '@/shared/i18n'

export interface SiteHandle {
  /** Called when the smash starts: get the site ready to be revealed (scroll to top, pre-entrance state). */
  prepareReveal(): void
  /** Run the entrance animation (instant=true: returning visitors, no theatrics). */
  playEntrance(opts: { instant: boolean }): void
}

export function mountSite(root: HTMLElement, _opts: { lang: Lang; underIntro: boolean }): SiteHandle {
  root.innerHTML = '<main style="padding:80px"><h1>SimpleCMS One</h1><p><a href="app/">Open workspace</a></p></main>'
  return { prepareReveal() {}, playEntrance() {} }
}
