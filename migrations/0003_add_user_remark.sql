-- Migration: 0003_add_user_remark.sql
-- Add remark column to users for additional payment information.

ALTER TABLE users ADD COLUMN remark TEXT DEFAULT '';
