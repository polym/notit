// expect: error no-restricted-syntax
declare global {
  interface Window {
    __qingmark_flag__?: boolean
  }
}
export const flag = window.__qingmark_flag__
