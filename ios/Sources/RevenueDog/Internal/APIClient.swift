import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Thin URLSession-based client implementing the public (`pk_`) SDK endpoints
/// from `docs/API.md`.
final class APIClient {

    private let apiKey: String
    private let baseURL: URL
    private let session: URLSession
    private let appVersion: String
    private let platformVersion: String

    init(apiKey: String, baseURL: URL, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.session = session

        let osVersion = ProcessInfo.processInfo.operatingSystemVersion
        self.platformVersion = "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"
        self.appVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "unknown"
    }

    // MARK: - Endpoints

    /// `GET /v1/subscribers/{app_user_id}` — returns (and lazily creates) the
    /// subscriber. Returns the raw response body so it can be cached verbatim.
    func getSubscriber(appUserId: String) async throws -> Data {
        try await perform(
            method: "GET",
            path: "/v1/subscribers/\(encode(appUserId))",
            body: Optional<Data>.none
        )
    }

    /// `GET /v1/subscribers/{app_user_id}/offerings`.
    func getOfferings(appUserId: String) async throws -> OfferingsResponseDTO {
        try await request(
            method: "GET",
            path: "/v1/subscribers/\(encode(appUserId))/offerings",
            body: Optional<Data>.none,
            decode: OfferingsResponseDTO.self
        )
    }

    /// `POST /v1/receipts`. Returns the raw subscriber response body.
    func postReceipt(_ receipt: ReceiptRequest) async throws -> Data {
        try await perform(
            method: "POST",
            path: "/v1/receipts",
            body: receipt
        )
    }

    /// `POST /v1/subscribers/{app_user_id}/alias`. Returns the raw response
    /// body (subscriber + `created` flag).
    func postAlias(appUserId: String, newAppUserId: String) async throws -> Data {
        try await perform(
            method: "POST",
            path: "/v1/subscribers/\(encode(appUserId))/alias",
            body: AliasRequest(newAppUserId: newAppUserId)
        )
    }

    /// `POST /v1/subscribers/{app_user_id}/attributes`.
    func postAttributes(appUserId: String, attributes: [String: String?]) async throws {
        let payload = AttributesRequest(
            attributes: attributes.mapValues { AttributesRequest.AttributeValue(value: $0) }
        )
        try await requestNoContent(
            method: "POST",
            path: "/v1/subscribers/\(encode(appUserId))/attributes",
            body: payload
        )
    }

    /// `DELETE /v1/subscribers/{app_user_id}` — GDPR-style delete.
    func deleteSubscriber(appUserId: String) async throws {
        try await requestNoContent(
            method: "DELETE",
            path: "/v1/subscribers/\(encode(appUserId))",
            body: Optional<Data>.none
        )
    }

    // MARK: - Request plumbing

    private func request<Body: Encodable, Response: Decodable>(
        method: String,
        path: String,
        body: Body?,
        decode: Response.Type
    ) async throws -> Response {
        let data = try await perform(method: method, path: path, body: body)
        do {
            return try JSONCoding.decoder.decode(Response.self, from: data)
        } catch {
            Logger.error("Failed to decode \(Response.self) from \(path): \(error)")
            throw PurchasesError.unknown("Failed to decode server response.", error)
        }
    }

    private func requestNoContent<Body: Encodable>(
        method: String,
        path: String,
        body: Body?
    ) async throws {
        _ = try await perform(method: method, path: path, body: body)
    }

    private func perform<Body: Encodable>(
        method: String,
        path: String,
        body: Body?
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw PurchasesError.configuration("Invalid URL for path \(path).")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue(SDKConstants.platform, forHTTPHeaderField: "X-Platform")
        request.setValue(platformVersion, forHTTPHeaderField: "X-Platform-Version")
        request.setValue(SDKConstants.sdkVersion, forHTTPHeaderField: "X-SDK-Version")
        request.setValue(appVersion, forHTTPHeaderField: "X-App-Version")

        if let body, !(body is Data?) {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try JSONCoding.encoder.encode(body)
            } catch {
                throw PurchasesError.unknown("Failed to encode request body.", error)
            }
        }

        Logger.debug("→ \(method) \(url.absoluteString)")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            Logger.error("Network error for \(method) \(path): \(error)")
            throw PurchasesError.network("Network request failed.", error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw PurchasesError.network("Non-HTTP response received.")
        }

        Logger.debug("← \(http.statusCode) \(method) \(url.absoluteString)")

        guard (200..<300).contains(http.statusCode) else {
            throw mapError(status: http.statusCode, data: data)
        }
        return data
    }

    private func mapError(status: Int, data: Data) -> PurchasesError {
        let serverMessage = (try? JSONCoding.decoder.decode(ErrorResponseDTO.self, from: data))?.error.message
        let message = serverMessage ?? "Server returned HTTP \(status)."
        switch status {
        case 401, 403:
            return PurchasesError.configuration(message)
        case 404:
            return PurchasesError.productNotFound(message)
        case 422:
            return PurchasesError.receiptValidationFailed(message)
        case 500...599:
            return PurchasesError.network(message)
        default:
            return PurchasesError.unknown(message)
        }
    }

    private func encode(_ component: String) -> String {
        component.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? component
    }
}
