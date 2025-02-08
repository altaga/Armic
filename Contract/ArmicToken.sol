//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";  // OpenZeppelin package contains implementation of the ERC 20 standard, which our NFT smart contract will inherit

contract ArmicToken is ERC20 {
    uint constant _initial_supply = 100_000_000_000 * (10**18);  // setting variable for how many of your own tokens are initially put into your wallet, feel free to edit the first number but make sure to leave the second number because we want to make sure our supply has 18 decimals

    constructor() ERC20("Armic", "ARM") {
        _mint(msg.sender, _initial_supply);
    }

}