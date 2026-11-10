# BigQuery analytics views

Hand-written views over the GA4 daily export (`clanker-prod.analytics_544289823`),
kept in a separate dataset (`clanker_analytics`) so they are never clobbered by the
auto-managed GA4 export.

## One-time dataset creation

    bq --project_id=clanker-prod mk --dataset --location=US clanker_analytics

## Apply / update the views

    bq --project_id=clanker-prod query --use_legacy_sql=false < analytics/bq/v_purchases.sql
    bq --project_id=clanker-prod query --use_legacy_sql=false < analytics/bq/v_user_journey.sql

## Notes

- **Daily export only.** Tables land ~24h behind; there is no `events_intraday_*`.
  A "today" query returns nothing by design (owner decision 2026-07-24: no streaming export).
- `v_purchases` counts each transaction exactly once from the server-sent `purchase`
  events. See the B2 double-count check below before trusting native totals.
- `subscribe_flow_started` in `v_user_journey` is a client funnel event; if not emitted,
  those rows are simply absent.

## B2 double-count check (run after the first native purchase)

The Firebase native SDK can auto-log `in_app_purchase`. If it lands alongside the
server-sent `purchase`, native revenue double-counts. After the first native test purchase:

    bq --project_id=clanker-prod query --use_legacy_sql=false \
      'SELECT event_name, COUNT(*) FROM `clanker-prod.analytics_544289823.events_*`
       WHERE event_name IN ("purchase","in_app_purchase") GROUP BY event_name'

If `in_app_purchase` is present: prefer disabling the platform IAP auto-collection flag;
failing that, exclude `in_app_purchase` from these views and document why here.

## Coverage caveats (read before trusting user counts)

- **Native is opt-in.** `analytics_auto_collection_enabled` is `false` and collection follows
  `setting:analytics`. Until Nov 2026 the only switch lived in Settings (default off), so
  almost no native installs reported; GA4 users were ~97% web. Since then
  `AnalyticsConsentPrompt` asks once after Terms, so native coverage = opt-in rate.
- **Web is consent-gated** by the cookie banner, and the static landing page at `/` carries
  no tag at all. Landing-page traffic and store-button clicks are not in GA4.
- **Installs come from the stores.** Use App Store Connect and Play Console for installs.
  Landing-page store links carry a Play `referrer` (`utm_medium=landing`,
  `utm_campaign=landing_hero|landing_bottom`) that shows in Play Console acquisition reports.
  App Store campaign links need the provider token: set `IOS_PROVIDER_TOKEN` in
  `src/config/siteConfig.js`.
