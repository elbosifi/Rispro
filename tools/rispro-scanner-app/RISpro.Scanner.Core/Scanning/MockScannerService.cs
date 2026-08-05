using System.IO;

namespace RISpro.Scanner.Core.Scanning;

public sealed class MockScannerService : IScannerService
{
    public Task<IReadOnlyList<ScannerOption>> ListScannersAsync(string connectionMode, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ScannerOption>>([new ScannerOption("mock-scanner", "Mock Scanner", connectionMode)]);

    public async Task<ScanResult> ScanToPdfAsync(ScannerProfile profile, string outputDirectory, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(outputDirectory);
        var path = Path.Combine(outputDirectory, $"rispro-mock-scan-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.pdf");
        await File.WriteAllBytesAsync(path, MinimalPdf(), cancellationToken);
        return new ScanResult(path, 1, string.IsNullOrWhiteSpace(profile.Name) ? "Mock Scanner" : profile.Name);
    }

    private static byte[] MinimalPdf() =>
        System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
}
