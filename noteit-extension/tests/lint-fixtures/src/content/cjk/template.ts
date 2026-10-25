// expect: error noteit/no-cjk-literal
export const count = (n: number) => `${n} \u6761`
