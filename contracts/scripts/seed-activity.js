// Generates a handful of real borrow+gamble cycles so the CHOG reserve and
// pool have realistic non-zero numbers for judges, instead of a freshly
// deployed empty state. Run with: npx hardhat run scripts/seed-activity.js --network monadTestnet
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const contractsPath = path.join(__dirname, "..", "..", "frontend", "src", "contracts.json");
  const { addresses, abis } = JSON.parse(fs.readFileSync(contractsPath));
  const [deployer] = await ethers.getSigners();

  const nft = new ethers.Contract(addresses.ChogNFT, abis.ChogNFT, deployer);
  const bank = new ethers.Contract(addresses.ChogBank, abis.ChogBank, deployer);

  const cycles = Number(process.env.CYCLES || 5);
  const startBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`Running ${cycles} borrow+gamble cycles from ${deployer.address}`);
  console.log("Starting balance:", ethers.formatEther(startBalance), "MON");

  for (let i = 0; i < cycles; i++) {
    const mintTx = await nft.mint(deployer.address);
    const mintReceipt = await mintTx.wait();
    const tokenId = (await nft.nextTokenId()) - 1n;

    const valuation = await bank.valuations(tokenId);
    if (valuation === 0n) {
      const valueTx = await bank.claimDefaultValuation(tokenId);
      await valueTx.wait();
    }

    const approveTx = await nft.approve(addresses.ChogBank, tokenId);
    await approveTx.wait();

    const borrowTx = await bank.borrow(tokenId, 30);
    await borrowTx.wait();

    const stake = await bank.gambleStake(tokenId);
    const gambleTx = await bank.gamble(tokenId, { value: stake });
    const gambleReceipt = await gambleTx.wait();

    const ev = gambleReceipt.logs
      .map((l) => {
        try {
          return bank.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l && l.name === "GambleResult");

    console.log(`  cycle ${i + 1}: tokenId ${tokenId}, stake ${ethers.formatEther(stake)} MON, won=${ev.args.won}`);
  }

  const [poolValue, chogReserve, endBalance] = await Promise.all([
    bank.poolValue(),
    bank.chogReserve(),
    ethers.provider.getBalance(deployer.address),
  ]);
  console.log("\nDone.");
  console.log("Pool value:", ethers.formatEther(poolValue), "MON");
  console.log("CHOG reserve:", ethers.formatEther(chogReserve), "MON");
  console.log("Deployer balance:", ethers.formatEther(endBalance), "MON");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
