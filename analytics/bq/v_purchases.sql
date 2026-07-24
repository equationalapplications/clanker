-- clanker_analytics.v_purchases
-- One row per transaction event (purchase or refund), sourced from the
-- server-sent GA4 purchase/refund events in the daily export dataset. Refunds
-- are their own rows (`type = 'refund'`), not merged into the purchase row —
-- query `type = 'refund'` directly for refund-level analysis.
--
-- The `refunded` boolean on purchase rows is a best-effort convenience join on
-- matching `transaction_id`: it works for RevenueCat (refund events reuse the
-- purchase's transaction id) but Stripe refund events key on `charge.id`, which
-- differs from the originating purchase's `transaction_id` (`session.id` /
-- `invoice.id`) — see docs/billing-architecture.md B6.4. `refunded` will not
-- flip for Stripe purchases; use the `type = 'refund'` rows for canonical Stripe
-- refund reconciliation instead.
--
-- Daily export only — data lands ~24h behind; there is no events_intraday_*
-- table, so "today" returns nothing by design.
CREATE OR REPLACE VIEW `clanker-prod.clanker_analytics.v_purchases` AS
WITH purchases AS (
  SELECT
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') AS transaction_id,
    user_id,
    user_pseudo_id,
    event_date,
    TIMESTAMP_MICROS(event_timestamp) AS event_timestamp,
    (SELECT COALESCE(ep.value.int_value, ep.value.float_value, ep.value.double_value) FROM UNNEST(event_params) ep WHERE ep.key = 'value') AS value,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'currency') AS currency,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'payment_provider') AS payment_provider,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'store') AS store,
    (SELECT i.item_id FROM UNNEST(items) i LIMIT 1) AS item_id
  FROM `clanker-prod.analytics_544289823.events_*`
  WHERE event_name = 'purchase'
    AND (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id')
    ORDER BY event_timestamp
  ) = 1
),
refunds AS (
  SELECT
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') AS transaction_id,
    user_id,
    user_pseudo_id,
    event_date,
    TIMESTAMP_MICROS(event_timestamp) AS event_timestamp,
    (SELECT COALESCE(ep.value.int_value, ep.value.float_value, ep.value.double_value) FROM UNNEST(event_params) ep WHERE ep.key = 'value') AS value,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'currency') AS currency,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'payment_provider') AS payment_provider,
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'store') AS store,
    (SELECT i.item_id FROM UNNEST(items) i LIMIT 1) AS item_id
  FROM `clanker-prod.analytics_544289823.events_*`
  WHERE event_name = 'refund'
    AND (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id')
    ORDER BY event_timestamp
  ) = 1
),
refunded_transaction_ids AS (
  SELECT DISTINCT transaction_id FROM refunds
)
SELECT
  'purchase' AS type,
  p.transaction_id,
  p.user_id,
  p.user_pseudo_id,
  p.event_date,
  p.event_timestamp,
  p.value,
  p.currency,
  p.payment_provider,
  p.store,
  p.item_id,
  r.transaction_id IS NOT NULL AS refunded
FROM purchases p
LEFT JOIN refunded_transaction_ids r USING (transaction_id)
UNION ALL
SELECT
  'refund' AS type,
  r.transaction_id,
  r.user_id,
  r.user_pseudo_id,
  r.event_date,
  r.event_timestamp,
  r.value,
  r.currency,
  r.payment_provider,
  r.store,
  r.item_id,
  TRUE AS refunded
FROM refunds r;
