# Chog Bank

Borrow MON against a Chog NFT instead of selling it — and if you can't pay it
back, flip a coin for a chance to walk away debt-free. Anyone can become the
house too, by depositing into the lending pool.

## How it works

1. **Collateralize.** Mint a Chog NFT — it's auto-priced instantly via a
   self-serve default valuation (the admin can also set a specific
   valuation per NFT). Borrow up to **67% LTV** of that value in native MON.
2. **Interest accrues** by term: 7 days = 3%, 14 days = 5%, 30 days = 8%
   (flat, admin-configurable). On a 2.01 MON principal / 30-day loan that's
   0.16 MON interest, so 2.17 MON to redeem the NFT.
3. **Repay normally**, or **gamble**: stake 50% of the principal on a coin
   flip.
   - **Win (30% chance):** debt forgiven, NFT returned immediately. The
     pool absorbs the unrecovered principal as a loss.
   - **Lose (70% chance):** loan stands exactly as before — you still owe
     the full balance later — but you get a CHOG consolation bonus. The
     stake is kept by the house either way; gambling is a one-shot option
     per loan.
4. **Default:** if the loan isn't repaid within a grace period after the due
   date, the owner can seize the NFT (`liquidate`). It stays in the pool as
   a treasury asset until manually disposed of (`sweepNft`).

### The house is a shared liquidity pool

`ChogBank` isn't funded by the deployer alone — it's a share-based vault.
Anyone can call `deposit()` to become an LP and `withdraw()` to cash out
(limited by liquid cash on hand). The pool's share price rises automatically
as loans repay interest and gambles get played, since LPs are the house.

### CHOG has a real floor, not just a mint

A slice of every profit event (loan interest, gamble stakes — win or lose)
is routed into a CHOG redemption reserve (`profitToChogReserveBps`, 10% by
default). CHOG earned as a gamble consolation prize can be burned back via
`redeemChog()` for a guaranteed MON payout at an admin-set rate
(`chogRedemptionRateWei`), instead of being a dead-end inflationary reward.

### Why the house is +EV on every path

Per gamble attempt (illustrative numbers, 2 MON principal / 2.16 MON due /
1 MON stake):

| Outcome | Probability | House nets |
|---|---|---|
| Win | 30% | +1 stake − 2 forgiven principal = **−1** |
| Lose | 70% | +1 stake + 2.16 collected later = **+3.16** |

Expected value to the house per gamble ≈ `0.3 × (−1) + 0.7 × (3.16) ≈ +1.9`,
comfortably positive — on top of the interest every loan collects and the
LTV haircut that protects the pool if an NFT's assessed value falls. LTV,
gamble stake size, odds, and the CHOG profit cut are all admin-configurable
(`setRiskParams`, `setChogEconomics`).

## Project layout

```
contracts/    Solidity contracts, Hardhat tests, deploy scripts
frontend/     React + Vite + ethers.js UI
```

## Contracts

- `ChogNFT.sol` — mock ERC721, anyone can mint, capped at a supply of
  **1969** (stands in for the real Chog collection for demo purposes).
- `ChogToken.sol` — mock ERC20 (burnable), mintable only by the bank
  (gamble-loss bonus payouts), burnable by the bank on redemption.
- `ChogBank.sol` — core lending/gambling/LP-pool logic. `borrow`, `repay`,
  `gamble`, `deposit`, `withdraw`, `redeemChog` are the main user entry
  points; `setValuation`, `setRiskParams`, `setChogEconomics`, `liquidate`,
  `sweepNft` are owner-only.

**Security note:** the coin flip uses on-chain pseudo-randomness
(blockhash/timestamp based) — fine for a hackathon demo, *not* safe against
a validator/searcher in production. A real deployment should swap `_flip()`
for a verifiable randomness source (Chainlink VRF or Monad's equivalent)
before handling real value. This is called out in the contract's NatSpec too.

## Running locally

```bash
# 1. Contracts — start a local chain, deploy, seed the LP pool
cd contracts
npm install
npx hardhat node                                              # keep running in its own terminal
npx hardhat run scripts/deploy.js --network localhost
DEPOSIT_AMOUNT=500 npx hardhat run scripts/deposit-liquidity.js --network localhost

# 2. Frontend
cd ../frontend
npm install
npm run dev
```

Connect MetaMask to `http://127.0.0.1:8545` (chain ID 31337) using one of
the accounts Hardhat prints out, then open the app.

## Deploying to Monad testnet

```bash
cd contracts
# .env needs PRIVATE_KEY set to the deployer key — fund that address first
# at https://faucet.monad.xyz
npx hardhat run scripts/deploy.js --network monadTestnet
DEPOSIT_AMOUNT=5 npx hardhat run scripts/deposit-liquidity.js --network monadTestnet
```

The deploy script writes `frontend/src/contracts.json` with the live
addresses + ABIs, so the frontend picks them up automatically. Monad
testnet: chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`, explorer
`https://testnet.monadexplorer.com`.

To point the frontend at an already-deployed contract set without
redeploying (e.g. after a frontend-only change), edit the addresses in
`scripts/write-frontend-config.js` and run it with `node`.

## Frontend

React + Vite SPA (`frontend/src`). First load shows an intro/guide screen
(what Chog Bank is, a numbered walkthrough) with a "Launch App" button, then
a brief welcome transition into the app itself. A **Guide** button in the
header reopens the same explainer at any time. Main panels once connected:
My Chog NFTs (mint/borrow), My Loans (repay/gamble), Liquidity Pool
(deposit/withdraw, public to everyone), CHOG Redemption (public), and an
Admin panel (owner wallet only: NFT valuation, CHOG economics).

## Admin tasks (owner wallet only)

- `setValuation(tokenId, valueInMon)` — price a specific NFT.
- `setDefaultValuation(valueInMon)` — the fallback value anyone can claim
  once per unpriced NFT via `claimDefaultValuation` (self-serve demo path).
- `setTermRate(days, bps)` / `setRiskParams(...)` — tune LTV, gamble stake,
  win odds, bonus size.
- `setChogEconomics(profitCutBps, redemptionRateWei)` — tune how much
  profit backs the CHOG reserve and its redemption rate.
- `liquidate(tokenId)` / `sweepNft(tokenId, to)` — seize a defaulted loan's
  collateral, then dispose of it.

Valuation and CHOG-economics controls are exposed in the frontend's Admin
panel when connected as the contract owner; liquidate/sweepNft are
console/script-only for now (rare, judge-facing demo doesn't need them).

## Tests

```bash
cd contracts
npx hardhat test
```

16 tests covering LP share minting/withdraw limits, borrow/repay accounting,
both gamble outcomes, liquidation, CHOG profit routing/redemption, and the
NFT supply cap.
