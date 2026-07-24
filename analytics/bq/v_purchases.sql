-- clanker_analytics.v_purchases
-- One row per transaction, sourced from the server-sent GA4 purchase/refund events
-- in the daily export dataset. Daily export only — data lands ~24h behind; there is
-- no events_intraday_* table, so "today" returns nothing by design.
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
  SELECT DISTINCT
    (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') AS transaction_id
  FROM `clanker-prod.analytics_544289823.events_*`
  WHERE event_name = 'refund'
    AND (SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'transaction_id') IS NOT NULL
)
SELECT
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
LEFT JOIN refunds r USING (transaction_id);
