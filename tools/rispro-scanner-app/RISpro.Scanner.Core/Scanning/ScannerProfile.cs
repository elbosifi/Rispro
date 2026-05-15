namespace RISpro.Scanner.Core.Scanning;

public sealed record ScannerProfile(string Name, int Dpi, string ColorMode, string Source);
public sealed record ScanResult(string PdfPath, int PageCount, string ScannerName);

public interface IScannerService
{
    Task<IReadOnlyList<string>> ListScannersAsync(CancellationToken cancellationToken = default);
    Task<ScanResult> ScanToPdfAsync(ScannerProfile profile, string outputDirectory, CancellationToken cancellationToken = default);
}
