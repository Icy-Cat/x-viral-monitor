# feature/list-member-filter

This branch preserves the full X List member filtering implementation that was removed from `main` before the next public release.

## What remains here
- Popup List member filter settings and list fetch UI.
- X GraphQL `ListMembers` and `ListByRestId` member source.
- In-page floating leaderboard `仅看 List 成员` toggle.
- `data-xvm-list-member-hidden` filtering and recovery guards.
- Tests and release/store copy covering the feature.

## Restore path
When the feature is ready to ship again, merge this branch back into `main` or cherry-pick the List member modules/UI/test changes from this branch, then run the full test suite and browser smoke tests.
