// expect: error no-restricted-syntax
// The cast form used by legacy code must be caught as well.
export const flag = (window as unknown as Record<string, unknown>).__noteit_creating_highlight__
