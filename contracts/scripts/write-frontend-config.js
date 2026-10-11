// Regenerates frontend/src/contracts.json from already-deployed addresses,
// without deploying anything. Usage: EDIT the addresses below, then:
//   npx hardhat run scripts/write-frontend-config.js
const fs = require("fs");
const path = require("path");

const addresses = {
  network: "monadTestnet",
  chainId: "10143",
  ChogNFT: "0x186fFD335Fa54d2cdfD9F19bEe67e0703124e671",
  ChogToken: "0xC98c5b652a948b08d245743d1d311d53d314b574",
  ChogBank: "0x835F29adECCfD049939a4A8F930977fF44C05d96",
};

const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
const out = {
  addresses,
  abis: {
    ChogNFT: JSON.parse(fs.readFileSync(path.join(artifactsDir, "ChogNFT.sol", "ChogNFT.json"))).abi,
    ChogToken: JSON.parse(fs.readFileSync(path.join(artifactsDir, "ChogToken.sol", "ChogToken.json"))).abi,
    ChogBank: JSON.parse(fs.readFileSync(path.join(artifactsDir, "ChogBank.sol", "ChogBank.json"))).abi,
  },
};

const frontendDir = path.join(__dirname, "..", "..", "frontend", "src");
fs.writeFileSync(path.join(frontendDir, "contracts.json"), JSON.stringify(out, null, 2));
console.log("Wrote frontend/src/contracts.json pointing at existing deployment:", addresses.ChogBank);
