# Patch Notes / Future Flow

## Subscription Flow (business rule to keep)

- User can use trial (free) plan with renewals.
- User can switch from trial to paid at any time.
- User cannot switch from paid back to trial while paid subscription is active.
- After paid subscription expires, user should be able to return to trial according to product policy.

## Current implementation note

- Current logic is stricter: if trial existed before, trial activation is blocked to avoid duplicate trial subscriptions.
- If product decision remains "allow return to trial after paid expires", this part should be adjusted in trial activation/renew flow without creating duplicate subscriptions.

## Suggested future task

- Rework trial re-entry flow after paid expiry:
  - keep `1 subscription = 1 Remnawave user`;
  - avoid duplicate trial records;
  - allow controlled fallback to trial after paid end date.
