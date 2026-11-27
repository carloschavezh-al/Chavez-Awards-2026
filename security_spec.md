# Security Specification — Gala Familiar Firestore Rules

## Data Invariants
1. **Single-Category Active Voting**: Only `isAdmin()` can mutate `/ceremony/main` (`stageMode`, `activeCategoryId`) or `/categories/{categoryId}`.
2. **Closed Voting Guard**: A voter cannot create a document in `/votes/{voteId}` unless the referenced category exists and `isVotingOpen == true`.
3. **One Vote Per Category Per Voter**: Vote document IDs are strictly enforced as `categoryId + '__' + voterId` on `create`, and `update` is denied, making duplicate votes per category impossible.
4. **No Public Vote Scraping**: Non-admin clients cannot `list` `/votes` or `/voters`; public screen and voter clients can only read published `/results/{categoryId}` once `isRevealed == true`.
5. **Temporal & Schema Integrity**: All `createdAt`/`updatedAt` timestamps must match `request.time`, all strings/lists have strict `.size()` bounds, and `keys().hasOnly(...)` prevents shadow fields.

## Dirty Dozen Adversarial Payloads
1. Unauthenticated write to `/ceremony/main` attempting to switch `stageMode` to `winner` -> `PERMISSION_DENIED`.
2. Unauthenticated write to `/categories/cat-1` attempting to add a fake nominee -> `PERMISSION_DENIED`.
3. Signed-in non-admin user with unverified email spoofing admin email -> `PERMISSION_DENIED`.
4. Vote payload with extra shadow key `isAdmin: true` -> `PERMISSION_DENIED`.
5. Vote payload targeting a closed category (`isVotingOpen == false`) -> `PERMISSION_DENIED`.
6. Vote payload targeting a nonexistent category -> `PERMISSION_DENIED`.
7. Vote payload with mismatched document ID (`randomId` instead of `cat-1__voter-1`) -> `PERMISSION_DENIED`.
8. Second vote attempt (`update`) on existing `cat-1__voter-1` document -> `PERMISSION_DENIED`.
9. Unauthenticated `list` query on `/votes` to inspect live tallies -> `PERMISSION_DENIED`.
10. Unauthenticated `get` on `/results/cat-1` when `isRevealed == false` -> `PERMISSION_DENIED`.
11. Resource poisoning with 2KB `voterId` string -> `PERMISSION_DENIED`.
12. Client-forged past `createdAt` timestamp on `/votes` -> `PERMISSION_DENIED`.
