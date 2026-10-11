// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Mock Chog NFT collection for demo purposes. Anyone can mint up to
/// a fixed supply of 1969 — this stands in for the real Chog NFT collection
/// so the lending flow can be demoed end to end without depending on an
/// external contract, while still having a real supply cap.
contract ChogNFT is ERC721 {
    uint256 public constant MAX_SUPPLY = 1969;
    uint256 public nextTokenId;

    constructor() ERC721("Chog", "CHOG-NFT") {}

    function mint(address to) external returns (uint256 tokenId) {
        require(nextTokenId < MAX_SUPPLY, "Chog supply exhausted");
        tokenId = nextTokenId++;
        _mint(to, tokenId);
    }
}
