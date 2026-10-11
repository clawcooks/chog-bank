const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ChogNFT", function () {
  it("caps supply at 1969", async function () {
    const [owner] = await ethers.getSigners();
    const ChogNFT = await ethers.getContractFactory("ChogNFT");
    const nft = await ChogNFT.deploy();

    expect(await nft.MAX_SUPPLY()).to.equal(1969n);

    for (let i = 0; i < 1969; i++) {
      await nft.mint(owner.address);
    }
    expect(await nft.nextTokenId()).to.equal(1969n);

    await expect(nft.mint(owner.address)).to.be.revertedWith("Chog supply exhausted");
  });
});
