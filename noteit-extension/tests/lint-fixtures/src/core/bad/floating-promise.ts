// expect: error @typescript-eslint/no-floating-promises
async function work(): Promise<void> {}
export function run(): void {
  work()
}
