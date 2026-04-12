// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/// @dev Minimal ERC-20 interface used only for USDC payment (transferFrom + balanceOf).
interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title ChainPassTicket
/// @notice Soulbound ERC-721 transit ticket: gated mint, role-gated burn, indexable events.
///         Accepts native MON or USDC for public purchases.
/// @dev Token IDs are pseudo-random uint256 values (not sequential); not unpredictable RNG—do not rely on them for secrecy.
contract ChainPassTicket is ERC721Enumerable, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @dev Increments each allocation attempt so successive mints yield distinct candidate IDs.
    uint256 private _mintNonce;

    /// @dev Once set, an ID is never reused (covers burned tickets).
    mapping(uint256 tokenId => bool) private _tokenIdUsed;

    uint256 private constant _MAX_MINT_ATTEMPTS = 256;

    string private _baseTokenURI;

    /// @notice Receives native MON and USDC from ticket purchases (Monad testnet).
    address payable public immutable treasury;

    /// @notice Lifetime count of successful mints (including still-held and burned tokens).
    uint256 public totalMinted;

    /// @notice Lifetime count of successful `burnTicket` calls.
    uint256 public totalBurned;

    // ─── MON pricing ─────────────────────────────────────────────────────────

    /// @notice Default minimum wei for `purchaseTicket` when `routeMintPriceWei[routeId]` is unset (0).
    uint256 public mintPriceWei;

    /// @notice Per-route override for `purchaseTicket`. If 0, `mintPriceWei` applies.
    mapping(uint256 routeId => uint256) public routeMintPriceWei;

    // ─── USDC pricing ────────────────────────────────────────────────────────

    /// @notice ERC-20 token accepted as payment (set by admin; address(0) = disabled).
    address public usdcToken;

    /// @notice Default USDC price for `purchaseTicketWithUSDC` (6 decimals). 0 = disabled.
    uint256 public mintPriceUsdc;

    /// @notice Per-route USDC override. If 0, `mintPriceUsdc` applies for that route.
    mapping(uint256 routeId => uint256) public routeMintPriceUsdc;

    // ─── Token metadata ───────────────────────────────────────────────────────

    mapping(uint256 tokenId => uint256) public routeOf;
    mapping(uint256 tokenId => uint64) public validUntil;
    mapping(uint256 tokenId => address) public operatorOf;

    /// @notice Addresses permitted to be recorded as `operatorAddr` on minted tickets.
    ///         address(0) is approved by default so existing zero-address sentinel usage works.
    mapping(address => bool) public approvedOperators;

    // ─── Loyalty / reward tiers ───────────────────────────────────────────────

    /// @notice Lifetime completed rides (burned tickets) per rider address.
    mapping(address rider => uint256) public rideCount;

    /// @notice Free-ride credits already redeemed per rider.
    mapping(address rider => uint256) public freeRidesClaimed;

    /// @dev Tier thresholds (ride counts at which each tier is first reached).
    uint256 private constant BRONZE_THRESHOLD   = 1;
    uint256 private constant SILVER_THRESHOLD   = 10;
    uint256 private constant GOLD_THRESHOLD     = 25;
    uint256 private constant PLATINUM_THRESHOLD = 50;

    /// @dev Completed rides required to earn one free-ride credit.
    uint256 private constant RIDES_PER_FREE_RIDE = 10;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error SoulboundTransfer();
    error OperatorNotApproved(address operator);
    error NoFreeRideCredits();
    error TicketExpired(uint256 tokenId, uint64 validUntilEpoch, uint256 nowTimestamp);
    error RouteMismatch(uint256 tokenId, uint256 expectedRouteId, uint256 actualRouteId);
    error HolderMismatch(uint256 tokenId, address expectedHolder, address actualOwner);
    error InsufficientPayment(uint256 sent, uint256 required);
    error TreasuryTransferFailed();
    error ExcessRefundFailed();
    error TokenIdAllocationFailed();
    error UsdcNotConfigured();
    error UsdcTransferFailed();
    error InvalidQuantity();

    // ─── Events ───────────────────────────────────────────────────────────────

    event TicketMinted(
        address indexed to, uint256 indexed tokenId, uint256 routeId, uint64 validUntilEpoch, address operatorAddr
    );
    event TicketBurned(address indexed from, uint256 indexed tokenId, uint256 routeId);
    event OperatorApproved(address indexed operator, bool approved);
    event RideCompleted(address indexed rider, uint256 newCount);
    event TierReached(address indexed rider, string tier);
    event FreeRideClaimed(address indexed rider, uint256 indexed tokenId);
    event RoutePriceSet(uint256 indexed routeId, uint256 weiAmount);
    event MintPriceSet(uint256 weiAmount);
    event BaseURISet(string baseURI);
    event UsdcTokenSet(address indexed token);
    event UsdcRoutePriceSet(uint256 indexed routeId, uint256 amount);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param admin       Receives DEFAULT_ADMIN_ROLE.
    /// @param baseURI_    Base URI for {tokenURI}; empty string if unset.
    /// @param treasury_   Receives all payments.
    /// @param mintPriceWei_ Default MON price (wei); 0 for free on testnets.
    constructor(address admin, string memory baseURI_, address payable treasury_, uint256 mintPriceWei_)
        ERC721("ChainPass Ticket", "PASS")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _baseTokenURI = baseURI_;
        treasury = treasury_;
        mintPriceWei = mintPriceWei_;
        // Allow address(0) as a zero-operator sentinel by default.
        approvedOperators[address(0)] = true;
    }

    // ─── Admin: operator whitelist ────────────────────────────────────────────

    /// @notice Approve or revoke an operator address. Only approved addresses may be
    ///         passed as `operatorAddr` when minting tickets.
    function setOperatorApproved(address operator, bool approved)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        approvedOperators[operator] = approved;
        emit OperatorApproved(operator, approved);
    }

    // ─── Admin: MON pricing ───────────────────────────────────────────────────

    function setMintPriceWei(uint256 newPriceWei) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintPriceWei = newPriceWei;
        emit MintPriceSet(newPriceWei);
    }

    function setRouteMintPrice(uint256 routeId, uint256 weiAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        routeMintPriceWei[routeId] = weiAmount;
        emit RoutePriceSet(routeId, weiAmount);
    }

    // ─── Admin: USDC pricing ──────────────────────────────────────────────────

    /// @notice Set the ERC-20 token accepted for USDC payments. Use address(0) to disable.
    function setUsdcToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        usdcToken = token;
        emit UsdcTokenSet(token);
    }

    /// @notice Set default USDC price (6 decimals). Use 0 to disable global USDC purchases.
    function setMintPriceUsdc(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintPriceUsdc = amount;
    }

    /// @notice Per-route USDC override. Use 0 to clear (falls back to `mintPriceUsdc`).
    function setRouteUsdcPrice(uint256 routeId, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        routeMintPriceUsdc[routeId] = amount;
        emit UsdcRoutePriceSet(routeId, amount);
    }

    // ─── Admin: metadata ─────────────────────────────────────────────────────

    function setBaseURI(string memory baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ─── Loyalty views & claiming ─────────────────────────────────────────────

    /// @notice Returns all loyalty state for `rider` in a single RPC call.
    /// @return rides     Lifetime completed rides.
    /// @return earned    Total free-ride credits earned (floor(rides / 10)).
    /// @return claimed   Free-ride credits already redeemed.
    /// @return available Credits that can be claimed right now.
    /// @return tier      Current tier label: "None", "Bronze", "Silver", "Gold", or "Platinum".
    function loyaltyInfo(address rider)
        external
        view
        returns (
            uint256 rides,
            uint256 earned,
            uint256 claimed,
            uint256 available,
            string memory tier
        )
    {
        rides   = rideCount[rider];
        earned  = rides / RIDES_PER_FREE_RIDE;
        claimed = freeRidesClaimed[rider];
        available = earned > claimed ? earned - claimed : 0;

        if      (rides >= PLATINUM_THRESHOLD) tier = "Platinum";
        else if (rides >= GOLD_THRESHOLD)     tier = "Gold";
        else if (rides >= SILVER_THRESHOLD)   tier = "Silver";
        else if (rides >= BRONZE_THRESHOLD)   tier = "Bronze";
        else                                  tier = "None";
    }

    /// @notice Spend one free-ride credit and instantly mint a ticket to `msg.sender`.
    /// @dev Caller must have at least one unredeemed credit (floor(rideCount/10) > freeRidesClaimed).
    ///      `operatorAddr` must be whitelisted via `setOperatorApproved`.
    function claimFreeRide(
        uint256 routeId,
        uint64  validUntilEpoch,
        address operatorAddr
    )
        external
        returns (uint256 tokenId)
    {
        address rider   = msg.sender;
        uint256 earned  = rideCount[rider] / RIDES_PER_FREE_RIDE;
        uint256 claimed = freeRidesClaimed[rider];
        if (earned <= claimed) revert NoFreeRideCredits();

        unchecked { ++freeRidesClaimed[rider]; }
        tokenId = _mintTicket(rider, routeId, validUntilEpoch, operatorAddr);
        emit FreeRideClaimed(rider, tokenId);
    }

    // ─── Minting ──────────────────────────────────────────────────────────────

    /// @notice Mint a ticket (free / backend / promo). Only `MINTER_ROLE`.
    function mint(address to, uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        return _mintTicket(to, routeId, validUntilEpoch, operatorAddr);
    }

    /// @notice Buy a ticket with native MON; forwards payment to treasury, refunds any excess.
    function purchaseTicket(uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        external
        payable
        returns (uint256 tokenId)
    {
        uint256 required = routeMintPriceWei[routeId];
        if (required == 0) required = mintPriceWei;

        if (msg.value < required) revert InsufficientPayment(msg.value, required);

        tokenId = _mintTicket(msg.sender, routeId, validUntilEpoch, operatorAddr);

        (bool ok,) = treasury.call{value: required}("");
        if (!ok) revert TreasuryTransferFailed();

        // Refund any overpayment
        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool refundOk,) = msg.sender.call{value: excess}("");
            if (!refundOk) revert ExcessRefundFailed();
        }
    }

    /// @notice Buy multiple tickets at once with native MON; one signature, total price charged.
    /// @param qty Number of tickets (1–20).
    function batchPurchaseTicket(uint256 routeId, uint64 validUntilEpoch, address operatorAddr, uint256 qty)
        external
        payable
        returns (uint256[] memory tokenIds)
    {
        if (qty == 0 || qty > 20) revert InvalidQuantity();

        uint256 unitPrice = routeMintPriceWei[routeId];
        if (unitPrice == 0) unitPrice = mintPriceWei;

        uint256 totalRequired = unitPrice * qty;
        if (msg.value < totalRequired) revert InsufficientPayment(msg.value, totalRequired);

        tokenIds = new uint256[](qty);
        for (uint256 i = 0; i < qty; ++i) {
            tokenIds[i] = _mintTicket(msg.sender, routeId, validUntilEpoch, operatorAddr);
        }

        (bool ok,) = treasury.call{value: totalRequired}("");
        if (!ok) revert TreasuryTransferFailed();

        uint256 excess = msg.value - totalRequired;
        if (excess > 0) {
            (bool refundOk,) = msg.sender.call{value: excess}("");
            if (!refundOk) revert ExcessRefundFailed();
        }
    }

    /// @notice Buy a ticket paying with `usdcToken`. Caller must pre-approve this contract.
    ///         `usdcToken` and a non-zero USDC price must be configured by an admin first.
    function purchaseTicketWithUSDC(uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        external
        returns (uint256 tokenId)
    {
        address token = usdcToken;
        if (token == address(0)) revert UsdcNotConfigured();

        uint256 required = routeMintPriceUsdc[routeId];
        if (required == 0) required = mintPriceUsdc;
        if (required == 0) revert UsdcNotConfigured();

        // Pull payment first (revert on failure — no state has changed yet)
        bool ok = IERC20Minimal(token).transferFrom(msg.sender, treasury, required);
        if (!ok) revert UsdcTransferFailed();

        tokenId = _mintTicket(msg.sender, routeId, validUntilEpoch, operatorAddr);
    }

    /// @notice Buy multiple tickets at once with USDC; caller must pre-approve total amount.
    /// @param qty Number of tickets (1–20).
    function batchPurchaseTicketWithUSDC(uint256 routeId, uint64 validUntilEpoch, address operatorAddr, uint256 qty)
        external
        returns (uint256[] memory tokenIds)
    {
        if (qty == 0 || qty > 20) revert InvalidQuantity();

        address token = usdcToken;
        if (token == address(0)) revert UsdcNotConfigured();

        uint256 unitPrice = routeMintPriceUsdc[routeId];
        if (unitPrice == 0) unitPrice = mintPriceUsdc;
        if (unitPrice == 0) revert UsdcNotConfigured();

        uint256 totalRequired = unitPrice * qty;
        bool ok = IERC20Minimal(token).transferFrom(msg.sender, treasury, totalRequired);
        if (!ok) revert UsdcTransferFailed();

        tokenIds = new uint256[](qty);
        for (uint256 i = 0; i < qty; ++i) {
            tokenIds[i] = _mintTicket(msg.sender, routeId, validUntilEpoch, operatorAddr);
        }
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _allocateTokenId(address to, uint256 routeId, uint64 validUntilEpoch, address operatorAddr)
        internal
        returns (uint256 tokenId)
    {
        for (uint256 attempt = 0; attempt < _MAX_MINT_ATTEMPTS; ++attempt) {
            tokenId = uint256(
                keccak256(
                    abi.encodePacked(
                        ++_mintNonce, block.chainid, to, routeId,
                        validUntilEpoch, operatorAddr, msg.sender,
                        block.timestamp, block.prevrandao, attempt
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
        if (!approvedOperators[operatorAddr]) revert OperatorNotApproved(operatorAddr);
        tokenId = _allocateTokenId(to, routeId, validUntilEpoch, operatorAddr);
        routeOf[tokenId]    = routeId;
        validUntil[tokenId] = validUntilEpoch;
        operatorOf[tokenId] = operatorAddr;
        _safeMint(to, tokenId);
        unchecked { ++totalMinted; }
        emit TicketMinted(to, tokenId, routeId, validUntilEpoch, operatorAddr);
    }

    // ─── Burning ──────────────────────────────────────────────────────────────

    /// @notice Validate and burn a ticket at the gate. Only `BURNER_ROLE`.
    function burnTicket(uint256 tokenId, uint256 expectedRouteId, address expectedHolder)
        external
        onlyRole(BURNER_ROLE)
    {
        address from  = _requireOwned(tokenId);
        uint256 route = routeOf[tokenId];
        uint64  until = validUntil[tokenId];

        if (block.timestamp >= uint256(until)) revert TicketExpired(tokenId, until, block.timestamp);
        if (route != expectedRouteId)          revert RouteMismatch(tokenId, expectedRouteId, route);
        if (from  != expectedHolder)           revert HolderMismatch(tokenId, expectedHolder, from);

        delete routeOf[tokenId];
        delete validUntil[tokenId];
        delete operatorOf[tokenId];
        _burn(tokenId);
        unchecked { ++totalBurned; }

        // ── Loyalty accounting ────────────────────────────────────────────────
        uint256 newCount;
        unchecked { newCount = ++rideCount[from]; }
        emit RideCompleted(from, newCount);
        if      (newCount == BRONZE_THRESHOLD)   emit TierReached(from, "Bronze");
        else if (newCount == SILVER_THRESHOLD)   emit TierReached(from, "Silver");
        else if (newCount == GOLD_THRESHOLD)     emit TierReached(from, "Gold");
        else if (newCount == PLATINUM_THRESHOLD) emit TierReached(from, "Platinum");

        emit TicketBurned(from, tokenId, route);
    }

    // ─── Soulbound ────────────────────────────────────────────────────────────

    /// @dev Disallow transfers between two non-zero addresses (mint and burn allowed).
    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert SoulboundTransfer();
        return super._update(to, tokenId, auth);
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
}
