-- Per-line-item priority and comment.
ALTER TABLE "order_items" ADD COLUMN "priority" TEXT;
ALTER TABLE "order_items" ADD COLUMN "comment" TEXT;
