using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace RISpro.Scanner.Core.Api;

public sealed record ScanSessionContext(
    long SessionId,
    string Status,
    string ExpiresAt,
    string DocumentType,
    PatientContext Patient,
    AppointmentContext Appointment);

public sealed record PatientContext(long Id, string ArabicFullName, string EnglishFullName);
public sealed record AppointmentContext(long Id, string RefType, string AccessionNumber, string AppointmentDate, string ModalityName, string ExamTypeName);

public sealed class RisproScannerApiClient(HttpClient httpClient)
{
    public async Task<ScanSessionContext> GetContextAsync(string token, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/scan-sessions/context");
        request.Headers.Add("X-RISpro-Scan-Token", token);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ContextEnvelope>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("RISpro returned an empty scan context.");
        return body.Context;
    }

    public async Task MarkOpenedAsync(string token, string workstationName, string appVersion, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/scan-sessions/opened");
        request.Headers.Add("X-RISpro-Scan-Token", token);
        request.Content = JsonContent.Create(new { workstationName, appVersion });
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task UploadAsync(string token, string pdfPath, UploadMetadata metadata, CancellationToken cancellationToken = default)
    {
        using var content = new MultipartFormDataContent();
        var fileContent = new StreamContent(File.OpenRead(pdfPath));
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        content.Add(fileContent, "file", Path.GetFileName(pdfPath));
        content.Add(new StringContent(metadata.DocumentType), "documentType");
        content.Add(new StringContent(metadata.PageCount.ToString()), "pageCount");
        content.Add(new StringContent(metadata.ScannerName), "scannerName");
        content.Add(new StringContent(metadata.WorkstationName), "workstationName");
        content.Add(new StringContent(metadata.AppVersion), "appVersion");

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/scan-sessions/upload");
        request.Headers.Add("X-RISpro-Scan-Token", token);
        request.Content = content;
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task CancelAsync(string token, string lastError, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/scan-sessions/cancel");
        request.Headers.Add("X-RISpro-Scan-Token", token);
        request.Content = JsonContent.Create(new { lastError });
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private sealed record ContextEnvelope(ScanSessionContext Context);
}

public sealed record UploadMetadata(
    string DocumentType,
    int PageCount,
    string ScannerName,
    string WorkstationName,
    string AppVersion);
