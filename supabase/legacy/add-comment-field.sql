-- 迁移脚本：为 highlights 表添加 comment 字段
-- 如果你的数据库表已经存在但缺少 comment 字段，运行此脚本

-- 检查并添加 comment 字段
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'highlights' 
        AND column_name = 'comment'
    ) THEN
        ALTER TABLE highlights ADD COLUMN comment TEXT;
        RAISE NOTICE 'comment 字段已添加到 highlights 表';
    ELSE
        RAISE NOTICE 'comment 字段已存在，无需添加';
    END IF;
END $$;

-- 验证字段是否存在
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'highlights' 
ORDER BY ordinal_position;
