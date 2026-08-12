# Promo Codes & Loyalty Program — Design Plan

Status: **all open questions resolved 2026-08-10 — ready to implement.** Written 2026-08-10, grounded in the actual codebase (entities, use cases, admin panel) and directly reusing the architectural pattern already proven by the referral program (`docs/referral-program-plan.md`): a tunable `*Settings` singleton + an auditable, idempotent `*Reward`/`*Redemption` ledger + best-effort hooks in `PurchasePlanUseCase`/`ActivateTrialUseCase` + a matching admin panel page. This doc covers two related but independently shippable systems:

- **§A — Promo Codes**: one mechanic that covers both gift subscriptions and discount codes, since structurally they're the same thing (a code that produces an effect on redemption), just with a different effect.
- **§B — Loyalty Program**: automatic bonus for paying subscribers who renew on time, N cycles in a row.

Numbers below (discount %, gift durations, milestone thresholds, grace windows) are proposals for a first pass, not confirmed — same status as the referral plan's first draft before the round-1/2/3 revisions. Flag anything that looks off before implementation starts.

---

## 1. Goals

1. **Second acquisition channel, independent of the referral link.** Referrals require the inviter to already be a user who bothers to share a link. A gift subscription is purchasable and shareable by anyone, including non-users gifting to a friend, and works well around holidays/occasions where "here's a link, sign up" is a weaker pitch than "I bought you 3 months of VPN."
2. **Open a door for external marketing** (bloggers, partner channels, one-off campaigns) that the referral program structurally can't reach — a shareable discount code works outside Telegram, doesn't require the recipient to know a specific person.
3. **Attack the actual cause of most subscription churn**: people don't cancel, they just forget to renew. Loyalty rewards make staying subscribed *visibly* pay off, which is a cheaper lever than the deeper fix (recurring auto-charge via saved YooKassa payment method) while still meaningfully reducing "silent" churn.
4. **Reuse, don't reinvent.** Same Settings-singleton + ledger + idempotent-insert-before-mutate + admin page shape as the referral program, so this is cheap to build and cheap for future-you to understand (same mental model across every growth/retention feature in the codebase).

---

## 2. §A — Promo Codes (gift + discount, one mechanic)

### 2.1 Why gift and discount are one entity, not two

A gift code and a discount code are both "a code that does something when redeemed" — they differ only in *what*:

- `gift` — redeeming it **grants a subscription** (N days of a specific plan) to whoever redeems it.
- `percent_discount` / `fixed_discount` — redeeming it **reduces the price** of a purchase the redeemer is about to make.

One `PromoCode` entity, one admin page to create/manage codes, one redemption ledger for audit + idempotency. Not two parallel systems that happen to look similar.

### 2.2 Where the money comes from

- **User-purchased gift codes**: a real user pays for a plan through the bot exactly like a normal purchase (same Stars/YooKassa `Payment` row, same `PurchasePlanUseCase` payment machinery — `provider` stays `'stars' | 'yookassa'`, unrelated to the code mechanic). The only difference from a normal purchase: on success, instead of upgrading/extending the **buyer's own** Remnawave account, a `PromoCode` (`type: 'gift'`) is minted, linked to the funding `Payment.id`. `Payment.provider` is a strict Postgres enum (`'stars' | 'yookassa' | 'crypto'`, see `Payment.ts`) — deliberately **not** adding a `'gift'` provider value there; the payment rail and the "who does this fulfill" question are orthogonal, so `PurchasePlanUseCase` gets a `giftMode` flag rather than a new provider.
- **Admin-issued codes** (marketing/blogger/one-off discount campaigns): created directly in the admin panel, no `Payment` behind them, `createdByUserId: null`, `maxRedemptions` can be > 1 (a single code shared publicly), optional `expiresAt`.

### 2.3 Database schema

```ts
export type PromoCodeType = 'gift' | 'percent_discount' | 'fixed_discount';

@Entity('promo_codes')
export class PromoCode {
  @PrimaryColumn('uuid') id: string = generateId();

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 }) code: string; // human-typeable: GIFT-8F3K2X1Q (auto) or SUMMER2026 (admin-chosen)

  @Column({ type: 'varchar', length: 20 }) type: PromoCodeType;

  // gift only
  @Column({ type: 'uuid', nullable: true }) giftPlanId: string | null = null;
  @Column({ type: 'uuid', nullable: true }) fundingPaymentId: string | null = null; // null for admin-issued

  // percent_discount / fixed_discount only
  @Column({ type: 'integer', nullable: true }) discountPercent: number | null = null;
  @Column({ type: 'integer', nullable: true }) discountFixedRub: number | null = null; // RUB only (decision, §2.7.1) — Stars purchases only ever get percent_discount, never a fixed one

  @Column({ type: 'uuid', nullable: true }) createdByUserId: string | null = null; // null = admin-issued
  @Column({ type: 'integer', default: 1 }) maxRedemptions: number;
  @Column({ type: 'timestamp', nullable: true }) expiresAt: Date | null = null;
  // Per-code kill switch (e.g. a leaked/abused code) — separate from the global enabled flags in
  // PromoCodeSettings, same relationship as ReferralSettings.enabled vs the per-tier toggles.
  @Column({ type: 'boolean', default: true }) active: boolean;

  @CreateDateColumn({ type: 'timestamp' }) createdAt: Date;
}
```

```ts
/**
 * Redemption ledger — mirrors ReferralReward: the INSERT itself is the idempotency boundary
 * (unique constraint reserves the slot before any mutation happens), not a check-then-act.
 */
@Entity('promo_code_redemptions')
@Unique(['promoCodeId', 'redeemedByUserId']) // one user, one redemption per code, ever
export class PromoCodeRedemption {
  @PrimaryColumn('uuid') id: string = generateId();

  @Index() @Column('uuid') promoCodeId: string;
  @Index() @Column('uuid') redeemedByUserId: string;
  @Column({ type: 'varchar', length: 20 }) type: PromoCodeType; // snapshot at redemption time

  // gift
  @Column({ type: 'integer', default: 0 }) daysGranted: number;
  @Column({ type: 'uuid', nullable: true }) creditedSubscriptionId: string | null = null;

  // discount — filled in once the discounted purchase actually completes, not at "entry" time
  @Column({ type: 'integer', nullable: true }) discountAppliedRub: number | null = null;
  @Column({ type: 'uuid', nullable: true }) appliedToPaymentId: string | null = null;

  @CreateDateColumn({ type: 'timestamp' }) createdAt: Date;
}
```

No denormalized `redeemedCount` on `PromoCode` — same choice as the referral system's stats (`countConvertedReferrals` etc. are always live-counted from the ledger, never cached on the parent row): checking `maxRedemptions` means `COUNT(*) FROM promo_code_redemptions WHERE promoCodeId = ...`, avoids any drift between a counter and the ledger it's supposedly summarizing.

`PromoCodeSettings` — deliberately small, since most configuration here is per-code rather than global:

```ts
@Entity('promo_code_settings')
export class PromoCodeSettings {
  @PrimaryColumn('uuid') id: string = generateId();
  @Column({ type: 'boolean', default: true }) giftCodesEnabled: boolean;
  @Column({ type: 'boolean', default: true }) discountCodesEnabled: boolean;
  // Safety rail against a fat-fingered "500" in the admin create-code form, not a real business rule.
  @Column({ type: 'integer', default: 50 }) maxDiscountPercent: number;
  @UpdateDateColumn({ type: 'timestamp' }) updatedAt: Date;
}
```

### 2.4 Backend flow

**Buying a gift** — `PurchasePlanUseCase` extended with a `giftMode: true` param (**decision, §2.7.2**: parameterize the existing use case rather than a parallel one — see the guardrail note there on not breaking the normal purchase path). Same plan-picker → same Stars/YooKassa invoice → on `successful_payment`/webhook/polling fulfillment, instead of `remnawaveService.upgradeUser`/`createUser` against the buyer's own account, mint a `PromoCode` row (`type: 'gift'`, `giftPlanId`, `fundingPaymentId`) and hand the buyer the code + a shareable deep link.

**Redeeming — two different UX paths depending on type, this matters:**

- **Gift — instant, standalone.** Deep link `t.me/<bot>?start=promo_<code>` (parsed the same way `r_<code>` already is in `handleStart`/`RegisterUserUseCase` — just a second recognized prefix) or a "🎫 У меня есть промокод" button/command with manual entry. `RedeemGiftCodeUseCase.execute(code, userId)`:
  1. Look up `PromoCode` by code; reject if inactive, expired, or `redemptions >= maxRedemptions`.
  2. Insert the `PromoCodeRedemption` row *first* (idempotency boundary, same ordering fix we applied to `ReferralRewardService` this session — reserve the slot before mutating anything).
  3. Apply `giftPlanId`'s `durationDays` to the redeemer's subscription, reusing `PurchasePlanUseCase`'s existing upgrade/renew/create branching (trial→paid upgrade, existing-paid renewal, or fresh create) rather than re-deriving that logic a third time.
- **Discount — validated at checkout, not standalone.** Entering a discount code doesn't redeem anything by itself; it's attached to the *next* purchase attempt. `PurchasePlanUseCase.execute()` takes an optional `promoCode` param: validates it (same active/expiry/maxRedemptions checks), computes the discounted `amount` before the invoice is created, and — **only once that specific payment actually completes** — inserts the `PromoCodeRedemption` row with `appliedToPaymentId`. A code entered but never paid never produces a redemption row.

**Mutually exclusive with the referral conversion reward on the same payment (decision, §2.7.3):** if a `promoCode` of type `percent_discount`/`fixed_discount` was applied to a payment, `PurchasePlanUseCase` must **skip** the `referralRewardService.processConversionRewards(...)` call for that payment entirely — no referrer bonus, no milestone/pyramid knock-on effects either, as if that buyer's first payment never happened from the referral system's point of view. A gift-funding payment (`giftMode: true`) is unaffected by this — it's a normal purchase for referral-attribution purposes, the exclusion is specifically about *discount codes*, not the gift mechanic.

Worth being explicit about the consequence: `processConversionRewards` only ever fires on a buyer's genuinely-first completed payment (`paymentRepo.countCompletedByUserId(userId) === 1`). If that specific first payment used a discount code and gets skipped per the rule above, **the referrer permanently loses that conversion reward** — the buyer's second payment is no longer "the first" and the hook never fires retroactively. That's the real-world shape of "разделил, пусть будет порядок": a referred user who redeems a discount code on their first purchase costs their referrer the conversion bonus for that relationship, full stop, not just a one-time skip. Flag this in the admin-facing settings description too (per decision §2.7.4) so it isn't a support-ticket surprise later.

### 2.5 Telegram bot UX

- New "🎁 Подарить VPN" entry (main menu, near "💎 Тарифы") → plan picker → payment → success screen shows the code + a share-sheet button, same `t.me/share/url` pattern already used for the referral link.
- New "🎫 Промокод" entry/command → text input → immediate feedback (gift: "🎉 Активировано! +N дней" / discount: "✅ Скидка N% применится к следующей оплате").
- Plan-selection screen shows the discounted price alongside the normal one once a valid discount code is "pending" for that user.

### 2.6 Admin panel

New "🎁 Промокоды" nav entry (own page, not nested under Рефералы — different feature, different audience of one, don't force a shared mental model that isn't there): code list (code, type, redemptions X/Y, expiry, active toggle), a create-code form (mirrors the referral settings form's grouped-fieldset style), and a redemption feed. Same `parsePagination`/`{items, total, page, pageSize}` convention as every other admin list.

### 2.7 Decisions — resolved 2026-08-10

1. **Fixed-amount discounts and currency: RUB only, confirmed.** `discountFixedRub` applies to YooKassa purchases only; Stars purchases can only ever use `percent_discount`. No Stars-denominated fixed-discount field — don't add one later without re-opening this decision.
2. **Gift purchase implementation shape: parameterize the existing `PurchasePlanUseCase`** with a `giftMode` flag rather than a parallel use case — user's call was "if it's worth it via a flag, do it via a flag, main thing is don't break it" («если выгодно через флаг, то можешь через флаг. Главное не сломать»). Read as explicit permission for the reuse *and* an explicit requirement: the existing non-gift purchase path (Stars/YooKassa/webhook/polling, all three fulfillment call sites) must come out of this change with **zero behavior change** when `giftMode` is absent/false. Needs real test coverage on the non-gift path before/after, not just the new gift branch — the existing `tests/usecases/PurchasePlanUseCase.test.ts` suite is the regression net to lean on.
3. **Stacking with the referral program: kept mutually exclusive, not independent.** User's call: «Я бы разделил. Пусть будет порядок» (keep them separate, for the sake of order) — a discount code applied to a payment blocks the referral conversion reward for that same payment entirely (see the consequence note in §2.4 — this is a *permanent* loss of that referral relationship's conversion bonus, not just a one-time skip, since the hook only ever fires on the buyer's actual first payment).
4. **Numbers stay as placeholders — but every admin-editable field needs a description, not just a bare input.** User's call: «Да, заглушки с описанием. Чтобы я когда в админке правил, понимал что за что отвечает» (placeholders are fine, but with descriptions, so I understand what governs what when I'm editing in the admin panel). This is a hard requirement for the admin panel work in §2.6/§3.6, not a nice-to-have: reuse the exact accordion-with-description pattern already built for `ReferralsPage.tsx` (`SettingsSection` component — title + plain-language description always visible, fields collapsed by default) for every settings group here too, including the mutual-exclusivity behavior from decision §2.7.3 and the "this permanently costs the referrer their bonus" consequence being spelled out in-panel, not just in this doc.

---

## 3. §B — Loyalty Program (consecutive on-time renewals)

### 3.1 Trigger definition

Reward a user for renewing their **paid** subscription N times in a row *without letting it lapse for long*. "Consecutive" needs a precise definition or the streak logic is unfalsifiable:

- A payment extends the streak if it lands before the previous paid period's `endDate`, or within a small grace window after it (`graceDays`, proposed default **3** — forgiving of "paid a day late," not of "came back after two months").
- A payment after a longer gap **resets** the streak to 1, it does not break the user out of the loyalty program entirely — they start earning toward the first milestone again.
- Trial renewals don't count — this is specifically a reward for *paying* customers, matching goal §1.3 (attacking forgotten-renewal churn on paid subs, not trial engagement, which the existing trial-expiring reminders already cover).

### 3.2 Database schema

```ts
@Entity('loyalty_settings')
export class LoyaltySettings {
  @PrimaryColumn('uuid') id: string = generateId();
  @Column({ type: 'boolean', default: true }) enabled: boolean;
  @Column({ type: 'integer', default: 3 }) graceDays: number;
  @Column({
    type: 'jsonb',
    default: () => `'[{"streak":3,"bonusDays":7},{"streak":6,"bonusDays":20},{"streak":12,"bonusDays":60}]'`,
  })
  milestones: Array<{ streak: number; bonusDays: number }>;
  @UpdateDateColumn({ type: 'timestamp' }) updatedAt: Date;
}
```

```ts
@Entity('loyalty_rewards')
@Unique(['userId', 'streakThreshold']) // one payout per threshold per user, ever
export class LoyaltyReward {
  @PrimaryColumn('uuid') id: string = generateId();
  @Index() @Column('uuid') userId: string;
  @Column({ type: 'integer' }) streakThreshold: number;
  @Column({ type: 'integer' }) daysGranted: number;
  @Column({ type: 'uuid', nullable: true }) triggerPaymentId: string | null = null;
  // No 'pending_claim' here, unlike ReferralReward — this only ever fires right after a payment
  // that just succeeded, so there is always an active subscription to extend. Banking doesn't apply.
  @Column({ type: 'varchar', length: 20 }) status: 'granted' | 'failed';
  @Column({ type: 'varchar', length: 500, nullable: true }) errorMessage: string | null = null;
  @CreateDateColumn({ type: 'timestamp' }) createdAt: Date;
}
```

### 3.3 The genuinely tricky part: computing the streak

Subscriptions are renewed **in place** (`PurchasePlanUseCase`'s renewal branch does `subscriptionRepo.update`, not `create` — one row per subscription lineage, not one row per billing period), so there's no ready-made per-period history to walk on the `Subscription` table. The `Payment` table *does* have one row per completed purchase, though, so the streak has to be reconstructed from `paymentRepo.findByUserId()` (already exists), ordered by `completedAt`, walking consecutive payments and checking each one landed within `previous coverage end + graceDays` of the next — where "coverage end" comes from that payment's `plan.durationDays` added to when its coverage started. This needs a small dedicated helper (`computePaymentStreak(payments, plans, graceDays): number`) rather than inlining the walk into the use case — it's the one piece of this doc that isn't a straight copy of the referral pattern and deserves its own unit tests before it's trusted.

### 3.4 Backend flow

`LoyaltyRewardService.processPaymentStreak(user, paymentId)`, hooked into the very end of `PurchasePlanUseCase.execute()` right alongside the existing `referralRewardService.processConversionRewards(...)` call — same best-effort try/catch, same "never allowed to fail the purchase" principle already established there. Computes the streak, checks it against `settings.milestones`, and — since (per §3.1) there's always an active subscription at this point — applies `bonusDays` via `RenewSubscriptionUseCase` directly, no banking/claim step needed.

### 3.5 Telegram bot UX

- Milestone notification: *"🔥 Вы платите с нами N циклов подряд! Бонус: +X дней."*
- Small streak indicator on the profile screen (*"🔥 Серия оплат: 4"*), and optionally a badge at the top tier (*"👑 VIP"*) — cheap, since the profile screen already renders a stats block.

### 3.6 Admin panel

Lighter than referrals or promo codes — this doesn't need its own nav entry necessarily. A settings section (same grouped-fieldset accordion style as `ReferralsPage`) plus a simple stats/feed table would cover it; could live as a second tab on an existing page or its own thin page, whichever reads better once §A's promo-codes page exists as a sibling to compare against.

---

## 4. Rollout

Same shape as the referral program: new entities → `npm run migrate:safe` (non-destructive `synchronize()`, no hand-written SQL expected) → hooks wired into `PurchasePlanUseCase`/`ActivateTrialUseCase` → admin panel pages → `tests/usecases/` coverage per this repo's hand-written-mock convention (see any file under `tests/usecases/referral/` equivalent, or `ReferralRewardService.test.ts` for the shape of idempotency/cap/notification tests worth mirroring here).

Suggested build order, if both land in the same effort: **§A gift codes first** (new acquisition channel, no dependency on payment history existing) → **§A discount codes** (shares the `PromoCode` entity, small incremental addition) → **§B loyalty** (needs real payment history to be meaningful, and the streak-computation helper is the one piece worth extra care/tests before trusting it).
