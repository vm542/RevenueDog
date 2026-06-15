import Foundation

/// A `Codable` representation of an arbitrary JSON value.
///
/// Used to decode open-ended fields such as an offering's `metadata` object,
/// which the contract types as `[String: Any]`.
enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value):   try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value):  try container.encode(value)
        case .null:              try container.encodeNil()
        }
    }

    /// Converts the value into a plain `Any` graph suitable for the public
    /// `[String: Any]` metadata surface.
    var anyValue: Any {
        switch self {
        case .string(let value): return value
        case .number(let value): return value
        case .bool(let value):   return value
        case .object(let value): return value.mapValues { $0.anyValue }
        case .array(let value):  return value.map { $0.anyValue }
        case .null:              return NSNull()
        }
    }
}

extension Dictionary where Key == String, Value == JSONValue {
    /// Projects a JSON object into the public `[String: Any]` representation.
    var anyDictionary: [String: Any] {
        mapValues { $0.anyValue }
    }
}
