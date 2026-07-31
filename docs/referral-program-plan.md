# Referral Program — Design Plan

Status: **design only, not yet implemented**. Written 2026-07-30 for a build session planned for the next day. Grounded in the actual codebase (entities, use cases, admin panel) as of this commit, not a generic referral-system template.

This doc is intentionally in English so it's precise for implementation; the accompanying chat message summarizes it in Russian for the user.

---

## 1. Goals

1. Make existing users actively want to invite friends — the reward has to be *worth talking about*, not a token gesture.
2. Make the invited friend also get something, day one — a program that only pays the inviter is a much weaker pitch to send ("why would I forward this?") than one where the recipient benefits too.
3. Tie the expensive reward tier to money actually coming in (paid conversion), so growth in referral payouts is self-funding rather than a farmable cost center.
4. Ship an MVP that reuses existing, already-battle-tested subscription-extension code (`RenewSubscriptionUseCase`, `RemnawaveClient`) instead of inventing a parallel crediting mechanism.

## 2. Reward mechanics

**Status: numbers below reflect the user's 2026-07-31 decisions (see §9 for the resolved questions).** All amounts are still **defaults stored in `ReferralSettings`** (§7.4), tunable from the admin panel without a redeploy — the point of storing them in DB is exactly so these can move without touching code.

### 2.1 Referred-user signup perk ("get" side) — always on, **defaults to traffic, not days**
When someone opens the bot via a referral link and activates the **trial**, they get a boost on top of the normal trial, applied once inside `ActivateTrialUseCase`.

**Revised 2026-07-31, after looking at what a competitor bot does** (flat +14 days per invite, no payment required). Copying that number directly doesn't fit this bot's structure: unlike a typical one-shot trial, **this bot's trial already renews indefinitely every 2 weeks** (`Texts.ERROR_TRIAL_EXISTS` — "нажмите «Продлить», и тариф снова станет активным"), so *duration* is not actually the scarce resource for a free user here. What's scarce is the **2 GB/day traffic cap** and the **2-device limit**. Giving a free user more days on top of an already-renewable trial is a weak reward; giving them more daily traffic is a reward they'll actually feel. Days-per-invite rewards stay meaningful once someone is paying (§2.3), where there's no free renewal to fall back on — that's the split the doc now uses throughout Phase-2.1/2.2.

`ReferralSettings.referredSignupBonusType: 'days' | 'traffic_gb'` — admin still picks one mode (keeps the marketing copy in §6.2 a single unambiguous sentence), but the **default flips to `traffic_gb`**:
- `traffic_gb` mode (**new default**): **+3 GB/day** (2 → 5 GB/day), via the already-existing `RemnawaveClient.updateTrafficLimit`.
- `days` mode (still available, no longer the default): +5 trial days (14 → 19).

This costs nothing extra in infra risk (self-funded by the referrer's own excitement to share) and is what actually makes a friend *use* the link instead of just downloading the app directly.

### 2.2 Referrer signup reward ("give" side, direct) — **enabled**, **defaults to traffic, not days**
Reward to the referrer the moment their invitee activates a trial (registration alone doesn't pay — has to be an actual trial activation, so there's at least a real Remnawave account created, not a bare `/start`).

Same reasoning as §2.1 applies here, doubly so: this reward triggers on the cheapest-to-fake action (a trial signup) *and* was already flagged as the shakiest part of the fraud model even before this revision. Paying it in days — a currency that's nearly worthless for free users given the renewable trial, but genuinely fungible-feeling — was giving away the wrong thing for a fraud-sensitive tier. Switching the default to traffic keeps the reward *meaningful to a legitimate inviter* while being *less attractive to farm*, since a stack of extra GB/day on trial accounts isn't worth much to resell or hoard the way subscription days would be.

`ReferralSettings.referrerSignupRewardType: 'days' | 'traffic_gb'`:
- `traffic_gb` mode (**new default**): **+2 GB/day**, **stacking per rewarded signup** (same stacking mechanic as the conversion-tier bonus, §2.3.2), capped by a new `referrerSignupTrafficMaxStackedGb` ceiling (default **8 GB/day**).
- `days` mode (still available): +2 days, unchanged from the earlier draft.
- Rate cap unchanged either way: **5 rewarded signups per referrer per rolling 7 days** (`referrerSignupRewardMaxPer7d`) — this was shipped **disabled-by-default** in the original draft specifically because trial signups are the cheapest thing to fake on Telegram; the user decided to enable it from day one, and the rate cap plus the traffic-not-days currency switch are now the two guardrails carrying that decision. If abuse shows up in the admin `referral_rewards` feed (§7.2) after launch, tighten the cap first, before disabling the feature outright.
- **Revised 2026-07-31 (round 3), fixing a real gap the user caught:** if the referrer is already on an unlimited paid plan when this fires, granting GB is pointless — a paid plan has no daily cap for it to raise. Rather than let the reward silently do nothing, it **auto-converts to a days-equivalent**: `ReferralSettings.referrerSignupRewardTrafficFallbackDays` (default **1 day**). The reward always resolves to *whatever currency is actually useful for the referrer's current plan* — GB while they're capped, days once they're not — instead of ever being a wasted grant. See §2.3.2 for the identical mechanism on the bigger conversion-tier bonus, and §4.2 for how this shows up in the `ReferralReward` row.

### 2.3 Referrer conversion reward (direct / "level 1") — the real driver, two components
Triggered the moment the referred user's **first-ever completed payment** (Stars or YooKassa, any plan) is fulfilled. Per the user's decision, this now has **two independent components**, both fire on the same event:

1. **Days** — flat **+10 days** (bumped from the earlier +7 draft) added to the referrer's own active subscription. Flat stays easier to put in a marketing sentence than a percentage; `ReferralSettings.conversionRewardMode` (`flat_days` default / `percent_of_purchase` alternative) is unchanged from the original design, just the flat default moved 7→10.
2. **Traffic** — **+1 GB/day**, permanent, **stacking per converted referral** (invite 3 friends who all pay → +3 GB/day, indefinitely). Applied via `RemnawaveClient.updateTrafficLimit`.
   - **Constraint, now resolved (round 3):** paid plans in this bot already have *unlimited* traffic (`Texts.CHOOSE_PLAN`: "Безлимитный трафик"), so a GB/day bump is only ever meaningful while the referrer is on the trial plan. Per the same fix as §2.2: if the referrer is already on a paid plan when this fires, the GB grant **auto-converts to a days-equivalent** instead of doing nothing — `ReferralSettings.conversionTrafficBonusFallbackDays` (default **2 days**, added on top of the +10 from component 1, so a paid referrer effectively gets +12 days instead of +10 days and an invisible GB bump). The `ReferralReward` row records which currency was actually granted (`metadata: { trafficConvertedToFallbackDays: 2 }`) rather than silently no-op'ing — auditable in the admin panel either way.
   - Soft ceiling on the stacked GB total: **+10 GB/day max** from referral stacking (`conversionTrafficBonusMaxStackedGb`), so it can't compound into something operationally weird at scale for a referrer who stays on trial indefinitely.

### 2.4 "Pyramid" — level 2 (indirect) reward
When a referred user converts (§2.3 fires), also look at **the referrer's own referrer** (one hop up, "grandparent") and give them a smaller reward too. Depth capped at **2 levels** — no deeper walk.
- Default: **30% of the level-1 *days* component, rounded down, minimum 1 day** → with the new 10-day level-1 default, level 2 = **3 days**.
- The GB component (§2.3.2) is **not** carried to level 2 — keeps the pyramid math to one currency (days) instead of compounding two reward types across two levels, which would get hard to explain in the UI copy.
- This is what makes a user want to help *their* referrals invite people too, not just invite people themselves — genuine second-order growth loop. No level 3+.

### 2.5 Milestone bonuses — **in scope for V1**, not Phase 2 anymore
User specifically wants this in the first build, with a concrete example already given: **5 converted (paid) referrals → +15 days**. Deliberately keyed off *converted* count, not raw invite count, to stay consistent with "the expensive rewards are tied to real revenue" (§1 goal 3) — a milestone big enough to be exciting (+15 days) needs the same anti-farming logic as the conversion reward itself.

Needs a small `referral_milestones` concept — simplest shape that stays admin-editable without a schema change per new tier: a `jsonb` column on `ReferralSettings` rather than a separate table, since milestones are a short, rarely-changing list:
```ts
@Column({ type: 'jsonb', default: () => `'[{"convertedCount":5,"bonusDays":15}]'` })
milestones: Array<{ convertedCount: number; bonusDays: number }>;
```
Suggested extrapolated ladder for tomorrow's discussion (only the 5→15 point is confirmed, the rest are a proposed shape, not a decision):
- 5 converted → +15 days *(confirmed)*
- 10 converted → +40 days *(suggested)*
- 25 converted → +120 days *(suggested — roughly a free 4-month plan, meaningful enough to be a real "power user" goal)*

Progress copy in the referral screen (§6.2) should show distance to the next milestone ("Пригласите ещё 2 друзей и получите +15 дней") — small addition to the stats block, not a new screen.
Milestone rewards are **one-time per threshold per user** — needs its own idempotency key (`ReferralReward.rewardType = 'milestone'` + a unique constraint on `(referrerUserId, convertedCountThreshold)`), same pattern as everything else in §4.2.

### 2.6 Guardrails (apply to all reward types)
- Self-referral blocked: `referrerUserId !== referredUserId`, enforced at attribution time, not just at reward time.
- Attribution is **one-shot and immutable**: `User.referredByUserId` can only be set once, only for a user who is brand new (first-ever `/start`), never backfilled onto existing users.
- Every reward event is idempotent via a DB unique constraint (see §4.2) — a retried webhook, a duplicated polling tick, or a double-click can never grant the same reward twice.
- Rolling caps: max **20 rewarded conversions per referrer per 30 days** (bounds payout exposure from one compromised/abusive account); max **60 "banked" unclaimed days per referrer** (see §2.7) so pending rewards can't be gamed into unlimited future free service.
- If a referrer's payout would push the cap, the reward record is still created for audit purposes but marked `status: 'capped'` (not silently dropped) — visible in the admin panel so a human can review and manually override if it's a false positive.

### 2.7 What if the referrer has no active subscription to extend?
`RenewSubscriptionUseCase.execute(subscriptionId, days)` needs a subscription to extend. If the referrer currently has none (expired trial, never activated anything, etc.), don't just drop the reward — **bank it**:
- The `ReferralReward` row is created with `status: 'pending_claim'` and `daysGranted` set, but not yet applied to anything.
- The moment that referrer activates *any* subscription (trial or paid) — the existing `ActivateTrialUseCase` / `PurchasePlanUseCase` success paths — a small `ClaimPendingReferralRewardsUseCase` step sums their pending rewards and applies the days to the just-created subscription, marking those rows `status: 'granted'`.
- This turns "your invite paid off" into a genuine comeback hook: send a proactive notification when a reward is banked ("🎉 Друг оплатил подписку — вам начислено 10 дней! Активируйте VPN, чтобы забрать бонус") even if they're currently inactive. That's a free re-engagement push most referral programs don't bother building, and it fits naturally on top of the existing reminder infrastructure (`NotificationService.send()`).

---

## 3. Anti-abuse summary

| Vector | Mitigation |
|---|---|
| Attacker creates N fake Telegram accounts, all "referred" by themselves, to farm the signup reward | As of the 2026-07-31 revision, this reward pays in **traffic (GB/day), not days, by default** (§2.1, §2.2) — a currency that's much less attractive to hoard/resell than subscription days, precisely because it doesn't buy the farmer anything beyond a trial account's existing (already-free) lifespan. Backed up by two hard limits regardless: the rate cap (5 signups/week per referrer, `referrerSignupRewardMaxPer7d`) and the stacking ceiling (`referrerSignupTrafficMaxStackedGb`, default 8 GB/day). Worth watching the `referral_rewards` admin feed (§7.2) closely after launch specifically for this reward type — it's the one tier the user chose to enable despite the fraud-surface tradeoff, and the **global kill switch** (§7.4) exists specifically as the "shut this off and go fix it" escape hatch if it turns out to be exploited anyway |
| Attacker pays real money through fake accounts to farm level-1/level-2 conversion rewards | Reward is smaller than the money spent to trigger it (10 days + limited traffic bump ≈ a fraction of a paid plan's price) — self-limiting by construction. The `conversionTrafficBonusMaxStackedGb` ceiling (§2.3.2, §7.4) additionally bounds the *permanent* component so it can't compound past a fixed cap even across many fake conversions |
| Same payment retried (webhook + polling race, already a known race in this codebase per `PurchasePlanUseCase`'s existing lock) grants reward twice | Unique DB constraint on `ReferralReward.triggerPaymentId` — second insert fails/ignored, not a second grant |
| Existing user re-attributed to a referrer after the fact (to retroactively claim a "signup" they didn't actually originate from) | `referredByUserId` only settable at first-ever registration (`RegisterUserUseCase` already short-circuits for existing users — reuse that same early-return as the attribution boundary) |
| One compromised/abusive account racks up unbounded rewards | 30-day rolling cap per referrer + banked-days cap (§2.6) |
| Reward-granting bug/outage silently breaks payment fulfillment | All reward logic runs **best-effort, wrapped in try/catch, after** the core purchase/trial flow succeeds — mirrors the existing pattern in `yooKassaFulfillment.ts` where notification failures are logged and swallowed, never allowed to fail the payment itself |
| The whole feature turns out buggy or exploited after launch and needs to come down fast without a redeploy | Global `ReferralSettings.enabled` kill switch (§7.4) — flip one toggle in the admin panel, all attribution and reward-granting stops immediately, existing data is preserved untouched for investigation |

---

## 4. Database schema

Schema evolves the same way the rest of this project does: edit TypeORM entity classes, run `npm run migrate:safe` (non-destructive `synchronize()`, per `src/infrastructure/db/migrate-safe.ts`) — no hand-written SQL needed unless something synchronize can't express.

### 4.1 `User` entity changes (`src/domain/entities/User.ts`)
```ts
@Column({ type: 'varchar', length: 12, unique: true, nullable: true })
referralCode: string | null = null;   // short shareable code, backfilled lazily (see §8.2)

@Index()
@Column('uuid', { nullable: true })
referredByUserId: string | null = null;   // set once, at first registration, never changed after
```
No `@ManyToOne` self-relation needed in the entity — a plain nullable uuid column is enough; resolving it goes through `IUserRepository.findById` like everywhere else in this codebase (no new TypeORM relation-loading pattern to introduce).

### 4.2 New `ReferralReward` entity (`src/domain/entities/ReferralReward.ts`)
Mirrors the existing `NotificationLog` shape (ledger of events with a dedup key, `delivered`/`errorMessage`-style status) rather than inventing a new pattern:

```ts
export type ReferralRewardType =
  | 'referred_signup_perk'        // friend's own perk for using the link (§2.1, days OR traffic per admin setting)
  | 'referrer_signup'             // referrer's reward when friend activates trial (§2.2, days)
  | 'referrer_conversion_l1_days' // referrer's day reward when friend pays (§2.3.1)
  | 'referrer_conversion_l1_traffic' // referrer's permanent GB/day bump when friend pays (§2.3.2)
  | 'referrer_conversion_l2'      // grandparent pyramid reward (§2.4, days only)
  | 'milestone';                  // cumulative-converted-referrals bonus (§2.5)
export type ReferralRewardStatus = 'granted' | 'pending_claim' | 'capped' | 'failed';

@Entity('referral_rewards')
export class ReferralReward {
  @PrimaryColumn('uuid') id: string = generateId();

  @Index() @Column('uuid') referrerUserId: string;   // who benefits (for 'referred_signup_perk' this is the referred user themself)
  @Index() @Column('uuid') referredUserId: string;    // whose action triggered the reward

  @Column({ type: 'varchar', length: 40 }) rewardType: ReferralRewardType;
  @Column({ type: 'integer' }) level: number;          // 1 = direct, 2 = grandparent/pyramid

  // For conversion rewards: the Payment row that triggered it. Unique (with rewardType) → idempotency.
  @Column({ type: 'uuid', nullable: true }) triggerPaymentId: string | null = null;

  @Column({ type: 'integer', default: 0 }) daysGranted: number;
  @Column({ type: 'integer', default: 0 }) trafficGbGranted: number; // for *_traffic rows; 0 for day-only rows
  @Column({ type: 'uuid', nullable: true }) creditedSubscriptionId: string | null = null; // which subscription actually got extended
  @Column({ type: 'integer', nullable: true }) milestoneConvertedCountThreshold: number | null = null; // for 'milestone' rows

  @Column({ type: 'varchar', length: 20 }) status: ReferralRewardStatus;
  @Column({ type: 'varchar', length: 500, nullable: true }) errorMessage: string | null = null;
  // e.g. { trafficConvertedToFallbackDays: 2 } when a *_traffic reward auto-converts to its
  // days-equivalent because the referrer is already on an unlimited paid plan — see §2.2/§2.3.2.
  // Free-form, admin-panel-readable only.
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, unknown> | null = null;

  @CreateDateColumn({ type: 'timestamp' }) createdAt: Date;
  @Column({ type: 'timestamp', nullable: true }) claimedAt: Date | null = null;
}
```

Idempotency constraints:
- Composite unique on `(triggerPaymentId, rewardType)` — a given payment can only ever produce one row per reward type (`l1_days`, `l1_traffic`, `l2`), so the pair — not a bare unique on `triggerPaymentId` alone — is what actually prevents double-crediting while still allowing the day and traffic components of the same payment to coexist as two rows.
- One `referred_signup_perk` and one `referrer_signup` ever per `referredUserId` — composite unique on `(referredUserId, rewardType)`.
- One `milestone` row per `(referrerUserId, milestoneConvertedCountThreshold)` — a given threshold pays out once per referrer, ever.

### 4.3 Traffic-bonus mechanics (used by §2.1's `traffic_gb` mode and §2.3.2)
Not new infra work — `RemnawaveClient.updateTrafficLimit(remnawaveUserId, trafficLimitBytes)` already exists (`src/infrastructure/remnawave/RemnawaveClient.ts:255`) and already goes through the shared `patchUser` helper, so it already gets the mandatory Remnawave state-cache invalidation described in `CLAUDE.md`. Granting logic reads the subscription's current `trafficLimitBytes` off Remnawave, adds the granted GB, writes back — same idempotency guarantee as the days path (one `ReferralReward` row per trigger, never re-applied).

---

## 5. Backend flow (use cases & hook points)

### 5.1 Attribution — extend `RegisterUserUseCase`
`handleStart` in `src/transport/telegram/handlers.ts` already calls `bot.start(this.handleStart)`, and Telegraf already parses `/start <payload>` into `ctx.startPayload` — no new deep-link plumbing needed.

- New referral link format: `https://t.me/<bot_username>?start=r_<referralCode>` (payload `r_XXXXXXXX`, plain alphanumeric — Telegram start-payload only allows `[A-Za-z0-9_-]`).
- `handleStart` passes `ctx.startPayload` through to `RegisterUserUseCase.execute(telegramId, username, firstName, startPayload)`.
- Inside `RegisterUserUseCase`, **only on the new-user branch** (the existing early-return for already-registered users stays untouched — this is the immutability guarantee from §2.6):
  1. Parse `r_` prefix, resolve referrer via new `IUserRepository.findByReferralCode(code)`.
  2. Guard: referrer exists, `referrer.id !== newUser.id` (can't happen on a brand new user anyway, but codify it), referrer's own `referredByUserId` chain doesn't loop back to the new user (impossible at creation time, but assert instead of assuming).
  3. Set `referredByUserId` on the newly created user.
  4. Audit log entry `action: 'referral_attributed'`.

### 5.2 Referral code generation
Lazy, not a backfill migration: add `IUserRepository.getOrCreateReferralCode(userId): Promise<string>`, called the first time a user opens the new "Invite friends" screen (§6.2) or the referral admin page needs one. Generates e.g. 8 chars of base36 from a fresh random source, retries on unique-constraint collision (astronomically rare at this scale, but code should handle it rather than assume). Existing users get a code the first time they touch the feature — no big migration script needed.

### 5.3 Signup-side rewards — hook in `ActivateTrialUseCase`
At the end of `ActivateTrialUseCase.execute()`, after the trial subscription is created and synced:
1. If `user.referredByUserId` is set: apply the referred-user signup perk (§2.1 — days or traffic per `referredSignupBonusType`) directly to the trial being created right now (extra days/traffic applied before or right after the initial `subscriptionRepo.create()` call — cheapest point, no second Remnawave round-trip needed for the days case since the subscription doesn't exist yet; the traffic case needs the Remnawave user to exist first, so it's applied via `updateTrafficLimit` right after creation instead).
2. Call new `ClaimPendingReferralRewardsUseCase.execute(user.id, newSubscriptionId)` — applies any `pending_claim` rows for this user (§2.7), regardless of whether they were a referrer earlier.
3. Since `referrerSignupRewardEnabled` defaults to `true` (§2.2, §7.4): grant/queue the referrer's `referrer_signup` reward, subject to the `referrerSignupRewardMaxPer7d` rate cap — best-effort, try/catch, never throws out of `ActivateTrialUseCase`.

### 5.4 Conversion-side rewards — hook in `PurchasePlanUseCase`
Single funnel for all three payment paths (Stars `successful_payment`, YooKassa webhook, YooKassa polling tick — all converge here per `CLAUDE.md`), so hooking once here covers everything instead of threading it through 3 handler call sites again (the mistake we already fixed once for the delivery-message duplication).

At the end of `PurchasePlanUseCase.execute()`, right before the existing `return { subscriptionId, subscriptionUrl, qrCodeBase64 }`:
1. Best-effort, wrapped so it can never fail the purchase: check `paymentRepo.countCompletedByUserId(userId)` (new repo method) `=== 1` (this payment *is* the first — cheaper and more explicit than a "was this the first" boolean flag threaded through).
2. If first payment and `user.referredByUserId` is set:
   - Grant level-1 `referrer_conversion_l1_days` (§2.3.1) to the referrer — via `RenewSubscriptionUseCase` if they have an active subscription, else create a `pending_claim` `ReferralReward` row (§2.7).
   - Grant level-1 `referrer_conversion_l1_traffic` (§2.3.2) to the same referrer — via `RemnawaveClient.updateTrafficLimit`, capped at `conversionTrafficBonusMaxStackedGb`; auto-converted to `conversionTrafficBonusFallbackDays` extra days instead if they're currently on an unlimited paid plan (§2.3.2).
   - Check the milestone table (§2.5) against the referrer's updated converted-count; grant a `milestone` reward if a new threshold was just crossed.
   - Look up the referrer's own `referredByUserId`; if present, grant level-2 `referrer_conversion_l2` (§2.4, days only) the same way.
   - Send the "🎉 friend converted" proactive notification to whoever actually got days/traffic credited or banked (§6.4).
3. Also call `ClaimPendingReferralRewardsUseCase.execute(userId, subscriptionId)` here too — the *buyer* might themselves have pending rewards from having referred others earlier.

This means `PurchasePlanUseCase`'s constructor grows a couple of new collaborators (`IReferralRewardRepository`, a small `ReferralRewardService` or the two use cases directly) — consistent with how this project already threads cross-cutting dependencies explicitly through constructors (per `CLAUDE.md`'s note on `container.ts` wiring order).

### 5.5 New repository interface — `IReferralRewardRepository`
Same shape family as `INotificationLogRepository`:
```ts
export interface IReferralRewardRepository {
  create(reward: Partial<ReferralReward>): Promise<ReferralReward>;
  countCompletedConversionsSince(referrerUserId: string, since: Date): Promise<number>; // for the 30-day cap
  sumPendingDays(referrerUserId: string): Promise<number>; // for the banked-days cap
  findPendingByReferrer(referrerUserId: string): Promise<ReferralReward[]>; // for claiming
  markClaimed(ids: string[], creditedSubscriptionId: string): Promise<void>;
  findByReferrer(referrerUserId: string, options?: { limit?: number; skip?: number }): Promise<Paginated<ReferralReward>>;
  getTopReferrers(limit: number): Promise<Array<{ referrerUserId: string; invitedCount: number; convertedCount: number; totalDaysGranted: number }>>;
  getStats(): Promise<{ totalReferred: number; totalConverted: number; totalDaysGranted: number }>;
}
```
Plus on `IUserRepository`: `findByReferralCode(code)`, `getOrCreateReferralCode(userId)`, `countReferredBy(userId)`.

---

## 6. Telegram bot UX

### 6.1 Button placement
Three places, ranked by expected traffic and "moment of goodwill" (people share things right after they're happy, not from a cold menu):

1. **Main menu** (`mainMenuKeyboard` in `keyboards.ts`) — new row `[🎁 Пригласить друзей]`, always one tap away. Highest-traffic placement, table-stakes.
2. **Right after a successful purchase** (`sendSubscriptionDelivered`, the message we just consolidated) — append one line to `Texts.SUBSCRIPTION_DELIVERED` ("Кстати — пригласите друга и получите 10 дней + 1 ГБ/день бесплатно 🎁") plus a button in that same keyboard. This is the single highest-converting moment: the user is already happy and money already changed hands, so the ask feels natural rather than needy.
3. **Profile screen** (`profileKeyboard`) — add invited-count as a line in the `PROFILE` text plus a `[🎁 Рефералы]` button, so it's discoverable for anyone who thinks to check their stats.

### 6.2 New screen — "Реферальная программа"
New action `referral_program`, new handler (new `ReferralHandlers.ts` under `src/transport/telegram/user/`, following the same per-domain-handler pattern as `PaymentHandlers`/`SubscriptionHandlers`/`DeviceHandlers` — thin `register(bot)`, own screens, wired into `BotHandlers`'s composition root same as the others).

Draft copy (`Texts.REFERRAL_PROGRAM`) — all numbers below are the §2/§7.4 defaults, rendered from `ReferralSettings` at send time, not hardcoded in the template:
```
🎁 Приглашайте друзей — получайте VPN бесплатно!

Как это работает:
1️⃣ Отправьте другу вашу персональную ссылку
2️⃣ Друг активирует пробный период — и сразу получает +3 ГБ/день трафика в подарок
3️⃣ Вы получаете +2 ГБ/день, как только друг подключится
4️⃣ Когда друг оплатит любой тариф — вам начислится +10 дней и +1 ГБ/день трафика навсегда

💎 Пригласили того, кто тоже кого-то пригласил? Получите ещё 3 дня с каждой такой оплаты — бонус растёт сам!

🏆 Чем больше друзей оплатят подписку, тем больше бонус:
• 5 друзей — +15 дней
• 10 друзей — +40 дней
• 25 друзей — +120 дней
{milestoneProgressLine}

📊 Ваша статистика:
👥 Приглашено: {invitedCount}
✅ Оплатили подписку: {convertedCount}
🎉 Всего начислено: {totalDaysGranted} дн. и {totalTrafficGranted} ГБ/день
{pendingClaimLine}

🔗 Ваша ссылка:
{referralLink}
```
where `{pendingClaimLine}` only appears when there's a banked reward: `⏳ Ждут получения: {pendingDays} дн. — активируйте VPN, чтобы забрать!`, and `{milestoneProgressLine}` shows distance to the next threshold: `Осталось пригласить {N} друзей до следующего бонуса!` (omitted once the top tier is reached).

Note steps 2 and 3 have to read from `referredSignupBonusType`/`referrerSignupRewardType` (§7.4) — the template above assumes the new `traffic_gb` default; an admin who switches either back to `days` mode needs the alternate sentence ("+5 дней в подарок" / "+2 дня") swapped in, not both shown at once (per the admin's single-mode-per-tier choice, §2.1/§2.2).

Keyboard: one `url` button using Telegram's native share sheet instead of "copy-paste this text" —
```
https://t.me/share/url?url=<url-encoded referralLink>&text=<url-encoded pitch text>
```
This opens Telegram's built-in forward-to-chat picker pre-filled with the link and pitch text — meaningfully lower friction than asking someone to copy a raw URL, and needs zero bot-side work beyond building that URL string. Pitch text draft: *"Пользуюсь этим VPN — быстро и без сбоев. Подключайся по моей ссылке, получишь бонус к пробному периоду 👇"* (kept generic rather than hardcoding "+5 дней" here too, so it doesn't drift out of sync with the admin-configured amount).

### 6.3 Reward-granted notification (referrer side)
Reuses `NotificationService.send()` per existing convention. Four variants, one per event:
- Signup (§2.2): `"🎉 Ваш друг {firstName} подключил бесплатный VPN! Вам начислено {days} дн."`
- Conversion (§2.3, the big one — mentions both components in one message rather than sending two notifications back to back): `"🎉 Ваш друг {firstName} оплатил подписку! Вам начислено {days} дней и +{trafficGb} ГБ/день трафика навсегда."` (traffic clause omitted if `conversionTrafficBonusEnabled` is off or the bonus was skipped per §2.3.2)
- Banked/pending (§2.7, covers any reward type): `"🎉 Друг {firstName} принёс вам бонус ({days} дн.) — активируйте VPN (🌐 Мой VPN), чтобы получить его!"`
- Milestone (§2.5): `"🏆 {convertedCount} друзей оплатили подписку по вашей ссылке! Бонус: +{bonusDays} дней."`

### 6.4 Referred-user signup perk notice
When the referred user activates trial, `TRIAL_INFO`/the delivery message should visibly call out the bonus so it doesn't feel silently added: append a line like *"🎁 +5 дней — бонус за переход по ссылке друга!"* (or the traffic-mode equivalent, per `referredSignupBonusType`) to the delivery text specifically when `referredByUserId` was set (small conditional in `Texts.SUBSCRIPTION_DELIVERED` composition, not a schema change).

---

## 7. Admin panel

### 7.1 Navigation
New `Sidebar.tsx` entry: `{ to: '/referrals', label: 'Рефералы', Icon: IconGift }` (new icon, add to `icons.tsx` following the existing icon-component pattern). Placed after "Пользователи" — it's a growth/marketing view, adjacent to but distinct from user management.

### 7.2 New page — `admin-panel/src/pages/ReferralsPage.tsx`
Follows the existing page conventions (`PageHeader`, `card`/`table-scroll`/`payments-table` CSS classes, `Pagination` component, own `useEffect`-driven fetch — same shape as `UsersPage.tsx`/`PaymentsPage.tsx`, no shared `DashboardOutletContext` since this page has its own filtering/pagination like Payments/Users/Logs already do per `CLAUDE.md`).

Layout:
- KPI row (`StatCard` × 4): «Всего приглашено», «Оплатили подписку» (+ conversion %), «Начислено дней всего», «Ожидают получения» (banked days across all users — a health signal, a big number here means people aren't coming back to claim).
- Top-referrers table: user label (linking to `/users/:id` per the existing `userId`-alongside-`userLabel` convention), invited count, converted count, total days granted, sortable by converted count.
- Recent rewards feed: paginated table of `ReferralReward` rows (referrer, referred, type, days, status, date) — same pagination convention as `PaymentsPage`/`LogsPage` (`?page=&pageSize=`, `{ items, total, page, pageSize }`).

### 7.3 `UserDetailPage.tsx` extension
Add a small "Рефералы" section: referred-by (link to the referrer's user page, if any), invited count, list of rewards where this user is either side. Cheap addition to an existing page rather than a new route.

### 7.4 Tunable settings
**Decision: DB-backed, confirmed** (not env vars) — the whole point of building this is to tune it without a redeploy. Updated shape reflecting the 2026-07-31 decisions (§2, §9):

```ts
@Entity('referral_settings')
export class ReferralSettings {
  @PrimaryColumn('uuid') id: string = generateId(); // single row, fixed id or just "latest by updatedAt"

  // GLOBAL KILL SWITCH — see the dedicated "Kill switch behavior" note below this block.
  @Column({ type: 'boolean', default: true }) enabled: boolean;

  // §2.1 — friend's own signup perk. Admin picks ONE mode; amount is read from the matching field.
  // Default flipped to traffic_gb 2026-07-31 (see §2.1) — trial already renews forever, so days
  // are a weak reward for a free user; traffic/day is the tier's actual bottleneck.
  @Column({ type: 'varchar', length: 20, default: 'traffic_gb' }) referredSignupBonusType: 'days' | 'traffic_gb';
  @Column({ type: 'integer', default: 5 }) referredSignupBonusDays: number;
  @Column({ type: 'integer', default: 3 }) referredSignupBonusTrafficGb: number;

  // §2.2 — referrer's reward when friend activates trial. Enabled per 2026-07-31 decision.
  // Default mode also flipped to traffic_gb 2026-07-31, same reasoning as §2.1.
  @Column({ type: 'boolean', default: true }) referrerSignupRewardEnabled: boolean;
  @Column({ type: 'varchar', length: 20, default: 'traffic_gb' }) referrerSignupRewardType: 'days' | 'traffic_gb';
  @Column({ type: 'integer', default: 2 }) referrerSignupRewardDays: number;
  @Column({ type: 'integer', default: 2 }) referrerSignupRewardTrafficGb: number; // stacks per rewarded signup
  @Column({ type: 'integer', default: 8 }) referrerSignupTrafficMaxStackedGb: number; // soft ceiling, mirrors §2.3.2
  @Column({ type: 'integer', default: 1 }) referrerSignupRewardTrafficFallbackDays: number; // paid-plan fallback, §2.2
  @Column({ type: 'integer', default: 5 }) referrerSignupRewardMaxPer7d: number; // rate cap, §2.2/§3

  // §2.3.1 — referrer's day reward when friend pays.
  @Column({ type: 'varchar', length: 20, default: 'flat_days' }) conversionRewardMode: 'flat_days' | 'percent_of_purchase';
  @Column({ type: 'integer', default: 10 }) conversionRewardFlatDays: number;
  @Column({ type: 'integer', default: 20 }) conversionRewardPercent: number;

  // §2.3.2 — referrer's permanent traffic bump when friend pays, stacks per converted referral.
  @Column({ type: 'boolean', default: true }) conversionTrafficBonusEnabled: boolean;
  @Column({ type: 'integer', default: 1 }) conversionTrafficBonusGb: number;
  @Column({ type: 'integer', default: 10 }) conversionTrafficBonusMaxStackedGb: number; // soft ceiling, §2.3.2
  @Column({ type: 'integer', default: 2 }) conversionTrafficBonusFallbackDays: number; // paid-plan fallback, §2.3.2

  // §2.4 — pyramid level 2, percent of the level-1 *days* component only.
  @Column({ type: 'integer', default: 30 }) level2RewardPercent: number;

  // §2.5 — milestones, short admin-editable list rather than a separate table.
  @Column({ type: 'jsonb', default: () => `'[{"convertedCount":5,"bonusDays":15},{"convertedCount":10,"bonusDays":40},{"convertedCount":25,"bonusDays":120}]'` })
  milestones: Array<{ convertedCount: number; bonusDays: number }>;

  // §2.6 — guardrails.
  @Column({ type: 'integer', default: 20 }) maxRewardedConversionsPer30d: number;
  @Column({ type: 'integer', default: 60 }) maxBankedDays: number;

  @UpdateDateColumn({ type: 'timestamp' }) updatedAt: Date;
}
```
Loaded once and cached in Redis like other hot-path config-ish reads in this codebase (mirrors the `remnawave:state:{uuid}` TTL-cache pattern already established), invalidated on admin save. Form on `ReferralsPage.tsx` (or a `ReferralSettingsPage.tsx` if it gets big — given the field count above, probably worth its own tab/page rather than cramming into the stats page) to edit these — plain inputs + a save button, same style as other admin forms in this panel. Group the form visually to match §2's structure (friend's perk / signup reward / conversion reward / pyramid / milestones / guardrails) so it reads as the same mental model as this doc, not a flat wall of number inputs.

**Kill switch behavior — `enabled` (added per explicit 2026-07-31 request: "вдруг там ошибки будут, я просто выключу и пойду дорабатывать").** This is the one field that isn't a reward amount — it's an emergency stop, and needs to actually behave like one, not just gate the marketing copy. Precise semantics when `enabled = false`:
- **Attribution stops immediately.** `RegisterUserUseCase` skips the referral-code lookup entirely for new `/start r_XXX` sessions — no `referredByUserId` gets set while disabled, so nothing needs undoing when it's re-enabled.
- **All reward-granting hooks no-op at the top**, before any other referral logic runs: the `ActivateTrialUseCase` and `PurchasePlanUseCase` hooks (§5.3, §5.4) check `settings.enabled` first and return immediately if false. Existing subscriptions/payments are completely unaffected — this only ever touches the referral side-effects, never the core purchase/trial flow (consistent with §2.6/§3's "never allowed to fail the payment itself" principle).
- **Pending/banked rewards (`status: 'pending_claim'`) are frozen, not cancelled.** `ClaimPendingReferralRewardsUseCase` also checks `enabled` first — while off, nobody's banked days/traffic get silently paid out *or* silently lost. They resume claiming automatically the moment the toggle flips back on and that user next activates a subscription.
- **Bot UI hides itself.** The "🎁 Пригласить друзей" entry points (main menu row, post-purchase line, profile button — §6.1) all read the cached `enabled` flag before rendering and simply omit themselves when off, rather than showing a button that leads to a "feature disabled" dead end.
- **Admin panel stays fully visible and editable regardless** — `ReferralsPage.tsx`, the settings form, and historical `referral_rewards` data are never hidden by this flag; the whole point is that the admin needs to see and fix things *while* the feature is off.
- This is a single global switch, not per-reward-type — the per-tier toggles (`referrerSignupRewardEnabled`, `conversionTrafficBonusEnabled`) already give finer-grained control for tuning; `enabled` is specifically the "something's broken, stop everything now" lever.

New backend route `src/transport/http/routes/referrals.ts` (mirrors the one-file-per-resource convention): `GET /api/referrals/stats`, `GET /api/referrals/top`, `GET /api/referrals` (paginated rewards feed), `GET /api/referrals/settings`, `PUT /api/referrals/settings` — all behind `requireAdminAuth` like everything except `/api/auth/*`.

---

## 8. Rollout

### 8.1 Schema
New `ReferralReward` and `ReferralSettings` entities + `User.referralCode`/`User.referredByUserId` columns → `npm run migrate:safe` picks them up automatically (non-destructive `synchronize()`), same as every other schema change in this project. No hand-written SQL expected to be necessary.

### 8.2 Backfill
None required as a blocking step — `referralCode` is nullable and generated lazily (§5.2) the first time each user touches the feature (opens the new screen, or an admin looks them up). No migration script, no downtime concern.

### 8.3 Testing (per this repo's conventions)
- `tests/usecases/` — hand-written interface mocks (not a mocking framework), covering:
  - `RegisterUserUseCase`: attribution happens for new users with a valid `r_` payload, does *not* happen for existing users, self-referral rejected, invalid/unknown code ignored gracefully (registration still succeeds).
  - New `ProcessReferralRewardUseCase`/hook in `PurchasePlanUseCase`: first-payment-only trigger, level-2 walk, idempotency (same `triggerPaymentId` twice → one reward), capped case still creates an audit row.
  - `ClaimPendingReferralRewardsUseCase`: banked rewards get applied and marked claimed exactly once.
- `tests/transport/http/referralsRoutes.test.ts` — `supertest` against `createAdminHttpApp(...)`, 401-without-session + happy path for each new route, following `adminListRoutes.test.ts`'s shape.
- Manual bot click-through before deploy (this repo has no test coverage on exact Telegram copy/keyboards, per existing convention) — two-account test: account A invites account B, B activates trial (check bonus days), B pays (check A got days, check A's own referrer if chained, check notification arrives).

---

## 9. Decisions — resolved 2026-07-31

All six original open questions are now settled. Recorded here for traceability (what was asked, what was decided, where it landed in the doc):

1. **Signup-side referrer reward (§2.2)**: ✅ **enabled from day one**, not disabled-by-default as originally recommended. ~~Pays in days (+2)~~ — **superseded by decision 7 below**: now defaults to traffic (+2 GB/day, stacking) instead of days, which meaningfully softens the farming risk this item originally accepted. Rate cap (`referrerSignupRewardMaxPer7d`, default 5/week) plus the new stacking ceiling (`referrerSignupTrafficMaxStackedGb`, default 8 GB/day) are what bound it now. See the updated §3 table.
2. **Reward currency for the referred-user perk (§2.1)**: ✅ **admin-configurable**, not hardcoded — `ReferralSettings.referredSignupBonusType: 'days' | 'traffic_gb'`, admin picks one mode at a time. ~~Default: days~~ — **superseded by decision 7 below**: default mode is now `traffic_gb` (+3 GB/day), `days` (+5) still available as the alt mode.
3. **Exact numbers**: ✅ bumped up ("chunkier") across the board — signup perk 3→5 days, referrer signup 1→2 days, conversion 7→10 days **plus a new +1 GB/day permanent component** (not in the original draft at all — see §2.3.2), level 2 stays 30% of the (now bigger) days component → 3 days. Still defaults, still tunable from the admin panel — these are the *new* starting points, not necessarily final either.
4. **Settings storage (§7.4)**: ✅ **DB-backed + Redis-cached**, confirmed — `ReferralSettings` entity, editable from the admin panel, no redeploy needed to retune.
5. **Milestone bonuses (§2.5)**: ✅ **in scope for the first build**, not Phase 2. Confirmed concrete point: 5 converted referrals → +15 days. Extrapolated a full ladder (10→+40, 25→+120) for tomorrow to sanity-check, only the 5→15 point itself is a confirmed number.
6. **Referral link format**: ✅ **random code**, confirmed — `t.me/<bot>?start=r_<code>`, 8-char random base36, not username-based.

New things worth a quick sanity-check tomorrow that came up *while* resolving the above (not blocking, just flagged inline where they appear):
- `conversionTrafficBonusMaxStackedGb` (default 10 GB/day ceiling), `referrerSignupTrafficMaxStackedGb` (default 8 GB/day ceiling), and the milestone ladder's 10/25 tiers are this doc's own extrapolations, not things you stated directly — cheapest to just eyeball them in the settings form once it exists rather than debate in the abstract now.
- The two new fallback-day amounts introduced in round 3 (1 day for §2.2, 2 days for §2.3.2) are also this doc's own guess at "small but not nothing" — worth a glance, not a hard blocker.

### Round 3 — resolved 2026-07-31 (same day, user caught a real gap)

9. **"Paid уже безлимит — зачем ему ГБ?"** — the traffic-bonus no-op-for-paid-referrers caveat flagged throughout rounds 1–2 was never actually resolved, just repeatedly noted as "worth checking." User asked the obvious follow-up directly. **Fixed properly**, not just flagged again: every traffic-denominated reward (§2.2's signup reward, §2.3.2's conversion bonus) now **auto-converts to a days-equivalent** when the referrer is already on an unlimited paid plan, instead of ever granting something with zero visible effect. New settings: `referrerSignupRewardTrafficFallbackDays` (default 1) and `conversionTrafficBonusFallbackDays` (default 2). The `ReferralReward.metadata` field records which currency was actually granted either way, so the admin feed stays honest about what happened rather than showing a GB grant that did nothing.

### Round 2 — resolved 2026-07-31 (same day, after comparing a competitor bot)

7. **Competitor comparison (+14 days per invite, no payment required, friend gets +7 days)**: after discussing why a straight transplant doesn't fit — this bot's trial already renews indefinitely every 2 weeks (`Texts.ERROR_TRIAL_EXISTS`), so *days* aren't actually scarce for a free user here the way they are for a one-shot-trial competitor — **decided to switch both signup-tier rewards (§2.1 friend's perk, §2.2 referrer's signup reward) to default to traffic (GB/day) instead of days.** Days stay the default currency only for the paid-conversion tier (§2.3), where they're genuinely valuable since there's no free renewal to fall back on. `days` mode remains available as an admin-configurable alternative for both signup-tier rewards, just no longer the default. See §2.1, §2.2, §3, §7.4 for the full rewrite.
8. **Global kill switch**: explicitly requested — "вдруг там ошибки будут, я просто выключу и пойду дорабатывать." `ReferralSettings.enabled` already existed in the schema draft but was under-specified; now has a full behavioral spec in §7.4 (attribution stops, reward-granting hooks no-op, banked rewards freeze rather than cancel, bot UI hides its entry points, admin panel stays fully visible/editable throughout). This is the single "something's broken, stop everything" lever, separate from the existing per-tier enable flags.
