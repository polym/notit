---
name: verify-feature
description: 对 NoteIt 扩展的新功能或修改做端到端验证与验收，产出带截图的中文测试报告。用于"验证一下这个功能""写测试报告""做回归测试""验收这个修复"等请求，尤其是涉及页面高亮渲染、选区、锚点、侧边栏等用户可见行为的改动。
---

# NoteIt 功能验证与测试报告

目标：用可复现的证据证明改动对用户有效，并且没有破坏已有功能。最终交付 `test-reports/<slug>/REPORT.md` 和截图。

核心原则：
- **验收的是用户想要的结果，不是"症状消失"。** 例如"高亮后文字消失"的修复，验收标准是"文字可见 **且** 有高亮底色 **且** 能点击、能刷新恢复"，而不只是"文字没消失"。开始前先把验收标准逐条写下来。
- **截图不能当证据单独用。** 图片查看可能有缓存，肉眼也容易看漏。每个结论都要配一个客观指标：DOM 数量、`getBBox()` 宽度、计算样式、像素计数等。
- **对照组。** 同一个检查在"修复前"和"修复后"两份构建上各跑一次，修复前必须失败，修复后必须通过，否则说明检查没有抓到这个问题。

## 0. 准备环境

```bash
export PATH=/opt/homebrew/opt/node@24/bin:$PATH   # 项目要求 Node 24（noteit-extension/.nvmrc），默认 Node 20 跑不了 lint
cd noteit-extension
npm ci                                            # worktree 里没有 node_modules 时
npx playwright install chromium
npm run db:start && npm run db:reset && npm run env:local   # 本地 Supabase（docker），e2e 登录需要
```

`env:local` 写出的 `.env.local` 已被 git 忽略，不要提交；输出里的本地 demo 密钥不要写进报告。

## 1. 写下验收标准

在动手前列出 3–6 条可检验的标准，每条对应一个指标。示例：

| 标准 | 指标 |
|---|---|
| 高亮后原文仍可见 | 目标元素 `getBBox().width` / `getBoundingClientRect().width` 高亮前后一致 |
| 有可见的高亮底色 | 高亮元素数量 > 0；计算样式 `background-color` / `fill` 为高亮色；截图中高亮色像素数 > 0 |
| 交互正常 | 点击高亮打开弹层（`noteit-root [data-noteit-popover]` 可见） |
| 持久化正常 | `liveRecords` 有记录；刷新后高亮恢复 |
| 不影响其他内容 | 同页普通段落照常高亮 |

## 2. 构建对照组

```bash
# 修复前构建（只 stash 改动的源文件，测试文件保留）
git stash push <改动的源文件...> -q
npm run build && rm -rf /tmp/noteit-dist-before && cp -R dist /tmp/noteit-dist-before
git stash pop -q && git diff --stat               # 确认改动已恢复
npm run build                                     # dist/ = 修复后
```

用产物里的特征字符串确认两份构建确实不同，例如 `grep -c '<新增的类名或常量>' dist/assets/src-content-index.ts-*.js`。

## 3. 回归测试（放在正确的层级）

按改动所在层级选测试类型，能放低层就放低层：

- **渲染器 / 锚点 / TextIndex**：`src/**/*.browser.test.ts`（vitest 浏览器模式，真实 DOM）。参考 `src/features/highlight/render/mark-renderer.browser.test.ts`。
- **用户流程**（选中 → 菜单 → 保存 → 刷新恢复 → 点击弹层）：`tests/e2e/<name>.e2e.ts`，夹具页面放 `tests/e2e/pages/`，按真实网站的 DOM 结构复刻最小页面。参考 `tests/e2e/svg-text.e2e.ts`。
- 断言用户的真实症状和验收标准里的指标，不要只断言"不报错"。

验证测试能抓到问题：

```bash
npx vitest run --project browser <测试文件>
npx playwright test <spec 名关键字> --project=e2e        # 注意：--project 后面接项目名，spec 用位置参数
# 换成修复前构建再跑一次 e2e，必须失败：
mv dist /tmp/noteit-dist-after && cp -R /tmp/noteit-dist-before dist
npx playwright test <spec> --project=e2e --output=/tmp/noteit-before-results
rm -rf dist && mv /tmp/noteit-dist-after dist
```

e2e 截图用 `testInfo.outputPath('xxx.png')` 存到 `test-results/`，最后复制进报告目录。

## 4. 真实页面验证

问题来自真实网站时，必须在真实页面上用构建好的扩展复现和验收。用 [templates/real-page-check.ts](templates/real-page-check.ts)：

```bash
cp ../.claude/skills/verify-feature/templates/real-page-check.ts tmp-real-page-check.ts
# 修复前 / 修复后各跑一次
node tmp-real-page-check.ts --dist /tmp/noteit-dist-before --url '<页面>' --site '<siteKey>' --text '<要选中的文字>' --out ../test-reports/<slug>/real-before
node tmp-real-page-check.ts --dist dist                   --url '<页面>' --site '<siteKey>' --text '<要选中的文字>' --out ../test-reports/<slug>/real-after
```

脚本会：加载扩展、登录本地测试账号、启用站点、拖选目标文字、点第一个颜色、点击高亮、刷新，并输出 JSON 指标和 `-before/-after/-popover/-reload.png` 四张截图。需要额外指标时直接在副本里加。`siteKey` 是去掉 `www.` 的主机名。

真实页面需要外网；e2e fixture 会拦截外网请求，所以真实页面验证只能用这个独立脚本。

## 5. 用像素数检查截图

```bash
python3 -W ignore -c "
import sys; from PIL import Image
for f in sys.argv[1:]:
    im=Image.open(f).convert('RGB')
    print(f, sum(1 for p in im.getdata() if p[2]<p[0]-40 and p[2]<p[1]-40))
" ../test-reports/<slug>/*.png
```

上面统计的是偏黄像素（黄色高亮）。其他颜色按需调整条件。高亮后数量为 0 就说明没画出来，不管截图看起来怎样。

## 6. 全量回归

```bash
npm run test:unit
npm run test:browser
npm run typecheck
npm run lint          # 必须 Node 24
npm run build && npm run scan:dist
npx playwright test --project=e2e    # 约 6 分钟，后台跑
```

`scan:dist` 检查内容脚本 gzip 体积不超过基线 120%。CI 用 `env:local` 的配置构建，比本地 `.env.local` 大约多 150–200 字节，本地离上限不足 300 字节时要当作会失败处理。超限时先尝试精简代码；确认基线已过时（`main` 本身就接近上限）再用 `node scripts/scan-dist.ts --update-baseline` 更新，并在提交信息里说明原因。

## 7. 写报告

用 [templates/REPORT.md](templates/REPORT.md) 生成 `test-reports/<slug>/REPORT.md`。要求：
- 中文，先写结论；每个结论附指标；修复前后对照放表格。
- 写清楚已知限制和**未覆盖**的部分（没跑的套件、没手动验证的场景），不要夸大。
- 截图用相对路径引用，放在同一目录。

## 8. 清理

```bash
rm -f tmp-real-page-check.ts
rm -rf /tmp/noteit-dist-before /tmp/noteit-before-results test-results
git status --short     # 只应剩下源码、测试、报告
```

本地 Supabase 不用时 `npm run db:stop`。提交时按文件 `git add`，不要带上 `.env.local`。
