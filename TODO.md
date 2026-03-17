# TODO - Fix race condition `spot_not_booked` on nav start

- [x] Review current `handleSelectionStep` flow in `src/App.jsx`
- [x] Add retry logic for `nav_started` when error code is `spot_not_booked`
- [x] Keep existing safeguards (`not_booker`, `session_mismatch`, etc.) unchanged
- [x] Verify selection persistence still uses resolved `bookingSessionId`
- [ ] Run a quick validation command (`npm run build` or `npm run lint`)
- [ ] Mark tasks as done
