import XCTest
@testable import RevenueDog

/// Exercises the entitlement active / expiry logic in isolation, with injected
/// clocks so results are deterministic.
final class EntitlementLogicTests: XCTestCase {

    private func date(_ iso: String) throws -> Date {
        try XCTUnwrap(JSONCoding.parseDate(iso))
    }

    func testLifetimeEntitlementIsAlwaysActive() throws {
        let requestDate = try date("2026-06-10T12:00:00Z")
        let now = try date("2030-01-01T00:00:00Z")
        XCTAssertTrue(
            EntitlementInfo.computeIsActive(expirationDate: nil, requestDate: requestDate, deviceNow: now)
        )
    }

    func testFutureExpiryIsActive() throws {
        let requestDate = try date("2026-06-10T12:00:00Z")
        let now = try date("2026-06-10T12:00:00Z")
        let expires = try date("2026-07-10T12:00:00Z")
        XCTAssertTrue(
            EntitlementInfo.computeIsActive(expirationDate: expires, requestDate: requestDate, deviceNow: now)
        )
    }

    func testPastExpiryIsInactive() throws {
        let requestDate = try date("2026-06-10T12:00:00Z")
        let now = try date("2026-08-01T12:00:00Z")
        let expires = try date("2026-07-10T12:00:00Z")
        XCTAssertFalse(
            EntitlementInfo.computeIsActive(expirationDate: expires, requestDate: requestDate, deviceNow: now)
        )
    }

    /// When the device clock lags the server, the server `request_date` is used
    /// as the anchor (we compare against `max(deviceNow, requestDate)`). An
    /// expiry between the lagging device clock and the server time must read as
    /// expired.
    func testUsesServerRequestDateWhenDeviceClockLags() throws {
        let expires = try date("2026-06-10T12:00:00Z")
        let deviceNow = try date("2026-06-10T11:00:00Z")   // device behind
        let requestDate = try date("2026-06-10T13:00:00Z") // server ahead of expiry

        XCTAssertFalse(
            EntitlementInfo.computeIsActive(expirationDate: expires, requestDate: requestDate, deviceNow: deviceNow),
            "Expiry before the server-anchored now should be inactive even if the device clock is behind."
        )
    }

    func testExpiryAfterBothAnchorsIsActive() throws {
        let expires = try date("2026-06-10T14:00:00Z")
        let deviceNow = try date("2026-06-10T11:00:00Z")
        let requestDate = try date("2026-06-10T13:00:00Z")

        XCTAssertTrue(
            EntitlementInfo.computeIsActive(expirationDate: expires, requestDate: requestDate, deviceNow: deviceNow)
        )
    }

    func testActiveAndExpiredEntitlementsSplitCorrectly() throws {
        // Two entitlements: one active (future expiry), one expired (past).
        let json = """
        {
          "request_date": "2026-06-10T12:00:00Z",
          "subscriber": {
            "original_app_user_id": "u",
            "entitlements": {
              "pro": {
                "expires_date": "2999-01-01T00:00:00Z",
                "purchase_date": "2026-06-10T12:00:00Z",
                "product_identifier": "com.app.pro",
                "grace_period_expires_date": null
              },
              "old": {
                "expires_date": "2000-01-01T00:00:00Z",
                "purchase_date": "1999-06-10T12:00:00Z",
                "product_identifier": "com.app.old",
                "grace_period_expires_date": null
              }
            }
          }
        }
        """
        let info = try CustomerInfoMapper.decode(Data(json.utf8))

        XCTAssertEqual(info.entitlements.all.count, 2)
        XCTAssertTrue(info.entitlements["pro"]?.isActive == true)
        XCTAssertTrue(info.entitlements["old"]?.isActive == false)
        XCTAssertEqual(Set(info.entitlements.active.keys), ["pro"])
    }

    func testLifetimeNonSubscriptionEntitlementIsActive() throws {
        let json = """
        {
          "request_date": "2026-06-10T12:00:00Z",
          "subscriber": {
            "original_app_user_id": "u",
            "entitlements": {
              "forever": {
                "expires_date": null,
                "purchase_date": "2026-06-10T12:00:00Z",
                "product_identifier": "com.app.lifetime",
                "grace_period_expires_date": null
              }
            },
            "non_subscriptions": {
              "com.app.lifetime": [
                { "id": "t1", "purchase_date": "2026-06-10T12:00:00Z", "store": "app_store", "is_sandbox": false }
              ]
            }
          }
        }
        """
        let info = try CustomerInfoMapper.decode(Data(json.utf8))
        let forever = try XCTUnwrap(info.entitlements["forever"])
        XCTAssertTrue(forever.isActive)
        XCTAssertNil(forever.expirationDate)
        XCTAssertEqual(forever.store, .appStore)
        XCTAssertFalse(forever.willRenew)
    }
}
