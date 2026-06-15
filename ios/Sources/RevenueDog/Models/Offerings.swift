import Foundation

/// The complete set of ``Offering``s configured for the app, plus the
/// currently-selected one.
public struct Offerings {
    /// The current offering, as resolved by the backend (experiment-aware), or
    /// `nil` if none is configured.
    public let current: Offering?
    /// All offerings keyed by identifier.
    public let all: [String: Offering]

    public init(current: Offering?, all: [String: Offering]) {
        self.current = current
        self.all = all
    }

    /// Look up an offering by identifier.
    public func offering(identifier: String) -> Offering? {
        all[identifier]
    }

    /// Look up an offering by identifier.
    public func get(_ identifier: String) -> Offering? {
        all[identifier]
    }

    /// Look up an offering by identifier via subscript.
    public subscript(_ identifier: String) -> Offering? {
        all[identifier]
    }
}
