// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Mock CHOG token used to pay the "better luck next time" bonus
/// when a borrower loses the pay-back gamble. Ownership is transferred to
/// ChogBank after deployment so only the bank can mint bonuses. Burnable so
/// the bank can retire CHOG redeemed against its profit-funded reserve.
contract ChogToken is ERC20, ERC20Burnable, Ownable {
    constructor() ERC20("Chog Token", "CHOG") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
