// expect: error no-restricted-syntax
declare global {
  interface Window {
    __noteit_flag__?: boolean
  }
}
export const flag = window.__noteit_flag__
