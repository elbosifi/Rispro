namespace RISpro.Scanner.Core.Scanning;

public sealed record ScannerOption(string Id, string DisplayName, string ConnectionMode)
{
    public override string ToString() => DisplayName;
}

public sealed record ScannerProfile(string Id, string Name, string ConnectionMode, int Dpi, string ColorMode, string Source);
public sealed record ScanResult(string PdfPath, int PageCount, string ScannerName);

public interface IScannerService
{
    Task<IReadOnlyList<ScannerOption>> ListScannersAsync(string connectionMode, CancellationToken cancellationToken = default);
    Task<ScanResult> ScanToPdfAsync(ScannerProfile profile, string outputDirectory, CancellationToken cancellationToken = default);
}
