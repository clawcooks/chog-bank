const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Usage: DEPOSIT_AMOUNT=5 npx hardhat run scripts/deposit-liquidity.js --network monadTestnet
// Deposits MON into the LP pool as the deployer, minting it LP shares.
async function main() {
  const amount = process.env.DEPOSIT_AMOUNT || "2";
  const contractsPath = path.join(__dirname, "..", "..", "frontend", "src", "contracts.json");
  const { addresses, abis } = JSON.parse(fs.readFileSync(contractsPath));

  const [deployer] = await ethers.getSigners();
  const bank = new ethers.Contract(addresses.ChogBank, abis.ChogBank, deployer);

  console.log(`Depositing ${amount} MON into ChogBank at ${addresses.ChogBank} from ${deployer.address}`);
  const tx = await bank.deposit({ value: ethers.parseEther(amount) });
  await tx.wait();
  console.log("Done:", tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
