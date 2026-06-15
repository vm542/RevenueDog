import Foundation

/// Verbosity levels for the RevenueDog SDK logger.
///
/// Ordered from most to least verbose. Set the desired level on
/// ``Purchases/logLevel``. The default is ``LogLevel/info``.
public enum LogLevel: Int, Comparable, Sendable, CaseIterable {
    case verbose = 0
    case debug   = 1
    case info    = 2
    case warn    = 3
    case error   = 4

    public static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var label: String {
        switch self {
        case .verbose: return "VERBOSE"
        case .debug:   return "DEBUG"
        case .info:    return "INFO"
        case .warn:    return "WARN"
        case .error:   return "ERROR"
        }
    }
}

/// Lightweight console logger. All output is prefixed with `[RevenueDog]`.
///
/// Messages are emitted only when their level is greater than or equal to the
/// currently configured ``Logger/level``.
enum Logger {

    /// Prefix prepended to every log line.
    static let prefix = "[RevenueDog]"

    /// Backing storage for the threshold level, guarded by ``lock``.
    private static var _level: LogLevel = .info
    private static let lock = NSLock()

    /// The minimum level that will be printed.
    static var level: LogLevel {
        get { lock.lock(); defer { lock.unlock() }; return _level }
        set { lock.lock(); _level = newValue; lock.unlock() }
    }

    static func verbose(_ message: @autoclosure () -> String) { log(.verbose, message()) }
    static func debug(_ message: @autoclosure () -> String)   { log(.debug, message()) }
    static func info(_ message: @autoclosure () -> String)     { log(.info, message()) }
    static func warn(_ message: @autoclosure () -> String)     { log(.warn, message()) }
    static func error(_ message: @autoclosure () -> String)    { log(.error, message()) }

    private static func log(_ level: LogLevel, _ message: @autoclosure () -> String) {
        guard level >= self.level else { return }
        print("\(prefix) [\(level.label)] \(message())")
    }
}

/// Compile-time constants describing this SDK build.
enum SDKConstants {
    /// Current RevenueDog SDK version, sent as `X-SDK-Version`.
    static let sdkVersion = "0.1.0"

    /// Value sent in the `X-Platform` header.
    static let platform = "ios"

    /// Prefix used when generating anonymous app user identifiers.
    static let anonymousIDPrefix = "$RevenueDogAnonymousID:"

    /// Default base URL, only used automatically in DEBUG builds.
    static let debugBaseURL = URL(string: "http://localhost:8787")!

    /// Standard (RevenueDog-managed) package identifiers.
    static let lifetimePackageID   = "$rd_lifetime"
    static let annualPackageID     = "$rd_annual"
    static let sixMonthPackageID   = "$rd_six_month"
    static let threeMonthPackageID = "$rd_three_month"
    static let twoMonthPackageID   = "$rd_two_month"
    static let monthlyPackageID    = "$rd_monthly"
    static let weeklyPackageID     = "$rd_weekly"

    /// CustomerInfo cache lifetime used by ``FetchPolicy/cachedOrFetch``.
    static let cacheStaleInterval: TimeInterval = 5 * 60
}
