# NoteIt 📝

一个简洁优雅的 Chrome 网页高亮笔记扩展，让你可以在任何网页上标记重要内容，添加笔记，并跨设备同步。

## ✨ 功能特点

### 🎨 网页高亮
- 在任何网页上选中文字，选择颜色进行高亮标记
- 支持多种高亮颜色：黄色、绿色、蓝色、粉色、橙色
- 高亮内容会自动保存，刷新页面后依然存在

### 📝 添加笔记
- 为高亮内容添加文字注释
- 悬停在高亮文字上即可查看笔记
- 笔记以优雅的工具提示形式展示

### 🔄 跨设备同步
- 支持通过 Supabase 云端同步高亮内容
- 在不同设备、不同浏览器间无缝访问你的笔记
- 数据安全可靠，完全由你掌控

### 📱 侧边栏管理
- **Current Page（当前页面）**：查看当前网页的所有高亮
- **Websites（网站列表）**：按时间分组查看所有网站的高亮
  - 今天 (Today)
  - 昨天 (Yesterday)
  - 本周 (This Week)
  - 更早 (Earlier)
- 显示网站图标和标题，界面简洁美观
- 一键跳转到高亮位置
- 轻松删除不需要的高亮

### ⌨️ 快捷键支持
- 选中文字后使用快捷键快速高亮（默认：`Ctrl+Shift+H` / `Cmd+Shift+H`）

---

## 🚀 安装方法

### 方法一：从发布包安装（推荐）

1. **下载扩展包**
   - 在 [GitHub Releases](https://github.com/polym/notit/releases) 页面下载最新版本的 `noteit-extension.zip`
   - 或从 GitHub Actions 的构建产物中下载

2. **解压文件**
   - 将下载的 `noteit-extension.zip` 解压到一个文件夹

3. **安装到 Chrome**
   - 打开 Chrome 浏览器
   - 在地址栏输入 `chrome://extensions/` 并回车
   - 打开右上角的「开发者模式」开关
   - 点击「加载已解压的扩展程序」按钮
   - 选择解压后的文件夹（包含 `manifest.json` 的文件夹）
   - 完成！扩展图标会出现在工具栏

### 方法二：从源码构建

1. **克隆仓库**
   ```bash
   git clone https://github.com/你的用户名/notit.git
   cd notit/noteit-extension
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **构建扩展**
   ```bash
   npm run build
   ```

4. **加载到 Chrome**
   - 打开 `chrome://extensions/`
   - 启用「开发者模式」
   - 点击「加载已解压的扩展程序」
   - 选择 `noteit-extension/dist` 文件夹

---

## ⚙️ Supabase 配置（可选）

如果你想跨设备同步高亮内容，需要配置 Supabase。不配置也可以正常使用，数据会保存在本地。

### 第一步：创建 Supabase 项目

1. **注册 Supabase 账号**
   - 访问 [https://supabase.com](https://supabase.com)
   - 点击「Start your project」，使用 GitHub 账号登录（推荐）

2. **创建新项目**
   - 登录后点击「New Project」
   - 填写项目信息：
     - **Name（项目名称）**：随意填写，例如 `noteit`
     - **Database Password（数据库密码）**：设置一个强密码，**务必保存好**
     - **Region（地区）**：选择离你最近的地区（推荐 Singapore 或 Tokyo）
   - 点击「Create new project」，等待 1-2 分钟初始化完成

### 第二步：创建数据表

1. **进入 SQL Editor**
   - 项目创建完成后，点击左侧菜单的「SQL Editor」
   - 点击「New query」创建新查询

2. **执行建表 SQL**
   - 复制以下 SQL 代码，粘贴到查询编辑器中：

   ```sql
   -- 创建 highlights 表
   CREATE TABLE highlights (
     id TEXT PRIMARY KEY,
     text TEXT NOT NULL,
     url TEXT NOT NULL,
     color TEXT NOT NULL,
     timestamp BIGINT NOT NULL,
     "pageTitle" TEXT,
     favicon TEXT,
     comment TEXT,
     start INTEGER,
     length INTEGER,
     context JSONB,
     xpath TEXT,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );

   -- 创建索引以提高查询性能
   CREATE INDEX idx_highlights_url ON highlights(url);
   CREATE INDEX idx_highlights_timestamp ON highlights(timestamp DESC);
   ```

   - 点击「Run」执行 SQL
   - 看到「Success. No rows returned」表示创建成功

3. **设置表权限（重要！）**
   - 点击左侧菜单的「Authentication」→「Policies」
   - 找到 `highlights` 表
   - 点击「New Policy」→「Create policy from scratch」
   - 填写策略信息：
     - **Policy name**: `Enable all access for highlights`
     - **Allowed operation**: 选择 `ALL`
     - **Target roles**: 选择 `anon`
     - **USING expression**: 输入 `true`
     - **WITH CHECK expression**: 输入 `true`
   - 点击「Save policy」

### 第三步：获取配置信息

1. **获取项目 URL**
   - 点击左侧菜单的「Settings」（齿轮图标）
   - 点击「API」
   - 找到「Project URL」，复制这个 URL
   - 格式类似：`https://xxxxx.supabase.co`

2. **获取 API Key**
   - 在同一个页面往下滚动
   - 找到「Project API keys」部分
   - 复制「anon public」密钥（**不是 service_role 密钥！**）

### 第四步：在扩展中配置

1. **打开扩展设置**
   - 点击 Chrome 工具栏的 NoteIt 图标，打开侧边栏
   - 点击右上角的 ⚙️（设置）图标

2. **填写配置信息**
   - **Supabase URL**：粘贴第三步复制的 Project URL
   - **Supabase Anon Key**：粘贴第三步复制的 anon public 密钥
   - 点击「Save Configuration」

3. **验证配置**
   - 创建一个高亮测试
   - 在不同设备上登录同一个 Supabase 项目
   - 如果能看到同步的高亮，说明配置成功！

### 常见问题

**Q: 配置后不能同步怎么办？**
- 检查 Supabase URL 和 Key 是否正确
- 确认已创建 highlights 表
- 确认已设置表权限（Policies）
- 打开浏览器开发者工具（F12）→ Console，查看是否有错误信息

**Q: 批注功能不工作，数据库中没有 comment 字段？**
- 如果你的数据库表是在添加批注功能之前创建的，可能缺少 `comment` 字段
- 解决方法：在 Supabase SQL Editor 中运行以下 SQL：
  ```sql
  ALTER TABLE highlights ADD COLUMN IF NOT EXISTS comment TEXT;
  ```
- 或者运行项目中的完整架构脚本：`supabase-migrations/complete-schema.sql`
- 验证字段已添加：
  ```sql
  SELECT column_name FROM information_schema.columns WHERE table_name = 'highlights';
  ```

**Q: 如何验证批注功能是否正常？**
- 在浏览器中打开项目根目录下的 `test-annotation.html` 文件
- 按照页面上的测试步骤操作
- 使用开发者工具检查数据：
  ```javascript
  chrome.storage.local.get('highlights', (result) => console.log(result.highlights))
  ```

**Q: 我的数据安全吗？**
- 所有数据存储在你自己的 Supabase 项目中
- Supabase 提供行业标准的加密和安全措施
- 你可以随时导出或删除数据
- 不配置 Supabase 的话，数据仅保存在本地浏览器

**Q: Supabase 免费吗？**
- Supabase 提供永久免费套餐
- 免费套餐包含：500MB 数据库空间、50MB 文件存储、每月 2GB 流量
- 对于个人笔记使用，免费套餐完全足够

---

## 📖 使用指南

### 创建高亮

1. 在任何网页上用鼠标选中想要高亮的文字
2. 会弹出颜色选择菜单（包含4个颜色按钮和1个笔记按钮）
3. **直接高亮**：点击任一颜色按钮，立即生成对应颜色的高亮
4. **添加批注**：点击 📝 笔记按钮，输入批注内容后保存

### 添加和编辑批注

**创建带批注的高亮：**
1. 选中文本后，点击浮动菜单中的 📝 按钮（最右侧）
2. 在弹出的输入框中输入你的批注内容
3. 点击 "Save Note" 按钮或按 `Ctrl+Enter` (Mac: `Cmd+Enter`) 保存
4. 批注会以紫色高亮显示

**编辑已有批注：**
1. 将鼠标悬停在高亮文本上
2. 浮动菜单会自动出现
3. 点击 📝 按钮打开编辑界面
4. 修改批注内容后保存
5. 要删除批注，清空输入框后保存即可

**查看批注：**
- 将鼠标悬停在带有批注的高亮文本上
- 批注内容会以工具提示形式显示
- 在侧边栏中也可以看到批注内容（显示在高亮文本下方）

### 查看高亮

- **在原网页**：高亮的文字会以彩色背景显示
- **在侧边栏**：点击工具栏图标打开侧边栏，查看所有高亮
- **悬停查看笔记**：鼠标悬停在有笔记的高亮上，会显示注释内容

### 管理高亮

- **跳转到高亮位置**：在侧边栏点击高亮内容，自动跳转并滚动到对应位置
- **修改颜色或笔记**：鼠标悬停在高亮文字上，会显示编辑菜单
- **删除高亮**：在侧边栏点击高亮右上角的 × 按钮

### 快捷键

- **快速高亮**：选中文字后按 `Ctrl+Shift+H`（Mac: `Cmd+Shift+H`）
- **打开侧边栏**：点击工具栏图标或使用右键菜单

---

## 🛠️ 技术栈

- **前端框架**：React + TypeScript
- **构建工具**：Vite + CRXJS
- **高亮引擎**：Mark.js
- **云端同步**：Supabase
- **浏览器 API**：Chrome Extensions Manifest V3

---

## 📝 开发

```bash
# 安装依赖
cd noteit-extension
npm install

# 开发模式（自动重载）
npm run dev

# 构建生产版本
npm run build

# 代码检查
npm run lint
```

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📮 联系方式

如有问题或建议，请在 GitHub 上提 Issue。

---

**享受你的网页阅读和笔记之旅！📚✨**
