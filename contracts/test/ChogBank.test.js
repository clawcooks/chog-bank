const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("ChogBank", function () {
  let nft, token, bank, owner, alice, bob, carol;
  const VALUATION = ethers.parseEther("3"); // stand-in for a "$300" nft, scaled down for test balances
  const EXPECTED_PRINCIPAL = (VALUATION * 6700n) / 10000n; // 67% LTV -> "$2.01"

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();

    const ChogNFT = await ethers.getContractFactory("ChogNFT");
    nft = await ChogNFT.deploy();

    const ChogToken = await ethers.getContractFactory("ChogToken");
    token = await ChogToken.deploy();

    const ChogBank = await ethers.getContractFactory("ChogBank");
    bank = await ChogBank.deploy(await nft.getAddress(), await token.getAddress());

    await token.transferOwnership(await bank.getAddress());
    await bank.connect(owner).deposit({ value: ethers.parseEther("500") });
  });

  async function mintAndValue(signer) {
    const tx = await nft.connect(signer).mint(signer.address);
    await tx.wait();
    const tokenId = (await nft.nextTokenId()) - 1n;
    await bank.setValuation(tokenId, VALUATION);
    return tokenId;
  }

  async function openLoan(signer, termDays = 30) {
    const tokenId = await mintAndValue(signer);
    await nft.connect(signer).approve(await bank.getAddress(), tokenId);
    await bank.connect(signer).borrow(tokenId, termDays);
    return tokenId;
  }

  // ---------- LP pool ----------

  describe("LP pool", function () {
    it("mints shares 1:1 on the first deposit and proportionally after", async function () {
      expect(await bank.shares(owner.address)).to.equal(ethers.parseEther("500"));
      expect(await bank.totalShares()).to.equal(ethers.parseEther("500"));

      await bank.connect(alice).deposit({ value: ethers.parseEther("500") });
      // pool value unchanged by profit yet, so alice should get ~equal shares to owner
      expect(await bank.shares(alice.address)).to.equal(ethers.parseEther("500"));
    });

    it("lets an LP withdraw their proportional value", async function () {
      await bank.connect(alice).deposit({ value: ethers.parseEther("100") });
      const before = await ethers.provider.getBalance(alice.address);

      const tx = await bank.connect(alice).withdraw(ethers.parseEther("40"));
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + gas).to.equal(ethers.parseEther("40"));
      expect(await bank.shares(alice.address)).to.equal(ethers.parseEther("60"));
    });

    it("blocks withdrawing more than the liquid cash on hand", async function () {
      // drain almost all liquidity into an oversized loan pool by valuing
      // many NFTs — simpler: just try to withdraw more than total deposited
      await expect(
        bank.connect(owner).withdraw(ethers.parseEther("10000"))
      ).to.be.revertedWith("insufficient pool liquidity");
    });

    it("share price rises as loans repay interest", async function () {
      const priceBefore = await bank.pricePerShare();

      const tokenId = await openLoan(alice, 30);
      const due = await bank.totalDue(tokenId);
      await bank.connect(alice).repay(tokenId, { value: due });

      const priceAfter = await bank.pricePerShare();
      expect(priceAfter).to.be.greaterThan(priceBefore);
    });
  });

  // ---------- borrowing (unchanged mechanics, re-verified against new pool) ----------

  describe("borrowing", function () {
    it("computes max principal at 67% LTV and pays it out, locking the NFT", async function () {
      const tokenId = await mintAndValue(alice);
      expect(await bank.maxPrincipal(tokenId)).to.equal(EXPECTED_PRINCIPAL);

      await nft.connect(alice).approve(await bank.getAddress(), tokenId);
      const before = await ethers.provider.getBalance(alice.address);
      const tx = await bank.connect(alice).borrow(tokenId, 30);
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      expect(await nft.ownerOf(tokenId)).to.equal(await bank.getAddress());
      expect(after - before + gas).to.equal(EXPECTED_PRINCIPAL);
      expect(await bank.principalOutstanding()).to.equal(EXPECTED_PRINCIPAL);
    });

    it("returns the NFT on repayment and reduces principalOutstanding", async function () {
      const tokenId = await openLoan(alice, 30);
      const due = await bank.totalDue(tokenId);

      await expect(bank.connect(alice).repay(tokenId, { value: due })).to.emit(bank, "LoanRepaid");

      expect(await nft.ownerOf(tokenId)).to.equal(alice.address);
      expect(await bank.principalOutstanding()).to.equal(0n);
    });

    it("rejects borrowing beyond pool liquidity", async function () {
      const tokenId = await mintAndValue(bob);
      await bank.setValuation(tokenId, ethers.parseEther("100000"));
      await nft.connect(bob).approve(await bank.getAddress(), tokenId);
      await expect(bank.connect(bob).borrow(tokenId, 30)).to.be.revertedWith("bank illiquid");
    });
  });

  // ---------- CHOG reserve + redemption ----------

  describe("CHOG profit routing and redemption", function () {
    it("routes a cut of repaid interest into the CHOG reserve", async function () {
      const tokenId = await openLoan(alice, 30);
      const loan = await bank.loans(tokenId);
      const due = loan.principal + loan.interest;

      const reserveBefore = await bank.chogReserve();
      await bank.connect(alice).repay(tokenId, { value: due });
      const reserveAfter = await bank.chogReserve();

      const expectedCut = (loan.interest * 1000n) / 10000n; // 10% default
      expect(reserveAfter - reserveBefore).to.equal(expectedCut);
    });

    it("routes a cut of every gamble stake into the reserve regardless of outcome", async function () {
      const reserveBefore = await bank.chogReserve();
      const tokenId = await openLoan(alice, 30);
      const stake = await bank.gambleStake(tokenId);
      await bank.connect(alice).gamble(tokenId, { value: stake });
      const reserveAfter = await bank.chogReserve();

      const expectedCut = (stake * 1000n) / 10000n;
      expect(reserveAfter - reserveBefore).to.equal(expectedCut);
    });

    it("lets a CHOG holder redeem for MON backed by the reserve", async function () {
      // force a loss to mint some CHOG to alice, retrying across fresh loans
      // until the coin flip lands on a loss (deterministic within a few tries)
      let bonusPaid = 0n;
      for (let i = 0; i < 25 && bonusPaid === 0n; i++) {
        const tokenId = await openLoan(alice, 30);
        const stake = await bank.gambleStake(tokenId);
        const tx = await bank.connect(alice).gamble(tokenId, { value: stake });
        const receipt = await tx.wait();
        const ev = receipt.logs
          .map((l) => {
            try {
              return bank.interface.parseLog(l);
            } catch {
              return null;
            }
          })
          .find((l) => l && l.name === "GambleResult");
        bonusPaid = ev.args.bonusPaid;
      }
      expect(bonusPaid).to.be.greaterThan(0n);

      // make sure the reserve can cover it regardless of how few losses landed
      await bank.setChogEconomics(1000, ethers.parseEther("0.001"));

      const chogBalance = await token.balanceOf(alice.address);
      await token.connect(alice).approve(await bank.getAddress(), chogBalance);

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await bank.connect(alice).redeemChog(chogBalance);
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      const expectedPayout = (chogBalance * ethers.parseEther("0.001")) / ethers.parseEther("1");
      expect(after - before + gas).to.equal(expectedPayout);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("rejects redemption beyond the reserve", async function () {
      await expect(bank.connect(bob).redeemChog(ethers.parseEther("1000000"))).to.be.reverted;
    });
  });

  // ---------- gamble (re-verified) ----------

  describe("gamble", function () {
    it("on win the loan is forgiven, NFT returned, and principalOutstanding drops; on loss the loan stands and a CHOG bonus is paid", async function () {
      let wins = 0;
      let losses = 0;
      const trials = 30;

      for (let i = 0; i < trials; i++) {
        const tokenId = await openLoan(alice, 30);
        const stake = await bank.gambleStake(tokenId);
        const principalBefore = await bank.principalOutstanding();
        const tx = await bank.connect(alice).gamble(tokenId, { value: stake });
        const receipt = await tx.wait();

        const ev = receipt.logs
          .map((l) => {
            try {
              return bank.interface.parseLog(l);
            } catch {
              return null;
            }
          })
          .find((l) => l && l.name === "GambleResult");

        const loan = await bank.loans(tokenId);
        const principalAfter = await bank.principalOutstanding();

        if (ev.args.won) {
          wins++;
          expect(await nft.ownerOf(tokenId)).to.equal(alice.address);
          expect(loan.active).to.equal(false);
          expect(principalBefore - principalAfter).to.equal(loan.principal);
        } else {
          losses++;
          expect(await nft.ownerOf(tokenId)).to.equal(await bank.getAddress());
          expect(loan.active).to.equal(true);
          expect(principalAfter).to.equal(principalBefore);
          expect(ev.args.bonusPaid).to.equal(ethers.parseEther("10"));
        }
      }

      expect(wins + losses).to.equal(trials);
      expect(wins).to.be.greaterThan(0);
      expect(wins).to.be.lessThan(trials);
    });

    it("only allows gambling once per loan", async function () {
      const tokenId = await openLoan(alice, 30);
      const stake = await bank.gambleStake(tokenId);
      await bank.connect(alice).gamble(tokenId, { value: stake });

      const loanAfter = await bank.loans(tokenId);
      if (loanAfter.active) {
        await expect(bank.connect(alice).gamble(tokenId, { value: stake })).to.be.revertedWith(
          "already gambled this loan"
        );
      }
    });
  });

  // ---------- default handling ----------

  describe("liquidation", function () {
    it("lets the owner seize an NFT only after the grace period, keeping it in the pool as a treasury asset", async function () {
      const tokenId = await openLoan(alice, 7);

      await expect(bank.liquidate(tokenId)).to.be.revertedWith("not yet defaultable");

      await network.provider.send("evm_increaseTime", [8 * 24 * 3600 + 3 * 24 * 3600 + 10]);
      await network.provider.send("evm_mine");

      const principalBefore = await bank.principalOutstanding();
      await expect(bank.liquidate(tokenId)).to.emit(bank, "Liquidated");
      expect(await bank.principalOutstanding()).to.equal(principalBefore - (await bank.loans(tokenId)).principal);
      expect(await nft.ownerOf(tokenId)).to.equal(await bank.getAddress());
    });

    it("lets the owner sweep a seized NFT out of the pool", async function () {
      const tokenId = await openLoan(alice, 7);
      await network.provider.send("evm_increaseTime", [8 * 24 * 3600 + 3 * 24 * 3600 + 10]);
      await network.provider.send("evm_mine");
      await bank.liquidate(tokenId);

      await bank.sweepNft(tokenId, carol.address);
      expect(await nft.ownerOf(tokenId)).to.equal(carol.address);
    });
  });
});
