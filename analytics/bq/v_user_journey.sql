-- clanker_analytics.v_user_journey
-- Behavioral funnel over the trailing 90 days of the GA4 daily export.
-- Corrections vs. the advice draft: %Y%m%d (not %Y%m%m); _TABLE_SUFFIX bounded on
-- BOTH the inner and outer scans; filter on real event names, not URL guessing;
-- pre-login stitching via a user_pseudo_id -> user_id identity map built from
-- authenticated events, so anonymous events inherit the later-known user_id.
CREATE OR REPLACE VIEW `clanker-prod.clanker_analytics.v_user_journey` AS
WITH bounds AS (
  SELECT
    FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)) AS start_suffix,
    FORMAT_DATE('%Y%m%d', CURRENT_DATE()) AS end_suffix
),
events AS (
  SELECT
    user_id,
    user_pseudo_id,
    event_name,
    event_date,
    TIMESTAMP_MICROS(event_timestamp) AS event_timestamp
  FROM `clanker-prod.analytics_544289823.events_*`, bounds
  WHERE _TABLE_SUFFIX BETWEEN bounds.start_suffix AND bounds.end_suffix
    AND event_name IN ('subscribe_flow_started', 'purchase', 'screen_view', 'page_view')
),
identity_map AS (
  SELECT user_pseudo_id, ANY_VALUE(user_id) AS user_id
  FROM events
  WHERE user_id IS NOT NULL
  GROUP BY user_pseudo_id
)
SELECT
  COALESCE(e.user_id, im.user_id, e.user_pseudo_id) AS journey_key,
  COALESCE(e.user_id, im.user_id) AS user_id,
  e.user_pseudo_id,
  e.event_name,
  e.event_date,
  e.event_timestamp
FROM events e
LEFT JOIN identity_map im USING (user_pseudo_id)
ORDER BY journey_key, event_timestamp;
