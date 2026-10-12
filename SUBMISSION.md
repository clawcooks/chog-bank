# Chog Bank — Hackathon Submission

## 01 — Your project

- **Project name:** Chog Bank
- **Team:** monasex
- **Discord:** monasex_
- **X:** [@monasex_1](https://x.com/monasex_1)

## 02 — What you built

Chog Bank lets you borrow native MON against a Chog NFT instead of selling
it — and if you can't pay the loan back, you don't have to just default.
You can flip a coin: win, and your debt is forgiven outright and the NFT
comes straight back to your wallet; lose, and the loan stands exactly as it
was (you still owe the full balance to redeem your NFT), but you walk away
with a CHOG token consolation prize.

**Worked example:** mint a Chog NFT valued at 3 MON → borrow up to 67% LTV
(2.01 MON) → over a 30-day term that's 8% interest (0.16 MON), so 2.17 MON
to redeem the NFT. Instead of repaying, gamble half the principal (~1 MON):
win and the NFT is yours again for free; lose and you still owe the 2.17 MON
later, but you're holding CHOG that's redeemable for real MON.

What makes it new, beyond the lending-against-an-NFT idea itself:

- **The gamble is a real alternative payoff path, not a gimmick bolted on
  top.** The stake size, odds, and what happens on each outcome are tuned
  from day one so the house stays positive-EV on both branches — not an
  afterthought feature, the core economic design (see §05 for the numbers).
- **The house is the community, not the deployer.** Anyone can deposit MON
  into the lending pool and become an LP, earning a cut of every loan's
  interest *and* every gamble's house edge as the pool's share price rises.
  It's not an admin-funded faucet — it's a real shared pool with
  deposit/withdraw and proportional share accounting.
- **CHOG has a real floor, not just a mint.** A slice of every profit event
  (interest collected, stakes kept, win or lose) funds a redemption reserve,
  so the token handed out as a gamble consolation prize can be burned back
  for a guaranteed MON payout — it's not a dead-end inflationary reward with
  no sink.
- **Self-serve by design.** Anyone can mint a test Chog NFT and it's
  auto-priced instantly (no admin gatekeeping required), so a judge — or any
  new user — can walk the entire mint → borrow → gamble → redeem loop
  solo, with their own wallet, in under five minutes.
- **Onboarding built for people who've never seen it before.** First load is
  a guided intro explaining the mechanic and a numbered "how to try it"
  walkthrough before you ever touch the app, reachable again anytime via a
  Guide button in the header.

## 03 — Why Chog matters

The Chog NFT isn't decoration here — it's the entire reason the product
exists. Every loan, every interest calculation, every gamble is downstream
of a Chog NFT sitting in the vault as collateral:

- It's the **collateral asset** that unlocks a loan (up to 67% of its
  assessed value) — there is no Chog Bank without a Chog to bank.
- It's the **thing at risk** in the gamble — what you're trying to win back
  without paying, or what stays locked if you don't.
- It's the **identity of the product** — "Chog Bank" only makes sense
  because Chog is a loved, specific character in the Monad ecosystem, not a
  generic placeholder JPEG. The whole pitch ("don't sell your Chog, bank it
  instead") depends on people actually wanting to keep this specific NFT
  rather than cash out, the same emotional logic that makes real-world
  asset-backed lending work.
- It has a **real, finite identity** in the demo too: the mock collection
  used for testing is capped at exactly **1969** mints, so even the stand-in
  behaves like a real collection with scarcity, not an infinite faucet.

## 04 — Show it working

- **Live demo:** https://claude.ai/artifact/DmvZKouDjfrHqWfE84xBiv
  (public — "Anyone with the link" access confirmed)
- **Demo video:** https://x.com/monasex_1/status/2109284801307893883?s=20
- **Testing instructions:**
  1. Open the live demo link and click **Launch App**.
  2. Click **Connect Wallet** (MetaMask or any injected wallet). If
     prompted, approve adding/switching to **Monad Testnet** (chain ID
     `10143`, RPC `https://testnet-rpc.monad.xyz`).
  3. Get testnet MON from https://faucet.monad.xyz if your wallet is empty.
  4. Click **Mint test NFT** — it's auto-priced instantly, no waiting on an
     admin.
  5. Pick a loan term (7/14/30 days) and click **Borrow** — MON lands in
     your wallet immediately, the NFT is locked as collateral.
  6. Either **Repay** in full to get the NFT back, or **Gamble** half the
     principal for a shot at full debt forgiveness.
  7. If you lose the gamble, open **CHOG Redemption** and burn the CHOG you
     received for a guaranteed MON payout.
  8. Try **Liquidity Pool → Deposit** to become an LP yourself and watch the
     price-per-share figure move as loans/gambles happen.
  9. Click **Guide** in the header any time to re-read the walkthrough.

## 05 — Under the hood

- **Repository:** https://github.com/clawcooks/chog-bank
- **Live contracts on Monad Testnet** (chain ID `10143`,
  explorer `https://testnet.monadexplorer.com`):
  - `ChogBank`: [`0x835F29adECCfD049939a4A8F930977fF44C05d96`](https://testnet.monadexplorer.com/address/0x835F29adECCfD049939a4A8F930977fF44C05d96)
  - `ChogNFT`: [`0x186fFD335Fa54d2cdfD9F19bEe67e0703124e671`](https://testnet.monadexplorer.com/address/0x186fFD335Fa54d2cdfD9F19bEe67e0703124e671)
  - `ChogToken`: [`0xC98c5b652a948b08d245743d1d311d53d314b574`](https://testnet.monadexplorer.com/address/0xC98c5b652a948b08d245743d1d311d53d314b574)
- **Tech stack:**
  - Contracts: Solidity 0.8.24, Hardhat, OpenZeppelin Contracts (ERC721,
    ERC20 + ERC20Burnable, Ownable)
  - Frontend: React + Vite, ethers.js v6, vanilla CSS (no UI framework)
  - Network: Monad Testnet
- **Pre-existing work used:** OpenZeppelin's audited ERC721/ERC20/Ownable
  implementations as a base for the mock Chog NFT and CHOG token contracts.
  Everything else — `ChogBank`'s lending, gamble, LP-pool, and redemption
  logic, and the entire frontend — was written during this hackathon.
- **Core economics, explicitly:** 67% max LTV, 3%/5%/8% flat interest for
  7/14/30-day terms, gamble stake = 50% of principal, borrower win chance
  30% (house 70%), 10% of every profit event funds the CHOG reserve — all
  admin-tunable on-chain (`setRiskParams`, `setTermRate`,
  `setChogEconomics`), not hardcoded constants.
- **Known limitation, disclosed in the contract's NatSpec:** the coin flip
  uses on-chain pseudo-randomness (blockhash/timestamp-based) — fine for a
  testnet demo, not safe against a validator/searcher with real funds at
  stake. See §06.
- **Tests:** 16 Hardhat tests, all passing — LP share minting and
  withdraw-liquidity limits, borrow/repay accounting, both gamble outcomes,
  liquidation + treasury sweep, CHOG profit routing and redemption, and the
  1969 NFT supply cap (`contracts/test/`).

## 06 — What's next?

**What building and testing it taught us:** we didn't just ship and hope —
the LP-pool and CHOG-redemption rework went through multiple rounds of live
testing (both automated Hardhat tests and clicking through the actual
deployed build with real wallets), and that process surfaced and fixed real
issues before they reached judges: a naming collision where a view function
called `valueOf` was silently shadowed by JavaScript's built-in
`Object.prototype.valueOf` (always showed a 0 balance until renamed); a
stale-nonce race from `ethers.js` caching `eth_getTransactionCount` across
back-to-back transactions on fast-confirming chains; a CSS specificity bug
that broke text alignment in the in-app guide; and raw Solidity revert
strings leaking to the UI instead of a human-readable message (now
pre-validated client-side with a clear "max redeemable" figure shown before
you can even hit the error). We haven't run a formal external user-testing
round yet — that's the natural next step once this is in front of judges
and early users.

**Roadmap**, in priority order:

1. **Verifiable randomness.** Swap the pseudo-random coin flip for Chainlink
   VRF or Monad's equivalent before any real value touches the gamble path.
2. **Real Chog NFT collection.** The demo intentionally uses an open-mint
   mock collection (capped at 1969) so judges can self-serve test the flow
   without us gatekeeping valuations. A production version points at the
   real Chog collection with an actual floor price.
3. **On-chain CHOG buybacks.** CHOG is currently backed by a treasury
   redemption floor rather than real market buy-pressure, since there's no
   live DEX pair for it yet. Once there is, routing a cut of protocol
   profit into an actual buy-and-burn would be a stronger token sink than
   the fixed-rate redemption we have now.
4. **Utilization-based interest rates** (Aave-style), so rates respond to
   how much of the pool is currently lent out instead of being flat per
   term.
5. **On-chain liquidation auctions** for seized collateral, instead of the
   current manual `sweepNft` admin disposal path.
