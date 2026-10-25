-- 完整的数据库架构脚本
-- 创建或更新 highlights 表，确保所有字段都存在

-- 如果表不存在则创建
CREATE TABLE IF NOT EXISTS highlights (
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

-- 如果表已存在，添加可能缺失的字段
-- 注意：如果字段已存在，这些命令会失败但不会影响数据

-- 添加 pageTitle 字段（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'highlights' AND column_name = 'pageTitle') THEN
        ALTER TABLE highlights ADD COLUMN "pageTitle" TEXT;
    END IF;
END $$;

-- 添加 favicon 字段（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'highlights' AND column_name = 'favicon') THEN
        ALTER TABLE highlights ADD COLUMN favicon TEXT;
    END IF;
END $$;

-- 添加 comment 字段（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'highlights' AND column_name = 'comment') THEN
        ALTER TABLE highlights ADD COLUMN comment TEXT;
    END IF;
END $$;

-- 添加 start 字段（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'highlights' AND column_name = 'start') THEN
        ALTER TABLE highlights ADD COLUMN start INTEGER;
    END IF;
END $$;

-- 添加 length 字段（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'highlights' AND column_name = 'length') THEN
        ALTER TABLE highlights ADD COLUMN length INTEGER;
    END IF;
END $$;

-- 添加 context 字段（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'highlights' AND column_name = 'context') THEN
        ALTER TABLE highlights ADD COLUMN context JSONB;
    END IF;
END $$;

-- 添加 xpath 字段（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'highlights' AND column_name = 'xpath') THEN
        ALTER TABLE highlights ADD COLUMN xpath TEXT;
    END IF;
END $$;

-- 创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_highlights_url ON highlights(url);
CREATE INDEX IF NOT EXISTS idx_highlights_timestamp ON highlights(timestamp DESC);

-- 显示当前表结构
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'highlights' 
ORDER BY ordinal_position;
