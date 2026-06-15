import XCTest
@testable import RevenueDog

/// Verifies that the backend `CustomerInfo` JSON (verbatim from `docs/API.md`)
/// decodes and maps into the public ``CustomerInfo`` model correctly. Runs with
/// no network and no StoreKit.
final class CustomerInfoParsingTests: XCTestCase {

    /// The exact CustomerInfo sample from the API contract.
    private let sampleJSON = """
    {
      "request_date": "2026-06-10T12:00:00Z",
      "subscriber": {
        "original_app_user_id": "user_123",
        "first_seen": "2026-01-01T00:00:00Z",
        "last_seen": "2026-06-10T12:00:00Z",
        "management_url": null,
        "entitlements": {
          "pro": {
            "expires_date": "2026-07-10T12:00:00Z",
            "purchase_date": "2026-06-10T12:00:00Z",
            "product_identifier": "com.app.pro.monthly",
            "grace_period_expires_date": null
          }
        },
        "subscriptions": {
          "com.app.pro.monthly": {
            "purchase_date": "2026-06-10T12:00:00Z",
            "original_purchase_date": "2026-06-10T12:00:00Z",
            "expires_date": "2026-07-10T12:00:00Z",
            "store": "app_store",
            "unsubscribe_detected_at": null,
            "billing_issues_detected_at": null,
            "grace_period_expires_date": null,
            "is_sandbox": true,
            "period_type": "normal",
            "will_renew": true
          }
        },
        "non_subscriptions": {
          "com.app.lifetime": [
            {
              "id": "txn_abc",
              "purchase_date": "2026-06-10T12:00:00Z",
              "store": "play_store",
              "is_sandbox": false
            }
          ]
        },
        "subscriber_attributes": {
          "$email": { "value": "a@b.com", "updated_at": "2026-06-10T12:00:00Z" }
        }
      }
    }
    """

    func testDecodesTopLevelFields() throws {
        let info = try CustomerInfoMapper.decode(Data(sampleJSON.utf8))

        XCTAssertEqual(info.originalAppUserId, "user_123")
        XCTAssertNil(info.managementURL)
        XCTAssertEqual(info.requestDate, JSONCoding.parseDate("2026-06-10T12:00:00Z"))
        XCTAssertEqual(info.latestExpirationDate, JSONCoding.parseDate("2026-07-10T12:00:00Z"))
    }

    func testDecodesEntitlementJoinedToSubscription() throws {
        let info = try CustomerInfoMapper.decode(Data(sampleJSON.utf8))

        let pro = try XCTUnwrap(info.entitlements["pro"])
        XCTAssertEqual(pro.identifier, "pro")
        XCTAssertEqual(pro.productIdentifier, "com.app.pro.monthly")
        XCTAssertEqual(pro.store, .appStore)
        XCTAssertEqual(pro.periodType, .normal)
        XCTAssertTrue(pro.willRenew)
        XCTAssertEqual(pro.expirationDate, JSONCoding.parseDate("2026-07-10T12:00:00Z"))
        XCTAssertEqual(pro.latestPurchaseDate, JSONCoding.parseDate("2026-06-10T12:00:00Z"))

        // `get` and subscript should agree.
        XCTAssertEqual(info.entitlements.get("pro"), pro)
        XCTAssertNil(info.entitlements["does_not_exist"])
    }

    func testCollectsAllPurchasedProductIdentifiers() throws {
        let info = try CustomerInfoMapper.decode(Data(sampleJSON.utf8))

        XCTAssertEqual(
            info.allPurchasedProductIdentifiers,
            ["com.app.pro.monthly", "com.app.lifetime"]
        )
    }

    func testActiveEntitlementRelativeToFixedNow() throws {
        // Use a fixed "now" before the expiry so the assertion is stable
        // regardless of when the test runs.
        let requestDate = try XCTUnwrap(JSONCoding.parseDate("2026-06-10T12:00:00Z"))
        let expires = try XCTUnwrap(JSONCoding.parseDate("2026-07-10T12:00:00Z"))
        let now = try XCTUnwrap(JSONCoding.parseDate("2026-06-15T12:00:00Z"))

        XCTAssertTrue(
            EntitlementInfo.computeIsActive(expirationDate: expires, requestDate: requestDate, deviceNow: now)
        )
    }

    func testEmptyCollectionsDecodeGracefully() throws {
        let json = """
        {
          "request_date": "2026-06-10T12:00:00Z",
          "subscriber": { "original_app_user_id": "u" }
        }
        """
        let info = try CustomerInfoMapper.decode(Data(json.utf8))

        XCTAssertEqual(info.originalAppUserId, "u")
        XCTAssertTrue(info.entitlements.all.isEmpty)
        XCTAssertTrue(info.activeSubscriptions.isEmpty)
        XCTAssertTrue(info.allPurchasedProductIdentifiers.isEmpty)
        XCTAssertNil(info.latestExpirationDate)
    }

    func testManagementURLDecodesWhenPresent() throws {
        let json = """
        {
          "request_date": "2026-06-10T12:00:00Z",
          "subscriber": {
            "original_app_user_id": "u",
            "management_url": "https://apps.apple.com/account/subscriptions"
          }
        }
        """
        let info = try CustomerInfoMapper.decode(Data(json.utf8))
        XCTAssertEqual(info.managementURL, URL(string: "https://apps.apple.com/account/subscriptions"))
    }
}
