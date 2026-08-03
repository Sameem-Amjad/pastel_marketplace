-- ════════════════════════════════════════════════════════════════════════════
-- Pastel — Postgres performance layer (doc 05: "Search & Scaling")
--
-- What lives here vs in schema.prisma:
--   schema.prisma  → write model: tables, relations, btree @@index, uniques. Prisma owns these.
--   performance.sql → everything Prisma can't express: GIN / GiST / trigram indexes, PARTIAL indexes,
--                     and the derived `listing_search` read projection + its sync triggers.
--
-- DESIGN DECISION (vs doc 02 §12, which lists GIN/GiST/trigram on `Listing` itself):
--   The heavy search indexes (full-text, trigram, materials-GIN, geo-GiST) live ONLY on the derived
--   `listing_search` projection, NOT on the hot `Listing` write table. Carrying multiple GIN/GiST
--   indexes on the write model taxes every insert/update; the projection is updated once per change via
--   trigger and is the single thing the search path reads. This keeps writes cheap and reads fast — the
--   right tradeoff at 1M+ listings. (See AUDIT notes in README.)
--
-- IDEMPOTENT: safe to re-run. Uses IF NOT EXISTS / CREATE OR REPLACE throughout.
--
-- PRODUCTION NOTE: on a populated DB, create indexes with CREATE INDEX CONCURRENTLY (outside a txn) to
--   avoid write locks. On an empty/fresh DB (migration time) the plain form below is fine and faster.
--   For zero-drift prod, fold this file's contents into the Prisma migration that creates these tables.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Partial indexes on the write model — sweep/worker hot paths.
--    Partial indexes are tiny (only the rows the poller cares about) and stay hot in RAM.
-- ─────────────────────────────────────────────────────────────────────────────

-- ScheduledTransition: the timer poller scans only pending rows due now (doc 04).
CREATE INDEX IF NOT EXISTS "ScheduledTransition_pending_runAt_idx"
  ON "ScheduledTransition" ("runAt")
  WHERE "status" = 'pending';

-- StockReservation: the 15-min expiry sweeper scans only pending holds.
CREATE INDEX IF NOT EXISTS "StockReservation_pending_expiresAt_idx"
  ON "StockReservation" ("expiresAt")
  WHERE "state" = 'pending';

-- Outbox: the relay worker polls only pending events, oldest first.
CREATE INDEX IF NOT EXISTS "Outbox_pending_createdAt_idx"
  ON "Outbox" ("createdAt")
  WHERE "status" = 'pending';

-- Story: 24h expiry sweep only touches rows that actually expire.
CREATE INDEX IF NOT EXISTS "Story_expiresAt_idx"
  ON "Story" ("expiresAt")
  WHERE "expiresAt" IS NOT NULL;

-- Notification: unread badge/feed is the hottest read — keep an index of only unread rows.
CREATE INDEX IF NOT EXISTS "Notification_unread_idx"
  ON "Notification" ("recipientId", "createdAt" DESC)
  WHERE "read" = false;

-- Notification: scheduled (future-visible) sweep, e.g. upcoming_live.
CREATE INDEX IF NOT EXISTS "Notification_sendAt_idx"
  ON "Notification" ("sendAt")
  WHERE "sendAt" IS NOT NULL;

-- Notification: order-transition dedup. orderId is NULLABLE, so a plain UNIQUE would collapse all
-- ad-hoc (orderId IS NULL) rows together — a PARTIAL unique is the correct construct (doc 02 §9).
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_order_dedup_uq"
  ON "Notification" ("recipientId", "orderId", "type")
  WHERE "orderId" IS NOT NULL;

-- OrderEmailReminder: the 15-min reminder sweeper scans only un-sent, un-canceled, due rows.
CREATE INDEX IF NOT EXISTS "OrderEmailReminder_due_idx"
  ON "OrderEmailReminder" ("sendAt")
  WHERE "sent" = false AND "canceled" = false;

-- NativeLog: 7-day TTL sweep (no console TTL in Postgres).
CREATE INDEX IF NOT EXISTS "NativeLog_expiresAt_idx"
  ON "NativeLog" ("expiresAt");

-- IdempotencyKey: sweep stale keys.
CREATE INDEX IF NOT EXISTS "IdempotencyKey_createdAt_idx"
  ON "IdempotencyKey" ("createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The `listing_search` read projection (doc 05).
--    Denormalized, lean (~1M published rows vs 10M historical), rebuildable from the write model.
--    NOT a Prisma model — owned entirely here. The SearchService reads ONLY this table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS listing_search (
  id             uuid PRIMARY KEY,
  author_id      uuid          NOT NULL,
  author_name    text,
  title          text          NOT NULL,
  description    text,
  primary_image  uuid,
  price_amount   bigint,
  price_currency char(3),
  category_l1    text,
  category_l2    text,
  category_l3    text,
  listing_type   text,
  condition      text,
  period         text,
  origin         text,
  materials      text[]        NOT NULL DEFAULT '{}',
  in_stock       boolean       NOT NULL DEFAULT false,
  popularity     double precision NOT NULL DEFAULT 0,
  created_at     timestamptz   NOT NULL,
  fts            tsvector
);

-- Geo column is added only when PostGIS is installed (dormant feature; absent in some dev envs).
DO $geo$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    CREATE EXTENSION IF NOT EXISTS postgis;
    EXECUTE 'ALTER TABLE listing_search ADD COLUMN IF NOT EXISTS geo geography(Point,4326)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS listing_search_geo_gist ON listing_search USING gist (geo)';
    -- GiST on the write model too, for the rare geo query that must hit live rows.
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Listing_geo_gist" ON "Listing" USING gist ("geo")';
    RAISE NOTICE 'PostGIS present: geo column + GiST indexes created.';
  ELSE
    RAISE NOTICE 'PostGIS not available: skipping geo column/indexes (geo search is dormant).';
  END IF;
END
$geo$;

-- Search indexes on the projection.
CREATE INDEX IF NOT EXISTS listing_search_fts_gin    ON listing_search USING gin (fts);
CREATE INDEX IF NOT EXISTS listing_search_title_trgm ON listing_search USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS listing_search_materials  ON listing_search USING gin (materials);
CREATE INDEX IF NOT EXISTS listing_search_cat        ON listing_search (category_l1, category_l2, category_l3);
-- category-L1 (the dominant marketplace facet) aligned with the default recency sort, so a category
-- browse seeks instead of walking the global created_at index and discarding non-matches (AUDIT H4).
CREATE INDEX IF NOT EXISTS listing_search_cat1_created ON listing_search (category_l1, created_at DESC, id DESC);
-- Default sort + keyset cursor pagination (created_at DESC, id DESC). Flat latency at any depth.
CREATE INDEX IF NOT EXISTS listing_search_created    ON listing_search (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS listing_search_price      ON listing_search (price_amount, id);
CREATE INDEX IF NOT EXISTS listing_search_type       ON listing_search (listing_type);
CREATE INDEX IF NOT EXISTS listing_search_popularity ON listing_search (popularity DESC, id DESC);
-- Hot facet: in-stock listings sorted by recency (partial keeps it small).
CREATE INDEX IF NOT EXISTS listing_search_instock    ON listing_search (created_at DESC, id DESC) WHERE in_stock;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Projection sync. refresh_listing_search(id) recomputes one row from the write model;
--    it INSERTs only published, non-deleted listings and DELETEs otherwise (so unpublish/close/delete
--    all converge correctly). Triggers on Listing + its denormalized inputs (images, stats) keep it live.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION refresh_listing_search(p_id uuid) RETURNS void AS $$
BEGIN
  DELETE FROM listing_search WHERE id = p_id;

  INSERT INTO listing_search (
    id, author_id, author_name, title, description, primary_image,
    price_amount, price_currency, category_l1, category_l2, category_l3,
    listing_type, condition, period, origin, materials, in_stock, popularity, created_at, fts
  )
  SELECT
    l."id",
    l."authorId",
    COALESCE(u."displayName", u."handle", u."firstName"),
    l."title",
    l."description",
    (SELECT li."assetId" FROM "ListingImage" li
       WHERE li."listingId" = l."id" ORDER BY li."position" ASC LIMIT 1),
    l."priceAmount",
    l."priceCurrency",
    l."categoryL1", l."categoryL2", l."categoryL3",
    l."listingType",
    l."condition", l."period", l."origin",
    COALESCE(l."materials", '{}'),
    (l."stockType"::text IN ('infiniteOneItem', 'infiniteMultipleItems') OR l."stockQuantity" > 0),
    COALESCE(s."viewCount", 0)::double precision * 0.3
      + COALESCE(s."ratingAvg", 0) * 20
      + COALESCE(s."reviewCount", 0) * 2,
    l."createdAt",
    setweight(to_tsvector('english', COALESCE(l."title", '')), 'A')
      || setweight(to_tsvector('english', COALESCE(l."description", '')), 'B')
      || setweight(to_tsvector('simple', array_to_string(COALESCE(l."materials", '{}'), ' ')), 'C')
  FROM "Listing" l
  LEFT JOIN "User" u         ON u."id" = l."authorId"
  LEFT JOIN "ListingStats" s ON s."listingId" = l."id"
  WHERE l."id" = p_id
    AND l."state"::text = 'published'
    AND l."deletedAt" IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on the write model.
CREATE OR REPLACE FUNCTION trg_listing_search() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM listing_search WHERE id = OLD."id";
    RETURN OLD;
  END IF;
  PERFORM refresh_listing_search(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- INSERT/DELETE always re-evaluate the projection. (WHEN can't reference OLD on INSERT / NEW on DELETE,
-- so these are separate from the UPDATE trigger.)
DROP TRIGGER IF EXISTS listing_search_sync ON "Listing";
DROP TRIGGER IF EXISTS listing_search_sync_insdel ON "Listing";
CREATE TRIGGER listing_search_sync_insdel
  AFTER INSERT OR DELETE ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION trg_listing_search();

-- UPDATE re-projects ONLY when a value the projection actually depends on changed — including the
-- DERIVED in_stock boolean (not raw stockQuantity). So a stockVersion bump, an updatedAt touch, or a
-- stock decrement that doesn't cross the 0 boundary do NOT rebuild the row (kills write amplification on
-- the hottest path; AUDIT.md H1/H2).
DROP TRIGGER IF EXISTS listing_search_sync_upd ON "Listing";
CREATE TRIGGER listing_search_sync_upd
  AFTER UPDATE ON "Listing"
  FOR EACH ROW
  WHEN (
    OLD."state" IS DISTINCT FROM NEW."state"
    OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
    OR OLD."title" IS DISTINCT FROM NEW."title"
    OR OLD."description" IS DISTINCT FROM NEW."description"
    OR OLD."priceAmount" IS DISTINCT FROM NEW."priceAmount"
    OR OLD."priceCurrency" IS DISTINCT FROM NEW."priceCurrency"
    OR OLD."categoryL1" IS DISTINCT FROM NEW."categoryL1"
    OR OLD."categoryL2" IS DISTINCT FROM NEW."categoryL2"
    OR OLD."categoryL3" IS DISTINCT FROM NEW."categoryL3"
    OR OLD."listingType" IS DISTINCT FROM NEW."listingType"
    OR OLD."condition" IS DISTINCT FROM NEW."condition"
    OR OLD."period" IS DISTINCT FROM NEW."period"
    OR OLD."origin" IS DISTINCT FROM NEW."origin"
    OR OLD."materials" IS DISTINCT FROM NEW."materials"
    OR (OLD."stockType"::text IN ('infiniteOneItem', 'infiniteMultipleItems') OR OLD."stockQuantity" > 0)
       IS DISTINCT FROM
       (NEW."stockType"::text IN ('infiniteOneItem', 'infiniteMultipleItems') OR NEW."stockQuantity" > 0)
  )
  EXECUTE FUNCTION trg_listing_search();

-- Denormalized inputs (primary_image, popularity) live in child tables — refresh the parent row when
-- they change so the projection never goes stale.
CREATE OR REPLACE FUNCTION trg_listing_search_child() RETURNS trigger AS $$
DECLARE
  v_listing_id uuid;
BEGIN
  v_listing_id := COALESCE(NEW."listingId", OLD."listingId");
  IF v_listing_id IS NOT NULL THEN
    PERFORM refresh_listing_search(v_listing_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_image_search_sync ON "ListingImage";
CREATE TRIGGER listing_image_search_sync
  AFTER INSERT OR UPDATE OR DELETE ON "ListingImage"
  FOR EACH ROW EXECUTE FUNCTION trg_listing_search_child();

DROP TRIGGER IF EXISTS listing_stats_search_sync ON "ListingStats";
CREATE TRIGGER listing_stats_search_sync
  AFTER INSERT OR UPDATE OR DELETE ON "ListingStats"
  FOR EACH ROW EXECUTE FUNCTION trg_listing_search_child();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Bulk backfill / rebuild. Set-based (fast) — use after migration or to recover the projection.
--    Returns the number of indexed rows. Run `SELECT rebuild_listing_search();`
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rebuild_listing_search() RETURNS bigint AS $$
DECLARE
  n bigint;
BEGIN
  TRUNCATE listing_search;
  INSERT INTO listing_search (
    id, author_id, author_name, title, description, primary_image,
    price_amount, price_currency, category_l1, category_l2, category_l3,
    listing_type, condition, period, origin, materials, in_stock, popularity, created_at, fts
  )
  SELECT
    l."id",
    l."authorId",
    COALESCE(u."displayName", u."handle", u."firstName"),
    l."title",
    l."description",
    (SELECT li."assetId" FROM "ListingImage" li
       WHERE li."listingId" = l."id" ORDER BY li."position" ASC LIMIT 1),
    l."priceAmount",
    l."priceCurrency",
    l."categoryL1", l."categoryL2", l."categoryL3",
    l."listingType",
    l."condition", l."period", l."origin",
    COALESCE(l."materials", '{}'),
    (l."stockType"::text IN ('infiniteOneItem', 'infiniteMultipleItems') OR l."stockQuantity" > 0),
    COALESCE(s."viewCount", 0)::double precision * 0.3
      + COALESCE(s."ratingAvg", 0) * 20
      + COALESCE(s."reviewCount", 0) * 2,
    l."createdAt",
    setweight(to_tsvector('english', COALESCE(l."title", '')), 'A')
      || setweight(to_tsvector('english', COALESCE(l."description", '')), 'B')
      || setweight(to_tsvector('simple', array_to_string(COALESCE(l."materials", '{}'), ' ')), 'C')
  FROM "Listing" l
  LEFT JOIN "User" u         ON u."id" = l."authorId"
  LEFT JOIN "ListingStats" s ON s."listingId" = l."id"
  WHERE l."state"::text = 'published'
    AND l."deletedAt" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

ANALYZE listing_search;
