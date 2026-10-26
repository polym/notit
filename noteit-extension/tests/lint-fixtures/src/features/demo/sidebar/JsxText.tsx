// expect: error noteit/no-cjk-literal
// The HTML entity decodes to a Han character in JSXText.value.
export function Label() {
  return <p>&#x6458;</p>
}
