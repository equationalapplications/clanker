-- clanker_analytics.v_user_journey
-- Behavioral funnel over the trailing 90 days of the GA4 daily export.
-- Corrections vs. the advice draft: %Y%m%d (not %Y%m%m); _TABLE_SUFFIX bounded on
-- BOTH the inner and outer scans; filter on real event names, not URL guessing;
-- join on user_id with user_pseudo_id retained for pre-login stitching.
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
)
SELECT
  COALESCE(user_id, user_pseudo_id) AS journey_key,
  user_id,
  user_pseudo_id,
  event_name,
  event_date,
  event_timestamp
FROM events
ORDER BY journey_key, event_timestamp;
