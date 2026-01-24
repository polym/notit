# NoteIt 故障排查指南

## 批注功能问题

### 问题：选中文本添加批注后，数据库中没有记录

#### 可能的原因和解决方案

#### 1. 数据库表缺少 comment 字段

**症状：**
- 本地存储中有批注数据，但 Supabase 数据库中 comment 列为空或不存在
- 浏览器控制台可能显示数据库错误

**解决方法：**

1. **检查表结构**
   
   在 Supabase SQL Editor 中运行：
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'highlights' 
   ORDER BY ordinal_position;
   ```

2. **添加缺失字段**
   
   如果没有 comment 字段，运行：
   ```sql
   ALTER TABLE highlights ADD COLUMN comment TEXT;
   ```

3. **或运行完整架构更新**
   
   执行项目中的 `/supabase-migrations/complete-schema.sql` 文件，确保所有字段都存在。

#### 2. 本地存储未正确保存批注

**验证方法：**

在浏览器开发者工具 Console 中运行：
```javascript
chrome.storage.local.get('highlights', (result) => {
  const highlights = result.highlights || [];
  console.table(highlights.map(h => ({
    id: h.id.substr(0, 8),
    text: h.text.substr(0, 30),
    comment: h.comment || '(无批注)',
    hasComment: !!h.comment
  })));
});
```

**如果批注未保存到本地：**
- 确认扩展已正确加载（尝试重新加载扩展）
- 检查浏览器控制台是否有 JavaScript 错误
- 清除本地存储后重试：
  ```javascript
  chrome.storage.local.clear()
  ```

#### 3. Supabase 同步失败

**验证方法：**

1. 打开浏览器开发者工具 → Console
2. 查找以下错误信息：
   - `Supabase upsert failed`
   - `Supabase sync failed`
   - 权限相关错误

**解决方法：**

1. **检查 Supabase 配置**
   - 点击扩展图标打开侧边栏
   - 点击设置（齿轮图标）
   - 确认 Project URL 和 Anon Key 正确

2. **检查表权限（RLS Policies）**
   
   在 Supabase 后台：
   - 进入 Authentication → Policies
   - 找到 highlights 表
   - 确认有允许 ALL 操作的策略，或创建新策略：
   
   ```sql
   -- 允许匿名用户的所有操作
   CREATE POLICY "Enable all access for highlights" 
   ON highlights 
   FOR ALL 
   TO anon 
   USING (true) 
   WITH CHECK (true);
   ```

3. **测试数据库连接**
   
   在浏览器 Console 中运行：
   ```javascript
   chrome.storage.sync.get(['supabaseUrl', 'supabaseKey'], async (result) => {
     if (!result.supabaseUrl || !result.supabaseKey) {
       console.error('Supabase 未配置');
       return;
     }
     
     const { createClient } = window.supabase;
     const supabase = createClient(result.supabaseUrl, result.supabaseKey);
     
     const { data, error } = await supabase.from('highlights').select('count');
     if (error) {
       console.error('数据库连接失败:', error);
     } else {
       console.log('数据库连接成功，记录数:', data);
     }
   });
   ```

## 测试批注功能

### 使用测试页面

1. 打开项目根目录的 `test-annotation.html` 文件
2. 按照页面上的步骤进行测试
3. 验证每个功能是否正常工作

### 手动测试步骤

1. **创建带批注的高亮**
   - 在网页上选中一段文本
   - 点击 📝 按钮
   - 输入批注："这是测试批注"
   - 保存

2. **验证本地存储**
   ```javascript
   chrome.storage.local.get('highlights', (result) => {
     const latest = result.highlights[result.highlights.length - 1];
     console.log('最新高亮:', {
       text: latest.text,
       comment: latest.comment,
       hasComment: !!latest.comment
     });
   });
   ```

3. **验证数据库**
   - 登录 Supabase 后台
   - 进入 Table Editor → highlights
   - 查找刚创建的记录
   - 检查 comment 列是否有值

4. **验证显示**
   - 刷新页面
   - 高亮应该恢复
   - 悬停在高亮文本上应该显示批注

## 其他常见问题

### 高亮不保存

1. 检查扩展权限
2. 检查是否在不支持的页面（如 chrome:// 页面）
3. 清除缓存和本地存储

### 高亮位置不准确

1. 这可能发生在动态网页上
2. 目前使用文本匹配来恢复高亮
3. 如果网页内容变化，可能需要手动调整

### 跨设备同步不工作

1. 确认两台设备都配置了相同的 Supabase 项目
2. 检查网络连接
3. 手动触发同步：在侧边栏中切换页面

## 获取帮助

如果以上方法都无法解决问题：

1. 打开浏览器开发者工具（F12）
2. 切换到 Console 标签
3. 复制所有错误信息
4. 在 GitHub Issues 中提交问题，附上：
   - 错误信息
   - 操作步骤
   - 浏览器版本
   - 是否配置了 Supabase

## 调试技巧

### 启用详细日志

扩展已经包含了详细的控制台日志，格式为 `[NoteIt] ...`。在开发者工具中过滤 "NoteIt" 可以只看相关日志。

### 查看扩展背景页日志

1. 进入 `chrome://extensions/`
2. 找到 NoteIt 扩展
3. 点击 "service worker" 或 "背景页"
4. 查看背景脚本的日志

### 重新加载扩展

1. 进入 `chrome://extensions/`
2. 找到 NoteIt
3. 点击刷新图标
4. 重新测试功能
