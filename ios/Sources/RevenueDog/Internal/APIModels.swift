import Foundation

/// Shared JSON coding configuration for the backend contract.
///
/// All dates are ISO-8601 UTC strings (with or without fractional seconds);
/// all keys are snake_case as defined in `docs/API.md`.
enum JSONCoding {

    /// ISO-8601 parser that tolerates optional fractional seconds.
    static let dateDecodingStrategy: JSONDecoder.DateDecodingStrategy = .custom { decoder in
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        if let date = parseDate(string) {
            return date
        }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Invalid ISO-8601 date: \(string)"
        )
    }

    static let dateEncodingStrategy: JSONEncoder.DateEncodingStrategy = .custom { date, encoder in
        var container = encoder.singleValueContainer()
        try container.encode(fractionalFormatter.string(from: date))
    }

    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = dateDecodingStrategy
        return decoder
    }

    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = dateEncodingStrategy
        return encoder
    }

    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parseDate(_ string: String) -> Date? {
        fractionalFormatter.date(from: string) ?? plainFormatter.date(from: string)
    }
}

// MARK: - CustomerInfo (Subscriber) DTOs

/// Top-level response for endpoints that return a subscriber.
struct SubscriberResponseDTO: Decodable {
    let requestDate: Date
    let subscriber: SubscriberDTO

    enum CodingKeys: String, CodingKey {
        case requestDate = "request_date"
        case subscriber
    }
}

/// Alias / logIn response: a subscriber response plus a `created` flag.
struct AliasResponseDTO: Decodable {
    let requestDate: Date
    let subscriber: SubscriberDTO
    let created: Bool

    enum CodingKeys: String, CodingKey {
        case requestDate = "request_date"
        case subscriber
        case created
    }

    var subscriberResponse: SubscriberResponseDTO {
        SubscriberResponseDTO(requestDate: requestDate, subscriber: subscriber)
    }
}

struct SubscriberDTO: Decodable {
    let originalAppUserId: String
    let firstSeen: Date?
    let lastSeen: Date?
    let managementURL: String?
    let entitlements: [String: EntitlementDTO]
    let subscriptions: [String: SubscriptionDTO]
    let nonSubscriptions: [String: [NonSubscriptionDTO]]
    let subscriberAttributes: [String: AttributeDTO]

    enum CodingKeys: String, CodingKey {
        case originalAppUserId = "original_app_user_id"
        case firstSeen = "first_seen"
        case lastSeen = "last_seen"
        case managementURL = "management_url"
        case entitlements
        case subscriptions
        case nonSubscriptions = "non_subscriptions"
        case subscriberAttributes = "subscriber_attributes"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        originalAppUserId = try c.decode(String.self, forKey: .originalAppUserId)
        firstSeen = try c.decodeIfPresent(Date.self, forKey: .firstSeen)
        lastSeen = try c.decodeIfPresent(Date.self, forKey: .lastSeen)
        managementURL = try c.decodeIfPresent(String.self, forKey: .managementURL)
        entitlements = try c.decodeIfPresent([String: EntitlementDTO].self, forKey: .entitlements) ?? [:]
        subscriptions = try c.decodeIfPresent([String: SubscriptionDTO].self, forKey: .subscriptions) ?? [:]
        nonSubscriptions = try c.decodeIfPresent([String: [NonSubscriptionDTO]].self, forKey: .nonSubscriptions) ?? [:]
        subscriberAttributes = try c.decodeIfPresent([String: AttributeDTO].self, forKey: .subscriberAttributes) ?? [:]
    }
}

struct EntitlementDTO: Decodable {
    let expiresDate: Date?
    let purchaseDate: Date?
    let productIdentifier: String
    let gracePeriodExpiresDate: Date?

    enum CodingKeys: String, CodingKey {
        case expiresDate = "expires_date"
        case purchaseDate = "purchase_date"
        case productIdentifier = "product_identifier"
        case gracePeriodExpiresDate = "grace_period_expires_date"
    }
}

struct SubscriptionDTO: Decodable {
    let purchaseDate: Date?
    let originalPurchaseDate: Date?
    let expiresDate: Date?
    let store: String?
    let unsubscribeDetectedAt: Date?
    let billingIssuesDetectedAt: Date?
    let gracePeriodExpiresDate: Date?
    let isSandbox: Bool?
    let periodType: String?
    let willRenew: Bool?

    enum CodingKeys: String, CodingKey {
        case purchaseDate = "purchase_date"
        case originalPurchaseDate = "original_purchase_date"
        case expiresDate = "expires_date"
        case store
        case unsubscribeDetectedAt = "unsubscribe_detected_at"
        case billingIssuesDetectedAt = "billing_issues_detected_at"
        case gracePeriodExpiresDate = "grace_period_expires_date"
        case isSandbox = "is_sandbox"
        case periodType = "period_type"
        case willRenew = "will_renew"
    }
}

struct NonSubscriptionDTO: Decodable {
    let id: String
    let purchaseDate: Date?
    let store: String?
    let isSandbox: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case purchaseDate = "purchase_date"
        case store
        case isSandbox = "is_sandbox"
    }
}

struct AttributeDTO: Decodable {
    let value: String?
    let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case value
        case updatedAt = "updated_at"
    }
}

// MARK: - CustomerInfo mapping

extension SubscriberResponseDTO {

    /// Maps the wire DTO into the public ``CustomerInfo`` model, enriching
    /// entitlements with data from their backing subscription / purchase.
    func toCustomerInfo() -> CustomerInfo {
        let now = Date()

        // Build entitlements, joining each to its backing subscription (for
        // store / will_renew / period_type) or non-subscription record.
        var entitlements: [String: EntitlementInfo] = [:]
        for (key, dto) in subscriber.entitlements {
            let subscription = subscriber.subscriptions[dto.productIdentifier]
            let nonSub = subscriber.nonSubscriptions[dto.productIdentifier]?.last

            let store: Store
            if let subStore = subscription?.store {
                store = Store(rawValueOrUnknown: subStore)
            } else if let nsStore = nonSub?.store {
                store = Store(rawValueOrUnknown: nsStore)
            } else {
                store = .unknown
            }

            let isActive = EntitlementInfo.computeIsActive(
                expirationDate: dto.expiresDate,
                requestDate: requestDate,
                deviceNow: now
            )

            entitlements[key] = EntitlementInfo(
                identifier: key,
                isActive: isActive,
                willRenew: subscription?.willRenew ?? false,
                periodType: PeriodType(rawValueOrNormal: subscription?.periodType),
                latestPurchaseDate: dto.purchaseDate ?? subscription?.purchaseDate ?? nonSub?.purchaseDate,
                expirationDate: dto.expiresDate,
                productIdentifier: dto.productIdentifier,
                store: store
            )
        }

        // Active subscriptions: product ids whose subscription has no expiry
        // or an expiry in the (skew-anchored) future.
        var activeSubscriptions: Set<String> = []
        var latestExpiration: Date?
        for (productId, sub) in subscriber.subscriptions {
            if EntitlementInfo.computeIsActive(expirationDate: sub.expiresDate,
                                               requestDate: requestDate,
                                               deviceNow: now) {
                activeSubscriptions.insert(productId)
            }
            if let exp = sub.expiresDate {
                latestExpiration = latestExpiration.map { max($0, exp) } ?? exp
            }
        }

        var allProductIds = Set(subscriber.subscriptions.keys)
        allProductIds.formUnion(subscriber.nonSubscriptions.keys)

        return CustomerInfo(
            originalAppUserId: subscriber.originalAppUserId,
            entitlements: EntitlementInfos(all: entitlements),
            activeSubscriptions: activeSubscriptions,
            allPurchasedProductIdentifiers: allProductIds,
            latestExpirationDate: latestExpiration,
            managementURL: subscriber.managementURL.flatMap(URL.init(string:)),
            requestDate: requestDate
        )
    }
}

/// Decodes raw subscriber response bodies into the public ``CustomerInfo``.
enum CustomerInfoMapper {

    /// Decodes a `SubscriberResponse` body into a ``CustomerInfo``.
    static func decode(_ data: Data) throws -> CustomerInfo {
        do {
            let dto = try JSONCoding.decoder.decode(SubscriberResponseDTO.self, from: data)
            return dto.toCustomerInfo()
        } catch let error as PurchasesError {
            throw error
        } catch {
            throw PurchasesError.unknown("Failed to decode customer info.", error)
        }
    }

    /// Decodes an alias / logIn response body into a ``CustomerInfo`` plus the
    /// `created` flag.
    static func decodeAlias(_ data: Data) throws -> (customerInfo: CustomerInfo, created: Bool) {
        do {
            let dto = try JSONCoding.decoder.decode(AliasResponseDTO.self, from: data)
            return (dto.subscriberResponse.toCustomerInfo(), dto.created)
        } catch {
            throw PurchasesError.unknown("Failed to decode alias response.", error)
        }
    }
}

// MARK: - Offerings DTOs

struct OfferingsResponseDTO: Decodable {
    let currentOfferingId: String?
    let offerings: [OfferingDTO]
    let experiment: ExperimentDTO?

    enum CodingKeys: String, CodingKey {
        case currentOfferingId = "current_offering_id"
        case offerings
        case experiment
    }
}

struct OfferingDTO: Decodable {
    let identifier: String
    let description: String
    let metadata: [String: JSONValue]
    let packages: [PackageDTO]

    enum CodingKeys: String, CodingKey {
        case identifier, description, metadata, packages
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        identifier = try c.decode(String.self, forKey: .identifier)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        metadata = try c.decodeIfPresent([String: JSONValue].self, forKey: .metadata) ?? [:]
        packages = try c.decodeIfPresent([PackageDTO].self, forKey: .packages) ?? []
    }
}

struct PackageDTO: Decodable {
    let identifier: String
    let platformProductIdentifier: String

    enum CodingKeys: String, CodingKey {
        case identifier
        case platformProductIdentifier = "platform_product_identifier"
    }
}

struct ExperimentDTO: Decodable {
    let id: String
    let variant: String
}

// MARK: - Request bodies

struct ReceiptRequest: Encodable {
    let appUserId: String
    let fetchToken: String
    let productId: String
    let store: String
    let presentedOfferingIdentifier: String?
    let price: Decimal?
    let currency: String?

    enum CodingKeys: String, CodingKey {
        case appUserId = "app_user_id"
        case fetchToken = "fetch_token"
        case productId = "product_id"
        case store
        case presentedOfferingIdentifier = "presented_offering_identifier"
        case price
        case currency
    }
}

struct AliasRequest: Encodable {
    let newAppUserId: String

    enum CodingKeys: String, CodingKey {
        case newAppUserId = "new_app_user_id"
    }
}

struct AttributesRequest: Encodable {
    struct AttributeValue: Encodable {
        let value: String?

        enum CodingKeys: String, CodingKey { case value }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            // Always emit `value`, even when null, so the backend treats a
            // null as an explicit attribute deletion rather than a no-op.
            if let value {
                try container.encode(value, forKey: .value)
            } else {
                try container.encodeNil(forKey: .value)
            }
        }
    }
    let attributes: [String: AttributeValue]
}

// MARK: - Error body

struct ErrorResponseDTO: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
    }
    let error: Body
}
