# PlayersB Analytics Contract (Phase 2.3+)

## Event taxonomy

| Event | Trigger | Required params | Notes |
|---|---|---|---|
| `nav_click` | Primary nav links | `destination`, `link_text`, `page_path`, `page_title` | Global template hook |
| `cta_click` | CTA buttons | `destination`, `link_text`, `page_path`, `page_title` | Global template hook |
| `outbound_click` | External links | `destination`, `link_text`, `page_path`, `page_title` | Global template hook |
| `theme_toggle` | Theme toggle click | `theme`, `page_path`, `page_title` | Global template hook |
| `engaged_read` | 30s dwell timer | `engaged_seconds`, `page_path`, `page_title` | Global template hook |
| `matches_filter` | Matchboard filter buttons | `filter`, `page_path`, `page_title` | Matches page only |
| `matches_data_refresh` | Manual/auto feed checks | `source`, `has_update`, `patch_mode`, `page_path`, `page_title` | Matches page only |
| `matches_follow_team_toggle` | Team follow toggle | `value`, `following`, `page_path`, `page_title` | Matches page only |
| `matches_follow_player_toggle` | Player follow toggle | `value`, `following`, `page_path`, `page_title` | Matches page only |
| `matches_follow_competition_toggle` | Competition follow toggle | `value`, `following`, `page_path`, `page_title` | Matches page only |

## Suggested GA4 dashboard

### Core engagement
- Active users
- Views by top landing pages
- `engaged_read` count / rate

### Matches funnel
1. `matches_filter`
2. `matches_follow_team_toggle` OR `matches_follow_player_toggle` OR `matches_follow_competition_toggle`
3. `matches_data_refresh`

### Freshness interaction
- `matches_data_refresh` split by `source` (`manual` / `auto`)
- `matches_data_refresh` split by `has_update`

## Suggested alerts

1. **Event drop alert**
   - Condition: any key event drops >60% day-over-day (`matches_filter`, `matches_data_refresh`, `cta_click`)
2. **Refresh failure signal**
   - Condition: `matches_data_refresh` where `has_update=false` is >95% for 24h while fixtures source status is healthy
3. **Follow adoption alert**
   - Condition: follow-toggle events drop >50% week-over-week

## Implementation notes
- This contract assumes `window.playersbTrack` appends `page_path` and `page_title` by default.
- Event names are intentionally stable and should be treated as API-like contracts.
