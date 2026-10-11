import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import contracts from "./contracts.json";
import { ensureChain, CHAINS } from "./chain.js";
import chogImage from "./assets/chog.jpg";
import chogBankHeroImage from "./assets/chog-bank-hero.jpg";

const TERM_LABELS = { 7: "7 days", 14: "14 days", 30: "30 days" };

function short(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

function fmt(wei, digits = 4) {
  try {
    return Number(ethers.formatEther(wei)).toFixed(digits);
  } catch {
    return "0";
  }
}

function formatError(err) {
  const raw = err?.shortMessage || err?.reason || err?.message || String(err);
  // strips noisy wrapper text like `execution reverted: "insufficient shares"`
  // down to just the contract's revert reason.
  const match = raw.match(/execution reverted:?\s*"?([^"]+?)"?\s*$/i);
  return (match ? match[1] : raw).trim();
}

function hasSeenIntro() {
  try {
    return localStorage.getItem("chogbank_seen_intro") === "1";
  } catch {
    return false;
  }
}

function markIntroSeen() {
  try {
    localStorage.setItem("chogbank_seen_intro", "1");
  } catch {
    /* ignore — per-viewer convenience only */
  }
}

export default function App() {
  const [stage, setStage] = useState(() => (hasSeenIntro() ? "app" : "intro")); // 'intro' | 'welcome' | 'app'
  const [showGuide, setShowGuide] = useState(false);

  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [status, setStatus] = useState(null); // { kind: 'info'|'error'|'success', text }
  const [busy, setBusy] = useState(false);

  const [monBalance, setMonBalance] = useState(0n);
  const [chogBalance, setChogBalance] = useState(0n);
  const [isOwner, setIsOwner] = useState(false);
  const [allowedTerms, setAllowedTerms] = useState([]);
  const [termRates, setTermRates] = useState({}); // termDays => rateBps

  const [pool, setPool] = useState(null); // {poolValue, pricePerShare, totalShares, myShares, myValue}
  const [chogEcon, setChogEcon] = useState(null); // {reserve, rateWei, profitCutBps, chogAllowance}

  const [myNfts, setMyNfts] = useState([]); // {tokenId, valuation, maxPrincipal, hasActiveLoan}
  const [myLoans, setMyLoans] = useState([]); // {tokenId, principal, interest, dueBy, termDays, active, gambled}

  const [gambleModal, setGambleModal] = useState(null); // {tokenId, flipping, won, bonusPaid}

  const targetChainId = Number(contracts.addresses.chainId);

  const { nft, token, bank } = useMemo(() => {
    if (!signer) return {};
    return {
      nft: new ethers.Contract(contracts.addresses.ChogNFT, contracts.abis.ChogNFT, signer),
      token: new ethers.Contract(contracts.addresses.ChogToken, contracts.abis.ChogToken, signer),
      bank: new ethers.Contract(contracts.addresses.ChogBank, contracts.abis.ChogBank, signer),
    };
  }, [signer]);

  const notify = (kind, text) => setStatus({ kind, text, ts: Date.now() });

  const connect = async () => {
    if (!window.ethereum) {
      notify("error", "No wallet found. Install MetaMask (or another injected wallet) first.");
      return;
    }
    try {
      setBusy(true);
      await ensureChain(window.ethereum, targetChainId);
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      const network = await browserProvider.getNetwork();
      const s = await browserProvider.getSigner();
      setProvider(browserProvider);
      setSigner(s);
      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
      notify("success", "Wallet connected.");
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccounts = (accs) => setAccount(accs[0] || null);
    const handleChain = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", handleAccounts);
    window.ethereum.on?.("chainChanged", handleChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!nft || !token || !bank || !account || !provider) return;
    try {
      const [mon, chog, owner, terms, nextId] = await Promise.all([
        provider.getBalance(account),
        token.balanceOf(account),
        bank.owner(),
        bank.getAllowedTerms(),
        nft.nextTokenId(),
      ]);
      setMonBalance(mon);
      setChogBalance(chog);
      setIsOwner(owner.toLowerCase() === account.toLowerCase());
      const termDaysList = terms.map((t) => Number(t));
      setAllowedTerms(termDaysList);

      const rates = await Promise.all(termDaysList.map((d) => bank.termRateBps(d)));
      setTermRates(Object.fromEntries(termDaysList.map((d, i) => [d, Number(rates[i])])));

      const [ltv, stakeBps] = await Promise.all([bank.maxLtvBps(), bank.gambleStakeBps()]);

      const [poolVal, pricePerShare, totalShares, myShares, myValue] = await Promise.all([
        bank.poolValue(),
        bank.pricePerShare(),
        bank.totalShares(),
        bank.shares(account),
        bank.lpPositionValue(account),
      ]);
      setPool({ poolValue: poolVal, pricePerShare, totalShares, myShares, myValue });

      const [chogReserve, chogRateWei, profitCutBps, chogAllowance] = await Promise.all([
        bank.chogReserve(),
        bank.chogRedemptionRateWei(),
        bank.profitToChogReserveBps(),
        token.allowance(account, contracts.addresses.ChogBank),
      ]);
      setChogEcon({
        reserve: chogReserve,
        rateWei: chogRateWei,
        profitCutBps: Number(profitCutBps),
        allowance: chogAllowance,
      });

      const total = Number(nextId);
      const ownedNfts = [];
      const loans = [];

      for (let id = 0; id < total; id++) {
        const [tokenOwner, valuation, loan] = await Promise.all([
          nft.ownerOf(id).catch(() => null),
          bank.valuations(id),
          bank.loans(id),
        ]);

        const isMine = tokenOwner && tokenOwner.toLowerCase() === account.toLowerCase();
        const borrowerIsMe = loan.borrower.toLowerCase() === account.toLowerCase();

        if (isMine) {
          ownedNfts.push({
            tokenId: id,
            valuation,
            maxPrincipal: (valuation * BigInt(ltv)) / 10000n,
            hasActiveLoan: loan.active && borrowerIsMe,
          });
        }

        if (loan.active && borrowerIsMe) {
          loans.push({
            tokenId: id,
            principal: loan.principal,
            interest: loan.interest,
            dueBy: Number(loan.dueBy),
            termDays: Number(loan.termDays),
            gambled: loan.gambled,
            stake: (loan.principal * BigInt(stakeBps)) / 10000n,
          });
        }
      }

      setMyNfts(ownedNfts);
      setMyLoans(loans);
    } catch (err) {
      console.error(err);
    }
  }, [nft, token, bank, account, provider]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const withBusy = (fn) => async (...args) => {
    setBusy(true);
    try {
      await fn(...args);
      await refresh();
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setBusy(false);
    }
  };

  // ethers v6 caches eth_getTransactionCount("pending") for a short window,
  // which can hand a second back-to-back tx a stale nonce right after a fast
  // confirmation (e.g. Hardhat's instant auto-mining). Fetching "latest"
  // fresh after each confirmation and passing it explicitly sidesteps that.
  const freshNonce = () => provider.getTransactionCount(account, "latest");

  const mintTestNft = withBusy(async () => {
    const tx = await nft.mint(account);
    notify("info", "Minting test Chog NFT...");
    const receipt = await tx.wait();
    const transferEvent = receipt.logs
      .map((l) => {
        try {
          return nft.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l && l.name === "Transfer");
    const tokenId = transferEvent?.args?.tokenId;

    if (tokenId !== undefined) {
      notify("info", "Pricing your new Chog...");
      const valueTx = await bank.claimDefaultValuation(tokenId, { nonce: await freshNonce() });
      await valueTx.wait();
    }
    notify("success", "Minted and priced a test Chog NFT — ready to borrow against.");
  });

  const setValuation = withBusy(async (tokenId, valueMon) => {
    const tx = await bank.setValuation(tokenId, ethers.parseEther(valueMon));
    notify("info", `Setting valuation for #${tokenId}...`);
    await tx.wait();
    notify("success", `Valuation set for #${tokenId}.`);
  });

  const depositLiquidity = withBusy(async (amountMon) => {
    const tx = await bank.deposit({ value: ethers.parseEther(amountMon) });
    notify("info", "Depositing into the pool...");
    await tx.wait();
    notify("success", "Deposited — you're now an LP earning a share of house profit.");
  });

  const withdrawLiquidity = withBusy(async (amountMon) => {
    const tx = await bank.withdraw(ethers.parseEther(amountMon));
    notify("info", "Withdrawing from the pool...");
    await tx.wait();
    notify("success", "Withdrawn.");
  });

  const redeemChog = withBusy(async (chogAmount) => {
    const amountWei = ethers.parseEther(chogAmount);
    const payout = (amountWei * chogEcon.rateWei) / ethers.parseEther("1");
    if (payout > chogEcon.reserve) {
      const maxChog = chogEcon.rateWei > 0n ? (chogEcon.reserve * ethers.parseEther("1")) / chogEcon.rateWei : 0n;
      throw new Error(`Only ${fmt(maxChog, 2)} CHOG redeemable right now — the reserve refills as more loans and gambles happen.`);
    }
    if (chogEcon.allowance < amountWei) {
      notify("info", "Approving CHOG for redemption...");
      const approveTx = await token.approve(contracts.addresses.ChogBank, amountWei);
      await approveTx.wait();
    }
    notify("info", "Redeeming CHOG...");
    const tx = await bank.redeemChog(amountWei, { nonce: await freshNonce() });
    await tx.wait();
    notify("success", "Redeemed CHOG for MON from the reserve.");
  });

  const setChogEconomics = withBusy(async (profitCutPercent, rateMon) => {
    const tx = await bank.setChogEconomics(Math.round(Number(profitCutPercent) * 100), ethers.parseEther(rateMon));
    notify("info", "Updating CHOG economics...");
    await tx.wait();
    notify("success", "CHOG economics updated.");
  });

  const borrow = withBusy(async (tokenId, termDays) => {
    const approved = await nft.getApproved(tokenId);
    let overrides = {};
    if (approved.toLowerCase() !== contracts.addresses.ChogBank.toLowerCase()) {
      notify("info", `Approving Chog Bank to hold #${tokenId}...`);
      const approveTx = await nft.approve(contracts.addresses.ChogBank, tokenId);
      await approveTx.wait();
      overrides = { nonce: await freshNonce() };
    }
    notify("info", `Borrowing against #${tokenId}...`);
    const tx = await bank.borrow(tokenId, termDays, overrides);
    await tx.wait();
    notify("success", `Loan opened for #${tokenId}.`);
  });

  const repay = withBusy(async (tokenId, due) => {
    notify("info", `Repaying loan for #${tokenId}...`);
    const tx = await bank.repay(tokenId, { value: due });
    await tx.wait();
    notify("success", `#${tokenId} repaid and returned.`);
  });

  const gamble = async (tokenId, stake) => {
    setBusy(true);
    setGambleModal({ tokenId, flipping: true });
    try {
      const tx = await bank.gamble(tokenId, { value: stake });
      notify("info", `Flipping the coin for #${tokenId}...`);
      const receipt = await tx.wait();
      const parsed = receipt.logs
        .map((l) => {
          try {
            return bank.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((l) => l && l.name === "GambleResult");

      const won = parsed?.args?.won ?? false;
      const bonusPaid = parsed?.args?.bonusPaid ?? 0n;

      setTimeout(async () => {
        setGambleModal({ tokenId, flipping: false, won, bonusPaid });
        notify(won ? "success" : "error", won ? `You won! #${tokenId} is unlocked, debt forgiven.` : `House wins. #${tokenId} stays locked — full repayment still due.`);
        await refresh();
        setBusy(false);
      }, 1400);
    } catch (err) {
      setGambleModal(null);
      notify("error", formatError(err));
      setBusy(false);
    }
  };

  const connected = Boolean(account);
  const wrongChain = connected && chainId !== targetChainId;
  const chainMeta = CHAINS[targetChainId];

  const launchApp = () => {
    markIntroSeen();
    setStage("welcome");
    setTimeout(() => setStage("app"), 1600);
  };

  if (stage === "intro") {
    return <IntroScreen onLaunch={launchApp} />;
  }

  if (stage === "welcome") {
    return <WelcomeScreen onSkip={() => setStage("app")} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-badge">CHOG</span>
          <span className="brand-name">CHOG BANK</span>
        </div>
        <div className="topbar-right">
          <button className="btn small ghost" onClick={() => setShowGuide(true)}>
            Guide
          </button>
          {!connected ? (
            <button className="btn primary" onClick={connect} disabled={busy}>
              Connect Wallet
            </button>
          ) : (
            <div className="account-pill">
              <span className={`dot ${wrongChain ? "dot-warn" : "dot-ok"}`} />
              <span>{chainMeta?.chainName || `Chain ${chainId}`}</span>
              <span className="sep">|</span>
              <span>{short(account)}</span>
            </div>
          )}
        </div>
      </header>

      {showGuide && (
        <div className="modal-overlay" onClick={() => setShowGuide(false)}>
          <div className="modal guide-modal" onClick={(e) => e.stopPropagation()}>
            <GuideContent />
            <button className="btn primary small" onClick={() => setShowGuide(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {status && (
        <div className={`toast toast-${status.kind}`} key={status.ts}>
          {status.text}
        </div>
      )}

      {!connected && (
        <section className="hero">
          <img src={chogBankHeroImage} alt="Chog Bank" className="hero-image" />
          <h1>Borrow against your Chog. Never sell it.</h1>
          <p>
            Lock a Chog NFT as collateral and borrow up to 67% of its value in MON.
            Can't pay it back? Flip a coin to walk away debt-free — lose, and you
            still owe the full balance, but you'll pocket a CHOG consolation prize.
          </p>
          <button className="btn primary lg" onClick={connect}>
            Connect Wallet to Start
          </button>
        </section>
      )}

      {connected && wrongChain && (
        <div className="banner banner-warn">
          Wrong network — connected to chain {chainId}, this app runs on {chainMeta?.chainName} ({targetChainId}).
          <button className="btn small" onClick={() => ensureChain(window.ethereum, targetChainId)}>
            Switch
          </button>
        </div>
      )}

      {connected && (
        <main className="grid">
          <section className="card stats">
            <div className="stat">
              <span className="stat-label">Pool TVL</span>
              <span className="stat-value">{pool ? fmt(pool.poolValue, 2) : "0.00"} MON</span>
            </div>
            <div className="stat">
              <span className="stat-label">Your Balance</span>
              <span className="stat-value">{fmt(monBalance, 3)} MON</span>
            </div>
            <div className="stat">
              <span className="stat-label">Your CHOG</span>
              <span className="stat-value">{fmt(chogBalance, 2)} CHOG</span>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>My Chog NFTs</h2>
              <button className="btn small" onClick={mintTestNft} disabled={busy}>
                Mint test NFT
              </button>
            </div>
            {myNfts.length === 0 && <p className="muted">No Chog NFTs yet — mint a test one above.</p>}
            <div className="nft-grid">
              {myNfts.map((n) => (
                <NftCard
                  key={n.tokenId}
                  nft={n}
                  allowedTerms={allowedTerms}
                  termRates={termRates}
                  onBorrow={borrow}
                  busy={busy}
                />
              ))}
            </div>
          </section>

          <section className="card">
            <h2>My Loans</h2>
            {myLoans.length === 0 && <p className="muted">No active loans.</p>}
            <div className="loan-list">
              {myLoans.map((l) => (
                <LoanCard key={l.tokenId} loan={l} onRepay={repay} onGamble={gamble} busy={busy} />
              ))}
            </div>
          </section>

          <LiquidityPanel pool={pool} onDeposit={depositLiquidity} onWithdraw={withdrawLiquidity} busy={busy} />

          <ChogRedemptionPanel
            chogEcon={chogEcon}
            chogBalance={chogBalance}
            onRedeem={redeemChog}
            busy={busy}
          />

          {isOwner && (
            <AdminPanel
              onSetValuation={setValuation}
              onSetChogEconomics={setChogEconomics}
              chogEcon={chogEcon}
              busy={busy}
            />
          )}
        </main>
      )}

      {gambleModal && (
        <GambleModal
          modal={gambleModal}
          onClose={() => setGambleModal(null)}
        />
      )}
    </div>
  );
}

function NftCard({ nft, allowedTerms, termRates, onBorrow, busy }) {
  const [term, setTerm] = useState(allowedTerms[0] || 30);
  const hasValuation = nft.valuation > 0n;

  const rateBps = termRates[term] ?? 0;
  const interest = (nft.maxPrincipal * BigInt(rateBps)) / 10000n;
  const totalDue = nft.maxPrincipal + interest;

  return (
    <div className="nft-card">
      <div className="nft-id">Chog #{nft.tokenId}</div>
      {!hasValuation && <div className="muted small">Not valued yet — ask the admin to set a valuation.</div>}
      {hasValuation && (
        <>
          <div className="row">
            <span>Valuation</span>
            <span>{fmt(nft.valuation, 2)} MON</span>
          </div>
          <div className="row">
            <span>Max loan (67%)</span>
            <span>{fmt(nft.maxPrincipal, 2)} MON</span>
          </div>
          {nft.hasActiveLoan ? (
            <div className="badge locked">Locked — loan active</div>
          ) : (
            <>
              <div className="borrow-row">
                <select value={term} onChange={(e) => setTerm(Number(e.target.value))}>
                  {allowedTerms.map((t) => (
                    <option key={t} value={t}>
                      {TERM_LABELS[t] || `${t} days`} — {(termRates[t] ?? 0) / 100}% interest
                    </option>
                  ))}
                </select>
                <button className="btn primary small" disabled={busy} onClick={() => onBorrow(nft.tokenId, term)}>
                  Borrow
                </button>
              </div>
              <div className="row small-print">
                <span>Interest ({rateBps / 100}%)</span>
                <span>{fmt(interest, 3)} MON</span>
              </div>
              <div className="row small-print strong">
                <span>To redeem</span>
                <span>{fmt(totalDue, 3)} MON</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function LoanCard({ loan, onRepay, onGamble, busy }) {
  const due = loan.principal + loan.interest;
  const dueDate = new Date(loan.dueBy * 1000);
  const overdue = Date.now() > loan.dueBy * 1000;

  return (
    <div className="loan-card">
      <div className="loan-head">
        <span>Chog #{loan.tokenId}</span>
        <span className={`badge ${overdue ? "warn" : "ok"}`}>{overdue ? "Overdue" : `Due ${TERM_LABELS[loan.termDays] || loan.termDays + "d"}`}</span>
      </div>
      <div className="row">
        <span>Principal</span>
        <span>{fmt(loan.principal, 3)} MON</span>
      </div>
      <div className="row">
        <span>Interest</span>
        <span>{fmt(loan.interest, 3)} MON</span>
      </div>
      <div className="row strong">
        <span>Total due</span>
        <span>{fmt(due, 3)} MON</span>
      </div>
      <div className="row">
        <span>Due by</span>
        <span>{dueDate.toLocaleDateString()}</span>
      </div>
      <div className="loan-actions">
        <button className="btn primary small" disabled={busy} onClick={() => onRepay(loan.tokenId, due)}>
          Repay {fmt(due, 2)} MON
        </button>
        <button
          className="btn gamble small"
          disabled={busy || loan.gambled}
          title={loan.gambled ? "Already gambled on this loan" : `Stake ${fmt(loan.stake, 2)} MON for a chance to walk away debt-free`}
          onClick={() => onGamble(loan.tokenId, loan.stake)}
        >
          {loan.gambled ? "Gamble used" : `Gamble (${fmt(loan.stake, 2)} MON)`}
        </button>
      </div>
    </div>
  );
}

function LiquidityPanel({ pool, onDeposit, onWithdraw, busy }) {
  const [depositAmount, setDepositAmount] = useState("10");
  const [withdrawAmount, setWithdrawAmount] = useState("5");

  return (
    <section className="card">
      <h2>Liquidity Pool</h2>
      <p className="muted small">
        Deposit MON and become the house — you earn a share of every loan's interest and every
        gamble's house edge as the pool's share price rises.
      </p>
      {pool && (
        <>
          <div className="row">
            <span>Price per share</span>
            <span>{fmt(pool.pricePerShare, 4)} MON</span>
          </div>
          <div className="row">
            <span>Your shares</span>
            <span>{fmt(pool.myShares, 4)}</span>
          </div>
          <div className="row strong">
            <span>Your pool value</span>
            <span>{fmt(pool.myValue, 4)} MON</span>
          </div>
        </>
      )}
      <div className="admin-row">
        <label>Deposit</label>
        <input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="MON" />
        <button className="btn primary small" disabled={busy} onClick={() => onDeposit(depositAmount)}>
          Deposit
        </button>
      </div>
      <div className="admin-row">
        <label>Withdraw</label>
        <input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="MON" />
        <button className="btn small" disabled={busy} onClick={() => onWithdraw(withdrawAmount)}>
          Withdraw
        </button>
      </div>
    </section>
  );
}

function ChogRedemptionPanel({ chogEcon, chogBalance, onRedeem, busy }) {
  const [redeemAmount, setRedeemAmount] = useState("10");

  return (
    <section className="card">
      <h2>CHOG Redemption</h2>
      <p className="muted small">
        CHOG earned as a gamble consolation prize is backed by a reserve funded from house profit —
        burn it here for a guaranteed MON payout.
      </p>
      {chogEcon && (
        <>
          <div className="row">
            <span>Redemption rate</span>
            <span>{fmt(chogEcon.rateWei, 4)} MON / CHOG</span>
          </div>
          <div className="row">
            <span>Reserve available</span>
            <span>{fmt(chogEcon.reserve, 4)} MON</span>
          </div>
          <div className="row">
            <span>Your CHOG</span>
            <span>{fmt(chogBalance, 2)}</span>
          </div>
          <div className="row strong">
            <span>Max redeemable now</span>
            <span>
              {chogEcon.rateWei > 0n
                ? fmt((chogEcon.reserve * ethers.parseEther("1")) / chogEcon.rateWei, 2)
                : "0.00"}{" "}
              CHOG
            </span>
          </div>
        </>
      )}
      <div className="admin-row">
        <label>Redeem</label>
        <input type="number" value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)} placeholder="CHOG" />
        <button className="btn primary small" disabled={busy} onClick={() => onRedeem(redeemAmount)}>
          Redeem
        </button>
      </div>
    </section>
  );
}

function AdminPanel({ onSetValuation, onSetChogEconomics, chogEcon, busy }) {
  const [valTokenId, setValTokenId] = useState("0");
  const [valAmount, setValAmount] = useState("3");
  const [profitCut, setProfitCut] = useState(chogEcon ? (chogEcon.profitCutBps / 100).toString() : "10");
  const [redemptionRate, setRedemptionRate] = useState(chogEcon ? ethers.formatEther(chogEcon.rateWei) : "0.02");

  return (
    <section className="card admin">
      <h2>Admin</h2>
      <div className="admin-row">
        <label>Set NFT valuation</label>
        <input type="number" value={valTokenId} onChange={(e) => setValTokenId(e.target.value)} placeholder="tokenId" />
        <input type="number" value={valAmount} onChange={(e) => setValAmount(e.target.value)} placeholder="value in MON" />
        <button className="btn small" disabled={busy} onClick={() => onSetValuation(valTokenId, valAmount)}>
          Set
        </button>
      </div>
      <div className="admin-row">
        <label>Profit to CHOG reserve</label>
        <input type="number" value={profitCut} onChange={(e) => setProfitCut(e.target.value)} placeholder="%" />
        <label className="inline-unit">%</label>
        <input type="number" value={redemptionRate} onChange={(e) => setRedemptionRate(e.target.value)} placeholder="MON per CHOG" />
        <button className="btn small" disabled={busy} onClick={() => onSetChogEconomics(profitCut, redemptionRate)}>
          Set
        </button>
      </div>
    </section>
  );
}

function GuideContent() {
  return (
    <div className="guide-content">
      <h2>What is Chog Bank?</h2>
      <p>
        Chog Bank lets you borrow MON against your Chog NFT instead of selling it. Can't repay?
        Flip a coin — win and your debt is forgiven outright, lose and you still owe the full
        balance, but you walk away with a CHOG consolation bonus. Anyone can become the house too
        — deposit MON into the pool and earn a cut of every loan's interest and every gamble's
        house edge.
      </p>
      <h3>How to try it</h3>
      <ol className="guide-steps">
        <li>Connect a wallet on Monad Testnet (chain 10143) — MetaMask will prompt to add/switch it.</li>
        <li>Mint a test Chog NFT. It's auto-priced instantly — no waiting on an admin.</li>
        <li>Borrow against it: pick a term and watch the interest and payoff update live.</li>
        <li>Settle the loan — repay in full, or gamble half the principal for a shot at full debt forgiveness.</li>
        <li>Lost the gamble? Redeem your CHOG bonus for MON, backed by a real protocol reserve.</li>
        <li>Deposit MON into the Liquidity Pool to become the house yourself and earn from every loan and gamble.</li>
      </ol>
      <p className="muted small">
        Heads up: this is a hackathon build on Monad testnet. The coin flip uses on-chain
        pseudo-randomness — fine for a demo, not for real funds — and the Chog NFT collection here
        is a free-mint stand-in (capped at 1969) for the real one.
      </p>
    </div>
  );
}

function IntroScreen({ onLaunch }) {
  return (
    <div className="app intro-screen">
      <img src={chogImage} alt="Chog" className="intro-chog-image" />
      <div className="brand intro-brand">
        <span className="brand-badge">CHOG</span>
        <span className="brand-name">CHOG BANK</span>
      </div>
      <div className="intro-card">
        <GuideContent />
        <button className="btn primary lg" onClick={onLaunch}>
          Launch App →
        </button>
      </div>
    </div>
  );
}

function WelcomeScreen({ onSkip }) {
  return (
    <div className="app welcome-screen" onClick={onSkip}>
      <img src={chogImage} alt="Chog" className="welcome-chog-image" />
      <h1>Welcome to Chog Bank</h1>
      <p className="muted">Let's get started...</p>
    </div>
  );
}

function GambleModal({ modal, onClose }) {
  const { flipping, won, bonusPaid, tokenId } = modal;
  return (
    <div className="modal-overlay" onClick={!flipping ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className={`coin ${flipping ? "flipping" : won ? "coin-win" : "coin-lose"}`}>
          {!flipping && (won ? "WIN" : "LOSE")}
        </div>
        {flipping && <p>Flipping for Chog #{tokenId}...</p>}
        {!flipping && won && (
          <>
            <h3>You won!</h3>
            <p>Debt forgiven — Chog #{tokenId} is back in your wallet.</p>
          </>
        )}
        {!flipping && !won && (
          <>
            <h3>House wins.</h3>
            <p>
              Chog #{tokenId} stays locked, full repayment is still due.
              {bonusPaid > 0n && <> You received {fmt(bonusPaid, 2)} CHOG as a consolation bonus.</>}
            </p>
          </>
        )}
        {!flipping && (
          <button className="btn primary small" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
