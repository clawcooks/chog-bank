const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", network.name);

  const ChogNFT = await ethers.getContractFactory("ChogNFT");
  const nft = await ChogNFT.deploy();
  await nft.waitForDeployment();
  console.log("ChogNFT:", await nft.getAddress());

  const ChogToken = await ethers.getContractFactory("ChogToken");
  const token = await ChogToken.deploy();
  await token.waitForDeployment();
  console.log("ChogToken:", await token.getAddress());

  const ChogBank = await ethers.getContractFactory("ChogBank");
  const bank = await ChogBank.deploy(await nft.getAddress(), await token.getAddress());
  await bank.waitForDeployment();
  console.log("ChogBank:", await bank.getAddress());

  const tx = await token.transferOwnership(await bank.getAddress());
  await tx.wait();
  console.log("CHOG token ownership transferred to ChogBank (bank is now the only minter)");

  const addresses = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    ChogNFT: await nft.getAddress(),
    ChogToken: await token.getAddress(),
    ChogBank: await bank.getAddress(),
  };

  const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
  const out = {
    addresses,
    abis: {
      ChogNFT: JSON.parse(
        fs.readFileSync(path.join(artifactsDir, "ChogNFT.sol", "ChogNFT.json"))
      ).abi,
      ChogToken: JSON.parse(
        fs.readFileSync(path.join(artifactsDir, "ChogToken.sol", "ChogToken.json"))
      ).abi,
      ChogBank: JSON.parse(
        fs.readFileSync(path.join(artifactsDir, "ChogBank.sol", "ChogBank.json"))
      ).abi,
    },
  };

  const frontendDir = path.join(__dirname, "..", "..", "frontend", "src");
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.writeFileSync(
    path.join(frontendDir, "contracts.json"),
    JSON.stringify(out, null, 2)
  );
  console.log("Wrote frontend/src/contracts.json");

  console.log("\nNext: seed the LP pool with MON liquidity, e.g.:");
  console.log(
    `  DEPOSIT_AMOUNT=10 npx hardhat run scripts/deposit-liquidity.js --network ${network.name}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
