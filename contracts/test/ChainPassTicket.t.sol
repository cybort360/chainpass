// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ChainPassTicket} from "../src/ChainPassTicket.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

contract ChainPassTicketTest is Test {
    ChainPassTicket internal ticket;

    address internal admin = address(0xA11);
    address internal minter = address(0xB22);
    address internal burner = address(0xC33);
    address internal alice = address(0xD44);
    address internal bob = address(0xE55);
    address payable internal treasury = payable(address(0x7Ee));

    uint256 internal constant ROUTE = 7;
    uint64 internal constant VALID_UNTIL = 1_700_000_000;
    address internal constant OPERATOR = address(0xF66);

    string internal constant BASE_URI = "https://example.com/meta/";

    uint256 internal constant PRICE = 0.1 ether;

    event TicketBurned(address indexed from, uint256 indexed tokenId, uint256 routeId);

    event RoutePriceSet(uint256 indexed routeId, uint256 weiAmount);

    function setUp() public {
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.startPrank(admin);
        ticket = new ChainPassTicket(admin, BASE_URI, treasury, 0);
        ticket.grantRole(ticket.MINTER_ROLE(), minter);
        ticket.grantRole(ticket.BURNER_ROLE(), burner);
        // Whitelist the test operator address used in all mint calls.
        ticket.setOperatorApproved(OPERATOR, true);
        vm.stopPrank();
    }

    function test_totalMinted_totalBurned_counters() public {
        assertEq(ticket.totalMinted(), 0);
        assertEq(ticket.totalBurned(), 0);

        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);
        assertEq(ticket.totalMinted(), 1);
        assertEq(ticket.totalBurned(), 0);

        vm.prank(minter);
        ticket.mint(bob, ROUTE, VALID_UNTIL, OPERATOR);
        assertEq(ticket.totalMinted(), 2);

        vm.prank(burner);
        ticket.burnTicket(id, ROUTE, alice);
        assertEq(ticket.totalBurned(), 1);
        assertEq(ticket.totalMinted(), 2);
    }

    function test_mint_onlyMinter() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);
        assertTrue(id != 0);
        assertEq(ticket.ownerOf(id), alice);
        assertEq(ticket.routeOf(id), ROUTE);
        assertEq(ticket.validUntil(id), VALID_UNTIL);
        assertEq(ticket.operatorOf(id), OPERATOR);
    }

    function test_tokenURI_concatenatesBaseAndId() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);
        assertEq(ticket.tokenURI(id), string.concat(BASE_URI, vm.toString(id)));
    }

    function test_mint_revertsWithoutRole() public {
        vm.prank(alice);
        vm.expectRevert();
        ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);
    }

    function test_soulbound_transferReverts() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);

        vm.prank(alice);
        vm.expectRevert(ChainPassTicket.SoulboundTransfer.selector);
        ticket.transferFrom(alice, bob, id);
    }

    function test_soulbound_safeTransferReverts() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);

        vm.prank(alice);
        vm.expectRevert(ChainPassTicket.SoulboundTransfer.selector);
        ticket.safeTransferFrom(alice, bob, id);
    }

    function test_burn_onlyBurner() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);

        vm.prank(burner);
        vm.expectEmit(true, true, true, true);
        emit TicketBurned(alice, id, ROUTE);
        ticket.burnTicket(id, ROUTE, alice);

        vm.expectRevert();
        ticket.ownerOf(id);
    }

    function test_burn_revertsForNonBurner() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);

        vm.prank(alice);
        vm.expectRevert();
        ticket.burnTicket(id, ROUTE, alice);
    }

    function test_burn_revertsWhenExpired() public {
        uint64 until = uint64(block.timestamp + 1 days);
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, until, OPERATOR);

        vm.warp(block.timestamp + 2 days);

        vm.prank(burner);
        vm.expectRevert(
            abi.encodeWithSelector(ChainPassTicket.TicketExpired.selector, id, until, block.timestamp)
        );
        ticket.burnTicket(id, ROUTE, alice);
    }

    function test_burn_revertsOnRouteMismatch() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);

        vm.prank(burner);
        vm.expectRevert(
            abi.encodeWithSelector(ChainPassTicket.RouteMismatch.selector, id, uint256(999), ROUTE)
        );
        ticket.burnTicket(id, 999, alice);
    }

    function test_burn_revertsOnHolderMismatch() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);

        vm.prank(burner);
        vm.expectRevert(
            abi.encodeWithSelector(ChainPassTicket.HolderMismatch.selector, id, bob, alice)
        );
        ticket.burnTicket(id, ROUTE, bob);
    }

    function test_doubleBurn_reverts() public {
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);

        vm.prank(burner);
        ticket.burnTicket(id, ROUTE, alice);

        vm.prank(burner);
        vm.expectRevert();
        ticket.burnTicket(id, ROUTE, alice);
    }

    function test_purchaseTicket_mintsAndSendsMonToTreasury() public {
        vm.prank(admin);
        ticket.setMintPriceWei(PRICE);

        uint256 balBefore = treasury.balance;
        vm.prank(alice);
        uint256 id = ticket.purchaseTicket{value: PRICE}(ROUTE, VALID_UNTIL, OPERATOR, ChainPassTicket.SeatClass.Economy);
        assertEq(ticket.ownerOf(id), alice);
        assertEq(treasury.balance - balBefore, PRICE);
    }

    function test_purchaseTicket_revertsInsufficientPayment() public {
        vm.prank(admin);
        ticket.setMintPriceWei(PRICE);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ChainPassTicket.InsufficientPayment.selector, PRICE - 1, PRICE)
        );
        ticket.purchaseTicket{value: PRICE - 1}(ROUTE, VALID_UNTIL, OPERATOR, ChainPassTicket.SeatClass.Economy);
    }

    function test_setMintPriceWei_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert();
        ticket.setMintPriceWei(1);

        vm.prank(admin);
        ticket.setMintPriceWei(PRICE);
        assertEq(ticket.mintPriceWei(), PRICE);
    }

    function test_purchaseTicket_perRouteOverride_beatsGlobal() public {
        uint256 overridePrice = 0.05 ether;
        vm.startPrank(admin);
        ticket.setMintPriceWei(PRICE);
        vm.expectEmit(true, true, true, true);
        emit RoutePriceSet(ROUTE, overridePrice);
        ticket.setRouteMintPrice(ROUTE, overridePrice);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ChainPassTicket.InsufficientPayment.selector, overridePrice - 1, overridePrice)
        );
        ticket.purchaseTicket{value: overridePrice - 1}(ROUTE, VALID_UNTIL, OPERATOR, ChainPassTicket.SeatClass.Economy);

        vm.prank(alice);
        uint256 id = ticket.purchaseTicket{value: overridePrice}(ROUTE, VALID_UNTIL, OPERATOR, ChainPassTicket.SeatClass.Economy);
        assertEq(ticket.ownerOf(id), alice);
    }

    function test_purchaseTicket_fallbackToGlobalWhenRouteUnset() public {
        uint256 routeUnset = 99;
        vm.prank(admin);
        ticket.setMintPriceWei(PRICE);
        assertEq(ticket.routeMintPriceWei(routeUnset), 0);

        vm.prank(alice);
        uint256 id = ticket.purchaseTicket{value: PRICE}(routeUnset, VALID_UNTIL, OPERATOR, ChainPassTicket.SeatClass.Economy);
        assertEq(ticket.ownerOf(id), alice);
    }

    function test_purchaseTicket_twoRoutes_differentOverrides() public {
        uint256 route1 = 1;
        uint256 route2 = 2;
        uint256 p1 = 1 ether;
        uint256 p2 = 2 ether;

        vm.startPrank(admin);
        ticket.setMintPriceWei(0);
        ticket.setRouteMintPrice(route1, p1);
        ticket.setRouteMintPrice(route2, p2);
        vm.stopPrank();

        vm.prank(alice);
        uint256 idAlice = ticket.purchaseTicket{value: p1}(route1, VALID_UNTIL, OPERATOR, ChainPassTicket.SeatClass.Economy);
        vm.prank(bob);
        uint256 idBob = ticket.purchaseTicket{value: p2}(route2, VALID_UNTIL, OPERATOR, ChainPassTicket.SeatClass.Economy);

        assertEq(ticket.ownerOf(idAlice), alice);
        assertEq(ticket.routeOf(idAlice), route1);
        assertEq(ticket.ownerOf(idBob), bob);
        assertEq(ticket.routeOf(idBob), route2);
    }

    function test_setRouteMintPrice_onlyAdmin() public {
        vm.prank(bob);
        vm.expectRevert();
        ticket.setRouteMintPrice(ROUTE, 1 ether);

        vm.prank(admin);
        ticket.setRouteMintPrice(ROUTE, 1 ether);
        assertEq(ticket.routeMintPriceWei(ROUTE), 1 ether);
    }

    function test_twoMints_distinctIdsAndEnumerable() public {
        vm.startPrank(minter);
        uint256 id1 = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);
        uint256 id2 = ticket.mint(alice, ROUTE, VALID_UNTIL, OPERATOR);
        vm.stopPrank();

        assertTrue(id1 != id2);
        assertEq(ticket.balanceOf(alice), 2);
        assertEq(ticket.totalSupply(), 2);
        assertEq(ticket.tokenOfOwnerByIndex(alice, 0), id1);
        assertEq(ticket.tokenOfOwnerByIndex(alice, 1), id2);
    }

    function test_supportsInterface_enumerable() public view {
        assertTrue(ticket.supportsInterface(type(IERC721Enumerable).interfaceId));
    }

    // ── Loyalty / tier tests ───────────────────────────────────────────────────

    event RideCompleted(address indexed rider, uint256 newCount);
    event TierReached(address indexed rider, string tier);
    event FreeRideClaimed(address indexed rider, uint256 indexed tokenId);

    /// @dev Mint and burn `n` tickets for `rider` with a validity far in the future.
    function _doRides(address rider, uint256 n) internal {
        uint64 until = uint64(block.timestamp + 365 days);
        for (uint256 i = 0; i < n; ++i) {
            vm.prank(minter);
            uint256 id = ticket.mint(rider, ROUTE, until, OPERATOR);
            vm.prank(burner);
            ticket.burnTicket(id, ROUTE, rider);
        }
    }

    function test_loyalty_rideCountIncrements() public {
        assertEq(ticket.rideCount(alice), 0);
        _doRides(alice, 3);
        assertEq(ticket.rideCount(alice), 3);
    }

    function test_loyalty_tierNoneBeforeFirstRide() public view {
        (,,,, string memory tier) = ticket.loyaltyInfo(alice);
        assertEq(tier, "None");
    }

    function test_loyalty_bronzeAfterOneRide() public {
        _doRides(alice, 1);
        (uint256 rides,,,, string memory tier) = ticket.loyaltyInfo(alice);
        assertEq(rides, 1);
        assertEq(tier, "Bronze");
    }

    function test_loyalty_silverAt10() public {
        _doRides(alice, 10);
        (uint256 rides,,,, string memory tier) = ticket.loyaltyInfo(alice);
        assertEq(rides, 10);
        assertEq(tier, "Silver");
    }

    function test_loyalty_goldAt25() public {
        _doRides(alice, 25);
        (uint256 rides,,,, string memory tier) = ticket.loyaltyInfo(alice);
        assertEq(rides, 25);
        assertEq(tier, "Gold");
    }

    function test_loyalty_tierEvent_emittedAtBoundary() public {
        // Mint separately so we can target the exact burn transaction for TierReached
        uint64 until = uint64(block.timestamp + 365 days);
        vm.prank(minter);
        uint256 id = ticket.mint(alice, ROUTE, until, OPERATOR);

        // Expect TierReached(alice, "Bronze") emitted during this specific burn
        vm.expectEmit(true, false, false, true);
        emit TierReached(alice, "Bronze");
        vm.prank(burner);
        ticket.burnTicket(id, ROUTE, alice);
    }

    function test_loyalty_freeRideEarnedAt10() public {
        _doRides(alice, 10);
        (,uint256 earned,, uint256 available,) = ticket.loyaltyInfo(alice);
        assertEq(earned, 1);
        assertEq(available, 1);
    }

    function test_loyalty_claimFreeRide() public {
        _doRides(alice, 10);

        uint64 until = uint64(block.timestamp + 7 days);
        vm.prank(alice);
        uint256 freeId = ticket.claimFreeRide(ROUTE, until, OPERATOR);

        assertEq(ticket.ownerOf(freeId), alice);
        (,, uint256 claimed, uint256 available,) = ticket.loyaltyInfo(alice);
        assertEq(claimed, 1);
        assertEq(available, 0);
    }

    function test_loyalty_claimRevertsWithNoCredits() public {
        _doRides(alice, 5); // only 5 rides — no credit yet
        uint64 until = uint64(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(ChainPassTicket.NoFreeRideCredits.selector);
        ticket.claimFreeRide(ROUTE, until, OPERATOR);
    }

    function test_loyalty_multipleCreditsAccumulate() public {
        _doRides(alice, 25); // 2 free rides (floor(25/10))
        (,uint256 earned,, uint256 available,) = ticket.loyaltyInfo(alice);
        assertEq(earned, 2);
        assertEq(available, 2);
    }
}
