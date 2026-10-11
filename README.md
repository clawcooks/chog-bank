# Chog Bank

Borrow MON against a Chog NFT instead of selling it — and if you can't pay it
back, flip a coin for a chance to walk away debt-free.

## How it works

1. **Collateralize.** Lock a Chog NFT the admin has valued (e.g. "$300").
   Borrow up to **67% LTV** (e.g. 200) in native MON.
2. **Interest accrues** by term: 7 days = 3%, 14 days = 5%, 30 days = 8%
   (flat, admin-configurable). On a 200 principal / 30-day loan that's 16
   interest, so 216 to redeem the NFT.
3. **Repay normally**, or **gamble**: stake 50% of the principal (100) on a
   coin flip.
   - **Win (30% chance):** debt forgiven, NFT returned immediately.
   - **Lose (70% chance):** loan stands exactly as before — you still owe
     the full 216 later — but you get a 10 CHOG consolation bonus. The
     stake is kept by the house either way; gambling is a one-shot option
     per loan.
4. **Default:** if the loan isn't repaid within a grace period after the due
   date, the admin can seize the NFT.

### Why the house always wins on average

Per gamble attempt (using the $300 / $200 / $250-due example from the brief):

| Outcome | Probability | House nets |
|---|---|---|
| Win | 30% | +100 stake − 250 forgiven debt = **−150** |
| Lose | 70% | +100 stake + 250 collected later (−~10 in token cost) = **+340** |

Expected value to the house per gamble ≈ `0.3 × (−150) + 0.7 × (340) ≈ +193`,
comfortably positive — and that's *in addition to* the loans the house
collects interest on and the LTV haircut that protects it if an NFT's value
falls. The 30/70 split and 67% LTV are both admin-configurable
(`setRiskParams`).

## Project layout

```
contracts/    Solidity contracts, Hardhat tests, deploy scripts
frontend/     React + Vite + ethers.js UI
```

## Contracts

- `ChogNFT.sol` — mock ERC721, anyone can mint (stands in for the real Chog
  collection for demo purposes).
- `ChogToken.sol` — mock ERC20, mintable only by the bank (bonus payouts).
- `ChogBank.sol` — core lending/gambling logic. Owner sets NFT valuations
  and risk parameters; `borrow`, `repay`, `gamble`, `liquidate` are the main
  user/admin entry points.

**Security note:** the coin flip uses on-chain pseudo-randomness
(blockhash/timestamp based) — fine for a hackathon demo, *not* safe against
a validator/searcher in production. A real deployment should swap `_flip()`
for a verifiable randomness source (Chainlink VRF or Monad's equivalent)
before handling real value. This is called out in the contract's NatSpec too.

## Running locally

```bash
# 1. Contracts — start a local chain, deploy, fund it
cd contracts
npm install
npx hardhat node                                    # keep running in its own terminal
npx hardhat run scripts/deploy.js --network localhost
FUND_AMOUNT=500 npx hardhat run scripts/fund-bank.js --network localhost

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
# .env already has PRIVATE_KEY set to the deployer key — fund that address
# first at https://faucet.monad.xyz
npx hardhat run scripts/deploy.js --network monadTestnet
FUND_AMOUNT=5 npx hardhat run scripts/fund-bank.js --network monadTestnet
```

The deploy script writes `frontend/src/contracts.json` with the live
addresses + ABIs, so the frontend picks them up automatically. Monad
testnet: chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`, explorer
`https://testnet.monadexplorer.com`.

## Admin tasks (owner wallet only)

- `setValuation(tokenId, valueInMon)` — price an NFT before it can be used
  as collateral.
- `setTermRate(days, bps)` / `setRiskParams(...)` — tune LTV, gamble stake,
  win odds, bonus size.
- `fundBank()` / `withdrawBank(amount)` — manage house liquidity.
- `liquidate(tokenId)` — seize collateral on a defaulted, overdue loan.

All of these are exposed in the frontend's Admin panel when connected as
the contract owner.
