// expect: error qingmark/no-cjk-literal
export const count = (n: number) => `${n} \u6761`
