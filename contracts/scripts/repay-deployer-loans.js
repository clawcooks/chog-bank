// Repays any active loans still owned by the deployer, returning principal
// + interest to the pool's liquid cash. Used to undo a liquidity crunch
// caused by seed-activity.js leaving too much principal "outstanding".
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const contractsPath = path.join(__dirname, "..", "..", "frontend", "src", "contracts.json");
  const { addresses, abis } = JSON.parse(fs.readFileSync(contractsPath));
  const [deployer] = await ethers.getSigners();

  const nft = new ethers.Contract(addresses.ChogNFT, abis.ChogNFT, deployer);
  const bank = new ethers.Contract(addresses.ChogBank, abis.ChogBank, deployer);

  const nextId = await nft.nextTokenId();
  console.log(`Scanning ${nextId} tokens for active loans owned by ${deployer.address}...`);

  for (let id = 0; id < Number(nextId); id++) {
    const loan = await bank.loans(id);
    if (loan.active && loan.borrower.toLowerCase() === deployer.address.toLowerCase()) {
      const due = loan.principal + loan.interest;
      console.log(`  repaying tokenId ${id}: ${ethers.formatEther(due)} MON`);
      const tx = await bank.repay(id, { value: due });
      await tx.wait();
    }
  }

  const [poolValue, bal, chogReserve, principalOut] = await Promise.all([
    bank.poolValue(),
    ethers.provider.getBalance(addresses.ChogBank),
    bank.chogReserve(),
    bank.principalOutstanding(),
  ]);
  console.log("\nDone.");
  console.log("Pool value:", ethers.formatEther(poolValue), "MON");
  console.log("Cash on hand:", ethers.formatEther(bal - chogReserve), "MON");
  console.log("Principal outstanding:", ethers.formatEther(principalOut), "MON");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
