-- Normalise existing text to UPPERCASE for consistent search/matching.
-- (Transporter and agent names are already uppercased on every write, so they
-- are left untouched here to avoid any unique-constraint edge cases.)

UPDATE "customers" SET
  "partySource"   = UPPER("partySource"),
  "agentName"     = UPPER("agentName"),
  "category"      = UPPER("category"),
  "partyName"     = UPPER("partyName"),
  "transportName" = UPPER("transportName"),
  "bagName"       = UPPER("bagName"),
  "city"          = UPPER("city"),
  "state"         = UPPER("state"),
  "region"        = UPPER("region"),
  "mobile"        = UPPER("mobile"),
  "email"         = UPPER("email"),
  "brand"         = UPPER("brand"),
  "payBy"         = UPPER("payBy");

UPDATE "gst_rates" SET
  "customerName" = UPPER("customerName"),
  "category"     = UPPER("category");

UPDATE "trans_rates" SET
  "customerName"  = UPPER("customerName"),
  "category"      = UPPER("category"),
  "type"          = UPPER("type"),
  "transportName" = UPPER("transportName");
