// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ChogToken.sol";

/// @title ChogBank
/// @notice Lets a Chog NFT holder borrow native MON against their NFT instead
/// of selling it, and offers an optional coin-flip gamble as an alternative
/// way to pay back the loan. The odds and loan terms are tuned so the house
/// is +EV on every path — see README for the expected-value walkthrough.
///
/// The house itself is a share-based liquidity pool: anyone can deposit MON
/// and become an LP, earning a cut of every loan's interest and every
/// gamble's house edge as the pool's share price rises. A slice of that same
/// profit funds a CHOG redemption reserve, so the token handed out as a
/// gamble consolation prize has a real, protocol-backed floor price instead
/// of being a one-way mint with no sink.
///
/// SECURITY NOTE: the coin flip uses on-chain pseudo-randomness
/// (blockhash/timestamp based). That is NOT safe against a validator or
/// searcher who can see the outcome before it lands and is only acceptable
/// here because this is a hackathon demo. A production deployment must
/// replace _flip() with a verifiable randomness source (e.g. Chainlink VRF
/// or Monad's equivalent) before handling real value.
contract ChogBank is Ownable {
    struct Loan {
        address borrower;
        uint256 principal; // MON lent out, in wei
        uint256 interest; // MON owed on top of principal, in wei
        uint256 startTime;
        uint256 dueBy;
        uint16 termDays;
        bool active; // NFT is locked and debt is unsettled
        bool gambled; // the one-shot gamble has been used for this loan
    }

    IERC721 public immutable nft;
    ChogToken public immutable chogToken;

    /// @dev max loan as a fraction of the admin-set valuation, in bps (6700 = 67%)
    uint16 public maxLtvBps = 6700;
    /// @dev size of the gamble stake as a fraction of principal, in bps (5000 = 50%)
    uint16 public gambleStakeBps = 5000;
    /// @dev borrower's win chance, in bps (3000 = 30%, house keeps 70%)
    uint16 public winChanceBps = 3000;
    /// @dev CHOG tokens minted to the borrower as a consolation prize on a loss
    uint256 public lossBonusAmount = 10 ether;
    /// @dev grace period after dueBy before the house can seize a defaulted NFT
    uint256 public gracePeriod = 3 days;

    mapping(uint256 => uint256) public valuations; // tokenId => value in wei, admin-set
    mapping(uint16 => uint16) public termRateBps; // termDays => flat interest rate in bps
    uint16[] public allowedTerms;
    mapping(uint256 => Loan) public loans; // tokenId => loan

    /// @dev fallback valuation anyone can claim once for an unpriced NFT, so a
    /// freshly minted demo NFT is immediately usable without waiting on the
    /// admin. The admin can still override any tokenId with setValuation.
    uint256 public defaultValuation = 3 ether;

    uint256 private _nonce;

    // ---------- LP pool (the "house") ----------

    uint256 public totalShares;
    mapping(address => uint256) public shares;
    /// @dev principal currently lent out across all active loans — counted as
    /// part of pool value even though it isn't sitting in the contract's
    /// balance, since it's an IOU owed back to the pool.
    uint256 public principalOutstanding;

    // ---------- CHOG redemption reserve ----------

    /// @dev MON set aside to back CHOG redemptions, funded from a cut of
    /// every profit event. Kept separate from LP-visible pool value.
    uint256 public chogReserve;
    /// @dev share of every profit event (interest, gamble stake) routed to
    /// the CHOG reserve instead of the LP pool, in bps.
    uint16 public profitToChogReserveBps = 1000; // 10%
    /// @dev MON paid out per whole CHOG redeemed, admin-set.
    uint256 public chogRedemptionRateWei = 0.02 ether;

    event ValuationSet(uint256 indexed tokenId, uint256 value);
    event TermConfigured(uint16 termDays, uint16 rateBps);
    event LoanOpened(uint256 indexed tokenId, address indexed borrower, uint256 principal, uint256 interest, uint16 termDays, uint256 dueBy);
    event LoanRepaid(uint256 indexed tokenId, address indexed borrower, uint256 amountPaid);
    event GambleResult(uint256 indexed tokenId, address indexed borrower, bool won, uint256 stake, uint256 bonusPaid);
    event Liquidated(uint256 indexed tokenId, address indexed borrower);
    event NftSwept(uint256 indexed tokenId, address indexed to);

    event Deposited(address indexed lp, uint256 monIn, uint256 sharesMinted);
    event Withdrawn(address indexed lp, uint256 sharesBurned, uint256 monOut);
    event ProfitRouted(uint256 toChogReserve, uint256 toPool);
    event ChogRedeemed(address indexed holder, uint256 chogIn, uint256 monOut);

    constructor(address nftAddress, address chogTokenAddress) Ownable(msg.sender) {
        nft = IERC721(nftAddress);
        chogToken = ChogToken(chogTokenAddress);

        termRateBps[7] = 300; // 3%
        termRateBps[14] = 500; // 5%
        termRateBps[30] = 800; // 8%
        allowedTerms.push(7);
        allowedTerms.push(14);
        allowedTerms.push(30);
    }

    // ---------- admin ----------

    function setValuation(uint256 tokenId, uint256 value) external onlyOwner {
        valuations[tokenId] = value;
        emit ValuationSet(tokenId, value);
    }

    function setDefaultValuation(uint256 value) external onlyOwner {
        defaultValuation = value;
    }

    /// @notice Anyone can claim the default valuation for an unpriced NFT
    /// once, so a self-minted demo NFT is instantly usable as collateral.
    function claimDefaultValuation(uint256 tokenId) external {
        require(valuations[tokenId] == 0, "already valued");
        valuations[tokenId] = defaultValuation;
        emit ValuationSet(tokenId, defaultValuation);
    }

    function setTermRate(uint16 termDays, uint16 rateBps) external onlyOwner {
        if (termRateBps[termDays] == 0) {
            allowedTerms.push(termDays);
        }
        termRateBps[termDays] = rateBps;
        emit TermConfigured(termDays, rateBps);
    }

    function setRiskParams(uint16 _maxLtvBps, uint16 _gambleStakeBps, uint16 _winChanceBps, uint256 _lossBonusAmount) external onlyOwner {
        require(_maxLtvBps <= 10000 && _gambleStakeBps <= 10000 && _winChanceBps <= 10000, "bps out of range");
        maxLtvBps = _maxLtvBps;
        gambleStakeBps = _gambleStakeBps;
        winChanceBps = _winChanceBps;
        lossBonusAmount = _lossBonusAmount;
    }

    function setChogEconomics(uint16 _profitToChogReserveBps, uint256 _chogRedemptionRateWei) external onlyOwner {
        require(_profitToChogReserveBps <= 10000, "bps out of range");
        profitToChogReserveBps = _profitToChogReserveBps;
        chogRedemptionRateWei = _chogRedemptionRateWei;
    }

    function getAllowedTerms() external view returns (uint16[] memory) {
        return allowedTerms;
    }

    /// @notice Lets the owner dispose of an NFT seized via liquidate() —
    /// e.g. sell it elsewhere and manually deposit() the proceeds back into
    /// the pool. On-chain auctioning is a roadmap item, not built here.
    function sweepNft(uint256 tokenId, address to) external onlyOwner {
        nft.transferFrom(address(this), to, tokenId);
        emit NftSwept(tokenId, to);
    }

    // ---------- LP pool ----------

    /// @notice Total value of the pool: liquid MON cash (excluding the CHOG
    /// reserve, which is earmarked separately) plus principal currently out
    /// on loan, which is owed back to the pool.
    function poolValue() public view returns (uint256) {
        return (address(this).balance - chogReserve) + principalOutstanding;
    }

    function pricePerShare() public view returns (uint256) {
        if (totalShares == 0) return 1 ether;
        return (poolValue() * 1 ether) / totalShares;
    }

    function lpPositionValue(address lp) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares[lp] * poolValue()) / totalShares;
    }

    /// @notice Become an LP — the house. Your MON joins the pool that funds
    /// loans, and your share of the pool grows with every loan's interest
    /// and every gamble's house edge.
    function deposit() external payable returns (uint256 mintedShares) {
        require(msg.value > 0, "zero deposit");
        uint256 valueBeforeDeposit = poolValue() - msg.value;

        if (totalShares == 0 || valueBeforeDeposit == 0) {
            mintedShares = msg.value;
        } else {
            mintedShares = (msg.value * totalShares) / valueBeforeDeposit;
        }

        shares[msg.sender] += mintedShares;
        totalShares += mintedShares;
        emit Deposited(msg.sender, msg.value, mintedShares);
    }

    /// @notice Withdraw up to `monAmount` of your pool value. Limited by
    /// liquid cash on hand — if too much of the pool is out on active loans,
    /// withdraw a smaller amount or wait for loans to be repaid.
    function withdraw(uint256 monAmount) external returns (uint256 burnedShares) {
        require(monAmount > 0, "zero amount");
        uint256 cash = address(this).balance - chogReserve;
        require(monAmount <= cash, "insufficient pool liquidity");

        burnedShares = (monAmount * totalShares) / poolValue();
        require(burnedShares > 0 && shares[msg.sender] >= burnedShares, "insufficient shares");

        shares[msg.sender] -= burnedShares;
        totalShares -= burnedShares;

        (bool ok, ) = msg.sender.call{value: monAmount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(msg.sender, burnedShares, monAmount);
    }

    /// @dev Splits a profit event (interest collected, gamble stake kept)
    /// between the CHOG redemption reserve and the LP pool. The pool's cut
    /// needs no bookkeeping — it's already sitting in the contract's balance
    /// and poolValue() picks it up automatically.
    function _routeProfit(uint256 amount) internal {
        uint256 toReserve = (amount * profitToChogReserveBps) / 10000;
        chogReserve += toReserve;
        emit ProfitRouted(toReserve, amount - toReserve);
    }

    // ---------- CHOG redemption ----------

    /// @notice Burn CHOG for a guaranteed MON payout, backed by the reserve
    /// funded from protocol profit. Requires approving this contract first.
    function redeemChog(uint256 chogAmount) external returns (uint256 payout) {
        require(chogAmount > 0, "zero amount");
        payout = (chogAmount * chogRedemptionRateWei) / 1 ether;
        require(payout > 0, "amount too small");
        require(payout <= chogReserve, "redemption reserve depleted");

        chogReserve -= payout;
        chogToken.burnFrom(msg.sender, chogAmount);

        (bool ok, ) = msg.sender.call{value: payout}("");
        require(ok, "redeem payout failed");
        emit ChogRedeemed(msg.sender, chogAmount, payout);
    }

    // ---------- borrowing ----------

    function maxPrincipal(uint256 tokenId) public view returns (uint256) {
        return (valuations[tokenId] * maxLtvBps) / 10000;
    }

    function totalDue(uint256 tokenId) public view returns (uint256) {
        Loan storage l = loans[tokenId];
        return l.principal + l.interest;
    }

    function borrow(uint256 tokenId, uint16 termDays) external {
        require(valuations[tokenId] > 0, "nft not valued");
        require(!loans[tokenId].active, "loan already open");
        require(termRateBps[termDays] > 0, "term not offered");
        require(nft.ownerOf(tokenId) == msg.sender, "not nft owner");

        uint256 principal = maxPrincipal(tokenId);
        require(principal > 0, "zero valuation");
        require(address(this).balance - chogReserve >= principal, "bank illiquid");

        uint256 interest = (principal * termRateBps[termDays]) / 10000;
        uint256 dueBy = block.timestamp + uint256(termDays) * 1 days;

        loans[tokenId] = Loan({
            borrower: msg.sender,
            principal: principal,
            interest: interest,
            startTime: block.timestamp,
            dueBy: dueBy,
            termDays: termDays,
            active: true,
            gambled: false
        });

        principalOutstanding += principal;
        nft.transferFrom(msg.sender, address(this), tokenId);

        (bool ok, ) = msg.sender.call{value: principal}("");
        require(ok, "payout failed");

        emit LoanOpened(tokenId, msg.sender, principal, interest, termDays, dueBy);
    }

    function repay(uint256 tokenId) external payable {
        Loan storage l = loans[tokenId];
        require(l.active, "no active loan");
        require(l.borrower == msg.sender, "not borrower");

        uint256 due = l.principal + l.interest;
        require(msg.value >= due, "insufficient payment");

        l.active = false;
        principalOutstanding -= l.principal;
        _routeProfit(l.interest);

        if (msg.value > due) {
            (bool refundOk, ) = msg.sender.call{value: msg.value - due}("");
            require(refundOk, "refund failed");
        }

        nft.transferFrom(address(this), msg.sender, tokenId);
        emit LoanRepaid(tokenId, msg.sender, due);
    }

    // ---------- gamble ----------

    function gambleStake(uint256 tokenId) public view returns (uint256) {
        return (loans[tokenId].principal * gambleStakeBps) / 10000;
    }

    /// @notice Stake half the loan principal on a coin flip. Win: debt is
    /// forgiven and the NFT is returned immediately — the pool absorbs the
    /// loss of the unrecovered principal. Lose: the loan stays exactly as it
    /// was — full principal + interest is still owed to redeem the NFT —
    /// plus a CHOG token consolation bonus. Either way the stake is kept by
    /// the house (split between the LP pool and the CHOG reserve); this is a
    /// one-shot option per loan.
    function gamble(uint256 tokenId) external payable {
        Loan storage l = loans[tokenId];
        require(l.active, "no active loan");
        require(l.borrower == msg.sender, "not borrower");
        require(!l.gambled, "already gambled this loan");

        uint256 stake = gambleStake(tokenId);
        require(msg.value >= stake, "insufficient stake");

        l.gambled = true;
        _routeProfit(stake);

        if (msg.value > stake) {
            (bool refundOk, ) = msg.sender.call{value: msg.value - stake}("");
            require(refundOk, "refund failed");
        }

        bool won = _flip(tokenId);
        uint256 bonusPaid;

        if (won) {
            l.active = false;
            principalOutstanding -= l.principal;
            nft.transferFrom(address(this), msg.sender, tokenId);
        } else {
            bonusPaid = lossBonusAmount;
            chogToken.mint(msg.sender, bonusPaid);
        }

        emit GambleResult(tokenId, msg.sender, won, stake, bonusPaid);
    }

    /// @dev NOT cryptographically secure randomness — see contract-level
    /// SECURITY NOTE. Fine for a hackathon demo, not for mainnet value.
    function _flip(uint256 salt) internal returns (bool) {
        _nonce++;
        uint256 rand = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, salt, _nonce, msg.sender))
        ) % 10000;
        return rand < winChanceBps;
    }

    // ---------- default handling ----------

    function liquidate(uint256 tokenId) external onlyOwner {
        Loan storage l = loans[tokenId];
        require(l.active, "no active loan");
        require(block.timestamp > l.dueBy + gracePeriod, "not yet defaultable");

        l.active = false;
        principalOutstanding -= l.principal;
        // NFT already sits in this contract from borrow() — it simply
        // becomes a seized treasury asset until sweepNft() disposes of it.
        emit Liquidated(tokenId, l.borrower);
    }
}
