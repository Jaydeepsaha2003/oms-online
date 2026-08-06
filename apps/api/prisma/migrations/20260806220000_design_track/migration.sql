-- Design Track: hand-entered processed ("Kalwat") quantity per order line.
-- Remaining is deliberately NOT stored — it is derived as bags - kalwat on read,
-- so editing the order's bags can never leave a stale Remaining behind.
CREATE TABLE "design_track_entries" (
    "orderItemId" INTEGER NOT NULL PRIMARY KEY,
    "kalwat" REAL,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "design_track_entries_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
