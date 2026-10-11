# Chog Bank — Hackathon Submission

## 01 — Your project

- **Project name:** Chog Bank
- **Team members:** _[fill in — names + Discord + X handles]_
- **Discord:** _[team/project Discord handle]_
- **X:** _[team/project X handle]_

## 02 — What you built

Chog Bank lets you borrow native MON against a Chog NFT instead of selling
it — and if you can't pay the loan back, you don't have to just default.
You can flip a coin: win, and your debt is forgiven outright and the NFT
comes straight back to your wallet; lose, and the loan stands exactly as it
was (you still owe the full balance to redeem your NFT), but you walk away
with a CHOG token consolation prize.

What makes it new, beyond the lending-against-an-NFT idea itself:

- **The gamble is a real alternative payoff path, not a gimmick bolted on
  top.** It's priced into the protocol's economics from day one — the stake
  size, odds, and what happens on each outcome are all tuned so the house
  stays positive-EV on both branches (see the README's expected-value
  walkthrough).
- **The house is the community, not the deployer.** Anyone can deposit MON
  into the lending pool and become an LP, earning a cut of every loan's
  interest *and* every gamble's house edge as the pool's share price rises.
  It's not an admin-funded faucet — it's a real shared pool with
  deposit/withdraw and share accounting.
- **CHOG has a real floor, not just a mint.** A slice of every profit event
  (interest collected, stakes kept) funds a redemption reserve, so the
  token handed out as a gamble consolation prize can be burned back for a
  guaranteed MON payout — it's not a dead-end inflationary reward.
- **Self-serve by design.** Anyone can mint a test Chog NFT and it's
  auto-priced instantly, so a judge (or any new user) can walk the entire
  loan → gamble → redeem loop without needing an admin to do anything on
  their behalf first.

## 03 — Why Chog matters

The Chog NFT isn't decoration here — it's the entire reason the product
exists. Every loan, every interest calculation, every gamble is downstream
of a Chog NFT sitting in the vault as collateral:

- It's the **collateral asset** that unlocks a loan (up to 67% of its
  admin/community-set value).
- It's the **thing at risk** in the gamble — what you're trying to win back
  without paying, or what stays locked if you don't.
- It's the **identity of the product** — "Chog Bank" only makes sense
  because Chog is a loved, specific character in the Monad ecosystem, not
  a generic placeholder JPEG. The whole pitch ("don't sell your Chog, bank
  it instead") is built around people actually wanting to keep this
  specific NFT rather than cash out.

## 04 — Show it working

- **Live demo:** https://claude.ai/artifact/DmvZKouDjfrHqWfE84xBiv
  _(private link — set to "anyone with the link" before sharing with judges)_
- **Demo video:** _[record a walkthrough up to 3 minutes — suggested script below]_
- **Testing instructions:**
  1. Open the live demo link and click **Launch App**.
  2. Click **Connect Wallet** (MetaMask or any injected wallet). If prompted,
     approve adding/switching to **Monad Testnet** (chain ID `10143`).
  3. Get testnet MON from https://faucet.monad.xyz if your wallet is empty.
  4. Click **Mint test NFT** — it's auto-priced instantly, no waiting.
  5. Pick a loan term and click **Borrow** — MON lands in your wallet, the
     NFT is locked as collateral.
  6. Either **Repay** in full to get the NFT back, or **Gamble** half the
     principal for a shot at full debt forgiveness.
  7. If you lose the gamble, open **CHOG Redemption** and burn the CHOG you
     received for a guaranteed MON payout.
  8. Try **Liquidity Pool → Deposit** to become an LP yourself and watch the
     price-per-share figure track pool profit.
  9. Click **Guide** in the header any time to re-read the walkthrough.

### Suggested 3-minute demo video script

1. **(0:00–0:20)** Open the intro screen, read the pitch out loud in your
   own words, click Launch App.
2. **(0:20–0:50)** Connect wallet, mint a test Chog NFT, show it's
   auto-priced and ready.
3. **(0:50–1:30)** Borrow against it — point out the live interest/payoff
   preview as you change the loan term.
4. **(1:30–2:10)** Gamble instead of repaying — show the coin-flip modal,
   explain both outcomes (win: NFT back, debt gone; lose: still owed, but
   CHOG bonus).
5. **(2:10–2:40)** Redeem the CHOG bonus for MON; show the Liquidity Pool
   panel and explain anyone can become the house.
6. **(2:40–3:00)** Close on the Guide button and the testnet contract
   addresses in the repo README as proof it's really on-chain.

## 05 — Under the hood

- **Repository:** https://github.com/clawcooks/chog-bank
- **Tech stack:**
  - Contracts: Solidity 0.8.24, Hardhat, OpenZeppelin Contracts (ERC721,
    ERC20 + ERC20Burnable, Ownable)
  - Frontend: React + Vite, ethers.js v6
  - Network: Monad Testnet (chain ID 10143)
- **Pre-existing work used:** OpenZeppelin's audited ERC721/ERC20/Ownable
  implementations as a base for the mock Chog NFT and CHOG token contracts;
  everything else (ChogBank's lending, gamble, LP-pool, and redemption
  logic, and the full frontend) was written for this hackathon.
- **Tests:** 16 Hardhat tests covering LP shares/withdraw limits, borrow/
  repay accounting, both gamble outcomes, liquidation, and CHOG profit
  routing/redemption — all passing (`contracts/test/`).

## 06 — What's next?

_[Fill in with real feedback once you've shown it to people — placeholder
roadmap below in the meantime.]_

Known limitations we'd address before handling real value:

- **Verifiable randomness.** The coin flip currently uses on-chain
  pseudo-randomness (blockhash/timestamp-based), which is fine for a demo
  but not safe against a validator or searcher. Next step: Chainlink VRF or
  Monad's equivalent.
- **Real Chog NFT collection.** The demo uses an open-mint mock collection
  (capped at 1969) so judges can self-serve test the flow. A production
  version points at the real Chog collection with an actual floor price.
- **On-chain CHOG buybacks.** Right now CHOG is backed by a treasury
  redemption floor rather than real market buy-pressure, since there's no
  live DEX pair for it yet. Once there is, routing a cut of protocol profit
  into an actual buy-and-burn would be a stronger token sink.
- **Utilization-based interest rates** (Aave-style), so rates respond to
  how much of the pool is currently lent out instead of being flat per term.
- **On-chain liquidation auctions** for seized collateral, instead of the
  current manual `sweepNft` admin disposal path.
