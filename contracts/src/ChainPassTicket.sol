// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/// @title ChainPassTicket
/// @notice Soulbound ERC-721 transit ticket: gated mint, role-gated burn, indexable events.
/// @dev On-chain burn checks: expiry, route, and owner must match `expectedHolder` (from signed QR). QR/HMAC stays off-chain.
///      Token IDs are pseudo-random uint256 values (not sequential); not unpredictable RNG—do not rely on them for secrecy.
contract ChainPassTicket is ERC721Enumerable, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @dev Increments each allocation attempt so successive mints yield distinct candidate IDs.
    uint256 private _mintNonce;

    /// @dev Once set, an ID is never reused (covers burned tickets).
    mapping(uint256 tokenId => bool) private _tokenIdUsed;

    uint256 private constant _MAX_MINT_ATTEMPTS = 256;

    string private _baseTokenURI;

    /// @notice Receives native MON from `purchaseTicket` (Monad testnet).
    address payable public immutable treasury;

    /// @notice Lifetime count of successful mints (including still-held and burned tokens). Cheap ops dashboard read.
    uint256 public totalMinted;

    /// @notice Lifetime count of successful `burnTicket` calls.
    uint256 public totalBurned;

    /// @notice Default minimum wei for `purchaseTicket` when `routeMintPriceWei[routeId]` is unset (0).
    uint256 public mintPriceWei;

    /// @notice Per-route override for `purchaseTicket`. If 0, `mintPriceWei` applies for that route.
    mapping(uint256 routeId => uint256) public routeMintPriceWei;

    mapping(uint256 tokenId => uint256) public routeOf;
    mapping(uint256 tokenId => uint64) public validUntil;
    mapping(uint256 tokenId => address) public operatorOf;

    error SoulboundTransfer();
    error TicketExpired(uint256 tokenId, uint64 validUntilEpoch, uint256 nowTimestamp);
    error RouteMismatch(uint256 tokenId, uint256 expectedRouteId, uint256 actualRouteId);
    error HolderMismatch(uint256 tokenId, address expectedHolder, address actualOwner);
    error InsufficientPayment(uint256 sent, uint256 required);
    error TreasuryTransferFailed();
    error TokenIdAllocationFailed();

    event TicketMinted(
        address indexed to, uint256 indexed tokenId, uint256 routeId, uint64 validUntilEpoch, address operatorAddr
    );

    event TicketBurned(address indexed from, uint256 indexed tokenId, uint256 routeId);

    event RoutePriceSet(uint256 indexed routeId, uint256 weiAmount);

    /// @param baseURI_ Base URI for {tokenURI}; concatenated with decimal `tokenId` (Option A). Use empty string if unset.
    /// @param treasury_ Receives native MON from ticket purchases.
    /// @param mintPriceWei_ Default price for `purchaseTicket` when no per-route price is set (wei); use 0 for testnets.
    constructor(address admin, string memory baseURI_, address payable treasury_, uint256 mintPriceWei_)
        ERC721("ChainPass Ticket", "PASS")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _baseTokenURI = baseURI_;
        treasury = treasury_;
        mintPriceWei = mintPriceWei_;
    }

    /// @notice Update default price for `purchaseTicket` when `routeMintPriceWei[routeId]` is 0 (admin only).
    function setMintPriceWei(uint256 newPriceWei) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintPriceWei = newPriceWei;
    }

    /// @notice Set minimum wei for `purchaseTicket` for a specific route. Use 0 to clear override (falls back to `mintPriceWei`).
    function setRouteMintPrice(uint256 routeId, uint256 weiAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        routeMintPriceWei[routeId] = weiAmount;
        emit RoutePriceSet(routeId, weiAmount);
    }

    /// @notice Update metadata base URI (admin only).
    function setBaseURI(string memory baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Mint a new ticket NFT. Only addresses with `MINTER_ROLE` may call (free / backend / promo).
    function mint(address to, uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        return _mintTicket(to, routeId, validUntilEpoch, operatorAddr);
    }

    /// @notice Buy a ticket with native MON; mints to `msg.sender` and forwards payment to `treasury`.
    function purchaseTicket(uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        external
        payable
        returns (uint256 tokenId)
    {
        uint256 required = routeMintPriceWei[routeId];
        if (required == 0) {
            required = mintPriceWei;
        }
        if (msg.value < required) {
            revert InsufficientPayment(msg.value, required);
        }
        tokenId = _mintTicket(msg.sender, routeId, validUntilEpoch, operatorAddr);
        (bool ok,) = treasury.call{value: msg.value}("");
        if (!ok) {
            revert TreasuryTransferFailed();
        }
    }

    function _allocateTokenId(address to, uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        internal
        returns (uint256 tokenId)
    {
        for (uint256 attempt = 0; attempt < _MAX_MINT_ATTEMPTS; ++attempt) {
            tokenId = uint256(
                keccak256(
                    abi.encodePacked(
                        ++_mintNonce,
                        block.chainid,
                        to,
                        routeId,
                        validUntilEpoch,
                        operatorAddr,
                        msg.sender,
                        block.timestamp,
                        block.prevrandao,
                        attempt
                    )
                )
            );
            if (!_tokenIdUsed[tokenId]) {
                _tokenIdUsed[tokenId] = true;
                return tokenId;
            }
        }
        revert TokenIdAllocationFailed();
    }

    function _mintTicket(address to, uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        internal
        returns (uint256 tokenId)
    {
        tokenId = _allocateTokenId(to, routeId, validUntilEpoch, operatorAddr);
        routeOf[tokenId] = routeId;
        validUntil[tokenId] = validUntilEpoch;
        operatorOf[tokenId] = operatorAddr;
        _safeMint(to, tokenId);
        unchecked {
            ++totalMinted;
        }
        emit TicketMinted(to, tokenId, routeId, validUntilEpoch, operatorAddr);
    }

    /// @notice Burn after validation. Only `BURNER_ROLE`.
    /// @param expectedHolder Must match current owner (passenger wallet from signed QR).
    function burnTicket(uint256 tokenId, uint256 expectedRouteId, address expectedHolder) external onlyRole(BURNER_ROLE) {
        address from = _ownerOf(tokenId);
        uint256 route = routeOf[tokenId];
        uint64 until = validUntil[tokenId];

        if (block.timestamp > uint256(until)) {
            revert TicketExpired(tokenId, until, block.timestamp);
        }
        if (route != expectedRouteId) {
            revert RouteMismatch(tokenId, expectedRouteId, route);
        }
        if (from != expectedHolder) {
            revert HolderMismatch(tokenId, expectedHolder, from);
        }

        delete routeOf[tokenId];
        delete validUntil[tokenId];
        delete operatorOf[tokenId];
        _burn(tokenId);
        unchecked {
            ++totalBurned;
        }
        emit TicketBurned(from, tokenId, route);
    }

    /// @dev Soulbound: disallow transfers between two non-zero addresses (mint and burn allowed).
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransfer();
        }
        return super._update(to, tokenId, auth);
    }
}
