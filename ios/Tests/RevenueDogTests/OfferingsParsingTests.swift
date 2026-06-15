import XCTest
@testable import RevenueDog

/// Verifies the Offerings response JSON (verbatim from `docs/API.md`) decodes
/// into the wire DTOs correctly. Building the public ``Offerings`` model
/// additionally requires StoreKit, so this focuses on the decode boundary.
final class OfferingsParsingTests: XCTestCase {

    private let sampleJSON = """
    {
      "current_offering_id": "default",
      "offerings": [
        {
          "identifier": "default",
          "description": "Standard paywall",
          "metadata": {},
          "packages": [
            {
              "identifier": "$rd_monthly",
              "platform_product_identifier": "com.app.pro.monthly"
            },
            {
              "identifier": "$rd_annual",
              "platform_product_identifier": "com.app.pro.annual"
            }
          ]
        }
      ],
      "experiment": {
        "id": "exp_1",
        "variant": "treatment"
      }
    }
    """

    func testDecodesOfferingsResponse() throws {
        let dto = try JSONCoding.decoder.decode(OfferingsResponseDTO.self, from: Data(sampleJSON.utf8))

        XCTAssertEqual(dto.currentOfferingId, "default")
        XCTAssertEqual(dto.offerings.count, 1)

        let offering = try XCTUnwrap(dto.offerings.first)
        XCTAssertEqual(offering.identifier, "default")
        XCTAssertEqual(offering.description, "Standard paywall")
        XCTAssertEqual(offering.packages.count, 2)
        XCTAssertEqual(offering.packages.map(\.identifier), ["$rd_monthly", "$rd_annual"])
        XCTAssertEqual(offering.packages.map(\.platformProductIdentifier),
                       ["com.app.pro.monthly", "com.app.pro.annual"])
    }

    func testDecodesExperiment() throws {
        let dto = try JSONCoding.decoder.decode(OfferingsResponseDTO.self, from: Data(sampleJSON.utf8))
        let experiment = try XCTUnwrap(dto.experiment)
        XCTAssertEqual(experiment.id, "exp_1")
        XCTAssertEqual(experiment.variant, "treatment")
    }

    func testNilExperimentDecodes() throws {
        let json = """
        {
          "current_offering_id": "default",
          "offerings": [],
          "experiment": null
        }
        """
        let dto = try JSONCoding.decoder.decode(OfferingsResponseDTO.self, from: Data(json.utf8))
        XCTAssertNil(dto.experiment)
        XCTAssertTrue(dto.offerings.isEmpty)
    }

    func testPackageTypeMapping() {
        XCTAssertEqual(PackageType(identifier: "$rd_lifetime"), .lifetime)
        XCTAssertEqual(PackageType(identifier: "$rd_annual"), .annual)
        XCTAssertEqual(PackageType(identifier: "$rd_six_month"), .sixMonth)
        XCTAssertEqual(PackageType(identifier: "$rd_three_month"), .threeMonth)
        XCTAssertEqual(PackageType(identifier: "$rd_two_month"), .twoMonth)
        XCTAssertEqual(PackageType(identifier: "$rd_monthly"), .monthly)
        XCTAssertEqual(PackageType(identifier: "$rd_weekly"), .weekly)
        XCTAssertEqual(PackageType(identifier: "$rd_some_custom_thing"), .custom)
    }

    func testMetadataDecodesArbitraryJSON() throws {
        let json = """
        {
          "current_offering_id": "default",
          "offerings": [
            {
              "identifier": "default",
              "description": "x",
              "metadata": { "headline": "Save 50%", "badge_count": 3, "enabled": true },
              "packages": []
            }
          ]
        }
        """
        let dto = try JSONCoding.decoder.decode(OfferingsResponseDTO.self, from: Data(json.utf8))
        let metadata = try XCTUnwrap(dto.offerings.first?.metadata).anyDictionary

        XCTAssertEqual(metadata["headline"] as? String, "Save 50%")
        XCTAssertEqual(metadata["badge_count"] as? Double, 3)
        XCTAssertEqual(metadata["enabled"] as? Bool, true)
    }
}
